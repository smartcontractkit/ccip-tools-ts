import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// Register every chain family (notably Solana, for decodeAddress on the pool's
// SVM remotes) the way SDK consumers do via the package root
import '../index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource, useResourceForDescribe } from '../../../scripts/useResource.ts'
import { EVMChain } from '../evm/index.ts'
import { discoverOffRamp } from '../execution.ts'
import { type ChainLog, ExecutionState } from '../types.ts'
import {
  findOffRampPackagesByCcipActivity,
  getCcipStateAddress,
  getOffRampForCcip,
} from './discovery.ts'
import { SuiChain } from './index.ts'

// Live RPCs: sui-testnet (BlockVision archival gateway) is held for the whole
// file; fuji is the EVM counterpart of exactly one block (discoverOffRamp), so
// it is locked only for that block — holding it for the file's whole lifetime
// would serialize this 3-minute suite against every other fuji user.
await useResource(['sui-testnet'])

// Integration tests issue live RPC calls against public endpoints. Sui's public
// JSON-RPC fullnodes were deprecated; the default is BlockVision's public
// gateway, which is archival (the CCIP publish tx is available) but aggressively
// rate-limited — the SDK's adaptive limiter paces through it.
// `https://sui-testnet-rpc.publicnode.com` is faster and fine for reads, but it
// prunes tx contents (offramp discovery via MCMS upgrade scan can't enumerate
// created packages there).
// Override via RPC_* env vars.
const SUI_TESTNET_RPC = rpcEndpoint(
  'RPC_SUI_TESTNET',
  'https://sui-testnet-endpoint.blockvision.org',
)
const FUJI_RPC = rpcEndpoint('RPC_FUJI', 'https://api.avax-test.network/ext/bc/C/rpc')

// ── Live sui-testnet CCIP deployment (1.6.x) ──
const SUI_SELECTOR = 9762610643973837292n
const FUJI_SELECTOR = 14767482510784806043n
const ARB_SEP_SELECTOR = 3478487238524512106n

const ONRAMP = '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d::onramp'
// The latest onramp package (upgraded from ONRAMP): a bare package id resolves here
const LATEST_ONRAMP = '0xfa4dc9ef5e099b6dc61c90b00e2b28a90b788fda510790bae84c96d2f0b0303c::onramp'
const CCIP = '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf::state_object'
const OFFRAMP = '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp'

const FUJI_ONRAMP = '0xA5D5B0B844c8f11B61F28AC98BBA84dEA9b80953'
const FUJI_ROUTER = '0xF694E193200268f9a4868e4Aa017A0118C9a8177'
const FUJI_OFFRAMP = '0x3F1f176e347235858DD6Db905DDBA09Eaf25478a'
const ARB_SEP_ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'

// Checkpoints with known CCIPMessageSent events (bounded range with 2 events:
// the two CCIP-BnM token-transfer sends, seq 93 and 94, dest sepolia)
const EVENTS_RANGE = { startBlock: 372_600_700, endBlock: 372_601_600 }
const KNOWN_TX = 'F7c2UALq5iurHWvw5i6nemE8cqg6jrV6L2GYi4sHztsU' // seq 93, dest sepolia

// ── Live token-transfer sends (CCIP-BnM → ethereum-testnet-sepolia) ──
const SEPOLIA_SELECTOR = 16015286601757825753n
const CCIP_BNM_METADATA = '0x331ce2ba0901fec09d863f0d4162ae29bae2898922e345f3e4cd356363ce3c1b'
const CCIP_BNM_POOL = '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8'
const SEPOLIA_BNM = '0xfd57b4ddbf88a4e07ff4e34c487b99af2fe82a05'
const TOKEN_SEND_RECEIVER = '0x89810cb91a5fe67dDf3483182f08e1559A5699De'
const TEST_SENDER = '0x466c64282c1a3368d59d2690cda7d84cae809df28c3da5a7550d33bf9cfb9186'
// 0.0012 CCIP BnM (1200000): the second send, exact-amount split
const TOKEN_SEND_TX = '2KgmjsUwqKkS2EKPzr1beE2vtFB7knr1Ue23JFM1gDLt'
const TOKEN_SEND_MESSAGE_ID = '0xd5e9fb64d36e13e692858b82b5fa309d1b900d5526356f48c9ea3a6a967c6a5e'
// First (buggy) send: whole 1.0 CCIP BnM coin burned into the transfer
const FULL_TOKEN_SEND_TX = 'F7c2UALq5iurHWvw5i6nemE8cqg6jrV6L2GYi4sHztsU'
const FULL_TOKEN_SEND_MESSAGE_ID =
  '0x657fa335d971bc95fa082ff831f18db38e2d49174b394d93ef820316bdaa9da5'

const skip = !!process.env.SKIP_INTEGRATION_TESTS

describe('SuiChain integration (sui-testnet)', { skip }, () => {
  let chain: SuiChain
  before(async () => {
    chain = await SuiChain.fromUrl(SUI_TESTNET_RPC)
  })

  it('connects and detects sui-testnet', () => {
    assert.equal(chain.network.name, 'sui-testnet')
    assert.equal(chain.network.chainSelector, SUI_SELECTOR)
  })

  it('getBlockInfo returns real checkpoints for tags, depths and numbers', async () => {
    const latest = await chain.getBlockInfo('latest')
    assert.ok(latest.number > EVENTS_RANGE.endBlock, `latest ${latest.number} is a checkpoint`)
    assert.ok(Math.abs(latest.timestamp - Date.now() / 1e3) < 60, 'latest timestamp is recent')

    // Sui checkpoints are finalized once committed
    const finalized = await chain.getBlockInfo('finalized')
    assert.ok(Math.abs(finalized.number - latest.number) < 100)

    const depth = await chain.getBlockInfo(-50)
    assert.ok(depth.number <= latest.number && depth.number > latest.number - 200)
    assert.ok(depth.timestamp <= latest.timestamp)

    const specific = await chain.getBlockInfo(EVENTS_RANGE.startBlock)
    assert.equal(specific.number, EVENTS_RANGE.startBlock)
  })

  it('getLogs streams CCIPMessageSent events over a bounded range', async () => {
    const logs = []
    for await (const log of chain.getLogs({
      address: ONRAMP,
      topics: ['CCIPMessageSent'],
      ...EVENTS_RANGE,
    })) {
      logs.push(log)
    }
    assert.equal(logs.length, 2)
    // ascending checkpoint order
    assert.ok(logs[0]!.blockNumber < logs[1]!.blockNumber)
    // original package reported as log address (not the upgraded one)
    assert.equal(logs[0]!.address, ONRAMP)
    assert.equal(logs[0]!.topics[0], 'CCIPMessageSent')
    assert.ok(logs.every((log) => log.blockTimestamp > 0))

    // decodes as a CCIP message (needs EVM family registered for dest addresses)
    // decodeMessage flattens the header into top-level fields
    const message = SuiChain.decodeMessage(logs[1]!) as unknown as {
      messageId: string
      sequenceNumber: bigint
      destChainSelector: bigint
      sourceChainSelector: bigint
    }
    assert.ok(message)
    assert.equal(message.messageId, TOKEN_SEND_MESSAGE_ID)
    assert.equal(message.sequenceNumber, 94n)
    assert.equal(message.destChainSelector, SEPOLIA_SELECTOR)
    assert.equal(message.sourceChainSelector, SUI_SELECTOR)
  })

  it('getLogs resolves startTime to a checkpoint', async () => {
    // checkpoint 372600700 has timestamp 1786904498.835
    const startTime = 1_786_904_400
    const logs = []
    for await (const log of chain.getLogs({
      address: ONRAMP,
      topics: ['CCIPMessageSent'],
      startTime,
      endBlock: EVENTS_RANGE.endBlock,
    })) {
      logs.push(log)
    }
    assert.ok(logs.length >= 1)
    assert.ok(logs.every((log) => log.blockTimestamp >= startTime))
  })

  it('getTransaction returns events with original package addresses', async () => {
    const tx = await chain.getTransaction(KNOWN_TX)
    assert.ok(tx.logs.length >= 1)
    assert.equal(tx.blockNumber, 372_600_763)
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

  describe('EVM counterpart lane (fuji)', () => {
    useResourceForDescribe(['fuji'])

    it('discoverOffRamp pairs lanes in both directions', async () => {
      const fuji = await EVMChain.fromUrl(FUJI_RPC)
      try {
        const toSui = await discoverOffRamp(fuji, chain, FUJI_ONRAMP)
        assert.equal(toSui, OFFRAMP)

        const fromSui = await discoverOffRamp(chain, fuji, ONRAMP)
        assert.equal(fromSui, FUJI_OFFRAMP)
      } finally {
        fuji.destroy()
      }
    })
  })

  it('getFee quotes a positive SUI fee for a sui→sepolia CCIP BnM transfer', async () => {
    const message = {
      receiver: TOKEN_SEND_RECEIVER,
      data: '0x',
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
    const native = await chain.getBalance({ holder: TEST_SENDER })
    assert.ok(native > 0n, `expected some SUI, got ${native}`)

    // token as CoinMetadata id and as coin type string report the same balance
    const byMetadata = await chain.getBalance({ holder: TEST_SENDER, token: CCIP_BNM_METADATA })
    assert.ok(byMetadata > 0n, 'the sender holds CCIP BnM')
    const byCoinType = await chain.getBalance({
      holder: TEST_SENDER,
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

  it('show decodes the token-transfer sends with amounts and CCIP BnM metadata', async () => {
    // one message per send tx, each carrying a single CCIP BnM transfer
    for (const want of [
      {
        tx: TOKEN_SEND_TX,
        messageId: TOKEN_SEND_MESSAGE_ID,
        amount: 1_200_000n,
        sequenceNumber: 94n,
      },
      {
        tx: FULL_TOKEN_SEND_TX,
        messageId: FULL_TOKEN_SEND_MESSAGE_ID,
        amount: 1_000_000_000n,
        sequenceNumber: 93n,
      },
    ]) {
      const requests = await chain.getMessagesInTx(want.tx)
      assert.equal(requests.length, 1, `one CCIP request in ${want.tx}`)
      // a v1.6 Sui request carrying one token transfer
      const message = requests[0]!.message as unknown as {
        messageId: string
        destChainSelector: bigint
        sequenceNumber: bigint
        receiver: string
        tokenAmounts: {
          amount: bigint
          destTokenAddress: string
          sourcePoolAddress: string
          extraData: string
        }[]
      }
      assert.equal(message.messageId, want.messageId)
      assert.equal(message.destChainSelector, SEPOLIA_SELECTOR)
      assert.equal(message.sequenceNumber, want.sequenceNumber)
      assert.equal(message.receiver, TOKEN_SEND_RECEIVER)

      const [tokenAmount] = message.tokenAmounts
      assert.ok(tokenAmount)
      assert.equal(tokenAmount.amount, want.amount)
      assert.equal(tokenAmount.destTokenAddress.toLowerCase(), SEPOLIA_BNM)
      assert.equal(tokenAmount.sourcePoolAddress.toLowerCase(), CCIP_BNM_POOL)
      // the pool's extraData carries the local decimals (9 => le bytes 0x09…)
      assert.equal(tokenAmount.extraData, `0x${'00'.repeat(31)}09`)
    }
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

describe('Sui failed execution detection integration (sui-testnet)', { skip }, () => {
  // A live message (bsc-testnet → sui, seq 572) whose first attempt SUCCEEDED
  // (tx 8gNPcma…, cp 303_556_303, minted) and whose later duplicate
  // manually_init_execute aborted unwrapping the empty ReceiverParams hot
  // potato (offramp_state_helper::get_dest_token_transfer_data, abort code 7 =
  // ETokenTransferDoesNotExist — the skipped-report guard for already-executed
  // reports). That double-execution attempt is NOT a failed execution: only
  // the success must surface.
  const SUCCESS_TX = '8gNPcma69CK9apVP1eqJcBJLcgYz6WX2pT1N6L1aKcSq'
  const SUCCESS_CHECKPOINT = 303_556_303
  // the duplicate attempt at cp 303_556_371 (68 checkpoints after the success)
  const DUPLICATE_TX = 'BGuoDp9oLQexWva6zhiLGW7sUiGMxh38y6KaxB2BaFSQ'
  const MESSAGE_ID = '0xdaad1218f179b7d52259922f16b66fd0b77fc921f06bc8059a83b37e07d4ca35'
  const SEQUENCE = 572n
  const BSC_TESTNET_SELECTOR = 13264668187771770619n
  // ~100 checkpoints around the attempts, so the merged stream picks them up
  const DOUBLE_EXEC_RANGE = {
    startBlock: 303_556_271,
    endBlock: 303_556_471,
  }

  // A live message whose BOTH executions FAILED (arbitrum-sepolia → sui,
  // seq 363): first exec EBKErVqpgo… and last exec GWzobLiuJ… both aborted in
  // the token's managed_token::validate_mint (abort code 7 — a REAL failure
  // from another module, not the offramp's skipped-report guard), so the
  // definitive state is failure and BOTH synthetic receipts must surface.
  const EFFECTIVE_MESSAGE_ID = '0x779543c63ac83b53a1893dc973d03dfbfd3170322542d629fc6fd156f4d9da86'
  const EFFECTIVE_SEQUENCE = 363n
  const FIRST_FAILED_TX = 'EBKErVqpgoewdGD2bApVKmMiFPN7NNVYxYmQ92iASo9K'
  const LAST_FAILED_TX = 'GWzobLiuJhVtSHDRHuMv866j37JgfaJbpyykXJYA5gPv'
  const FIRST_FAILED_CHECKPOINT = 291_123_524
  const LAST_FAILED_CHECKPOINT = 291_123_590
  const MANAGED_TOKEN = '0x2498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0'
  // a range comprising both failed txs, padded ~100 checkpoints each side
  const EFFECTIVE_FAILURE_RANGE = {
    startBlock: 291_123_424,
    endBlock: 291_123_690,
  }

  // decoded messageId comparisons: real event logs carry message_id as a byte
  // array in parsedJson, synthetic failure logs as a hex string — decodeReceipt
  // normalizes both
  const failuresOf = (logs: ChainLog[], messageId: string) =>
    logs.filter(
      (log) =>
        SuiChain.decodeReceipt(log)?.messageId === messageId &&
        (log.data as { state?: number }).state === ExecutionState.Failed,
    )
  const successesOf = (logs: ChainLog[], messageId: string) =>
    logs.filter(
      (log) =>
        SuiChain.decodeReceipt(log)?.messageId === messageId &&
        (log.data as { state?: number }).state === ExecutionState.Success,
    )

  let chain: SuiChain
  before(async () => {
    chain = await SuiChain.fromUrl(SUI_TESTNET_RPC)
  })

  it('getLogs emits the success and skips the double-exec attempt for a message that succeeded', async () => {
    const logs: ChainLog[] = []
    for await (const log of chain.getLogs({
      address: OFFRAMP,
      topics: ['ExecutionStateChanged'],
      ...DOUBLE_EXEC_RANGE,
    })) {
      logs.push(log)
    }
    // the earlier attempt's real success event surfaces; the duplicate
    // execution attempt left no state event and its guard abort is not a failure
    assert.equal(successesOf(logs, MESSAGE_ID).length, 1, 'exactly the committed success')
    assert.equal(failuresOf(logs, MESSAGE_ID).length, 0, 'no failure surfaces for the message')
    const success = successesOf(logs, MESSAGE_ID)[0]!
    assert.equal(success.transactionHash, SUCCESS_TX)
    assert.equal(success.blockNumber, SUCCESS_CHECKPOINT)
    const receipt = SuiChain.decodeReceipt(success)
    assert.ok(receipt)
    assert.equal(receipt.state, ExecutionState.Success)
    assert.equal(receipt.messageId, MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, SEQUENCE)
    assert.equal(success.address, OFFRAMP)

    // the merged stream stays globally ascending (block, then log index)
    for (let i = 1; i < logs.length; i++)
      assert.ok(
        logs[i]!.blockNumber >= logs[i - 1]!.blockNumber,
        `log ${i} must not precede its predecessor`,
      )
    // dedupe keys stay unique across both sources
    const keys = new Set(logs.map((log) => `${log.transactionHash}:${log.index}`))
    assert.equal(logs.length, logs.length && keys.size)
  })

  it('getTransaction does not reconstruct a failure from the skipped double-exec attempt', async () => {
    const tx = await chain.getTransaction(DUPLICATE_TX)
    const failure = tx.logs.find((log) => log.topics[0] === 'ExecutionStateChanged')
    assert.equal(
      failure,
      undefined,
      'the duplicate-execution guard abort is not a failed execution',
    )
  })

  it('getExecutionReceipts emits only the success of a double-executed message, breaking on it', async () => {
    const executions = []
    for await (const execution of chain.getExecutionReceipts({
      offRamp: OFFRAMP,
      messageId: MESSAGE_ID,
      sourceChainSelector: BSC_TESTNET_SELECTOR,
      sequenceNumber: SEQUENCE,
      startBlock: SUCCESS_CHECKPOINT - 100,
    })) {
      executions.push(execution)
    }
    // the duplicate attempt after the success is skipped; the success ends the
    // stream — the usual getExecutionReceipts break-on-success contract
    assert.equal(executions.length, 1)
    const { receipt, log } = executions[0]!
    assert.equal(receipt.state, ExecutionState.Success)
    assert.equal(receipt.messageId, MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, SEQUENCE)
    assert.equal(receipt.sourceChainSelector, BSC_TESTNET_SELECTOR)
    assert.equal(log.address, OFFRAMP)
    assert.equal(log.blockNumber, SUCCESS_CHECKPOINT)
    assert.equal(log.transactionHash, SUCCESS_TX)
  })

  it('getLogs emits BOTH failures of a message whose executions all failed', async () => {
    const logs: ChainLog[] = []
    for await (const log of chain.getLogs({
      address: OFFRAMP,
      topics: ['ExecutionStateChanged'],
      ...EFFECTIVE_FAILURE_RANGE,
    })) {
      logs.push(log)
    }
    // both failed attempts surface as synthetic state=3 logs in the ascending stream
    const failures = failuresOf(logs, EFFECTIVE_MESSAGE_ID)
    assert.equal(failures.length, 2, 'both failed executions are picked up')
    const [first, last] = failures.sort((left, right) => left.blockNumber - right.blockNumber)
    assert.equal(first!.transactionHash, FIRST_FAILED_TX)
    assert.equal(first!.blockNumber, FIRST_FAILED_CHECKPOINT)
    assert.equal(last!.transactionHash, LAST_FAILED_TX)
    assert.equal(last!.blockNumber, LAST_FAILED_CHECKPOINT)
    for (const failure of [first!, last!]) {
      assert.equal(failure.index, 0, 'synthetic failures use uint-friendly index 0')
      assert.equal(failure.address, OFFRAMP)
      const receipt = SuiChain.decodeReceipt(failure)
      assert.ok(receipt)
      assert.equal(receipt.messageId, EFFECTIVE_MESSAGE_ID)
      assert.equal(receipt.sequenceNumber, EFFECTIVE_SEQUENCE)
      assert.equal(receipt.sourceChainSelector, ARB_SEP_SELECTOR)
      assert.equal(receipt.state, ExecutionState.Failed)
      // the real abort: managed_token::validate_mint, not the skipped-report guard
      assert.equal(
        (receipt.returnData as Record<string, unknown>).location,
        `${MANAGED_TOKEN}::managed_token`,
      )
      assert.equal((receipt.returnData as Record<string, unknown>).abortCode, 7n)
    }

    // the merged stream stays globally ascending (block, then log index)
    for (let i = 1; i < logs.length; i++)
      assert.ok(
        logs[i]!.blockNumber >= logs[i - 1]!.blockNumber,
        `log ${i} must not precede its predecessor`,
      )
    // dedupe keys stay unique across both sources
    const keys = new Set(logs.map((log) => `${log.transactionHash}:${log.index}`))
    assert.equal(logs.length, logs.length && keys.size)
  })

  it('getExecutionReceipts yields both failures of the definitively-failed message', async () => {
    const executions = []
    for await (const execution of chain.getExecutionReceipts({
      offRamp: OFFRAMP,
      messageId: EFFECTIVE_MESSAGE_ID,
      sourceChainSelector: ARB_SEP_SELECTOR,
      sequenceNumber: EFFECTIVE_SEQUENCE,
      startBlock: FIRST_FAILED_CHECKPOINT - 100,
    })) {
      executions.push(execution)
    }
    // both attempts failed and nothing succeeded after them: both surface,
    // newest first, and the stream ends at the scan end (no success to break on)
    assert.equal(executions.length, 2)
    assert.deepEqual(
      executions.map(({ log }) => log.transactionHash),
      [LAST_FAILED_TX, FIRST_FAILED_TX],
    )
    for (const { receipt, log, error } of executions) {
      assert.equal(receipt.state, ExecutionState.Failed)
      assert.equal(receipt.messageId, EFFECTIVE_MESSAGE_ID)
      assert.equal(receipt.sequenceNumber, EFFECTIVE_SEQUENCE)
      assert.equal(receipt.sourceChainSelector, ARB_SEP_SELECTOR)
      assert.equal(log.address, OFFRAMP)
      assert.match(String(error!.effectsStatus), /MoveAbort/)
      assert.equal(error!.location, `${MANAGED_TOKEN}::managed_token`)
      assert.equal(error!.functionName, 'validate_mint')
      assert.equal(error!.abortCode, 7n)
    }
  })
})
