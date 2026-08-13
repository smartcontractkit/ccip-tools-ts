import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { hexlify } from 'ethers'
import { memoize } from 'micro-memoize'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import { getAddressBytes } from '../utils.ts'
import { withLookupRetry } from './events.ts'
import { getLatestPackageId, getObjectRef } from './objects.ts'

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
      { fields?: { owner?: unknown } } | undefined
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
 * Gets the Sui offramp package ID associated with a given CCIP package ID.
 *
 * @param ccip - Sui CCIP Package Id
 * @param client - Sui client
 * @returns Sui offramp package id
 */
export const getOffRampForCcip = memoize(
  async (ccip: string, client: SuiJsonRpcClient) => {
    let historyErr: unknown
    try {
      return await getOffRampForCcip_(ccip, client)
    } catch (err) {
      // The history path is brittle on pruned/limited indexers (missing publish
      // tx, pruned OwnerCap objects, stripped effects); fall back to MCMS
      // upgrade txs within retention, then to scanning recent events
      historyErr = err
    }
    const offramp =
      (await findOffRampPackageByUpgrades(ccip, client).catch(() => undefined)) ??
      (await findOffRampPackageByEvents(client).catch(() => undefined))
    if (offramp) return offramp
    throw historyErr
  },
  { maxArgs: 1, async: true, expires: 300e3 },
)

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
