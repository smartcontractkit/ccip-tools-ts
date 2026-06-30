import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import '../solana/index.ts' // register Solana chain family for cross-family message decoding
import '../ton/index.ts' // register TON chain family for cross-family message decoding
import { CCIPAPIClient } from '../api/index.ts'
import { LaneFeature } from '../chain.ts'
import { discoverOffRamp } from '../execution.ts'
import { NetworkType } from '../networks.ts'
import { CCTP_FINALITY_FAST, getUsdcBurnFees } from '../offchain.ts'
import { ExecutionState, MessageStatus } from '../types.ts'
import { interfaces } from './const.ts'
import { FUJI_TO_SEPOLIA, SEPOLIA_TO_FUJI } from './fork.test.data.ts'
import { EVMChain } from './index.ts'

// ── Chain constants ──

// Integration tests issue many live RPC calls (no anvil fork to absorb them), so the
// defaults point at reliable public endpoints. Free gateways (tenderly, avax public)
// rate-limit/stall under this load and time out the suite. Override via RPC_* env vars.
const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://sepolia.gateway.tenderly.co'
const SEPOLIA_SELECTOR = 16015286601757825753n
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://api.avax-test.network/ext/bc/C/rpc'

const ARB_SEP_RPC = process.env['RPC_ARB_SEPOLIA'] || 'https://sepolia-rollup.arbitrum.io/rpc'
const ARB_SEP_SELECTOR = 3478487238524512106n
const ARB_SEP_V2_0_ROUTER = '0x8F95FA37c55eF7beFdf05f6abDeC551773E17Fb4'

// ── getFeeTokens constants ──

const SEPOLIA_V1_6_ROUTER = '0x866071AB5167081Cf28d02A2bfA592b6f0dc6c15'
const FUJI_ROUTER = '0xF694E193200268f9a4868e4Aa017A0118C9a8177'
const FUJI_V1_6_ROUTER = '0x7397Da7131aa4D32010BB375090222cd341303ce'

// ── getLaneFeatures constants ──

// v2.0 router for Sepolia -> Fuji lane
const SEPOLIA_V2_0_ROUTER = '0x784d49a71BB4C48eB7dA4cD7e6Ecb424f9b5EAB1'
// v2.0 router for Fuji -> Sepolia lane
const FUJI_V2_0_ROUTER = '0x7C9B8B4e8024e5Ee8A630F6FCe9015e470dA5763'
// Token on Fuji whose v2.0 pool (BurnMintTokenPool 2.0.0) has FTF disabled
// (allowedFinalityConfig = 0x00000000). Used by tests that need a v2.0 pool
// without Fast Transfer Finality enabled.
const NOFTF_TOKEN_FUJI = '0xcba4fd7b4fe7adf246007d6228d42162815a1fd0'
// CCIP-BnM on Sepolia — supported on v1.5 Sepolia→Fuji lane
const CCIP_BNM_TOKEN_SEPOLIA = '0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05'
// Token pools with FTF enabled and custom rate limits configured
const FTF_ENABLED_POOL_SEPOLIA = '0x6e2df115f6cb112533be550ca70a41428a465925'
const FTF_ENABLED_POOL_FUJI = '0xcf0e862b5dc183adb8c42595238a982e45f58df1'
// Token served by FTF_ENABLED_POOL_SEPOLIA — works with V3 extra args on Sepolia→Fuji v2.0 lane
const FTF_TOKEN_SEPOLIA = '0xa41a773a7b68e80d4760a176cfec8f50e80d65a7'

// ── sendMessage constants (selector only — needed by getFee + getTotalFeesEstimate) ──

// v1.5 lane: Sepolia -> Fuji (OnRamp 0x1249…025B)
const FUJI_SELECTOR = 14767482510784806043n

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

describe('EVM Integration Tests', { skip, timeout: 180_000 }, () => {
  let sepoliaChain: EVMChain | undefined
  let fujiChain: EVMChain | undefined
  let arbSepChain: EVMChain | undefined
  let wallet: Wallet

  before(async () => {
    const sepoliaProvider = new JsonRpcProvider(SEPOLIA_RPC)
    const fujiProvider = new JsonRpcProvider(FUJI_RPC)
    const arbSepProvider = new JsonRpcProvider(ARB_SEP_RPC)
    sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, {
      apiClient: null,
      logger: testLogger,
    })
    fujiChain = await EVMChain.fromProvider(fujiProvider, { apiClient: null, logger: testLogger })
    arbSepChain = await EVMChain.fromProvider(arbSepProvider, {
      apiClient: null,
      logger: testLogger,
    })
    wallet = new Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      sepoliaProvider,
    )
  })

  after(() => {
    sepoliaChain?.provider.destroy()
    fujiChain?.provider.destroy()
    arbSepChain?.provider.destroy()
  })

  describe('getBalance', () => {
    it('should return native and token balances for CCIP transfer participants', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const apiClient = new CCIPAPIClient(undefined, { logger: testLogger })

      // Select token-transfer messages from test data (2 per direction)
      const tokenTransferMessages = [
        ...SEPOLIA_TO_FUJI.filter((m) => m.description.includes('token transfer')).slice(0, 2),
        ...FUJI_TO_SEPOLIA.filter((m) => m.description.includes('token transfer')).slice(0, 2),
      ]
      assert.ok(tokenTransferMessages.length >= 3, 'should have at least 3 token transfer messages')

      const chainBySelector = (selector: bigint) => {
        if (selector === SEPOLIA_SELECTOR) return sepoliaChain
        if (selector === FUJI_SELECTOR) return fujiChain
        return undefined
      }

      let nonZeroNative = 0
      let nonZeroToken = 0
      for (const msg of tokenTransferMessages) {
        const request = await apiClient.getMessageById(msg.messageId)
        const { sourceNetworkInfo, destNetworkInfo } = request.metadata

        const sourceChain = chainBySelector(sourceNetworkInfo.chainSelector)
        const destChain = chainBySelector(destNetworkInfo.chainSelector)

        const { sender, receiver } = request.message
        const tokenAmounts = request.message.tokenAmounts as unknown as {
          sourceTokenAddress: string
          destTokenAddress: string
        }[]

        // Check sender native + token balance on source chain
        if (sourceChain) {
          const nativeBalance = await sourceChain.getBalance({ holder: sender })
          if (nativeBalance > 0n) nonZeroNative++

          if (tokenAmounts.length) {
            const tokenBalance = await sourceChain.getBalance({
              holder: sender,
              token: tokenAmounts[0]!.sourceTokenAddress,
            })
            if (tokenBalance > 0n) nonZeroToken++
          }
        }

        // Check receiver native + token balance on dest chain
        if (destChain) {
          const nativeBalance = await destChain.getBalance({ holder: receiver })
          if (nativeBalance > 0n) nonZeroNative++

          if (tokenAmounts.length) {
            const tokenBalance = await destChain.getBalance({
              holder: receiver,
              token: tokenAmounts[0]!.destTokenAddress,
            })
            if (tokenBalance > 0n) nonZeroToken++
          }
        }
      }

      console.log(`  balances: ${nonZeroNative} nonzero native, ${nonZeroToken} nonzero token`)
      assert.ok(nonZeroNative > 0, `expected some nonzero native balances, got ${nonZeroNative}`)
      assert.ok(nonZeroToken > 0, `expected some nonzero token balances, got ${nonZeroToken}`)
    })
  })

  describe('getMessageById vs getMessagesInTx', () => {
    // One v1.5 + one v1.6 from each source chain
    const testMessages = [
      { ...SEPOLIA_TO_FUJI.find((m) => m.version === '1.5')!, source: 'sepolia' as const },
      { ...SEPOLIA_TO_FUJI.find((m) => m.version === '1.6')!, source: 'sepolia' as const },
      { ...FUJI_TO_SEPOLIA.find((m) => m.version === '1.5')!, source: 'fuji' as const },
      {
        ...FUJI_TO_SEPOLIA.find((m) => m.version === '1.6' && m.status !== MessageStatus.Failed)!,
        source: 'fuji' as const,
      },
    ]

    it('should return matching lane and message fields from API and RPC', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const apiClient = new CCIPAPIClient(undefined, { logger: testLogger })
      const chainBySource = { sepolia: sepoliaChain, fuji: fujiChain }

      for (const msg of testMessages) {
        const label = `${msg.source} v${msg.version} ${msg.messageId.slice(0, 10)}`
        console.log(`  comparing ${label}`)
        const chain = chainBySource[msg.source]

        // API path
        const apiResult = await apiClient.getMessageById(msg.messageId)

        // RPC path
        const tx = await chain.getTransaction(msg.txHash)
        const rpcResults = await chain.getMessagesInTx(tx)
        const rpcResult = rpcResults.find((r) => r.message.messageId === msg.messageId)
        assert.ok(rpcResult, `${label}: RPC should find message in tx`)

        // ── metadata presence ──
        assert.ok(apiResult.metadata, `${label}: API result should have metadata`)
        assert.equal(rpcResult.metadata, undefined, `${label}: RPC result should not have metadata`)

        // ── lane comparison ──
        assert.equal(
          apiResult.lane.sourceChainSelector,
          rpcResult.lane.sourceChainSelector,
          `${label}: sourceChainSelector should match`,
        )
        assert.equal(
          apiResult.lane.destChainSelector,
          rpcResult.lane.destChainSelector,
          `${label}: destChainSelector should match`,
        )
        assert.equal(apiResult.lane.onRamp, rpcResult.lane.onRamp, `${label}: onRamp should match`)
        assert.equal(
          apiResult.lane.version,
          rpcResult.lane.version,
          `${label}: version should match`,
        )

        // ── message comparison ──
        assert.equal(
          apiResult.message.messageId,
          rpcResult.message.messageId,
          `${label}: messageId should match`,
        )
        assert.equal(
          apiResult.message.sender,
          rpcResult.message.sender,
          `${label}: sender should match`,
        )
        assert.equal(
          apiResult.message.receiver,
          rpcResult.message.receiver,
          `${label}: receiver should match`,
        )
        assert.equal(
          String(apiResult.message.data),
          String(rpcResult.message.data),
          `${label}: data should match`,
        )
        assert.equal(
          apiResult.message.sequenceNumber,
          rpcResult.message.sequenceNumber,
          `${label}: sequenceNumber should match`,
        )
        const apiMsg = apiResult.message as unknown as Record<string, unknown>
        const rpcMsg = rpcResult.message as unknown as Record<string, unknown>
        assert.equal(apiMsg.nonce, rpcMsg.nonce, `${label}: nonce should match`)

        // ── tokenAmounts comparison ──
        const apiTokens = apiResult.message.tokenAmounts as unknown as { amount: bigint }[]
        const rpcTokens = rpcResult.message.tokenAmounts as unknown as { amount: bigint }[]
        assert.equal(
          apiTokens.length,
          rpcTokens.length,
          `${label}: tokenAmounts length should match`,
        )
        for (let i = 0; i < apiTokens.length; i++) {
          assert.equal(
            apiTokens[i]!.amount,
            rpcTokens[i]!.amount,
            `${label}: tokenAmounts[${i}].amount should match`,
          )
        }
      }
    })
  })

  describe('getFeeTokens', () => {
    it('should return fee tokens for v1.6 routers on both chains', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const cases = [
        { chain: sepoliaChain, router: SEPOLIA_V1_6_ROUTER, label: 'sepolia v1.6' },
        { chain: fujiChain, router: FUJI_V1_6_ROUTER, label: 'fuji v1.6' },
      ]

      for (const { chain, router, label } of cases) {
        const feeTokens = await chain.getFeeTokens(router)
        const entries = Object.entries(feeTokens)
        assert.ok(entries.length > 0, `${label}: should have at least one fee token`)

        console.log(
          `  ${label}: ${entries.map(([a, i]) => `${i.symbol}(${a.slice(0, 8)}…)`).join(', ')}`,
        )
        for (const [address, info] of entries) {
          assert.match(address, /^0x[0-9a-fA-F]{40}$/, `${label}: token address should be valid`)
          assert.ok(info.symbol.length > 0, `${label}: ${address} should have a symbol`)
          assert.ok(info.decimals >= 0, `${label}: ${address} should have non-negative decimals`)
        }
      }
    })

    // v1.5 resolves the PriceRegistry from the OnRamp's dynamic config and calls
    // getFeeTokens() directly — a single state read, no block-range event scan.
    it('should return fee tokens for v1.5 router on sepolia', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const feeTokens = await sepoliaChain.getFeeTokens(SEPOLIA_ROUTER)
      const entries = Object.entries(feeTokens)
      assert.ok(entries.length > 0, 'sepolia v1.5: should have at least one fee token')

      console.log(
        `  sepolia v1.5: ${entries.map(([a, i]) => `${i.symbol}(${a.slice(0, 8)}…)`).join(', ')}`,
      )
      for (const [address, info] of entries) {
        assert.match(address, /^0x[0-9a-fA-F]{40}$/, `sepolia v1.5: token address should be valid`)
        assert.ok(info.symbol.length > 0, `sepolia v1.5: ${address} should have a symbol`)
        assert.ok(info.decimals >= 0, `sepolia v1.5: ${address} should have non-negative decimals`)
      }
    })
  })

  describe('getFee', () => {
    it('should return positive fees for v1.5 and v1.6 routers on both chains', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const receiver = wallet.address

      // Built via buildMessageForDest (default V2 extraArgs)
      const builtMessage = EVMChain.buildMessageForDest({ receiver })
      // Manually constructed with explicit extraArgs
      const manualMessage = {
        receiver,
        extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
      }

      const cases = [
        {
          chain: sepoliaChain,
          router: SEPOLIA_ROUTER,
          dest: FUJI_SELECTOR,
          message: manualMessage,
          label: 'sepolia v1.5',
        },
        {
          chain: sepoliaChain,
          router: SEPOLIA_V1_6_ROUTER,
          dest: FUJI_SELECTOR,
          message: builtMessage,
          label: 'sepolia v1.6',
        },
        {
          chain: fujiChain,
          router: FUJI_ROUTER,
          dest: SEPOLIA_SELECTOR,
          message: manualMessage,
          label: 'fuji v1.5',
        },
        {
          chain: fujiChain,
          router: FUJI_V1_6_ROUTER,
          dest: SEPOLIA_SELECTOR,
          message: builtMessage,
          label: 'fuji v1.6',
        },
      ]

      for (const { chain, router, dest, message, label } of cases) {
        const fee = await chain.getFee({ router, destChainSelector: dest, message })
        console.log(`  ${label}: fee = ${fee}`)
        assert.ok(fee > 0n, `${label}: fee should be positive (got ${fee})`)
      }
    })
  })

  describe('getExecutionReceipts', () => {
    // Pick a known SUCCESS message (Fuji -> Sepolia) so we can query receipts on the dest fork
    const successMsg = FUJI_TO_SEPOLIA.find((m) => m.status === MessageStatus.Success)!

    it('should find a success receipt for a known successful message', async () => {
      assert.ok(fujiChain, 'source chain should be initialized')
      assert.ok(sepoliaChain, 'dest chain should be initialized')

      // Discover offRamp from the source transaction
      const tx = await fujiChain.getTransaction(successMsg.txHash)
      const requests = await fujiChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === successMsg.messageId)!
      assert.ok(request, 'should find the request in the transaction')

      const offRamp = await discoverOffRamp(fujiChain, sepoliaChain, request.lane.onRamp, fujiChain)
      assert.ok(offRamp, 'offRamp should be discovered')

      let foundSuccess = false
      for await (const exec of sepoliaChain.getExecutionReceipts({
        offRamp,
        messageId: successMsg.messageId,
        sourceChainSelector: request.message.sourceChainSelector,
        startTime: request.log.blockTimestamp,
      })) {
        if (exec.receipt.state === ExecutionState.Success) {
          foundSuccess = true
          console.log(`  receipt: state=Success messageId=${successMsg.messageId.slice(0, 10)}…`)
          assert.equal(
            exec.receipt.messageId,
            successMsg.messageId,
            'receipt messageId should match',
          )
          assert.ok(exec.log.blockTimestamp > 0, 'execution should have a positive timestamp')
          break
        }
      }
      assert.ok(foundSuccess, 'should find a success receipt for a known successful message')
    })

    // Pick a known FAILED message  — reuses the execute test message
    const failedMsg = FUJI_TO_SEPOLIA.find((m) => m.status === MessageStatus.Failed)!

    // messageId-filtered scan from the message's block forward; breaks on the first
    // Failed receipt (emitted shortly after the message), so it returns early.
    it('should find a failed receipt with no preceding success for a known failed message', async () => {
      assert.ok(fujiChain, 'source chain should be initialized')
      assert.ok(sepoliaChain, 'dest chain should be initialized')

      const tx = await fujiChain.getTransaction(failedMsg.txHash)
      const requests = await fujiChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === failedMsg.messageId)!
      assert.ok(request, 'should find the request in the transaction')

      const offRamp = await discoverOffRamp(fujiChain, sepoliaChain, request.lane.onRamp, fujiChain)
      assert.ok(offRamp, 'offRamp should be discovered')

      let foundFailed = false
      for await (const exec of sepoliaChain.getExecutionReceipts({
        offRamp,
        messageId: failedMsg.messageId,
        sourceChainSelector: request.message.sourceChainSelector,
        startTime: request.log.blockTimestamp,
      })) {
        assert.notEqual(
          exec.receipt.state,
          ExecutionState.Success,
          'should not find a success receipt before the failed one',
        )
        if (exec.receipt.state === ExecutionState.Failed) {
          foundFailed = true
          assert.equal(
            exec.receipt.messageId,
            failedMsg.messageId,
            'receipt messageId should match',
          )
          break
        }
      }
      assert.ok(foundFailed, 'should find a failed receipt for a known failed message')
    })
  })

  describe('getLaneFeatures', () => {
    it('should return FINALITY_FAST=undefined and no rate limits for v1.6 router', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V1_6_ROUTER,
        destChainSelector: FUJI_SELECTOR,
      })

      assert.equal(
        features[LaneFeature.FINALITY_FAST],
        undefined,
        'v1.6 lane should not include FINALITY_FAST (FTF does not exist pre-v2.0)',
      )
      assert.equal(
        LaneFeature.RATE_LIMITS in features,
        false,
        'v1.6 lane should not have RATE_LIMITS',
      )
      assert.equal(
        LaneFeature.FAST_RATE_LIMITS in features,
        false,
        'v1.6 lane should not have FAST_RATE_LIMITS',
      )
    })

    it('should return FINALITY_FAST=1 and no rate limits for v2.0 router without token', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
      })

      assert.equal(
        features[LaneFeature.FINALITY_FAST],
        1,
        'v2.0 lane without token should default to 1 block confirmation',
      )
      assert.equal(
        LaneFeature.RATE_LIMITS in features,
        false,
        'v2.0 lane without token should not have RATE_LIMITS (no pool to query)',
      )
    })

    it('should query token pool for features on v2.0 pool', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const features = await fujiChain.getLaneFeatures({
        router: FUJI_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        token: NOFTF_TOKEN_FUJI,
      })

      const minBlocks = features[LaneFeature.FINALITY_FAST]
      console.log(`  v2.0 FTF-disabled pool FINALITY_FAST = ${minBlocks}`)
      assert.equal(minBlocks, 0, 'FTF-disabled v2.0 pool should return FINALITY_FAST=0')

      // RATE_LIMITS should be present for v2.0 pool with token
      assert.ok(LaneFeature.RATE_LIMITS in features, 'v2.0 pool should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      if (rateLimits != null) {
        assert.equal(typeof rateLimits.tokens, 'bigint', 'tokens should be bigint')
        assert.equal(typeof rateLimits.capacity, 'bigint', 'capacity should be bigint')
        assert.equal(typeof rateLimits.rate, 'bigint', 'rate should be bigint')
      }

      // FTF disabled → no FAST_RATE_LIMITS
      assert.equal(
        LaneFeature.FAST_RATE_LIMITS in features,
        false,
        'FTF disabled pool should not have FAST_RATE_LIMITS',
      )
    })

    it('should return RATE_LIMITS for v1.5 router with token (legacy pool)', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        token: CCIP_BNM_TOKEN_SEPOLIA,
      })

      assert.equal(
        features[LaneFeature.FINALITY_FAST],
        undefined,
        'v1.5 lane should not include FINALITY_FAST (FTF does not exist pre-v2.0)',
      )

      // Legacy pool should expose RATE_LIMITS via getCurrentOutboundRateLimiterState
      assert.ok(LaneFeature.RATE_LIMITS in features, 'v1.5 lane with token should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      if (rateLimits != null) {
        assert.equal(typeof rateLimits.tokens, 'bigint', 'tokens should be bigint')
        assert.equal(typeof rateLimits.capacity, 'bigint', 'capacity should be bigint')
        assert.equal(typeof rateLimits.rate, 'bigint', 'rate should be bigint')
      }

      // FTF doesn't exist on legacy lanes → no FAST_RATE_LIMITS
      assert.equal(
        LaneFeature.FAST_RATE_LIMITS in features,
        false,
        'legacy lane should not have FAST_RATE_LIMITS',
      )
    })

    it('should return nonzero FINALITY_FAST and FAST_RATE_LIMITS for FTF-enabled pool (Sepolia)', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const token = await sepoliaChain.getTokenForTokenPool(FTF_ENABLED_POOL_SEPOLIA)
      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        token,
      })

      const minBlocks = features[LaneFeature.FINALITY_FAST]
      console.log(`  FTF-enabled pool FINALITY_FAST = ${minBlocks}`)
      assert.ok(
        minBlocks != null && minBlocks > 0,
        `FTF-enabled pool should have FINALITY_FAST > 0 (got ${minBlocks})`,
      )

      // Default rate limits should be present
      assert.ok(LaneFeature.RATE_LIMITS in features, 'FTF-enabled pool should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      assert.ok(rateLimits != null, 'RATE_LIMITS should not be null')
      assert.equal(typeof rateLimits.tokens, 'bigint', 'tokens should be bigint')
      assert.equal(typeof rateLimits.capacity, 'bigint', 'capacity should be bigint')
      assert.equal(typeof rateLimits.rate, 'bigint', 'rate should be bigint')

      // Custom finality rate limits should be present when FTF is enabled
      assert.ok(
        LaneFeature.FAST_RATE_LIMITS in features,
        'FTF-enabled pool should have FAST_RATE_LIMITS',
      )
      const customRateLimits = features[LaneFeature.FAST_RATE_LIMITS]
      assert.ok(customRateLimits != null, 'FAST_RATE_LIMITS should not be null')
      assert.equal(typeof customRateLimits.tokens, 'bigint', 'custom tokens should be bigint')
      assert.equal(typeof customRateLimits.capacity, 'bigint', 'custom capacity should be bigint')
      assert.equal(typeof customRateLimits.rate, 'bigint', 'custom rate should be bigint')

      // Custom rate limits should differ from default rate limits
      const differs =
        rateLimits.capacity !== customRateLimits.capacity ||
        rateLimits.rate !== customRateLimits.rate
      assert.ok(
        differs,
        `custom rate limits should differ from default (default: capacity=${rateLimits.capacity} rate=${rateLimits.rate}, custom: capacity=${customRateLimits.capacity} rate=${customRateLimits.rate})`,
      )
    })

    it('should return nonzero FINALITY_FAST and FAST_RATE_LIMITS for FTF-enabled pool (Fuji)', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const token = await fujiChain.getTokenForTokenPool(FTF_ENABLED_POOL_FUJI)
      const features = await fujiChain.getLaneFeatures({
        router: FUJI_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        token,
      })

      const minBlocks = features[LaneFeature.FINALITY_FAST]
      console.log(`  FTF-enabled Fuji pool FINALITY_FAST = ${minBlocks}`)
      assert.ok(
        minBlocks != null && minBlocks > 0,
        `FTF-enabled pool should have FINALITY_FAST > 0 (got ${minBlocks})`,
      )

      // Default rate limits should be present
      assert.ok(LaneFeature.RATE_LIMITS in features, 'FTF-enabled pool should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      assert.ok(rateLimits != null, 'RATE_LIMITS should not be null')

      // Custom finality rate limits should be present when FTF is enabled
      assert.ok(
        LaneFeature.FAST_RATE_LIMITS in features,
        'FTF-enabled pool should have FAST_RATE_LIMITS',
      )
      const customRateLimits = features[LaneFeature.FAST_RATE_LIMITS]
      assert.ok(customRateLimits != null, 'FAST_RATE_LIMITS should not be null')

      // Custom rate limits should differ from default rate limits
      const differs =
        rateLimits.capacity !== customRateLimits.capacity ||
        rateLimits.rate !== customRateLimits.rate
      assert.ok(
        differs,
        `custom rate limits should differ from default (default: capacity=${rateLimits.capacity} rate=${rateLimits.rate}, custom: capacity=${customRateLimits.capacity} rate=${customRateLimits.rate})`,
      )
    })
  })

  describe('getTokenPoolConfig with tokenTransferFeeConfig', () => {
    it('should return fee config for v2.0 pool', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Resolve pool address
      const onRamp = await fujiChain.getOnRampForRouter(FUJI_V2_0_ROUTER, SEPOLIA_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, fujiChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        SEPOLIA_SELECTOR,
        NOFTF_TOKEN_FUJI,
      )) as string

      const result = await fujiChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: SEPOLIA_SELECTOR,
        finality: 0,
        tokenArgs: '0x',
      })

      assert.ok(result.tokenTransferFeeConfig, 'v2.0 pool should return fee config')
      assert.equal(typeof result.tokenTransferFeeConfig.destGasOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.destBytesOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.isEnabled, 'boolean')
      console.log('  v2.0 pool fee config (finality=0):')
      console.log(`    finalityFeeUSDCents = ${result.tokenTransferFeeConfig.finalityFeeUSDCents}`)
      console.log(
        `    fastFinalityFeeUSDCents = ${result.tokenTransferFeeConfig.fastFinalityFeeUSDCents}`,
      )
      console.log(
        `    finalityTransferFeeBps = ${result.tokenTransferFeeConfig.finalityTransferFeeBps}`,
      )
      console.log(
        `    fastFinalityTransferFeeBps = ${result.tokenTransferFeeConfig.fastFinalityTransferFeeBps}`,
      )
    })

    it('should return fee config with finality=1', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Resolve pool address
      const onRamp = await fujiChain.getOnRampForRouter(FUJI_V2_0_ROUTER, SEPOLIA_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, fujiChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        SEPOLIA_SELECTOR,
        NOFTF_TOKEN_FUJI,
      )) as string

      const result = await fujiChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: SEPOLIA_SELECTOR,
        finality: 1,
        tokenArgs: '0x',
      })

      assert.ok(result.tokenTransferFeeConfig, 'v2.0 pool should return fee config')
      assert.equal(typeof result.tokenTransferFeeConfig.destGasOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.destBytesOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.isEnabled, 'boolean')
      console.log('  v2.0 pool fee config (finality=1):')
      console.log(`    finalityFeeUSDCents = ${result.tokenTransferFeeConfig.finalityFeeUSDCents}`)
      console.log(
        `    fastFinalityFeeUSDCents = ${result.tokenTransferFeeConfig.fastFinalityFeeUSDCents}`,
      )
      console.log(
        `    finalityTransferFeeBps = ${result.tokenTransferFeeConfig.finalityTransferFeeBps}`,
      )
      console.log(
        `    fastFinalityTransferFeeBps = ${result.tokenTransferFeeConfig.fastFinalityTransferFeeBps}`,
      )
    })

    it('should omit fee config when feeOpts not provided', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Resolve pool address
      const onRamp = await fujiChain.getOnRampForRouter(FUJI_V2_0_ROUTER, SEPOLIA_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, fujiChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        SEPOLIA_SELECTOR,
        NOFTF_TOKEN_FUJI,
      )) as string

      const result = await fujiChain.getTokenPoolConfig(poolAddress)

      assert.equal(
        result.tokenTransferFeeConfig,
        undefined,
        'fee config should be undefined without feeOpts',
      )
      assert.equal(typeof result.token, 'string')
      assert.equal(typeof result.router, 'string')
    })
  })

  describe('getTotalFeesEstimate', () => {
    it('should return ccipFee and no tokenTransferFee for data-only message', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const estimate = await sepoliaChain.getTotalFeesEstimate({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: { receiver: '0x0000000000000000000000000000000000000001', data: '0x1337' },
      })

      assert.equal(typeof estimate.ccipFee, 'bigint')
      assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')
      assert.equal(estimate.tokenTransferFee, undefined)
    })

    it('should return token transfer fee for message with tokenAmounts', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const amount = 1_000_000n
      const estimate = await sepoliaChain.getTotalFeesEstimate({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: FTF_TOKEN_SEPOLIA, amount }],
        },
      })

      assert.equal(typeof estimate.ccipFee, 'bigint')
      assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')
      assert.ok(estimate.tokenTransferFee, 'tokenTransferFee should be present')

      const tf = estimate.tokenTransferFee
      assert.equal(typeof tf.feeDeducted, 'bigint')
      assert.equal(typeof tf.bps, 'number')
      assert.equal(tf.feeDeducted, (amount * BigInt(tf.bps)) / 10_000n)

      console.log('  getTotalFeesEstimate (standard finality):')
      console.log(`    ccipFee = ${estimate.ccipFee}`)
      console.log(`    value = ${tf.feeDeducted} (${tf.bps} bps)`)
    })

    it('should return ccipFee only for pre-v2.0 lane with token transfer', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const amount = 1_000_000n
      const estimate = await sepoliaChain.getTotalFeesEstimate({
        router: SEPOLIA_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: CCIP_BNM_TOKEN_SEPOLIA, amount }],
        },
      })

      assert.equal(typeof estimate.ccipFee, 'bigint')
      assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')
      assert.equal(
        estimate.tokenTransferFee,
        undefined,
        'pre-v2.0 lane should not return tokenTransferFee',
      )
    })

    it('should use custom BPS when FTF', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const amount = 1_000_000n
      const estimate = await sepoliaChain.getTotalFeesEstimate({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: FTF_TOKEN_SEPOLIA, amount }],
          extraArgs: {
            gasLimit: 200_000n,
            finality: 1,
            ccvs: [],
            ccvArgs: [],
            executor: '',
            executorArgs: '0x',
            tokenReceiver: '',
            tokenArgs: '0x',
          },
        },
      })

      assert.equal(typeof estimate.ccipFee, 'bigint')
      assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')
      assert.ok(estimate.tokenTransferFee, 'tokenTransferFee should be present')

      const tf = estimate.tokenTransferFee
      assert.equal(tf.feeDeducted, (amount * BigInt(tf.bps)) / 10_000n)

      console.log('  getTotalFeesEstimate (finality=1):')
      console.log(`    ccipFee = ${estimate.ccipFee}`)
      console.log(`    value = ${tf.feeDeducted} (${tf.bps} bps)`)
    })

    // ── Historical message validation ──
    // Fetches real testnet messages from the staging API to get their fee breakdowns,
    // then runs preflight estimation with matching parameters and asserts the BPS
    // values match. This validates that on-chain fee estimation agrees with observed
    // historical behavior.
    //
    // TODO: once CCIPAPIClient exposes bpsFeeDetails from the API response, replace
    // the raw fetch below with client.getMessageById() and read fees from the result.

    const STAGING_API = 'https://api.ccip.cldev.cloud'

    const HISTORICAL_MESSAGE_IDS = [
      // Fuji → Arb-Sepolia, finalized (finality=0), 20 bps (finalityTransferFeeBps)
      '0xed535024b2c212ee0aef32a1c5790ffd0ed8684fed317623c704d991adc53a89',
      // Fuji → Arb-Sepolia, FTF (finality=1), 100 bps (fastFinalityTransferFeeBps)
      '0x1908420ed02f15577adf21277bb3ff562a20150c90d5848e1174237b5dc896c0',
      // Arb-Sepolia → Fuji, finalized (finality=0), 20 bps
      '0xd42a4152a46f062c73fcd7ad7c2702b97854573b93ab7a0476b91f5efd4547ec',
      // Arb-Sepolia → Fuji, FTF (finality=1), 100 bps
      '0x7c4502dd471f08db5801785095c87a20b0a6236e5350a7108e49342d884c6753',
    ]

    /** Resolve source chain selector to the matching fork chain + v2.0 router. */
    function resolveChain(sourceSelector: string) {
      if (sourceSelector === FUJI_SELECTOR.toString()) {
        assert.ok(fujiChain, 'fuji chain should be initialized')
        return { chain: fujiChain, router: FUJI_V2_0_ROUTER }
      }
      if (sourceSelector === ARB_SEP_SELECTOR.toString()) {
        assert.ok(arbSepChain, 'arb-sepolia chain should be initialized')
        return { chain: arbSepChain, router: ARB_SEP_V2_0_ROUTER }
      }
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')
      return { chain: sepoliaChain, router: SEPOLIA_V2_0_ROUTER }
    }

    for (const messageId of HISTORICAL_MESSAGE_IDS) {
      it(`preflight fee estimation should match API breakdown for ${messageId}`, async () => {
        // Fetch raw message from staging API (includes bpsFeeDetails not yet
        // exposed by CCIPAPIClient)
        const url = `${STAGING_API}/v2/messages/${messageId}`
        const res = await fetch(url)
        assert.ok(res.ok, `API request failed: ${res.status} ${res.statusText}`)
        const raw = (await res.json()) as Record<string, any>

        const { chain, router } = resolveChain(raw.sourceNetworkInfo.chainSelector)
        const destChainSelector = BigInt(raw.destNetworkInfo.chainSelector)
        const token = raw.tokenAmounts[0].sourceTokenAddress as string
        // v2.0.0 API exposes finality at the top level; extraArgs.blockConfirmations
        // was a dev-era compat field and is no longer populated.
        const finality: number = Number(raw.finality ?? 0)

        // Reconstruct original sent amount = post-fee amount + bps fee deducted
        const bpsEntry = raw.fees?.bpsFeeDetails?.[0]
        const apiBps: number = bpsEntry?.bps ?? 0
        const apiFeeDeducted = BigInt(bpsEntry?.amount ?? '0')
        const postFeeAmount = BigInt(raw.tokenAmounts[0].amount)
        const originalAmount = postFeeAmount + apiFeeDeducted

        console.log(`  [${messageId.slice(0, 10)}…] API: ${apiBps} bps, fee=${apiFeeDeducted}`)

        // Build estimation request matching the historical message
        const message: Parameters<typeof chain.getTotalFeesEstimate>[0]['message'] = {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token, amount: originalAmount }],
        }
        if (finality > 0) {
          message.extraArgs = {
            gasLimit: 0n,
            finality: finality,
            ccvs: [],
            ccvArgs: [],
            executor: '',
            executorArgs: '0x',
            tokenReceiver: '',
            tokenArgs: '0x',
          }
        }

        const estimate = await chain.getTotalFeesEstimate({
          router,
          destChainSelector,
          message,
        })

        assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')

        const estimatedBps = estimate.tokenTransferFee?.bps ?? 0
        const estimatedFee = estimate.tokenTransferFee?.feeDeducted ?? 0n

        console.log(
          `  [${messageId.slice(0, 10)}…] Estimated: ${estimatedBps} bps, fee=${estimatedFee}`,
        )

        assert.equal(estimatedBps, apiBps, `BPS mismatch for ${messageId}`)
        assert.equal(estimatedFee, apiFeeDeducted, `feeDeducted mismatch for ${messageId}`)
      })
    }
  })

  // ── USDC / CCTP detection tests ──
  // These test the CCTPVerifier-based USDC detection flow directly.
  // Limitations: on staging testnet the USDCTokenPoolProxy is deployed but not fully
  // initialized (getStaticConfig/getToken revert), so we can't test end-to-end through
  // getTotalFeesEstimate. Instead we exercise the detection building blocks:
  //   1. Pool typeAndVersion identification
  //   2. CCTPVerifier discovery via ccvs (extraArgs fallback path)
  //   3. CCTP domain resolution from the verifier
  describe('USDC / CCTP detection', () => {
    // CCTPVerifier on Fuji — known working, returns domain IDs
    const CCTP_VERIFIER_FUJI = '0x79DA0F0c54876C5c601877e335B92BD0E23ce1aA'
    // USDCTokenPoolProxy on Fuji — deployed but proxy not initialized
    const USDC_POOL_PROXY_FUJI = '0x53aAAA2b52D6bc2DbC7BC290f686B47799F61748'
    const BASE_SEPOLIA_SELECTOR = 10344971235874465080n

    it('should identify USDCTokenPoolProxy via typeAndVersion', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const [type, , full] = await fujiChain.typeAndVersion(USDC_POOL_PROXY_FUJI)
      assert.equal(type, 'USDCTokenPoolProxy')
      console.log(`  Pool typeAndVersion: ${full}`)
    })

    it('should identify CCTPVerifier via typeAndVersion', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const [type, , full] = await fujiChain.typeAndVersion(CCTP_VERIFIER_FUJI)
      assert.equal(type, 'CCTPVerifier')
      console.log(`  Verifier typeAndVersion: ${full}`)
    })

    it('should resolve CCTP domains from CCTPVerifier', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const provider = new JsonRpcProvider(FUJI_RPC)
      const verifier = new Contract(CCTP_VERIFIER_FUJI, interfaces.CCTPVerifier_v2_0, provider)

      const [staticConfig, destDomain] = (await Promise.all([
        verifier.getFunction('getStaticConfig')(),
        verifier.getFunction('getDomain')(BASE_SEPOLIA_SELECTOR),
      ])) as [{ localDomainIdentifier: bigint }, { domainIdentifier: bigint; enabled: boolean }]

      const sourceDomain = Number(staticConfig.localDomainIdentifier)
      const destDomainId = Number(destDomain.domainIdentifier)

      assert.equal(sourceDomain, 1, 'Fuji CCTP domain should be 1')
      assert.equal(destDomainId, 6, 'Base Sepolia CCTP domain should be 6')
      assert.equal(destDomain.enabled, true, 'Base Sepolia domain should be enabled')

      console.log(`  Fuji (domain ${sourceDomain}) -> Base Sepolia (domain ${destDomainId})`)

      // Extend: use the resolved domains to fetch burn fees from Circle's CCTP API
      const burnFees = await getUsdcBurnFees(sourceDomain, destDomainId, NetworkType.Testnet)

      assert.ok(Array.isArray(burnFees), 'burnFees should be an array')
      assert.ok(burnFees.length > 0, 'should have at least one fee tier')

      for (const tier of burnFees) {
        assert.equal(typeof tier.finalityThreshold, 'number')
        assert.equal(typeof tier.minimumFee, 'number')
        assert.ok(tier.finalityThreshold >= 0, 'finalityThreshold should be non-negative')
        assert.ok(tier.minimumFee >= 0, 'minimumFee should be non-negative')
      }

      // The fast tier (pre-finality) should have a positive fee
      const fastTier = burnFees.find((t) => t.finalityThreshold <= CCTP_FINALITY_FAST)
      // The standard tier (full finality) typically has 0 bps
      const standardTier = burnFees.find((t) => t.finalityThreshold > CCTP_FINALITY_FAST)

      console.log('  Circle API burn fee tiers:')
      for (const tier of burnFees) {
        console.log(`    threshold=${tier.finalityThreshold}, fee=${tier.minimumFee} bps`)
      }
      if (fastTier) console.log(`  Fast tier: ${fastTier.minimumFee} bps`)
      if (standardTier) console.log(`  Standard tier: ${standardTier.minimumFee} bps`)
    })

    it('should discover CCTPVerifier when passed as ccv in extraArgs', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Simulate the ccvs scanning loop from detectUsdcDomains:
      // given the CCTPVerifier address in ccvs, verify we can identify and use it
      const ccvs = [CCTP_VERIFIER_FUJI]
      let verifierAddress: string | undefined

      for (const ccv of ccvs) {
        const [ccvType] = await fujiChain.typeAndVersion(ccv)
        if (ccvType === 'CCTPVerifier') {
          verifierAddress = ccv
          break
        }
      }

      assert.ok(verifierAddress, 'should find CCTPVerifier in ccvs')
      assert.equal(verifierAddress, CCTP_VERIFIER_FUJI)

      // Now resolve domains from the discovered verifier
      const provider = new JsonRpcProvider(FUJI_RPC)
      const verifier = new Contract(verifierAddress, interfaces.CCTPVerifier_v2_0, provider)
      const destDomain = (await verifier.getFunction('getDomain')(BASE_SEPOLIA_SELECTOR)) as {
        domainIdentifier: bigint
      }

      assert.equal(Number(destDomain.domainIdentifier), 6)
      console.log(
        `  Discovered verifier ${verifierAddress.slice(0, 10)}..., dest domain: ${Number(destDomain.domainIdentifier)}`,
      )
    })
  })
})
