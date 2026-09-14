import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { hexlify } from 'ethers'
import { memoize } from 'micro-memoize'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import { getAddressBytes } from '../utils.ts'
import { withLookupRetry } from './events.ts'
import {
  deriveObjectID,
  getLatestPackageId,
  getObjectFields,
  getObjectRef,
  getPackageDisassembly,
} from './objects.ts'

/**
 * Discovers the CCIP package ID associated with a given Sui onramp package.
 *
 * @param ramp - sui onramp or offramp address, packageId with module suffix
 * @param client - sui client
 * @returns ccip package id
 */
export const getCcipStateAddress = memoize(
  async (ramp: string, client: SuiJsonRpcClient): Promise<string> => {
    // View calls must target the latest package (old versions are
    // version-gated and revert); state pointers are resolved by the callee
    ramp = await getLatestPackageId(ramp, client)
    const tx = new Transaction()
    tx.moveCall({
      target: `${ramp}::get_ccip_package_id`,
    })

    const inspectResult = await client.devInspectTransactionBlock({
      sender: normalizeSuiAddress('0x0'),
      transactionBlock: tx,
    })
    const returnValues = inspectResult.results?.[0]?.returnValues
    if (!returnValues?.length) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'No return values from dev inspect')
    }
    const [valueBytes] = returnValues[0]!

    return normalizeSuiAddress(hexlify(getAddressBytes(valueBytes))) + '::state_object'
  },
  { maxArgs: 1, async: true },
)

/**
 * Resolves any address of a Sui CCIP deployment to that deployment's ccip state
 * object, the deployment's canonical "router" handle: the same address for
 * both of its ramps, and the entrypoint every router-taking API accepts.
 *
 * Accepts a ramp (`<pkg>::onramp`/`<pkg>::offramp`), the ccip package itself
 * (`<pkg>::state_object`), a bare package id of either (classified by the
 * `*Pointer` object the package owns), or the bare state object id (classified
 * by the `CCIPObjectRef` type the object carries, which names the ccip package).
 */
export const resolveCcipStateAddress = memoize(
  async (address: string, client: SuiJsonRpcClient): Promise<string> => {
    const packageId = normalizeSuiAddress(address.split('::')[0]!)
    const module = address.split('::')[1] ?? (await moduleOfPackage(packageId, client))
    if (module === 'state_object') return `${packageId}::state_object`
    if (module) return getCcipStateAddress(`${packageId}::${module}`, client)

    // Bare ID with no package pointer: accept it if the object itself is the
    // state object, whose type names the original ccip package it belongs to.
    const object = await client
      .getObject({ id: packageId, options: { showType: true } })
      .catch(() => null)
    if (object?.data?.type?.includes('::state_object::CCIPObjectRef')) {
      return `${normalizeSuiAddress(object.data.type.split('::')[0]!)}::state_object`
    }
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `${packageId} is not a Sui CCIP package or state object (no state pointer)`,
    )
  },
  { maxArgs: 1, async: true, expires: 300e3 },
)

/**
 * Classifies a CCIP package by the `*Pointer` object it owns: every CCIP package
 * transfers one to itself (`OnRampStatePointer`, `OffRampStatePointer`,
 * `CCIPObjectRefPointer`, `RouterStatePointer`), and its type names the module.
 *
 * One small request per package, which makes it the cheap way to sift a large
 * candidate set — an ABI fetch would pull a whole module's bytecode metadata.
 */
export const moduleOfPackage = memoize(
  async (packageId: string, client: SuiJsonRpcClient): Promise<string | undefined> => {
    // The package-owned `*Pointer` object's type names the module (on-chain
    // state, one small request); the module is then validated - where the
    // package is interpretable - against its disassembly module list.
    const owned = await withLookupRetry(() =>
      client.getOwnedObjects({ owner: packageId, options: { showType: true } }),
    ).catch(() => null)
    const module = owned?.data
      .map((obj) => obj.data?.type?.split('::') ?? [])
      .find(([, , name]) => name?.endsWith('Pointer'))?.[1]
    if (module) return module

    // No pointer object: fall back to the disassembly. A single functional
    // module names the package; token pool packages expose exactly one
    // `*_token_pool` module alongside support modules.
    const disassembled = await getPackageDisassembly(packageId, client).catch(() => undefined)
    const mods = disassembled ? Object.keys(disassembled) : []
    const tokenPools = mods.filter((name) => name.endsWith('_token_pool'))
    if (mods.length === 1) return mods[0]
    if (tokenPools.length === 1) return tokenPools[0]
    return undefined
  },
  { maxArgs: 1, async: true, expires: 300e3 },
)

/**
 * Resolves the onramp serving `destChainSelector` of a CCIP deployment from the
 * deployment's RouterState (`ccip_router::router::RouterState.on_ramp_package_ids`),
 * using only current object state - no transaction or event scanning.
 *
 * The RouterState is not linked to the ccip package on-chain, but it shares its
 * owner: that owner's UpgradeCaps enumerate the deployment's packages, and the
 * one exposing a `router` module is the router package. Its package-owned
 * `RouterStatePointer` derives the shared `RouterState`, whose dest-selector map
 * names the onramp package. The candidate is confirmed by resolving its
 * `get_ccip_package_id` back to `ccip`.
 *
 * Caveat: when a deployment is owned by the MCMS package (the usual production
 * setup), the UpgradeCaps live with the deployer account, which is not
 * reachable from the ccip state - in that case this throws and callers fall
 * back to the activity scan (chainlink-sui's on-chain design keeps no other
 * deterministic ccip→router edge).
 *
 * @throws {@link CCIPError} if no RouterState onramp matches the selector
 */
export const getOnRampForSelectorFromRouterState = memoize(
  async (ccip: string, destChainSelector: bigint, client: SuiJsonRpcClient): Promise<string> => {
    const ccipRefId = await getObjectRef(ccip, client)
    const refFields = await getObjectFields(ccipRefId, client)
    const owner = (refFields['ownable_state'] as { fields?: { owner?: string } } | undefined)
      ?.fields?.owner
    if (!owner) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `No owner on the ccip state object ${ccipRefId} to locate its router`,
      )
    }

    const owned = await withLookupRetry(() =>
      client.getOwnedObjects({
        owner,
        filter: { StructType: '0x2::package::UpgradeCap' },
        options: { showContent: true },
      }),
    )
    const packages = [
      ...new Set(
        owned.data.flatMap((obj) => {
          const content = obj.data?.content
          if (content?.dataType !== 'moveObject') return []
          const pkg = (content.fields as { package?: string }).package
          return pkg ? [normalizeSuiAddress(pkg)] : []
        }),
      ),
    ]

    for (const routerPkg of packages) {
      const disassembled = await getPackageDisassembly(routerPkg, client).catch(() => undefined)
      if (!disassembled || !disassembled['router']) continue

      // the router package owns a RouterStatePointer; the shared RouterState is
      // derived from it under the key b"RouterState"
      const pointers = await withLookupRetry(() =>
        client.getOwnedObjects({ owner: routerPkg, options: { showContent: true } }),
      ).catch(() => null)
      let parentObjectId: string | undefined
      for (const obj of pointers?.data ?? []) {
        const content = obj.data?.content
        if (content?.dataType !== 'moveObject') continue
        const parent = Object.entries(content.fields as Record<string, unknown>).find(([key]) =>
          key.endsWith('_object_id'),
        )?.[1]
        if (typeof parent === 'string') {
          parentObjectId = parent
          break
        }
      }
      if (!parentObjectId) continue

      const routerStateId = deriveObjectID(parentObjectId, new TextEncoder().encode('RouterState'))
      const stateFields = await getObjectFields(routerStateId, client).catch(() => undefined)
      if (!stateFields) continue
      const entries = ((
        stateFields['on_ramp_package_ids'] as { fields?: { contents?: unknown[] } } | undefined
      )?.fields?.contents ?? []) as { fields?: { key?: string | number; value?: string } }[]
      const entry = entries.find(
        ({ fields }) => fields?.key != null && BigInt(fields.key) === destChainSelector,
      )
      const onRampPkg = entry?.fields?.value
      if (!onRampPkg) continue

      // confirm the onramp belongs to THIS ccip deployment
      const onRamp = `${normalizeSuiAddress(onRampPkg)}::onramp`
      const resolved = await getCcipStateAddress(onRamp, client).catch(() => undefined)
      if (resolved !== ccip) continue
      return onRamp
    }

    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `No RouterState onramp found for dest chain ${destChainSelector}`,
      { context: { ccip } },
    )
  },
  { maxArgs: 2, async: true, expires: 300e3 },
)

/**
 * Discovers the offramp package via MCMS upgrade history within retention:
 * the owner of the CCIPObjectRef is the MCMS package; its
 * `mcms_deployer::commit_upgrade` transactions publish new package versions.
 * Scanning them (and their created objects) finds the offramp package without
 * needing the pruned publish tx. Works on history-pruned RPCs as long as one
 * upgrade happened within transaction retention.
 */
async function findOffRampPackageByUpgrades(
  ccip: string,
  client: SuiJsonRpcClient,
): Promise<string | undefined> {
  const ccipRefId = await getObjectRef(ccip, client)
  const ccipRef = await withLookupRetry(() =>
    client.getObject({ id: ccipRefId, options: { showContent: true } }),
  )
  const content = ccipRef.data?.content
  if (content?.dataType !== 'moveObject') return
  const owner = (
    (content.fields as Record<string, unknown>)['ownable_state'] as
      | { fields?: { owner?: unknown } }
      | undefined
  )?.fields?.owner
  if (typeof owner !== 'string') return

  let cursor: string | null | undefined
  do {
    const txs = await withLookupRetry(() =>
      client.queryTransactionBlocks({
        filter: {
          MoveFunction: {
            package: normalizeSuiAddress(owner),
            module: 'mcms_deployer',
            function: 'commit_upgrade',
          },
        },
        options: { showEffects: true },
        cursor,
        limit: 50,
        order: 'descending',
      }),
    )
    for (const tx of txs.data) {
      for (const created of tx.effects?.created ?? []) {
        const modules = await client
          .getNormalizedMoveModulesByPackage({ package: created.reference.objectId })
          .catch(() => null)
        if (!modules || !('offramp' in modules)) continue
        // module.address is the *original* package id (possibly not zero-padded)
        return normalizeSuiAddress(modules['offramp'].address) + '::offramp'
      }
    }
    cursor = txs.hasNextPage ? txs.nextCursor : null
  } while (cursor)
}

/**
 * Discovers the offramp packages of a CCIP deployment from activity on its
 * `CCIPObjectRef`.
 *
 * Sui has no on-chain offramp registry: `ccip_router::RouterState` only maps
 * dest chain selectors to onramp packages, and `CCIPObjectRef.package_ids` only
 * tracks the ccip package's own versions. The one thing every offramp
 * commit/execute must do is take the deployment's `CCIPObjectRef` as an input
 * object. Filtering transactions by that input object therefore scopes the scan
 * to a single CCIP deployment — unlike a global event scan — and needs no
 * ownership, publish or upgrade history. Those transactions name the offramp
 * both in their `<offrampPkg>::offramp::*` events and in their
 * `<offrampPkg>::offramp::commit|execute` PTB calls.
 *
 * @param ccip - ccip package address (`<pkg>::state_object`)
 * @param client - sui client
 * @param opts - pagination bounds
 * @returns offramp addresses (`<pkg>::offramp`) seen committing/executing
 */
export async function findOffRampPackagesByCcipActivity(
  ccip: string,
  client: SuiJsonRpcClient,
  { maxPages = 20, limit = 50 }: { maxPages?: number; limit?: number } = {},
): Promise<string[]> {
  const ccipRefId = await getObjectRef(ccip, client)
  // event types carry the *original* package id; PTB calls target the latest
  const found = new Set<string>()
  const called = new Set<string>()
  let cursor: string | null | undefined
  for (let page = 0; page < maxPages; page++) {
    const res = await withLookupRetry(() =>
      client.queryTransactionBlocks({
        filter: { InputObject: ccipRefId },
        options: { showEvents: true, showInput: true },
        cursor,
        limit,
        order: 'descending',
      }),
    )
    let hasContents = false
    for (const tx of res.data) {
      for (const event of tx.events ?? []) {
        hasContents = true
        const match = event.type.match(/^(0x[0-9a-fA-F]+)::offramp::/)
        if (match) found.add(normalizeSuiAddress(match[1]!) + '::offramp')
      }
      const data = tx.transaction?.data.transaction
      if (!data || !('transactions' in data)) continue
      hasContents = true
      for (const command of data.transactions) {
        if (typeof command !== 'object' || !('MoveCall' in command)) continue
        if (command.MoveCall.module === 'offramp') called.add(command.MoveCall.package)
      }
    }
    if (found.size || called.size) break
    // RPCs which prune transaction contents list the digests but return neither
    // events nor inputs; paging further can't turn up anything
    if (!hasContents) break
    if (!res.hasNextPage || !res.data.length) break
    // Guard against stuck pagination (some RPCs repeat the cursor)
    if (cursor && res.nextCursor === cursor) break
    cursor = res.nextCursor
  }

  // State pointers live on the original package, so map each called (latest)
  // package id back through its module's defining address
  for (const pkg of called) {
    const asCalled = normalizeSuiAddress(pkg) + '::offramp'
    if (found.has(asCalled)) continue
    const module = await client
      .getNormalizedMoveModule({ package: pkg, module: 'offramp' })
      .catch(() => null)
    found.add(module ? normalizeSuiAddress(module.address) + '::offramp' : asCalled)
  }
  return [...found]
}

/**
 * Discovers the offramp package by scanning recent events for offramp event
 * types (`<pkg>::offramp::*`). Works on history-pruned RPCs once any offramp
 * activity (commit/execute/config) exists within event retention.
 */
export async function findOffRampPackageByEvents(
  client: SuiJsonRpcClient,
  {
    maxPages = 100,
    limit = 50,
    startTime = 0,
  }: { maxPages?: number; limit?: number; startTime?: number } = {},
): Promise<string | undefined> {
  const filter = { TimeRange: { startTime: startTime.toString(), endTime: Date.now().toString() } }
  let cursor: { txDigest: string; eventSeq: string } | null | undefined
  for (let page = 0; page < maxPages; page++) {
    const res = await withLookupRetry(() =>
      client.queryEvents({ query: filter, cursor, limit, order: 'descending' }),
    )
    for (const event of res.data) {
      const match = event.type.match(/^(0x[0-9a-fA-F]+)::offramp::/)
      if (match) return normalizeSuiAddress(match[1]!) + '::offramp'
    }
    if (!res.hasNextPage || !res.data.length) break
    // Guard against stuck pagination (some RPCs return the same cursor repeatedly
    // on very large event ranges)
    if (
      cursor &&
      res.nextCursor &&
      res.nextCursor.txDigest === cursor.txDigest &&
      res.nextCursor.eventSeq === cursor.eventSeq
    )
      break
    cursor = res.nextCursor
  }
}

/**
 * Reads the Ownable owner from a ramp's state object. The owner is either a
 * deployer EOA (before ownership is transferred to MCMS) or the MCMS package.
 */
async function getRampOwner(ramp: string, client: SuiJsonRpcClient): Promise<string | undefined> {
  const stateObjectId = await getObjectRef(ramp, client)
  const obj = await withLookupRetry(() =>
    client.getObject({ id: stateObjectId, options: { showContent: true } }),
  )
  const content = obj.data?.content
  if (content?.dataType !== 'moveObject') return
  const ownable = (content.fields as Record<string, unknown>)['ownable_state'] as
    | { fields?: { owner?: unknown } }
    | undefined
  const owner = ownable?.fields?.owner
  return typeof owner === 'string' ? owner : undefined
}

/**
 * Discovers offramps from a ramp's deployer owner.
 *
 * Before ramps are transferred to MCMS they are Ownable-owned by the deployer
 * EOA, which also owns the offramp's OwnerCap. This uses only current state (no
 * pruned publish/upgrade history), which matters on Sui RPCs with short
 * transaction/event retention.
 *
 * It is a last resort, not a primary path: shared testnet deployer keys own
 * hundreds of objects across unrelated deployments (150 OwnerCaps / 35 offramp
 * packages on sui-testnet at the time of writing), so this costs one page-walk
 * plus one probe per candidate package, and it finds nothing at all once
 * ownership has moved to MCMS. Candidates are narrowed to offramps referencing
 * the *same* ccip package as the ramp; the caller still matches the one whose
 * source chain config lists the expected onramp.
 */
export async function getOffRampsFromRampOwner(
  ramp: string,
  client: SuiJsonRpcClient,
): Promise<string[]> {
  const owner = await getRampOwner(ramp, client).catch(() => undefined)
  if (!owner) return []

  const rampCcipId = (await getCcipStateAddress(ramp, client).catch(() => undefined))?.split(
    '::',
  )[0]

  // Enumerate the owner's objects looking for Ownable OwnerCaps. OwnerCaps are
  // not returned by an unfiltered getOwnedObjects on every RPC, so request
  // showType and filter client-side.
  const pkgIds = new Set<string>()
  let cursor: string | null | undefined
  for (let page = 0; page < 100; page++) {
    const res = await withLookupRetry(() =>
      client.getOwnedObjects({ owner, options: { showType: true }, cursor, limit: 50 }),
    )
    for (const obj of res.data) {
      const type = obj.data?.type
      if (type?.includes('::ownable::OwnerCap')) pkgIds.add(type.split('::')[0]!)
    }
    cursor = res.hasNextPage ? res.nextCursor : null
    if (!cursor || !res.data.length) break
  }

  // Probe a single module instead of the whole package ABI: the normalized
  // module of every candidate would be megabytes of unused bytecode metadata.
  const offrampPkgs = (
    await Promise.all(
      [...pkgIds].map((pkg) =>
        client
          .getNormalizedMoveModule({ package: pkg, module: 'offramp' })
          // module.address is the *original* package id (possibly not zero-padded)
          .then((module) => normalizeSuiAddress(module.address) + '::offramp')
          .catch(() => undefined),
      ),
    )
  ).filter((offramp): offramp is string => !!offramp)

  if (!rampCcipId) return offrampPkgs
  const offramps: string[] = []
  for (const offramp of offrampPkgs) {
    const offrampCcipId = (
      await getCcipStateAddress(offramp, client).catch(() => undefined)
    )?.split('::')[0]
    if (offrampCcipId === rampCcipId) offramps.push(offramp)
  }
  return offramps
}

/**
 * Gets the Sui offramp packages associated with a given CCIP package ID.
 *
 * Strategies are tried cheapest/most-reliable first: activity on the
 * deployment's CCIPObjectRef, then MCMS upgrade transactions, then the ccip
 * publish transaction, then a global event scan.
 *
 * @param ccip - Sui CCIP Package Id
 * @param client - Sui client
 * @returns Sui offramp package ids (`<pkg>::offramp`)
 */
export const getOffRampsForCcip = memoize(
  async (ccip: string, client: SuiJsonRpcClient): Promise<string[]> => {
    const byActivity = await findOffRampPackagesByCcipActivity(ccip, client).catch(() => [])
    if (byActivity.length) return byActivity

    let historyErr: unknown
    try {
      return [await getOffRampForCcip_(ccip, client)]
    } catch (err) {
      // The history path is brittle on pruned/limited indexers (missing publish
      // tx, pruned OwnerCap objects, stripped effects); fall back to MCMS
      // upgrade txs within retention, then to scanning recent events
      historyErr = err
    }
    const offramp =
      (await findOffRampPackageByUpgrades(ccip, client).catch(() => undefined)) ??
      (await findOffRampPackageByEvents(client).catch(() => undefined))
    if (offramp) return [offramp]
    throw historyErr
  },
  { maxArgs: 1, async: true, expires: 300e3 },
)

/** Sui CCIP ramp modules, each living in its own package. */
export type RampModule = 'onramp' | 'offramp'

/**
 * Scans transactions matching `filter` for a ramp module, newest first, and
 * returns the ramp packages named by their events or PTB calls.
 */
async function findRampPackagesByTxFilter(
  client: SuiJsonRpcClient,
  filter: Parameters<SuiJsonRpcClient['queryTransactionBlocks']>[0]['filter'],
  module: RampModule,
  { maxPages = 20, limit = 50 }: { maxPages?: number; limit?: number } = {},
): Promise<string[]> {
  const eventType = new RegExp(`^(0x[0-9a-fA-F]+)::${module}::`)
  // event types carry the *original* package id; PTB calls target the latest
  const found = new Set<string>()
  const called = new Set<string>()
  let cursor: string | null | undefined
  for (let page = 0; page < maxPages; page++) {
    const res = await withLookupRetry(() =>
      client.queryTransactionBlocks({
        filter,
        options: { showEvents: true, showInput: true },
        cursor,
        limit,
        order: 'descending',
      }),
    )
    let hasContents = false
    for (const tx of res.data) {
      for (const event of tx.events ?? []) {
        hasContents = true
        const match = event.type.match(eventType)
        if (match) found.add(normalizeSuiAddress(match[1]!) + `::${module}`)
      }
      const data = tx.transaction?.data.transaction
      if (!data || !('transactions' in data)) continue
      hasContents = true
      for (const command of data.transactions) {
        if (typeof command !== 'object' || !('MoveCall' in command)) continue
        if (command.MoveCall.module === module) called.add(command.MoveCall.package)
      }
    }
    if (found.size || called.size) break
    // RPCs which prune transaction contents list the digests but return neither
    // events nor inputs; paging further can't turn up anything
    if (!hasContents) break
    if (!res.hasNextPage || !res.data.length) break
    // Guard against stuck pagination (some RPCs repeat the cursor)
    if (cursor && res.nextCursor === cursor) break
    cursor = res.nextCursor
  }

  // State pointers live on the original package, so map each called (latest)
  // package id back through its module's defining address
  for (const pkg of called) {
    const asCalled = normalizeSuiAddress(pkg) + `::${module}`
    if (found.has(asCalled)) continue
    const moduleAbi = await client
      .getNormalizedMoveModule({ package: pkg, module })
      .catch(() => null)
    found.add(moduleAbi ? normalizeSuiAddress(moduleAbi.address) + `::${module}` : asCalled)
  }
  return [...found]
}

/**
 * Gets the Sui onramp packages associated with a given CCIP package ID.
 *
 * Unlike the offramp there is no publish/upgrade history to anchor on (those
 * routes key off the CCIPObjectRef's owner, which provisions the ccip package,
 * not the ramps), so the onramps are recovered from on-chain activity:
 * every `ccip_send` builds its `TokenTransferParams` through the ccip
 * package's `onramp_state_helper` module, which makes that the most selective
 * scan available. Sends call the package's LATEST version (older versions are
 * version-gated and revert), so the scan filters on the latest package id;
 * the original id matches nothing once a deployment has been upgraded. The
 * CCIPObjectRef scan is repeated as a broader fallback (it also pages through
 * the commit backlog, so it runs second).
 *
 * @param ccip - ccip state object address (`<pkg>::state_object`)
 * @param client - Sui client
 * @returns Sui onramp package ids (`<pkg>::onramp`)
 */
export const getOnRampsForCcip = memoize(
  async (ccip: string, client: SuiJsonRpcClient): Promise<string[]> => {
    const latestPkg = normalizeSuiAddress((await getLatestPackageId(ccip, client)).split('::')[0]!)
    const byHelper = await findRampPackagesByTxFilter(
      client,
      { MoveFunction: { package: latestPkg, module: 'onramp_state_helper' } },
      'onramp',
    ).catch(() => [])
    if (byHelper.length) return byHelper

    const byRef = await findRampPackagesByTxFilter(
      client,
      { InputObject: await getObjectRef(ccip, client) },
      'onramp',
      { maxPages: 40 },
    ).catch(() => [])
    if (byRef.length) return byRef

    throw new CCIPError(CCIPErrorCode.UNKNOWN, `No onramp activity found for ccip ${ccip}`)
  },
  { maxArgs: 1, async: true, expires: 300e3 },
)

/**
 * Gets the Sui offramp package ID associated with a given CCIP package ID.
 *
 * @param ccip - Sui CCIP Package Id
 * @param client - Sui client
 * @returns Sui offramp package id
 * @see {@link getOffRampsForCcip} when more than one candidate is acceptable
 */
export async function getOffRampForCcip(ccip: string, client: SuiJsonRpcClient): Promise<string> {
  const [offramp] = await getOffRampsForCcip(ccip, client)
  if (!offramp)
    throw new CCIPError(CCIPErrorCode.UNKNOWN, `Could not find offramp package for ccip ${ccip}`)
  return offramp
}

const getOffRampForCcip_ = async (ccip: string, client: SuiJsonRpcClient) => {
  // Get CCIP publish tx info
  // Get the owner cap created in that tx.
  // Get owner of the ownercap object.
  // Get objects owned by that owner.
  // Trough each of the objects owned by that owner, get the original transaction that created them.
  // Take any of the objects created by that transaction, check its info to find the OffRamp package.
  const ccipObject = await withLookupRetry(() =>
    client.getObject({
      id: ccip.split('::')[0]!,
      options: {
        showPreviousTransaction: true,
      },
    }),
  )

  // Get the tx that created the ownercap object.
  const ccipCreationTxDigest = ccipObject.data?.previousTransaction
  if (!ccipCreationTxDigest) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      'Could not find previous transaction for CCIP object',
    )
  }

  if (!ccipCreationTxDigest) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'CCIP object has no previous transaction')
  }

  const ccipCreationTx = await withLookupRetry(() =>
    client.getTransactionBlock({
      digest: ccipCreationTxDigest,
      options: {
        showEffects: true,
        showInput: true,
      },
    }),
  ).catch((err) => {
    if (err instanceof Error && /could not find the referenced transaction/i.test(err.message)) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `CCIP creation transaction ${ccipCreationTxDigest} was pruned on this RPC`,
      )
    }
    throw err
  })

  let mcmsPackageId: string | undefined
  const txData = ccipCreationTx.transaction?.data.transaction
  if (txData && 'transactions' in txData) {
    const publishTx = txData.transactions.find((t) => {
      return typeof t === 'object' && 'Publish' in t
    })
    if (publishTx) {
      // First element in Publish array is the MCMS package ID
      mcmsPackageId = publishTx.Publish[0]
    }
  }

  const ccipCreatedObjects = ccipCreationTx.effects?.created?.map((obj) => obj.reference.objectId)
  if (!ccipCreatedObjects || ccipCreatedObjects.length === 0) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'No created objects found in creation transaction')
  }

  const ccipObjectsData = await Promise.all(
    ccipCreatedObjects.map((objId) =>
      client.getObject({
        id: objId,
        options: {
          showType: true,
          showContent: true,
          showOwner: true,
        },
      }),
    ),
  )

  // If owner cap was transferred to MCMS, the object will not exist anymore
  const erroredObjects = ccipObjectsData
    .filter((obj) => !!obj.error && obj.error.code === 'notExists')
    .map((obj) => (obj as { error: { object_id: string } }).error.object_id)

  // we need mcmsPackageId to proceed with owner cap lookup
  if (erroredObjects.length && !mcmsPackageId) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      'MCMS package ID not found, cannot proceed with owner cap lookup',
    )
  }

  // If no ownerCap object found, it means it was transferred to MCMS. Find offramp through MCMS registered packages
  if (erroredObjects.length) {
    // Find all the packages that were registered in the `mcms_registry` through the `EntrypointRegistered` event
    // Query for EntrypointRegistered events from the MCMS package
    const events = await client.queryEvents({
      query: {
        MoveEventType: `${mcmsPackageId}::mcms_registry::EntrypointRegistered`,
      },
    })

    // Extract package IDs from the events
    const registeredPackageIds = events.data
      .map((event) => {
        const eventData = event.parsedJson as { account_address?: string }
        return eventData.account_address
      })
      .filter((pkgId): pkgId is string => !!pkgId)

    return findModulePackageId(client, 'offramp', registeredPackageIds)
  }

  // Otherise, find the owner cap object among the created objects
  const ownerCapObject = ccipObjectsData.find((objData) =>
    objData.data?.type?.includes('::ownable::OwnerCap'),
  )

  if (!ownerCapObject) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'OwnerCap object not found among created objects')
  }

  const ownerCapOwner = ownerCapObject.data?.owner
  if (!ownerCapOwner) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Could not find owner of the OwnerCap object')
  }

  if (typeof ownerCapOwner === 'string' || !('AddressOwner' in ownerCapOwner)) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'OwnerCap object does not have an AddressOwner')
  }

  const ownerCapOwnerObjects = await client.getOwnedObjects({
    owner: ownerCapOwner['AddressOwner'],
  })

  const fullObjectsInfo = await Promise.all(
    ownerCapOwnerObjects.data.map((obj) =>
      client.getObject({
        id: obj.data?.objectId || '',
        options: {
          showType: true,
        },
      }),
    ),
  )

  const ownerCapPackageIds = fullObjectsInfo
    .filter((objData) => objData.data?.type?.includes('::ownable::OwnerCap'))
    .map((obj) => obj.data?.type?.split('::')[0])

  return findModulePackageId(client, 'offramp', ownerCapPackageIds as string[])
}

const findModulePackageId = async (
  client: SuiJsonRpcClient,
  moduleName: string,
  packageIds: string[],
) => {
  const packagesInfo = await Promise.all(
    packageIds.map((pkgId) =>
      client.getNormalizedMoveModulesByPackage({
        package: pkgId,
      }),
    ),
  )

  const pkgs = packagesInfo
    .filter((pkg) => {
      return Object.values(pkg).some((module) => module.name === moduleName)
    })
    .flatMap((pkg) => Object.values(pkg))
    .filter((module) => module.name === moduleName)

  if (!pkgs.length) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Could not find ${moduleName} package among registered MCMS packages`,
    )
  }

  if (pkgs.length > 1) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Multiple ${moduleName} packages found; unable to uniquely identify ${moduleName} package`,
    )
  }

  return normalizeSuiAddress(pkgs[0]!.address) + '::offramp'
}
