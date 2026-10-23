import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import type { EventId } from '@mysten/sui/jsonRpc'
import { hexlify } from 'ethers'

// Register every chain family (notably Solana, for decodeAddress on the pool's
// SVM remotes) the way SDK consumers do via the package root
import '../index.ts'
import { raceRpcEndpoint, rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource, useResourceForDescribe } from '../../../scripts/useResource.ts'
import { EVMChain } from '../evm/index.ts'
import { discoverOffRamp } from '../execution.ts'
import type { SuiClientLike } from './client.ts'
import {
  findOffRampPackagesByCcipActivity,
  getCcipStateAddress,
  getOffRampForCcip,
} from './discovery.ts'
import { SuiChain } from './index.ts'

// Live RPCs: sui-testnet (the gRPC fullnode) is held for the whole file;
// sepolia is the EVM counterpart of exactly one block (discoverOffRamp), so
// it is locked only for that block — holding it for the file's whole lifetime
// would serialize this suite against every other sepolia user.
await useResource(['sui-testnet'])

const SUI_SELECTOR = 9762610643973837292n
const FUJI_SELECTOR = 14767482510784806043n
const ARB_SEP_SELECTOR = 3478487238524512106n
const OP_SEP_SELECTOR = 5224473277236331295n
const SEPOLIA_SELECTOR = 16015286601757825753n
const AMOY_SELECTOR = 16281711391670634445n
const BSC_TESTNET_SELECTOR = 13264668187771770619n
// the onramp's current destination lanes (its dest_chain_configs)
const KNOWN_DEST_SELECTORS = [
  SEPOLIA_SELECTOR,
  OP_SEP_SELECTOR,
  AMOY_SELECTOR,
  BSC_TESTNET_SELECTOR,
]

const ONRAMP = '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d::onramp'
// The latest onramp package (upgraded from ONRAMP): a bare package id resolves here
const LATEST_ONRAMP = '0xfa4dc9ef5e099b6dc61c90b00e2b28a90b788fda510790bae84c96d2f0b0303c::onramp'
const CCIP = '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf::state_object'
const OFFRAMP = '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp'

const FUJI_ONRAMP = '0xA5D5B0B844c8f11B61F28AC98BBA84dEA9b80953'
const FUJI_ROUTER = '0xF694E193200268f9a4868e4Aa017A0118C9a8177'
const ARB_SEP_ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'
// sepolia is a current lane in both directions; fuji and arb-sepolia are still
// enabled offramp sources (checked live 2026-10-23), which the config tests read
const SEPOLIA_ONRAMP = '0x23a5084fa78104f3df11c63ae59fcac4f6ad9dee'
const SEPOLIA_OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'
const SEPOLIA_RPC = rpcEndpoint('RPC_SEPOLIA')

// Public Sui endpoints prune old transactions and checkpoints, so this file
// pins no transaction: the live send fixture is CAPTURED AT RUNTIME (a bounded
// descending scan for the newest tokenless send, see captureRecentTokenlessSend).
// Token decode and duplicate-execution coverage use recorded/synthetic
// responses instead (index.test.ts, execution-regression.test.ts).
const CCIP_BNM_METADATA = '0x331ce2ba0901fec09d863f0d4162ae29bae2898922e345f3e4cd356363ce3c1b'
const CCIP_BNM_POOL = '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8'
const SEPOLIA_BNM = '0xfd57b4ddbf88a4e07ff4e34c487b99af2fe82a05'
// the 1.6.1 fee quoter's wrapped-SUI fee token (native SUI is no longer accepted)
const SUI_FEE_TOKEN = '0x587c29de216efd4219573e08a1f6964d4fa7cb714518c2c8a0f29abfa264327d'
// an arbitrary receiver for the fee quote (the fee depends on the message shape)
const TOKEN_SEND_RECEIVER = '0x000000000000000000000000000000000000dEaD'

// computed BEFORE the binding probe below: a SKIP_INTEGRATION_TESTS run must
// not issue a single network call at module load
const skip = !!process.env.SKIP_INTEGRATION_TESTS

/**
 * Liveness probe for the binding race: the endpoint speaks Sui (over either
 * transport fromUrl detects) and serves the current tip. It checks NO static
 * fixtures — suite 1 captures its send at runtime against whichever endpoint
 * binds.
 */
const timeoutFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, {
    ...init,
    // bound every probe request: an endpoint that hangs must not hold the
    // run open past the race's own timeout
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  })
const suiTestnetHealthy = (url: string) =>
  SuiChain.fromUrl(url, { fetch: timeoutFetch }).then(
    () => true,
    () => false,
  )

/**
 * Integration tests issue live RPC calls against public endpoints. Sui's
 * public fullnodes no longer serve JSON-RPC at all (the HTTP transport this
 * suite used before its gRPC migration), so the default — and the only
 * candidate that answers — is the official gRPC fullnode in
 * DEFAULT_RPC_ENDPOINTS.RPC_SUI_TESTNET. The shared {@link raceRpcEndpoint}
 * owns retries, per-attempt timeouts and the backoff (no timers of our own);
 * CI-configured RPC_SUI_TESTNET entries lead it. Runs with
 * SKIP_INTEGRATION_TESTS=1 issue no network calls at all: the race is
 * skipped entirely.
 */
const SUI_TESTNET_RPC = skip
  ? rpcEndpoint('RPC_SUI_TESTNET')
  : await raceRpcEndpoint('RPC_SUI_TESTNET', suiTestnetHealthy)

/** The captured live send fixture suite 1's history tests run against. */
type SendFixture = {
  digest: string
  checkpoint: number
  timestamp: number
  messageId: string
  sequenceNumber: bigint
  destChainSelector: bigint
  range: { startBlock: number; endBlock: number }
}

/**
 * Runtime capture of suite 1's live send fixture: the newest TOKENLESS
 * CCIPMessageSent on the onramp (source sui-testnet, destination one of the
 * deployment's current lanes — the exact condition). Retention-safe: the
 * capture runs against whichever endpoint the binding race picked, so the
 * fixture is by construction served by it — no hardcoded digest to age out.
 * Bounded: at most 10 descending pages of 50; the type-filtered query pages
 * only CCIPMessageSent events, so even a days-old newest send is a couple of
 * pages away. undefined when no send matches the condition within the budget
 * — the caller fails loudly with the fixture scanner's path.
 */
const captureRecentTokenlessSend = async (
  client: SuiClientLike,
): Promise<SendFixture | undefined> => {
  const filter = { MoveEventType: `${ONRAMP}::CCIPMessageSent` }
  let cursor: EventId | null | undefined
  for (let pages = 0; pages < 10; pages++) {
    const res = await client.queryEvents({
      query: filter,
      order: 'descending',
      limit: 50,
      ...(cursor ? { cursor } : {}),
    })
    for (const event of res.data) {
      const json = event.parsedJson as
        | {
            dest_chain_selector?: string
            sequence_number?: string
            message?: {
              header?: {
                message_id?: number[]
                sequence_number?: string
                source_chain_selector?: string
              }
              token_amounts?: unknown[]
            }
          }
        | undefined
      const header = json?.message?.header
      // the exact condition: source sui-testnet, a current destination lane,
      // tokenless, and a well-formed message id
      if (!header?.message_id?.length) continue
      if ((json!.message!.token_amounts?.length ?? 0) !== 0) continue
      if (header.source_chain_selector !== SUI_SELECTOR.toString()) continue
      const destChainSelector = BigInt(json!.dest_chain_selector ?? 0)
      if (!KNOWN_DEST_SELECTORS.includes(destChainSelector)) continue

      // hydrate the tx for the checkpoint/timestamp the range/time assertions
      // need (the event itself carries neither)
      const digest = event.id!.txDigest!
      const tx = await client.getTransactionBlock({ digest, options: { showEvents: true } })
      const checkpoint = Number(tx.checkpoint ?? 0)
      if (!checkpoint) continue
      return {
        digest,
        checkpoint,
        timestamp: Number(tx.timestampMs ?? 0) / 1000,
        messageId: hexlify(Uint8Array.from(header.message_id)),
        sequenceNumber: BigInt(header.sequence_number ?? json!.sequence_number ?? 0),
        destChainSelector,
        // a bounded window around the send, so the streaming tests pick it up
        range: { startBlock: checkpoint - 100, endBlock: checkpoint + 100 },
      }
    }
    if (!res.hasNextPage) return undefined
    cursor = res.nextCursor
  }
  return undefined
}

describe('SuiChain integration (sui-testnet)', { skip }, () => {
  let chain: SuiChain
  let fixture: SendFixture
  before(async () => {
    // fromUrl detects the transport the raced endpoint speaks (gRPC-Web or JSON-RPC)
    chain = await SuiChain.fromUrl(SUI_TESTNET_RPC)
    const captured = await captureRecentTokenlessSend(chain.client)
    if (!captured)
      throw new Error(
        'no tokenless CCIPMessageSent on the onramp within the capture budget — check chain activity or widen the scan',
      )
    fixture = captured
  })

  it('connects and detects sui-testnet', () => {
    assert.equal(chain.network.name, 'sui-testnet')
    assert.equal(chain.network.chainSelector, SUI_SELECTOR)
  })

  it('getBlockInfo returns real checkpoints for tags, depths and numbers', async () => {
    const latest = await chain.getBlockInfo('latest')
    // the captured send may sit at the tip, so only its checkpoint is known to be past
    assert.ok(latest.number >= fixture.checkpoint, `latest ${latest.number} includes the send`)
    assert.ok(Math.abs(latest.timestamp - Date.now() / 1e3) < 60, 'latest timestamp is recent')

    // Sui checkpoints are finalized once committed
    const finalized = await chain.getBlockInfo('finalized')
    assert.ok(Math.abs(finalized.number - latest.number) < 100)

    const depth = await chain.getBlockInfo(-50)
    assert.ok(depth.number <= latest.number && depth.number > latest.number - 200)
    assert.ok(depth.timestamp <= latest.timestamp)

    const specific = await chain.getBlockInfo(fixture.range.startBlock)
    assert.equal(specific.number, fixture.range.startBlock)
  })

  it('getLogs streams CCIPMessageSent events over a bounded range', async () => {
    const logs = []
    for await (const log of chain.getLogs({
      address: ONRAMP,
      topics: ['CCIPMessageSent'],
      ...fixture.range,
    })) {
      logs.push(log)
    }
    // the captured send, picked up over the bounded range
    assert.ok(logs.length >= 1)
    // original package reported as log address (not the upgraded one)
    assert.ok(logs.every((log) => log.address === ONRAMP))
    assert.ok(logs.every((log) => log.topics[0] === 'CCIPMessageSent'))
    assert.ok(logs.every((log) => log.blockTimestamp > 0))
    // the stream stays within the requested range
    assert.ok(
      logs.every(
        (log) =>
          log.blockNumber >= fixture.range.startBlock && log.blockNumber <= fixture.range.endBlock,
      ),
    )

    // the captured send decodes with exactly the captured values (needs EVM
    // family registered for dest addresses; decodeMessage flattens the header
    // into top-level fields)
    // a tx may carry several sends: match the captured one by message id too
    const message = logs
      .filter((log) => log.transactionHash === fixture.digest)
      .map(
        (log) =>
          SuiChain.decodeMessage(log) as unknown as
            | {
                messageId: string
                sequenceNumber: bigint
                destChainSelector: bigint
                sourceChainSelector: bigint
              }
            | undefined,
      )
      .find((message) => message?.messageId === fixture.messageId)
    assert.ok(message, 'the captured send is in the stream')
    assert.equal(message.messageId, fixture.messageId)
    assert.equal(message.sequenceNumber, fixture.sequenceNumber)
    assert.equal(message.destChainSelector, fixture.destChainSelector)
    assert.equal(message.sourceChainSelector, SUI_SELECTOR)
  })

  it('getLogs resolves startTime to a checkpoint', async () => {
    // the captured send's checkpoint timestamp, minus a margin: the scan must
    // start at a checkpoint whose timestamp is at-or-after startTime
    const startTime = fixture.timestamp - 5
    const logs = []
    for await (const log of chain.getLogs({
      address: ONRAMP,
      topics: ['CCIPMessageSent'],
      startTime,
      endBlock: fixture.range.endBlock,
    })) {
      logs.push(log)
    }
    assert.ok(logs.length >= 1)
    assert.ok(logs.every((log) => log.blockTimestamp >= startTime))
    assert.ok(
      logs.some((log) => log.transactionHash === fixture.digest),
      'the captured send is in the startTime-resolved stream',
    )
  })

  it('getTransaction returns events with original package addresses', async () => {
    const tx = await chain.getTransaction(fixture.digest)
    assert.ok(tx.logs.length >= 1)
    assert.equal(tx.blockNumber, fixture.checkpoint)
    const ccipLog = tx.logs.find((log) => log.topics[0] === 'CCIPMessageSent')
    assert.ok(ccipLog)
    assert.equal(ccipLog.address, ONRAMP)
  })

  it('discovers ccip package and configs from the onramp', async () => {
    const ccip = await getCcipStateAddress(ONRAMP, chain.client)
    assert.equal(ccip, CCIP)

    const [, version, typeAndVersion] = await chain.typeAndVersion(ONRAMP)
    assert.equal(version, '1.6.0')
    assert.ok(typeAndVersion.startsWith('OnRamp 1.6'))

    const config = await chain.getOnRampConfig(ONRAMP, FUJI_SELECTOR)
    // sui has no usable router contract: the ccip state object is the
    // deployment's router handle, reported for both of its ramps
    assert.equal(config.router, CCIP)
    assert.equal(config.chainSelector, SUI_SELECTOR)
    assert.equal(config.destChainSelector, FUJI_SELECTOR)
    // rmn_remote/nonce_manager/token_admin_registry/fee_quoter are modules of the
    // ccip package, which is what the ramps report as their static config (@ccip)
    const ccipPkg = CCIP.split('::')[0]
    assert.equal(config.feeQuoter, `${ccipPkg}::fee_quoter`)
    assert.equal(config.rmnRemote, `${ccipPkg}::rmn_remote`)
    assert.equal(config.nonceManager, `${ccipPkg}::nonce_manager`)
    assert.equal(config.tokenAdminRegistry, `${ccipPkg}::token_admin_registry`)
    assert.match(config.feeAggregator, /^0x[0-9a-f]{64}$/)
    assert.match(config.allowlistAdmin, /^0x[0-9a-f]{64}$/)
    assert.match(config.owner, /^0x[0-9a-f]{64}$/)
    assert.equal(config.allowlistEnabled, false)
    assert.deepEqual(config.allowedSenders, [])
    // the onramp's per-dest router is the *remote* chain's router
    assert.equal(config.destRouter, FUJI_ROUTER)
    assert.equal(config.expectedNextSequenceNumber, config.sequenceNumber + 1n)

    // fee quoter static config + its config for this destination chain
    const { feeQuoterConfig } = config
    assert.ok(feeQuoterConfig)
    assert.equal(feeQuoterConfig.isEnabled, true)
    assert.ok(feeQuoterConfig.maxFeeJuelsPerMsg > 0n)
    assert.match(feeQuoterConfig.linkToken, /^0x[0-9a-f]{64}$/)
    assert.ok(feeQuoterConfig.feeTokens.includes(feeQuoterConfig.linkToken))
    // EVM family selector, hexlified from the on-chain byte vector
    assert.equal(feeQuoterConfig.chainFamilySelector, '0x2812d52c')
    assert.ok(feeQuoterConfig.maxPerMsgGasLimit > 0n)
    assert.ok(feeQuoterConfig.gasMultiplierWeiPerEth >= 10n ** 18n)
    assert.equal(typeof feeQuoterConfig.maxDataBytes, 'number')
    assert.equal(typeof feeQuoterConfig.enforceOutOfOrder, 'boolean')

    const registry = await chain.getTokenAdminRegistryFor(ONRAMP)
    assert.equal(registry, `${ccipPkg}::token_admin_registry`)
  })

  it('reports the offramp static, dynamic and per-source config', async () => {
    const config = await chain.getOffRampConfig(OFFRAMP, FUJI_SELECTOR)
    const ccipPkg = CCIP.split('::')[0]
    assert.equal(config.router, CCIP)
    assert.equal(config.chainSelector, SUI_SELECTOR)
    assert.equal(config.sourceChainSelector, FUJI_SELECTOR)
    assert.equal(config.feeQuoter, `${ccipPkg}::fee_quoter`)
    assert.equal(config.rmnRemote, `${ccipPkg}::rmn_remote`)
    assert.equal(config.nonceManager, `${ccipPkg}::nonce_manager`)
    assert.equal(config.tokenAdminRegistry, `${ccipPkg}::token_admin_registry`)
    assert.ok(config.permissionlessExecutionThresholdSeconds > 0)
    assert.ok(config.latestPriceSequenceNumber > 0n)
    assert.match(config.owner, /^0x[0-9a-f]{64}$/)
    assert.equal(config.isEnabled, true)
    assert.ok(config.minSeqNr > 0n)
    assert.equal(typeof config.isRmnVerificationDisabled, 'boolean')
    assert.deepEqual(config.onRamps, [FUJI_ONRAMP])

    // Sui has no RMNProxy, so there is no `getARM()` to unwrap into a separate
    // `rmn` address as on EVM: `ccip::rmn_remote` is itself the RMN. Its state is
    // reported instead — unconfigured on this deployment, matching
    // isRmnVerificationDisabled above
    const { rmnRemoteConfig } = config
    assert.ok(rmnRemoteConfig)
    assert.equal(typeof rmnRemoteConfig.version, 'number')
    assert.equal(typeof rmnRemoteConfig.fSign, 'bigint')
    assert.ok(Array.isArray(rmnRemoteConfig.signers))
    assert.ok(Array.isArray(rmnRemoteConfig.cursedSubjects))
    assert.equal(rmnRemoteConfig.isCursedGlobal, false)

    // an unconfigured source chain is reported as unsupported, not as zeroes
    await assert.rejects(() => chain.getOffRampConfig(OFFRAMP, 1n), /Unsupported source chain: 1/)
  })

  it('accepts the ccip state object as the router handle for both ramps', async () => {
    // the router reported for either ramp round-trips through every
    // router-taking API, in bare-package or `::state_object` form
    for (const router of [CCIP, CCIP.split('::')[0]!]) {
      assert.equal(await chain.getOnRampForRouter(router, FUJI_SELECTOR), ONRAMP)
      assert.deepEqual(await chain.getOffRampsForRouter(router, FUJI_SELECTOR), [OFFRAMP])
      assert.equal(
        await chain.getTokenAdminRegistryFor(router),
        `${CCIP.split('::')[0]}::token_admin_registry`,
      )
      // getOnRampConfig resolves it too, and reports it back unchanged
      assert.equal((await chain.getOnRampConfig(router, FUJI_SELECTOR)).router, CCIP)
    }
    // ramps with an explicit `::onramp` suffix are accepted as-is; a bare
    // package id resolves to the latest onramp package from publish history
    assert.equal(await chain.getOnRampForRouter(ONRAMP, FUJI_SELECTOR), ONRAMP)
    assert.equal(
      await chain.getOnRampForRouter(ONRAMP.split('::')[0]!, FUJI_SELECTOR),
      LATEST_ONRAMP,
    )
  })

  it('discovers the offramp from ccip activity, without ownership or publish history', async () => {
    // transactions taking the deployment's CCIPObjectRef as an input object name
    // the offramp in their events and PTB calls
    const offramps = await findOffRampPackagesByCcipActivity(CCIP, chain.client)
    assert.deepEqual(offramps, [OFFRAMP])
  })

  it('discovers the offramp through the ccip package (pruned-history fallback)', async () => {
    // public RPCs prune the publish tx; this exercises the MCMS upgrade scan
    const offramp = await getOffRampForCcip(CCIP, chain.client)
    assert.equal(offramp, OFFRAMP)

    const [, , typeAndVersion] = await chain.typeAndVersion(OFFRAMP)
    assert.ok(typeAndVersion.startsWith('OffRamp 1.6'))

    const fujiConfig = await chain.getOffRampConfig(OFFRAMP, FUJI_SELECTOR)
    assert.deepEqual(fujiConfig.onRamps, [FUJI_ONRAMP])
    assert.equal(fujiConfig.isEnabled, true)

    const arbConfig = await chain.getOffRampConfig(OFFRAMP, ARB_SEP_SELECTOR)
    assert.deepEqual(arbConfig.onRamps, [ARB_SEP_ONRAMP])
  })

  describe('EVM counterpart lane (sepolia)', () => {
    useResourceForDescribe(['sepolia'])

    it('discoverOffRamp pairs lanes in both directions', async () => {
      // sepolia is the deployment's current EVM counterpart lane (fuji was
      // removed from the offramp's source configs in 1.6.1); the sepolia
      // onramp/offramp pairing is discovered live in both directions
      const sepolia = await EVMChain.fromUrl(SEPOLIA_RPC)
      try {
        const toSui = await discoverOffRamp(sepolia, chain, SEPOLIA_ONRAMP)
        assert.equal(toSui, OFFRAMP)

        const fromSui = await discoverOffRamp(chain, sepolia, ONRAMP)
        assert.equal(fromSui, SEPOLIA_OFFRAMP)
      } finally {
        sepolia.destroy()
      }
    })
  })

  it('getFee quotes a positive fee for a sui→sepolia CCIP BnM transfer', async () => {
    const message = {
      receiver: TOKEN_SEND_RECEIVER,
      data: '0x',
      // the 1.6.1 fee quoter dropped native SUI from its accepted fee tokens;
      // the wrapped-SUI coin metadata is the deployment's SUI fee token
      feeToken: SUI_FEE_TOKEN,
      tokenAmounts: [{ token: CCIP_BNM_METADATA, amount: 1_200_000n }],
    }

    const fee = await chain.getFee({
      router: ONRAMP,
      destChainSelector: SEPOLIA_SELECTOR,
      message,
    })
    assert.ok(fee > 0n, `expected a positive fee, got ${fee}`)

    // the ccip state object resolves as the router handle and quotes the same fee
    const stateFee = await chain.getFee({
      router: CCIP,
      destChainSelector: SEPOLIA_SELECTOR,
      message,
    })
    assert.equal(stateFee, fee)
  })

  it('getBalance returns native SUI and CCIP BnM balances', async () => {
    // the BnM holder is the original suite's sender: balances are live state
    // (never pruned), so the holder predates the current retention window
    const holder = '0x466c64282c1a3368d59d2690cda7d84cae809df28c3da5a7550d33bf9cfb9186'
    assert.equal(typeof (await chain.getBalance({ holder })), 'bigint')

    // token as CoinMetadata id and as coin type string report the same balance
    const byMetadata = await chain.getBalance({ holder, token: CCIP_BNM_METADATA })
    const byCoinType = await chain.getBalance({
      holder,
      token:
        '0xde9a44c43b1e5cf3bee4ae5d6c1aa53f2981513ab3354ebace4fba470f44f92a::ccip_burn_mint_token::CCIP_BURN_MINT_TOKEN',
    })
    assert.equal(byCoinType, byMetadata)
  })

  it('getTokenPoolRemotes resolves the sepolia CCIP BnM address', async () => {
    const registry = await chain.getTokenAdminRegistryFor(ONRAMP)
    const { tokenPool } = await chain.getRegistryTokenConfig(registry, CCIP_BNM_METADATA)
    assert.equal(tokenPool, CCIP_BNM_POOL)

    const remotes = await chain.getTokenPoolRemotes(tokenPool, SEPOLIA_SELECTOR)
    const remote = remotes['ethereum-testnet-sepolia']
    assert.ok(remote, 'remote config for ethereum-testnet-sepolia')
    // remote addresses render EIP-55 checksummed (decodeAddress for EVM)
    assert.equal(remote.remoteToken.toLowerCase(), SEPOLIA_BNM)
  })

  it('show decodes the captured send (getMessagesInTx round-trip)', async () => {
    // one message per send tx, generally; the runtime-captured send is
    // tokenless by construction (token decode assertions live in the
    // recorded-shape fixture describe, so they never age out)
    const requests = await chain.getMessagesInTx(fixture.digest)
    assert.ok(requests.length >= 1)
    const request = requests.find(({ message }) => message.messageId === fixture.messageId)
    assert.ok(request, `the captured send's message in ${fixture.digest}`)
    // a v1.6 Sui request, decoded through the message envelope
    const message = request!.message as unknown as {
      destChainSelector: bigint
      sequenceNumber: bigint
      receiver: string
      tokenAmounts: unknown[]
    }
    assert.equal(message.destChainSelector, fixture.destChainSelector)
    assert.equal(message.sequenceNumber, fixture.sequenceNumber)
    // the receiver renders as the bytes the sender supplied — a 20-byte EVM
    // address or a padded 32-byte Sui one
    assert.match(message.receiver, /^(0x)?[0-9a-fA-F]{40}$|^(0x)?[0-9a-fA-F]{64}$/)
    assert.deepEqual(message.tokenAmounts, [])
  })

  it('get-supported-tokens: router lists registry tokens and fee tokens', async () => {
    // `-a <router>`: transferable tokens come from the token admin registry,
    // fee tokens from the fee quoter's accepted metadata
    const registry = await chain.getTokenAdminRegistryFor(CCIP)
    assert.equal(registry, `${CCIP.split('::')[0]}::token_admin_registry`)

    const tokens = await chain.getSupportedTokens(registry)
    assert.ok(tokens.length >= 4, 'registry lists the deployment tokens')
    assert.ok(tokens.includes(CCIP_BNM_METADATA), 'CCIP BnM is registered')
    for (const token of tokens) {
      const info = await chain.getTokenInfo(token)
      assert.ok(info.symbol, `symbol for ${token}`)
      assert.ok(info.decimals >= 0)
    }
    const info = await chain.getTokenInfo(CCIP_BNM_METADATA)
    assert.equal(info.symbol, 'CCIP BnM')
    assert.equal(info.decimals, 9)

    const feeTokens = await chain.getFeeTokens(CCIP)
    assert.ok(Object.keys(feeTokens).length >= 2, 'LINK and SUI fee tokens')
    assert.equal(
      feeTokens['0x7b1f2eda61dbb204d5a54c8453d91425336a8873ceedc5a59c00e750bdefc8dc']?.symbol,
      'LINK',
    )
    assert.equal(feeTokens[CCIP_BNM_METADATA], undefined, 'CCIP BnM is not a fee token')
  })

  it('get-supported-tokens: router + token resolves the registry config and pool', async () => {
    // `-a <router> -t <token>`: registry token config names the pool; the pool
    // config carries token/router/version
    const registry = await chain.getTokenAdminRegistryFor(CCIP)
    const { tokenPool, administrator } = await chain.getRegistryTokenConfig(
      registry,
      CCIP_BNM_METADATA,
    )
    assert.equal(tokenPool, CCIP_BNM_POOL)
    assert.match(administrator, /^0x[0-9a-f]{64}$/)

    const config = await chain.getTokenPoolConfig(tokenPool)
    assert.equal(config.token, CCIP_BNM_METADATA)
    assert.equal(config.router, CCIP)
    assert.equal(config.typeAndVersion, 'ManagedTokenPool 1.6.0')
  })

  it('get-supported-tokens: tokenPool address resolves token, router, and remotes', async () => {
    // `-a <tokenPool>`: everything resolves from the pool alone
    const config = await chain.getTokenPoolConfig(CCIP_BNM_POOL)
    assert.equal(config.token, CCIP_BNM_METADATA)
    assert.equal(config.router, CCIP)
    assert.equal(config.typeAndVersion, 'ManagedTokenPool 1.6.0')

    const registry = await chain.getTokenAdminRegistryFor(config.router)
    assert.equal(registry, `${CCIP.split('::')[0]}::token_admin_registry`)
    const { tokenPool } = await chain.getRegistryTokenConfig(registry, config.token)
    assert.equal(tokenPool, CCIP_BNM_POOL)

    const remotes = await chain.getTokenPoolRemotes(CCIP_BNM_POOL)
    assert.equal(remotes['ethereum-testnet-sepolia']?.remoteToken.toLowerCase(), SEPOLIA_BNM)
  })
})
