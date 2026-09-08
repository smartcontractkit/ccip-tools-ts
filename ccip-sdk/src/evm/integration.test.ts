import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from 'ethers'

import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { CCIPAPIClient } from '../api/index.ts'
import { LaneFeature } from '../chain.ts'
import { discoverOffRamp } from '../execution.ts'
import { NetworkType } from '../networks.ts'
import { CCTP_FINALITY_FAST, getUsdcBurnFees } from '../offchain.ts'
import { ExecutionState } from '../types.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

// Live RPCs: Base Sepolia + OP Sepolia (+ Hedera testnet) — plus the CCIP API.
//
// This suite deliberately avoids Sepolia and Fuji. Those two are the CCIP "hub"
// testnets every other live suite in the repo already locks (fork, dest-liquidity,
// solana, sui, the CLI e2e suites…), so anything pinned to them serializes behind
// 7-8 other files AND piles onto the same keyless public endpoints, which CI's
// shared egress gets rate-limited on. Base Sepolia and OP Sepolia carry the same
// three OnRamp generations (see the lane table below), are locked by no other
// suite, and therefore run fully in parallel with the rest of the matrix.
await useResource(['base-sepolia', 'optimism-sepolia', 'hedera-testnet', 'api'])

// ── Chain constants ──
//
// Integration tests issue many live RPC calls (no anvil fork to absorb them), so the
// defaults point at endpoints verified to (a) be reachable from CI's egress, (b) serve
// ~10k-block `eth_getLogs` ranges, and (c) retain logs deep enough for the historical
// messages asserted below. Override via RPC_* env vars.
const BASE_SEP_RPC = rpcEndpoint('RPC_BASE_SEPOLIA')
const BASE_SEP_SELECTOR = 10344971235874465080n

const OP_SEP_RPC = rpcEndpoint('RPC_OPTIMISM_SEPOLIA')
const OP_SEP_SELECTOR = 5224473277236331295n

const HEDERA_TESTNET_RPC = rpcEndpoint('RPC_HEDERA_TESTNET')
const HEDERA_ROUTER = '0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4'

// ── Routers ──

// Production CCIP Routers (1.2.0) from the CCIP Directory. A single Router fronts
// OnRamps of several generations — the lane (destination selector) picks the version.
const BASE_SEP_ROUTER = '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93'
const OP_SEP_ROUTER = '0x114A20A10b43D4115e5aeef7345a1A71d2a60C57'

// Base Sepolia Router of the CCIP 2.0 deployment (OnRamp 0x829F…0Fcd, "OnRamp 2.0.0").
// This is where the v2.0-only surface lives: Fast Transfer Finality (FTF), per-pool
// bps transfer fees and `tokenTransferFeeConfig`.
const BASE_SEP_V2_0_ROUTER = '0x0Ec6D443B425982f1F2862Dd0ffBFD431FCb6b8b'

// ── Destination selectors (no RPC needed: every test below is a source-side eth_call) ──
//
// Live OnRamp generations, as reported by `typeAndVersion` on the resolved OnRamp:
//   Base Sepolia → Chiado         EVM2EVMOnRamp 1.5.0
//   Base Sepolia → Unichain Sep.  OnRamp 1.6.0
//   Base Sepolia → OP Sepolia     OnRamp 2.0.0
//   OP Sepolia   → Chiado         EVM2EVMOnRamp 1.5.0
//   OP Sepolia   → WEMIX testnet  OnRamp 1.6.0
//   OP Sepolia   → Base Sepolia   OnRamp 2.0.0
const CHIADO_SELECTOR = 8871595565390010547n
const UNICHAIN_SEP_SELECTOR = 14135854469784514356n
const WEMIX_SELECTOR = 9284632837123596123n
// Destinations of the CCIP 2.0 deployment reachable from BASE_SEP_V2_0_ROUTER.
const SEPOLIA_SELECTOR = 16015286601757825753n
const AMOY_SELECTOR = 16281711391670634445n

// ── Token / pool constants ──

// CCIP-BnM on Base Sepolia — transferable on the v1.5 Base Sepolia→Chiado lane, served
// by a legacy (BurnMintTokenPool 1.5.1) pool.
const CCIP_BNM_TOKEN_BASE_SEP = '0x88A2d74F47a237a62e7A51cdDa67270CE381555e'

// v2.0 pool (BurnMintTokenPool 2.0.0, supportsInterface(IPoolV2) == true) with FTF
// enabled AND custom fast rate limits configured — i.e. FAST_RATE_LIMITS differs from
// the default RATE_LIMITS. Note being on a v2 lane does NOT imply a v2 pool: CCIP-BnM's
// pool on both Base Sepolia and OP Sepolia is still BurnMintTokenPool 1.5.x.
const FTF_ENABLED_POOL_BASE_SEP = '0x649bf0cBadf261BC3CfFb54995189303A86b618a'
// Token served by FTF_ENABLED_POOL_BASE_SEP (bps: 10 finalized / 50 fast).
const FTF_TOKEN_BASE_SEP = '0x28c1102d16409a8E3AA600AbFf9E84149f2Ee505'
// Token whose v2.0 pool (0x4a09…8324) has FTF disabled (allowedFinalityConfig = 0).
const NOFTF_TOKEN_BASE_SEP = '0xcB341eAe2171582cb8e112054d9d908EE5a69907'
// USDC on OP Sepolia — served by a USDCTokenPoolProxy 2.0.0 on the v2.0 OP→Base lane.
const USDC_TOKEN_OP_SEP = '0x5fd84259d66Cd46123540766Be93DFE6D43130D7'

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

describe('EVM Integration Tests', { skip, timeout: 180_000 }, () => {
  let baseSepChain: EVMChain | undefined
  let opSepChain: EVMChain | undefined
  let wallet: Wallet

  before(async () => {
    const baseSepProvider = new JsonRpcProvider(BASE_SEP_RPC)
    const opSepProvider = new JsonRpcProvider(OP_SEP_RPC)
    baseSepChain = await EVMChain.fromProvider(baseSepProvider, {
      apiClient: null,
      logger: testLogger,
    })
    opSepChain = await EVMChain.fromProvider(opSepProvider, {
      apiClient: null,
      logger: testLogger,
    })
    wallet = new Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      baseSepProvider,
    )
  })

  after(() => {
    baseSepChain?.provider.destroy()
    opSepChain?.provider.destroy()
  })

  describe('getBalance', () => {
    // Real Base Sepolia ↔ OP Sepolia token transfers. Each sender provably held both the
    // native coin (it paid gas) and the transferred token at send time, so their balances
    // are a stable non-zero target.
    const TOKEN_TRANSFER_MESSAGE_IDS = [
      // Base Sepolia → OP Sepolia, USDC, v2.0 lane (sender == receiver)
      '0x6ac545c356e5452041d2ff76c15a3fdcdcf18ba4a17d18b2be7970b9e141e2d9',
      // OP Sepolia → Base Sepolia, LINK, v1.5 lane
      '0xaac233a5ece55e930fdc6e0d3c7d503e8675a1cf0fcf7c67b4c840bc1fdbb9b6',
      // OP Sepolia → Base Sepolia, v1.5 lane
      '0x1f41114cb666e942789506c879bd0f2c2e5148c04f030ae8600ddba6ecf0e074',
    ]

    it('should return native and token balances for CCIP transfer participants', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')
      assert.ok(opSepChain, 'op-sepolia chain should be initialized')

      const apiClient = new CCIPAPIClient(undefined, { logger: testLogger })

      const chainBySelector = (selector: bigint) => {
        if (selector === BASE_SEP_SELECTOR) return baseSepChain
        if (selector === OP_SEP_SELECTOR) return opSepChain
        return undefined
      }

      let nonZeroNative = 0
      let nonZeroToken = 0
      for (const messageId of TOKEN_TRANSFER_MESSAGE_IDS) {
        const request = await apiClient.getMessageById(messageId)
        const { sourceNetworkInfo, destNetworkInfo } = request.metadata

        const sourceChain = chainBySelector(sourceNetworkInfo.chainSelector)
        const destChain = chainBySelector(destNetworkInfo.chainSelector)

        const { sender, receiver } = request.message
        const tokenAmounts = request.message.tokenAmounts as unknown as {
          sourceTokenAddress: string
          destTokenAddress: string
        }[]
        assert.ok(tokenAmounts.length, `${messageId}: expected a token transfer`)

        // Check sender native + token balance on source chain
        if (sourceChain) {
          const nativeBalance = await sourceChain.getBalance({ holder: sender })
          if (nativeBalance > 0n) nonZeroNative++

          const tokenBalance = await sourceChain.getBalance({
            holder: sender,
            token: tokenAmounts[0]!.sourceTokenAddress,
          })
          if (tokenBalance > 0n) nonZeroToken++
        }

        // Check receiver native + token balance on dest chain
        if (destChain) {
          const nativeBalance = await destChain.getBalance({ holder: receiver })
          if (nativeBalance > 0n) nonZeroNative++

          const tokenBalance = await destChain.getBalance({
            holder: receiver,
            token: tokenAmounts[0]!.destTokenAddress,
          })
          if (tokenBalance > 0n) nonZeroToken++
        }
      }

      console.log(`  balances: ${nonZeroNative} nonzero native, ${nonZeroToken} nonzero token`)
      assert.ok(nonZeroNative > 0, `expected some nonzero native balances, got ${nonZeroNative}`)
      assert.ok(nonZeroToken > 0, `expected some nonzero token balances, got ${nonZeroToken}`)
    })
  })

  describe('getMessageById vs getMessagesInTx', () => {
    // One message per OnRamp generation reachable from each source chain, so the
    // API↔RPC comparison covers v1.5, v1.6 and v2.0 message encodings.
    const testMessages = [
      {
        // Base Sepolia → BSC testnet
        messageId: '0xa0e050481f337be1708f2e7ac987f8c5b2c34b3b38b0d3cc3f7a8bfdeb9f7176',
        txHash: '0xfc13bd13ddba3b0db639ae657ed80cfe3480910f9e5721945e0dcd5688aa0fea',
        version: '1.5',
        source: 'base-sepolia' as const,
      },
      {
        // Base Sepolia → Sepolia, CCIP-BnM transfer
        messageId: '0xf2f43f4b614047ffe6764cdbc81c69d676d6e5ade9567bc93eca0596c268dbbc',
        txHash: '0x88a97073344e3b40d328edf09f55d98dcaba8b51ea9da694f37c3e9da0a474ec',
        version: '1.6',
        source: 'base-sepolia' as const,
      },
      {
        // Base Sepolia → OP Sepolia, USDC transfer, fast finality
        messageId: '0x6ac545c356e5452041d2ff76c15a3fdcdcf18ba4a17d18b2be7970b9e141e2d9',
        txHash: '0x2657d779860eae4ce68ab2cf26871f8919003fab97457b43205f71c280af4fad',
        version: '2.0',
        source: 'base-sepolia' as const,
      },
      {
        // OP Sepolia → Base Sepolia, token transfer
        messageId: '0x1f41114cb666e942789506c879bd0f2c2e5148c04f030ae8600ddba6ecf0e074',
        txHash: '0x51481227d5a227d07c16607d54a8184696cd58f0f65616dd9863d7c343ea2b2e',
        version: '1.5',
        source: 'op-sepolia' as const,
      },
      {
        // OP Sepolia → WEMIX testnet, token transfer
        messageId: '0xcc30a0f773d9e5b17aa7eb551dacec2110f43cc611c0ff1209cb4ef619c32ba3',
        txHash: '0x584618e6ba216042da79dd7cbaee1e77695c204f3d547ef73f33da85a3883153',
        version: '1.6',
        source: 'op-sepolia' as const,
      },
    ]

    it('should return matching lane and message fields from API and RPC', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')
      assert.ok(opSepChain, 'op-sepolia chain should be initialized')

      const apiClient = new CCIPAPIClient(undefined, { logger: testLogger })
      const chainBySource = { 'base-sepolia': baseSepChain, 'op-sepolia': opSepChain }

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
        assert.ok(
          rpcResult.lane.version.startsWith(msg.version),
          `${label}: expected a v${msg.version} lane, got ${rpcResult.lane.version}`,
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
    it('should return fee tokens for the production routers on both chains', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')
      assert.ok(opSepChain, 'op-sepolia chain should be initialized')

      const cases = [
        { chain: baseSepChain, router: BASE_SEP_ROUTER, label: 'base-sepolia' },
        { chain: opSepChain, router: OP_SEP_ROUTER, label: 'op-sepolia' },
        { chain: baseSepChain, router: BASE_SEP_V2_0_ROUTER, label: 'base-sepolia v2.0' },
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
    // Addressed by OnRamp (not Router) so the v1.5 path is exercised regardless of
    // which lane the Router's resolver happens to pick.
    it('should return fee tokens for a v1.5 OnRamp on base-sepolia', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      // EVM2EVMOnRamp 1.5.0 of the Base Sepolia → Chiado lane
      const v1_5OnRamp = await baseSepChain.getOnRampForRouter(BASE_SEP_ROUTER, CHIADO_SELECTOR)
      const [type, version] = await baseSepChain.typeAndVersion(v1_5OnRamp)
      assert.equal(type, 'EVM2EVMOnRamp', 'base-sepolia → chiado should be a legacy OnRamp')
      assert.ok(version.startsWith('1.5'), `expected a v1.5 OnRamp, got ${version}`)

      const feeTokens = await baseSepChain.getFeeTokens(v1_5OnRamp)
      const entries = Object.entries(feeTokens)
      assert.ok(entries.length > 0, 'base-sepolia v1.5: should have at least one fee token')

      console.log(
        `  base-sepolia v1.5: ${entries.map(([a, i]) => `${i.symbol}(${a.slice(0, 8)}…)`).join(', ')}`,
      )
      for (const [address, info] of entries) {
        assert.match(address, /^0x[0-9a-fA-F]{40}$/, `v1.5: token address should be valid`)
        assert.ok(info.symbol.length > 0, `v1.5: ${address} should have a symbol`)
        assert.ok(info.decimals >= 0, `v1.5: ${address} should have non-negative decimals`)
      }
    })
  })

  describe('generateUnsignedSendMessage (Hedera testnet)', () => {
    // Hedera's EVM quotes native (WHBAR) fees in tinybars (8 decimals); the SDK returns
    // the tx `value` in 18-decimal weibar by scaling the fee by 10^(18-8) = 10^10.
    // The hedera router also requires destination receivers left-padded to 32 bytes
    // (raw 20-byte EVM addresses revert with InvalidEVMAddress);
    // `encodeAddressToEvm` -> `encodeAddressToAny` provides that padding.
    it('should scale the native fee by 10^10 (tinybar -> weibar) in the ccipSend value', async () => {
      await using disposer = new AsyncDisposableStack()
      const hederaChain = disposer.adopt(
        await EVMChain.fromUrl(HEDERA_TESTNET_RPC, { apiClient: null, logger: testLogger }),
        (chain) => chain.provider.destroy(),
      )
      const sender = wallet.address
      const message = { receiver: sender, data: '0x', feeToken: ZeroAddress }
      const fee = await hederaChain.getFee({
        router: HEDERA_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message,
      })
      assert.ok(fee > 0n, `expected a positive fee on the live hedera->sepolia lane, got ${fee}`)

      const unsigned = await hederaChain.generateUnsignedSendMessage({
        sender,
        router: HEDERA_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message,
      })
      assert.equal(unsigned.transactions.length, 1, 'data-only send should not need approvals')
      const [sendTx] = unsigned.transactions
      assert.equal(sendTx?.to, HEDERA_ROUTER)
      assert.equal(sendTx.from, sender)
      assert.equal(
        sendTx.value,
        fee * 10n ** 10n,
        'native msg.value should be the fee in tinybars scaled to weibar',
      )
    })

    // An anvil fork of hedera can't replay this path (the FeeQuoter's native-price
    // reads inside anvil's fork env quote a garbage fee), so validate the actual send
    // by dry-running the exact SDK-built tx against the live router via eth_call.
    it('should build a native-fee ccipSend the live router accepts (dry-run)', async () => {
      await using disposer = new AsyncDisposableStack()
      const hederaChain = disposer.adopt(
        await EVMChain.fromUrl(HEDERA_TESTNET_RPC, { apiClient: null, logger: testLogger }),
        (chain) => chain.provider.destroy(),
      )
      const sender = wallet.address
      const message = { receiver: sender, data: '0x', feeToken: ZeroAddress }

      const fee = await hederaChain.getFee({
        router: HEDERA_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message,
      })
      assert.ok(fee > 0n, `expected a positive fee on the live hedera->sepolia lane, got ${fee}`)

      const unsigned = await hederaChain.generateUnsignedSendMessage({
        sender,
        router: HEDERA_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message,
      })
      const [sendTx] = unsigned.transactions
      assert.equal(sendTx?.to, HEDERA_ROUTER)
      assert.equal(sendTx.value, fee * 10n ** 10n)

      // eth_call executes the router's ccipSend without broadcasting: a revert here
      // means the lane rejects the SDK-built send (fee too high / receiver format /
      // value mismatch).
      await hederaChain.provider.call({
        to: sendTx.to,
        from: sender,
        data: sendTx.data,
        value: sendTx.value,
      })
    })
  })

  describe('getFee', () => {
    it('should return positive fees for v1.5, v1.6 and v2.0 lanes on both chains', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')
      assert.ok(opSepChain, 'op-sepolia chain should be initialized')

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
          chain: baseSepChain,
          router: BASE_SEP_ROUTER,
          dest: CHIADO_SELECTOR,
          message: manualMessage,
          label: 'base-sepolia v1.5',
        },
        {
          chain: baseSepChain,
          router: BASE_SEP_ROUTER,
          dest: UNICHAIN_SEP_SELECTOR,
          message: builtMessage,
          label: 'base-sepolia v1.6',
        },
        {
          chain: baseSepChain,
          router: BASE_SEP_ROUTER,
          dest: OP_SEP_SELECTOR,
          message: builtMessage,
          label: 'base-sepolia v2.0',
        },
        {
          chain: baseSepChain,
          router: BASE_SEP_V2_0_ROUTER,
          dest: SEPOLIA_SELECTOR,
          message: builtMessage,
          label: 'base-sepolia v2.0 (2.0 router)',
        },
        {
          chain: opSepChain,
          router: OP_SEP_ROUTER,
          dest: CHIADO_SELECTOR,
          message: manualMessage,
          label: 'op-sepolia v1.5',
        },
        {
          chain: opSepChain,
          router: OP_SEP_ROUTER,
          dest: WEMIX_SELECTOR,
          message: builtMessage,
          label: 'op-sepolia v1.6',
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
    // Both fixtures are on the OP Sepolia → Base Sepolia lane: the source tx is read by
    // hash (no scan), and only the destination (Base Sepolia) is scanned — that endpoint
    // is the one verified to serve 10k-block eth_getLogs ranges at this depth.
    const SUCCESS_MSG = {
      messageId: '0xaac233a5ece55e930fdc6e0d3c7d503e8675a1cf0fcf7c67b4c840bc1fdbb9b6',
      txHash: '0xdbb494cfcc39d1403158df7931d68e7146ced980b57066f57512a6a516ea111c',
    }

    it('should find a success receipt for a known successful message', async () => {
      assert.ok(opSepChain, 'source chain should be initialized')
      assert.ok(baseSepChain, 'dest chain should be initialized')

      // Discover offRamp from the source transaction
      const tx = await opSepChain.getTransaction(SUCCESS_MSG.txHash)
      const requests = await opSepChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === SUCCESS_MSG.messageId)
      assert.ok(request, 'should find the request in the transaction')

      const offRamp = await discoverOffRamp(
        opSepChain,
        baseSepChain,
        request.lane.onRamp,
        opSepChain,
      )
      assert.ok(offRamp, 'offRamp should be discovered')

      let foundSuccess = false
      for await (const exec of baseSepChain.getExecutionReceipts({
        offRamp,
        messageId: SUCCESS_MSG.messageId,
        sourceChainSelector: request.message.sourceChainSelector,
        startTime: request.log.blockTimestamp,
      })) {
        if (exec.receipt.state === ExecutionState.Success) {
          foundSuccess = true
          console.log(`  receipt: state=Success messageId=${SUCCESS_MSG.messageId.slice(0, 10)}…`)
          assert.equal(
            exec.receipt.messageId,
            SUCCESS_MSG.messageId,
            'receipt messageId should match',
          )
          assert.ok(exec.log.blockTimestamp > 0, 'execution should have a positive timestamp')
          break
        }
      }
      assert.ok(foundSuccess, 'should find a success receipt for a known successful message')
    })

    const FAILED_MSG = {
      messageId: '0x5cec46c7ae98f1a474e7af7f6a1241d3b14f5ee39a08e69ab79610d749acd54a',
      txHash: '0x9d9ac80f5c97b7a23cbc514a5701d2b01b3e2822ca6f11f47c96ae69ec4f454a',
    }

    // messageId-filtered scan from the message's block forward; breaks on the first
    // Failed receipt (emitted shortly after the message), so it returns early.
    it('should find a failed receipt with no preceding success for a known failed message', async () => {
      assert.ok(opSepChain, 'source chain should be initialized')
      assert.ok(baseSepChain, 'dest chain should be initialized')

      const tx = await opSepChain.getTransaction(FAILED_MSG.txHash)
      const requests = await opSepChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === FAILED_MSG.messageId)
      assert.ok(request, 'should find the request in the transaction')

      const offRamp = await discoverOffRamp(
        opSepChain,
        baseSepChain,
        request.lane.onRamp,
        opSepChain,
      )
      assert.ok(offRamp, 'offRamp should be discovered')

      let foundFailed = false
      for await (const exec of baseSepChain.getExecutionReceipts({
        offRamp,
        messageId: FAILED_MSG.messageId,
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
            FAILED_MSG.messageId,
            'receipt messageId should match',
          )
          break
        }
      }
      assert.ok(foundFailed, 'should find a failed receipt for a known failed message')
    })
  })

  describe('getLaneFeatures', () => {
    it('should return FINALITY_FAST=undefined and no rate limits for v1.6 lane', async () => {
      assert.ok(opSepChain, 'op-sepolia chain should be initialized')

      const features = await opSepChain.getLaneFeatures({
        router: OP_SEP_ROUTER,
        destChainSelector: WEMIX_SELECTOR,
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
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const features = await baseSepChain.getLaneFeatures({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: AMOY_SELECTOR,
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
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const features = await baseSepChain.getLaneFeatures({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: AMOY_SELECTOR,
        token: NOFTF_TOKEN_BASE_SEP,
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

    it('should return RATE_LIMITS for v1.5 lane with token (legacy pool)', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const features = await baseSepChain.getLaneFeatures({
        router: BASE_SEP_ROUTER,
        destChainSelector: CHIADO_SELECTOR,
        token: CCIP_BNM_TOKEN_BASE_SEP,
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

    it('should return nonzero FINALITY_FAST and FAST_RATE_LIMITS for FTF-enabled pool', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const token = await baseSepChain.getTokenForTokenPool(FTF_ENABLED_POOL_BASE_SEP)
      assert.equal(
        token.toLowerCase(),
        FTF_TOKEN_BASE_SEP.toLowerCase(),
        'pool should serve the expected token',
      )
      const features = await baseSepChain.getLaneFeatures({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: AMOY_SELECTOR,
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

    // Second chain / second pool flavour: OP Sepolia's v2.0 lane to Base Sepolia is
    // served by a USDCTokenPoolProxy 2.0.0, which reports FTF but delegates its rate
    // limits to CCTP — so both rate-limit keys are present but null.
    it('should report FTF with null rate limits for a v2.0 USDC proxy pool (OP Sepolia)', async () => {
      assert.ok(opSepChain, 'op-sepolia chain should be initialized')

      const features = await opSepChain.getLaneFeatures({
        router: OP_SEP_ROUTER,
        destChainSelector: BASE_SEP_SELECTOR,
        token: USDC_TOKEN_OP_SEP,
      })

      const minBlocks = features[LaneFeature.FINALITY_FAST]
      console.log(`  USDC proxy pool FINALITY_FAST = ${minBlocks}`)
      assert.ok(
        minBlocks != null && minBlocks > 0,
        `v2.0 USDC proxy pool should have FINALITY_FAST > 0 (got ${minBlocks})`,
      )

      assert.ok(LaneFeature.RATE_LIMITS in features, 'v2.0 pool should have RATE_LIMITS')
      assert.ok(
        LaneFeature.FAST_RATE_LIMITS in features,
        'FTF-reporting pool should have FAST_RATE_LIMITS',
      )
    })
  })

  describe('getTokenPoolConfig with tokenTransferFeeConfig', () => {
    /** Resolve the v2.0 pool serving FTF_TOKEN_BASE_SEP on the Base Sepolia → Amoy lane. */
    async function resolvePool(chain: EVMChain) {
      const onRamp = await chain.getOnRampForRouter(BASE_SEP_V2_0_ROUTER, AMOY_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, chain.provider)
      return (await onRampContract.getFunction('getPoolBySourceToken')(
        AMOY_SELECTOR,
        FTF_TOKEN_BASE_SEP,
      )) as string
    }

    it('should return fee config for v2.0 pool', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const poolAddress = await resolvePool(baseSepChain)

      const result = await baseSepChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: AMOY_SELECTOR,
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
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const poolAddress = await resolvePool(baseSepChain)

      const result = await baseSepChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: AMOY_SELECTOR,
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
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const poolAddress = await resolvePool(baseSepChain)

      const result = await baseSepChain.getTokenPoolConfig(poolAddress)

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
    // Amount matched to the historical messages asserted at the end of this block, so
    // the estimated bps fee is directly comparable with the observed one.
    const TRANSFER_AMOUNT = 10_000_000_000_000_000n

    it('should return ccipFee and no tokenTransferFee for data-only message', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const estimate = await baseSepChain.getTotalFeesEstimate({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message: { receiver: '0x0000000000000000000000000000000000000001', data: '0x1337' },
      })

      assert.equal(typeof estimate.ccipFee, 'bigint')
      assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')
      assert.equal(estimate.tokenTransferFee, undefined)
    })

    it('should return token transfer fee for message with tokenAmounts', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const estimate = await baseSepChain.getTotalFeesEstimate({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: FTF_TOKEN_BASE_SEP, amount: TRANSFER_AMOUNT }],
        },
      })

      assert.equal(typeof estimate.ccipFee, 'bigint')
      assert.ok(estimate.ccipFee > 0n, 'ccipFee should be positive')
      assert.ok(estimate.tokenTransferFee, 'tokenTransferFee should be present')

      const tf = estimate.tokenTransferFee
      assert.equal(typeof tf.feeDeducted, 'bigint')
      assert.equal(typeof tf.bps, 'number')
      assert.equal(tf.feeDeducted, (TRANSFER_AMOUNT * BigInt(tf.bps)) / 10_000n)

      console.log('  getTotalFeesEstimate (standard finality):')
      console.log(`    ccipFee = ${estimate.ccipFee}`)
      console.log(`    value = ${tf.feeDeducted} (${tf.bps} bps)`)
    })

    it('should return ccipFee only for pre-v2.0 lane with token transfer', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const amount = 1_000_000n
      const estimate = await baseSepChain.getTotalFeesEstimate({
        router: BASE_SEP_ROUTER,
        destChainSelector: CHIADO_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: CCIP_BNM_TOKEN_BASE_SEP, amount }],
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
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const standard = await baseSepChain.getTotalFeesEstimate({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: FTF_TOKEN_BASE_SEP, amount: TRANSFER_AMOUNT }],
        },
      })

      const estimate = await baseSepChain.getTotalFeesEstimate({
        router: BASE_SEP_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          tokenAmounts: [{ token: FTF_TOKEN_BASE_SEP, amount: TRANSFER_AMOUNT }],
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
      assert.equal(tf.feeDeducted, (TRANSFER_AMOUNT * BigInt(tf.bps)) / 10_000n)
      assert.ok(
        tf.bps > (standard.tokenTransferFee?.bps ?? 0),
        `fast-finality bps (${tf.bps}) should exceed finalized bps (${standard.tokenTransferFee?.bps})`,
      )

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
    // Both messages are sent FROM Base Sepolia, so only that chain's RPC is needed.
    //
    // TODO: once CCIPAPIClient exposes bpsFeeDetails from the API response, replace
    // the raw fetch below with client.getMessageById() and read fees from the result.

    const STAGING_API = 'https://api.ccip.cldev.cloud'

    const HISTORICAL_MESSAGE_IDS = [
      // Base Sepolia → Sepolia, finalized (finality=0), 10 bps (finalityTransferFeeBps)
      '0xbbdcc3f40b8f6d5890052ad2312857cf21545b64db135d2a5d1baae52d305ce7',
      // Base Sepolia → Sepolia, FTF (finality=1), 50 bps (fastFinalityTransferFeeBps)
      '0xfcb64b432b5b1f61721a37039566c8e255b6bc64616dee49116b238a5ee8c56d',
    ]

    /** Resolve source chain selector to the matching chain + v2.0 router. */
    function resolveChain(sourceSelector: string) {
      assert.equal(
        sourceSelector,
        BASE_SEP_SELECTOR.toString(),
        'historical fixtures must be sent from base-sepolia',
      )
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')
      return { chain: baseSepChain, router: BASE_SEP_V2_0_ROUTER }
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
  // These test the CCTPVerifier-based USDC detection flow directly, on Base Sepolia's
  // v2.0 USDC deployment. Note the CCV registered on the lane is a
  // VersionedVerifierResolver, not the CCTPVerifier itself — resolving through it is
  // exactly what `EVMChain.resolveVerifier` does, so the tests below mirror that:
  //   1. Pool typeAndVersion identification
  //   2. CCTPVerifier discovery via ccvs (resolver → implementation)
  //   3. CCTP domain resolution from the verifier
  describe('USDC / CCTP detection', () => {
    // USDCTokenPoolProxy 2.0.0 on Base Sepolia (prod USDC pool)
    const USDC_POOL_PROXY_BASE_SEP = '0x08FE8C7a71f4a6ED84738aE41b9dd3b355C1AE36'
    // CCV registered on Base Sepolia's v2.0 USDC lanes — a VersionedVerifierResolver 2.0.0
    const CCV_RESOLVER_BASE_SEP = '0xE57C834a439fDfE8196b95f4Fd24Daf1e05eAbB8'
    // CCTPVerifier 2.1.0 the resolver points at
    const CCTP_VERIFIER_BASE_SEP = '0xB066F99E0D0c30524c38ec45c9634284fE9Dc95a'
    // Circle CCTP domain IDs
    const BASE_SEPOLIA_CCTP_DOMAIN = 6
    const OP_SEPOLIA_CCTP_DOMAIN = 2

    it('should identify USDCTokenPoolProxy via typeAndVersion', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const [type, , full] = await baseSepChain.typeAndVersion(USDC_POOL_PROXY_BASE_SEP)
      assert.equal(type, 'USDCTokenPoolProxy')
      console.log(`  Pool typeAndVersion: ${full}`)
    })

    it('should identify CCTPVerifier via typeAndVersion', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const [resolverType] = await baseSepChain.typeAndVersion(CCV_RESOLVER_BASE_SEP)
      assert.equal(resolverType, 'VersionedVerifierResolver')

      const [type, , full] = await baseSepChain.typeAndVersion(CCTP_VERIFIER_BASE_SEP)
      assert.equal(type, 'CCTPVerifier')
      console.log(`  Verifier typeAndVersion: ${full}`)
    })

    it('should resolve CCTP domains from CCTPVerifier', async () => {
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      const verifier = new Contract(
        CCTP_VERIFIER_BASE_SEP,
        interfaces.CCTPVerifier_v2_0,
        baseSepChain.provider,
      )

      const [staticConfig, destDomain] = (await Promise.all([
        verifier.getFunction('getStaticConfig')(),
        verifier.getFunction('getDomain')(OP_SEP_SELECTOR),
      ])) as [{ localDomainIdentifier: bigint }, { domainIdentifier: bigint; enabled: boolean }]

      const sourceDomain = Number(staticConfig.localDomainIdentifier)
      const destDomainId = Number(destDomain.domainIdentifier)

      assert.equal(sourceDomain, BASE_SEPOLIA_CCTP_DOMAIN, 'Base Sepolia CCTP domain should be 6')
      assert.equal(destDomainId, OP_SEPOLIA_CCTP_DOMAIN, 'OP Sepolia CCTP domain should be 2')
      assert.equal(destDomain.enabled, true, 'OP Sepolia domain should be enabled')

      console.log(`  Base Sepolia (domain ${sourceDomain}) -> OP Sepolia (domain ${destDomainId})`)

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
      assert.ok(baseSepChain, 'base-sepolia chain should be initialized')

      // Simulate the ccvs scanning loop from detectUsdcDomains: given the lane's CCV in
      // ccvs, verify we can identify it and resolve through to the CCTPVerifier.
      const ccvs = [CCV_RESOLVER_BASE_SEP]
      let verifierAddress: string | undefined

      for (const ccv of ccvs) {
        const [ccvType] = await baseSepChain.typeAndVersion(ccv)
        if (ccvType === 'CCTPVerifier') {
          verifierAddress = ccv
          break
        }
        if (ccvType === 'VersionedVerifierResolver') {
          const resolver = new Contract(
            ccv,
            interfaces.VersionedVerifierResolver_v2_0,
            baseSepChain.provider,
          )
          const impl = (await resolver.getFunction('getOutboundImplementation')(
            OP_SEP_SELECTOR,
            '0x',
          )) as string
          const [implType] = await baseSepChain.typeAndVersion(impl)
          if (implType === 'CCTPVerifier') {
            verifierAddress = impl
            break
          }
        }
      }

      assert.ok(verifierAddress, 'should find CCTPVerifier in ccvs')
      assert.equal(verifierAddress, CCTP_VERIFIER_BASE_SEP)

      // Now resolve domains from the discovered verifier
      const verifier = new Contract(
        verifierAddress,
        interfaces.CCTPVerifier_v2_0,
        baseSepChain.provider,
      )
      const destDomain = (await verifier.getFunction('getDomain')(OP_SEP_SELECTOR)) as {
        domainIdentifier: bigint
      }

      assert.equal(Number(destDomain.domainIdentifier), OP_SEPOLIA_CCTP_DOMAIN)
      console.log(
        `  Discovered verifier ${verifierAddress.slice(0, 10)}..., dest domain: ${Number(destDomain.domainIdentifier)}`,
      )
    })
  })
})
