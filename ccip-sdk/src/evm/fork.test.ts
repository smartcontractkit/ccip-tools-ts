import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256, parseUnits, toBeHex } from 'ethers'
import { anvil } from 'prool/instances'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import '../ton/index.ts' // register TON chain family for cross-family message decoding
import { CCIPAPIClient } from '../api/index.ts'
import { LaneFeature } from '../chain.ts'
import { calculateManualExecProof, discoverOffRamp } from '../execution.ts'
import { type ExecutionInput, ExecutionState, MessageStatus } from '../types.ts'
import { interfaces } from './const.ts'
import { FUJI_TO_SEPOLIA, SEPOLIA_TO_FUJI } from './fork.test.data.ts'
import { EVMChain } from './index.ts'

// ── Chain constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://avalanche-fuji-c-chain-rpc.publicnode.com'
const FUJI_CHAIN_ID = 43113

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// ── getFeeTokens constants ──

const SEPOLIA_V1_6_ROUTER = '0x866071AB5167081Cf28d02A2bfA592b6f0dc6c15'
const FUJI_ROUTER = '0xF694E193200268f9a4868e4Aa017A0118C9a8177'
const FUJI_V1_6_ROUTER = '0x7397Da7131aa4D32010BB375090222cd341303ce'

// ── sendMessage constants ──

// v1.5 lane: Sepolia -> Fuji (OnRamp 0x1249…025B)
const FUJI_SELECTOR = 14767482510784806043n
// keccak256 of the CCIPSendRequested(tuple) event signature from the v1.5 OnRamp ABI
const CCIP_SEND_REQUESTED_TOPIC =
  interfaces.EVM2EVMOnRamp_v1_5.getEvent('CCIPSendRequested')!.topicHash

// v1.6 lane: Sepolia -> Aptos testnet (OnRamp 0x23a5…9DeE)
const APTOS_TESTNET_SELECTOR = 743186221051783445n
// keccak256 of the CCIPMessageSent(uint64,uint64,tuple) event signature from the v1.6 OnRamp ABI
const CCIP_MESSAGE_SENT_TOPIC = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!.topicHash

// Token with pool support on the Sepolia -> Aptos lane
const APTOS_SUPPORTED_TOKEN = '0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05'

// ── getLaneFeatures constants ──

// v2.0 router for Sepolia -> Fuji lane
const SEPOLIA_V2_0_ROUTER = '0xc0f457e615348708FaAB3B40ECC26Badb32B7b30'
// v2.0 router for Fuji -> Sepolia lane
const FUJI_V2_0_ROUTER = '0xE7b62d27D6DDca525FE2e1ea526905EbfB36a1e1'
// Token on Sepolia whose pool (BurnMintTokenPool 1.7.0-dev) supports the older
// singular getMinBlockConfirmation(), not the plural getMinBlockConfirmations()
// in our current ABI. This exercises the try-catch fallback path.
const OLD_POOL_TOKEN_SEPOLIA = '0x67f000ca40cb1c6ee3bd2c7fda2fd22ddf56faab'
// Token on Fuji whose pool (LombardTokenPool 2.0.0-dev) DOES support getMinBlockConfirmations
const FTF_TOKEN_FUJI = '0x7FbdC44BfEBDe80C970ba622B678daB36cee31f6'
// CCIP-BnM on Sepolia — supported on v1.5 Sepolia→Fuji lane
const CCIP_BNM_TOKEN_SEPOLIA = '0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05'
// Token pools with FTF enabled and custom rate limits configured
const FTF_ENABLED_POOL_SEPOLIA = '0x161d23c30b5ae2899c3d4d969ba2b82026f3954a'
const FTF_ENABLED_POOL_FUJI = '0xc9346f85a04a47188710d8830127a2490959cbd9'
// Token served by FTF_ENABLED_POOL_SEPOLIA — works with V3 extra args on Sepolia→Fuji v2.0 lane
const FTF_TOKEN_SEPOLIA = '0x6b039E8bDB3F92093AdC417367379089be7A80B1'

// ── execute constants ──

// Known message stuck in FAILED state on sepolia, sent from fuji (v1.6)
const EXEC_TEST_MSG = FUJI_TO_SEPOLIA.find(
  (m) => m.status === MessageStatus.Failed && m.version === '1.6',
)!
const SOURCE_TX_HASH = EXEC_TEST_MSG.txHash
const MESSAGE_ID = EXEC_TEST_MSG.messageId
const V2_API_EXEC_MSG = {
  messageId: '0x886836ec7b9adc834d45d70c4cbd05f2623f56add4e15a96e12758c941452155',
}

// Second failed v1.6 message for getExecutionInput test (different from above so both can execute)
const EXEC_INPUT_TEST_MSG = FUJI_TO_SEPOLIA.find(
  (m) => m.status === MessageStatus.Failed && m.version === '1.6' && m !== EXEC_TEST_MSG,
)!

// ── Helpers ──

async function setERC20Balance(
  provider: JsonRpcProvider,
  token: string,
  address: string,
  amount: bigint,
  balanceSlot = 0n,
): Promise<void> {
  const storageKey = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [address, balanceSlot]),
  )
  await provider.send('anvil_setStorageAt', [token, storageKey, toBeHex(amount, 32)])
  const erc20 = new Contract(token, interfaces.Token, provider)
  const balance: bigint = await erc20.getFunction('balanceOf')(address)
  if (balance !== amount) {
    if (balanceSlot < 20n)
      return setERC20Balance(provider, token, address, amount, balanceSlot + 1n)
    throw new Error(
      `setERC20Balance: no working slot found (last tried ${balanceSlot}, got ${balance}, expected ${amount})`,
    )
  }
}

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

const skipHighRpcLoad = !process.env.RUN_HIGH_RPC_LOAD_TESTS

describe('EVM Fork Tests', { skip, timeout: 180_000 }, () => {
  let sepoliaChain: EVMChain | undefined
  let fujiChain: EVMChain | undefined
  let wallet: Wallet
  let sepoliaInstance: ReturnType<typeof anvil> | undefined
  let fujiInstance: ReturnType<typeof anvil> | undefined

  before(async () => {
    sepoliaInstance = anvil({
      forkUrl: SEPOLIA_RPC,
      chainId: SEPOLIA_CHAIN_ID,
      port: 8646,
    })
    fujiInstance = anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8645 })
    await Promise.all([sepoliaInstance.start(), fujiInstance.start()])

    const sepoliaProvider = new JsonRpcProvider(
      `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
    )
    const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)

    sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, {
      apiClient: null,
      logger: testLogger,
    })
    fujiChain = await EVMChain.fromProvider(fujiProvider, { apiClient: null, logger: testLogger })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)
  })

  after(async () => {
    sepoliaChain?.destroy?.()
    fujiChain?.destroy?.()
    await Promise.all([sepoliaInstance?.stop(), fujiInstance?.stop()])
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

    // v1.5 scans FeeConfigSet events from block 1, requiring wide block ranges that
    // free-tier RPC providers may reject or serve very slowly.
    it(
      'should return fee tokens for v1.5 router on sepolia',
      { skip: skipHighRpcLoad },
      async () => {
        assert.ok(sepoliaChain, 'sepolia chain should be initialized')

        const feeTokens = await sepoliaChain.getFeeTokens(SEPOLIA_ROUTER)
        const entries = Object.entries(feeTokens)
        assert.ok(entries.length > 0, 'sepolia v1.5: should have at least one fee token')

        console.log(
          `  sepolia v1.5: ${entries.map(([a, i]) => `${i.symbol}(${a.slice(0, 8)}…)`).join(', ')}`,
        )
        for (const [address, info] of entries) {
          assert.match(
            address,
            /^0x[0-9a-fA-F]{40}$/,
            `sepolia v1.5: token address should be valid`,
          )
          assert.ok(info.symbol.length > 0, `sepolia v1.5: ${address} should have a symbol`)
          assert.ok(
            info.decimals >= 0,
            `sepolia v1.5: ${address} should have non-negative decimals`,
          )
        }
      },
    )
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
      })) {
        if (exec.receipt.state === ExecutionState.Success) {
          foundSuccess = true
          console.log(`  receipt: state=Success messageId=${successMsg.messageId.slice(0, 10)}…`)
          assert.equal(
            exec.receipt.messageId,
            successMsg.messageId,
            'receipt messageId should match',
          )
          assert.ok(exec.timestamp > 0, 'execution should have a positive timestamp')
          break
        }
      }
      assert.ok(foundSuccess, 'should find a success receipt for a known successful message')
    })

    // Pick a known FAILED message  — reuses the execute test message
    const failedMsg = FUJI_TO_SEPOLIA.find((m) => m.status === MessageStatus.Failed)!

    // Requires many log requests to reach the "failed" receipt, and gets slower as the chain advances.
    it(
      'should find a failed receipt with no preceding success for a known failed message',
      { skip: skipHighRpcLoad },
      async () => {
        assert.ok(fujiChain, 'source chain should be initialized')
        assert.ok(sepoliaChain, 'dest chain should be initialized')

        const tx = await fujiChain.getTransaction(failedMsg.txHash)
        const requests = await fujiChain.getMessagesInTx(tx)
        const request = requests.find((r) => r.message.messageId === failedMsg.messageId)!
        assert.ok(request, 'should find the request in the transaction')

        const offRamp = await discoverOffRamp(
          fujiChain,
          sepoliaChain,
          request.lane.onRamp,
          fujiChain,
        )
        assert.ok(offRamp, 'offRamp should be discovered')

        let foundFailed = false
        for await (const exec of sepoliaChain.getExecutionReceipts({
          offRamp,
          messageId: failedMsg.messageId,
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
      },
    )
  })

  describe('getLaneFeatures', () => {
    it('should return MIN_BLOCK_CONFIRMATIONS=0 and no rate limits for v1.6 router', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V1_6_ROUTER,
        destChainSelector: FUJI_SELECTOR,
      })

      assert.equal(
        features[LaneFeature.MIN_BLOCK_CONFIRMATIONS],
        undefined,
        'v1.6 lane should not include MIN_BLOCK_CONFIRMATIONS (FTF does not exist pre-v2.0)',
      )
      assert.equal(
        LaneFeature.RATE_LIMITS in features,
        false,
        'v1.6 lane should not have RATE_LIMITS',
      )
      assert.equal(
        LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS in features,
        false,
        'v1.6 lane should not have CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
      )
    })

    it('should return MIN_BLOCK_CONFIRMATIONS=1 and no rate limits for v2.0 router without token', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
      })

      assert.equal(
        features[LaneFeature.MIN_BLOCK_CONFIRMATIONS],
        1,
        'v2.0 lane without token should default to 1 block confirmation',
      )
      assert.equal(
        LaneFeature.RATE_LIMITS in features,
        false,
        'v2.0 lane without token should not have RATE_LIMITS (no pool to query)',
      )
    })

    it('should return MIN_BLOCK_CONFIRMATIONS=0 for token with old pool (fallback)', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        token: OLD_POOL_TOKEN_SEPOLIA,
      })

      assert.equal(
        features[LaneFeature.MIN_BLOCK_CONFIRMATIONS],
        0,
        'token with old pool should have FTF disabled (MIN_BLOCK_CONFIRMATIONS=0)',
      )
      // Old pool doesn't support getMinBlockConfirmations but does support
      // getCurrentRateLimiterState, so RATE_LIMITS may still be present
      assert.ok(LaneFeature.RATE_LIMITS in features, 'old pool should still have RATE_LIMITS')
      // FTF disabled → no CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS
      assert.equal(
        LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS in features,
        false,
        'FTF disabled pool should not have CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
      )
    })

    it('should query token pool for features on v2.0 pool', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const features = await fujiChain.getLaneFeatures({
        router: FUJI_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        token: FTF_TOKEN_FUJI,
      })

      const minBlocks = features[LaneFeature.MIN_BLOCK_CONFIRMATIONS]
      console.log(`  Lombard pool MIN_BLOCK_CONFIRMATIONS = ${minBlocks}`)
      assert.equal(
        minBlocks,
        0,
        'Lombard pool should return MIN_BLOCK_CONFIRMATIONS=0 (FTF not enabled)',
      )

      // RATE_LIMITS should be present for v2.0 pool with token
      assert.ok(LaneFeature.RATE_LIMITS in features, 'v2.0 pool should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      if (rateLimits != null) {
        assert.equal(typeof rateLimits.tokens, 'bigint', 'tokens should be bigint')
        assert.equal(typeof rateLimits.capacity, 'bigint', 'capacity should be bigint')
        assert.equal(typeof rateLimits.rate, 'bigint', 'rate should be bigint')
      }

      // FTF disabled → no CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS
      assert.equal(
        LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS in features,
        false,
        'FTF disabled pool should not have CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
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
        features[LaneFeature.MIN_BLOCK_CONFIRMATIONS],
        undefined,
        'v1.5 lane should not include MIN_BLOCK_CONFIRMATIONS (FTF does not exist pre-v2.0)',
      )

      // Legacy pool should expose RATE_LIMITS via getCurrentOutboundRateLimiterState
      assert.ok(LaneFeature.RATE_LIMITS in features, 'v1.5 lane with token should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      if (rateLimits != null) {
        assert.equal(typeof rateLimits.tokens, 'bigint', 'tokens should be bigint')
        assert.equal(typeof rateLimits.capacity, 'bigint', 'capacity should be bigint')
        assert.equal(typeof rateLimits.rate, 'bigint', 'rate should be bigint')
      }

      // FTF doesn't exist on legacy lanes → no CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS
      assert.equal(
        LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS in features,
        false,
        'legacy lane should not have CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
      )
    })

    it('should return nonzero MIN_BLOCK_CONFIRMATIONS and custom rate limits for FTF-enabled pool (Sepolia)', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const token = await sepoliaChain.getTokenForTokenPool(FTF_ENABLED_POOL_SEPOLIA)
      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        token,
      })

      const minBlocks = features[LaneFeature.MIN_BLOCK_CONFIRMATIONS]
      console.log(`  FTF-enabled pool MIN_BLOCK_CONFIRMATIONS = ${minBlocks}`)
      assert.ok(
        minBlocks != null && minBlocks > 0,
        `FTF-enabled pool should have MIN_BLOCK_CONFIRMATIONS > 0 (got ${minBlocks})`,
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
        LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS in features,
        'FTF-enabled pool should have CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
      )
      const customRateLimits = features[LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS]
      assert.ok(
        customRateLimits != null,
        'CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS should not be null',
      )
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

    it('should return nonzero MIN_BLOCK_CONFIRMATIONS and custom rate limits for FTF-enabled pool (Fuji)', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      const token = await fujiChain.getTokenForTokenPool(FTF_ENABLED_POOL_FUJI)
      const features = await fujiChain.getLaneFeatures({
        router: FUJI_V2_0_ROUTER,
        destChainSelector: SEPOLIA_SELECTOR,
        token,
      })

      const minBlocks = features[LaneFeature.MIN_BLOCK_CONFIRMATIONS]
      console.log(`  FTF-enabled Fuji pool MIN_BLOCK_CONFIRMATIONS = ${minBlocks}`)
      assert.ok(
        minBlocks != null && minBlocks > 0,
        `FTF-enabled pool should have MIN_BLOCK_CONFIRMATIONS > 0 (got ${minBlocks})`,
      )

      // Default rate limits should be present
      assert.ok(LaneFeature.RATE_LIMITS in features, 'FTF-enabled pool should have RATE_LIMITS')
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      assert.ok(rateLimits != null, 'RATE_LIMITS should not be null')

      // Custom finality rate limits should be present when FTF is enabled
      assert.ok(
        LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS in features,
        'FTF-enabled pool should have CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
      )
      const customRateLimits = features[LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS]
      assert.ok(
        customRateLimits != null,
        'CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS should not be null',
      )

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
    it('should return disabled fee config for token with old pool', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      // Resolve pool address for the old pool token
      const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_V2_0_ROUTER, FUJI_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, sepoliaChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        FUJI_SELECTOR,
        OLD_POOL_TOKEN_SEPOLIA,
      )) as string

      const result = await sepoliaChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: FUJI_SELECTOR,
        blockConfirmationsRequested: 0,
        tokenArgs: '0x',
      })

      // Old pools may respond with all-zero config rather than reverting
      assert.ok(result.tokenTransferFeeConfig, 'old pool responds to the call')
      assert.equal(
        result.tokenTransferFeeConfig.isEnabled,
        false,
        'fee config should not be enabled on old pool',
      )
    })

    it('should return fee config for v2.0 pool', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Resolve pool address
      const onRamp = await fujiChain.getOnRampForRouter(FUJI_V2_0_ROUTER, SEPOLIA_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, fujiChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        SEPOLIA_SELECTOR,
        FTF_TOKEN_FUJI,
      )) as string

      const result = await fujiChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: SEPOLIA_SELECTOR,
        blockConfirmationsRequested: 0,
        tokenArgs: '0x',
      })

      assert.ok(result.tokenTransferFeeConfig, 'v2.0 pool should return fee config')
      assert.equal(typeof result.tokenTransferFeeConfig.destGasOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.destBytesOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.isEnabled, 'boolean')
      console.log('  v2.0 pool fee config (blockConfirmationsRequested=0):')
      console.log(
        `    defaultBlockConfirmationsFeeUSDCents = ${result.tokenTransferFeeConfig.defaultBlockConfirmationsFeeUSDCents}`,
      )
      console.log(
        `    customBlockConfirmationsFeeUSDCents  = ${result.tokenTransferFeeConfig.customBlockConfirmationsFeeUSDCents}`,
      )
      console.log(
        `    defaultBlockConfirmationsTransferFeeBps = ${result.tokenTransferFeeConfig.defaultBlockConfirmationsTransferFeeBps}`,
      )
      console.log(
        `    customBlockConfirmationsTransferFeeBps  = ${result.tokenTransferFeeConfig.customBlockConfirmationsTransferFeeBps}`,
      )
    })

    it('should return fee config with blockConfirmationsRequested=1', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Resolve pool address
      const onRamp = await fujiChain.getOnRampForRouter(FUJI_V2_0_ROUTER, SEPOLIA_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, fujiChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        SEPOLIA_SELECTOR,
        FTF_TOKEN_FUJI,
      )) as string

      const result = await fujiChain.getTokenPoolConfig(poolAddress, {
        destChainSelector: SEPOLIA_SELECTOR,
        blockConfirmationsRequested: 1,
        tokenArgs: '0x',
      })

      assert.ok(result.tokenTransferFeeConfig, 'v2.0 pool should return fee config')
      assert.equal(typeof result.tokenTransferFeeConfig.destGasOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.destBytesOverhead, 'number')
      assert.equal(typeof result.tokenTransferFeeConfig.isEnabled, 'boolean')
      console.log('  v2.0 pool fee config (blockConfirmationsRequested=1):')
      console.log(
        `    defaultBlockConfirmationsFeeUSDCents = ${result.tokenTransferFeeConfig.defaultBlockConfirmationsFeeUSDCents}`,
      )
      console.log(
        `    customBlockConfirmationsFeeUSDCents  = ${result.tokenTransferFeeConfig.customBlockConfirmationsFeeUSDCents}`,
      )
      console.log(
        `    defaultBlockConfirmationsTransferFeeBps = ${result.tokenTransferFeeConfig.defaultBlockConfirmationsTransferFeeBps}`,
      )
      console.log(
        `    customBlockConfirmationsTransferFeeBps  = ${result.tokenTransferFeeConfig.customBlockConfirmationsTransferFeeBps}`,
      )
    })

    it('should omit fee config when feeOpts not provided', async () => {
      assert.ok(fujiChain, 'fuji chain should be initialized')

      // Resolve pool address
      const onRamp = await fujiChain.getOnRampForRouter(FUJI_V2_0_ROUTER, SEPOLIA_SELECTOR)
      const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, fujiChain.provider)
      const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
        SEPOLIA_SELECTOR,
        FTF_TOKEN_FUJI,
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
    it('should return nativeFee and no tokenTransferFee for data-only message', async () => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized')

      const estimate = await sepoliaChain.getTotalFeesEstimate({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: { receiver: '0x0000000000000000000000000000000000000001', data: '0x1337' },
      })

      assert.equal(typeof estimate.nativeFee, 'bigint')
      assert.ok(estimate.nativeFee > 0n, 'nativeFee should be positive')
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

      assert.equal(typeof estimate.nativeFee, 'bigint')
      assert.ok(estimate.nativeFee > 0n, 'nativeFee should be positive')
      assert.ok(estimate.tokenTransferFee, 'tokenTransferFee should be present')

      const tf = estimate.tokenTransferFee
      assert.equal(typeof tf.value, 'bigint')
      assert.equal(typeof tf.bps, 'number')
      assert.equal(tf.value, (amount * BigInt(tf.bps)) / 10_000n)

      console.log('  getTotalFeesEstimate (default blockConfirmations):')
      console.log(`    nativeFee = ${estimate.nativeFee}`)
      console.log(`    value = ${tf.value} (${tf.bps} bps)`)
    })

    it('should use custom BPS when blockConfirmations > 0', async () => {
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
            blockConfirmations: 1,
            ccvs: [],
            ccvArgs: [],
            executor: '',
            executorArgs: '0x',
            tokenReceiver: '',
            tokenArgs: '0x',
          },
        },
      })

      assert.equal(typeof estimate.nativeFee, 'bigint')
      assert.ok(estimate.nativeFee > 0n, 'nativeFee should be positive')
      assert.ok(estimate.tokenTransferFee, 'tokenTransferFee should be present')

      const tf = estimate.tokenTransferFee
      assert.equal(tf.value, (amount * BigInt(tf.bps)) / 10_000n)

      console.log('  getTotalFeesEstimate (blockConfirmations=1):')
      console.log(`    nativeFee = ${estimate.nativeFee}`)
      console.log(`    value = ${tf.value} (${tf.bps} bps)`)
    })
  })

  // ── State-mutating tests below: keep these last so read-only tests see clean fork state ──

  describe('sendMessage', () => {
    it('should send via v1.5 lane (Sepolia -> Fuji) and emit CCIPSendRequested', async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const walletAddress = await wallet.getAddress()

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: { receiver: walletAddress, data: '0x1337' },
        wallet,
      })

      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
      assert.equal(request.lane.sourceChainSelector, SEPOLIA_SELECTOR)
      assert.equal(request.lane.destChainSelector, FUJI_SELECTOR)
      assert.ok(request.tx.hash, 'tx hash should be defined')

      // Verify the v1.5 CCIPSendRequested event was emitted
      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.topics[0], CCIP_SEND_REQUESTED_TOPIC, 'should be CCIPSendRequested')
      assert.ok(request.log.address, 'log should have the onRamp address')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')
      assert.ok(
        String(request.message.data).includes('1337'),
        'message data should contain sent payload',
      )
    })

    it('should send via v1.6 lane (Sepolia -> Aptos) and emit CCIPMessageSent', async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const walletAddress = await wallet.getAddress()

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_ROUTER,
        destChainSelector: APTOS_TESTNET_SELECTOR,
        message: { receiver: walletAddress, data: '0xdead', extraArgs: { gasLimit: 0n } },
        wallet,
      })

      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
      assert.equal(request.lane.sourceChainSelector, SEPOLIA_SELECTOR)
      assert.equal(request.lane.destChainSelector, APTOS_TESTNET_SELECTOR)
      assert.ok(request.tx.hash, 'tx hash should be defined')

      // Verify the v1.6 CCIPMessageSent event was emitted
      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.topics[0], CCIP_MESSAGE_SENT_TOPIC, 'should be CCIPMessageSent')
      assert.ok(request.log.address, 'log should have the onRamp address')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')
      assert.ok(
        String(request.message.data).includes('dead'),
        'message data should contain sent payload',
      )
    })

    it('should send v1.6 token transfer with extraArgs (Sepolia -> Aptos)', async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const provider = wallet.provider as JsonRpcProvider
      const walletAddress = await wallet.getAddress()

      const amount = parseUnits('0.1', 18)
      await setERC20Balance(provider, APTOS_SUPPORTED_TOKEN, walletAddress, amount)

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_ROUTER,
        destChainSelector: APTOS_TESTNET_SELECTOR,
        message: {
          receiver: walletAddress,
          data: '0xcafe',
          tokenAmounts: [{ token: APTOS_SUPPORTED_TOKEN, amount }],
          extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
        },
        wallet,
      })

      // Event log assertions
      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.topics[0], CCIP_MESSAGE_SENT_TOPIC, 'should be CCIPMessageSent')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')

      // Message assertions
      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
      assert.ok(
        String(request.message.data).includes('cafe'),
        'message data should contain sent payload',
      )
      assert.ok(request.message.feeToken, 'feeToken should be defined')

      // ExtraArgs assertions (decoded from extraArgs bytes in v1.6 event)
      const msg = request.message as Record<string, unknown>
      assert.equal(msg.gasLimit, 0n, 'gasLimit should round-trip as 0')
      assert.equal(
        msg.allowOutOfOrderExecution,
        true,
        'allowOutOfOrderExecution should round-trip as true',
      )

      // Token transfer assertions
      const tokenAmounts = request.message.tokenAmounts as unknown as Record<string, unknown>[]
      assert.equal(tokenAmounts.length, 1, 'should have one token transfer')
      assert.equal(
        (tokenAmounts[0] as { amount: bigint }).amount,
        amount,
        'token amount should round-trip',
      )
      assert.ok(tokenAmounts[0]!.sourcePoolAddress, 'v1.6 should have sourcePoolAddress')
      assert.ok(tokenAmounts[0]!.destTokenAddress, 'v1.6 should have destTokenAddress')
    })
  })

  describe('execute', () => {
    it('should manually execute a failed v1.6 message (Fuji -> Sepolia)', async () => {
      assert.ok(fujiChain, 'source chain should be initialized')
      assert.ok(sepoliaChain, 'dest chain should be initialized')

      // 1. Get source transaction and extract CCIPRequest
      const tx = await fujiChain.getTransaction(SOURCE_TX_HASH)
      const requests = await fujiChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === MESSAGE_ID) ?? requests[0]!
      assert.equal(request.message.messageId, MESSAGE_ID, 'should find the expected message')

      // 2. Discover OffRamp on destination chain
      const offRamp = await discoverOffRamp(fujiChain, sepoliaChain, request.lane.onRamp, fujiChain)
      assert.ok(offRamp, 'offRamp should be discovered')

      // 3. Get commit store and commit report
      const verifications = await sepoliaChain.getVerifications({ offRamp, request })
      assert.ok('report' in verifications, 'commit should have a merkle root')
      assert.ok(verifications.report.merkleRoot, 'commit should have a merkle root')

      // 4. Get all messages in the commit batch from source
      const messagesInBatch = await fujiChain.getMessagesInBatch(request, verifications.report)

      // 5. Calculate manual execution proof
      const execReportProof = calculateManualExecProof(
        messagesInBatch,
        request.lane,
        request.message.messageId,
        verifications.report.merkleRoot,
        sepoliaChain,
      )

      // 6. Get offchain token data
      const offchainTokenData = await fujiChain.getOffchainTokenData(request)

      // 7. Build execution report and execute
      const input = {
        ...execReportProof,
        message: request.message,
        offchainTokenData,
      } as ExecutionInput
      const execution = await sepoliaChain.execute({
        offRamp,
        input,
        wallet,
        gasLimit: 500_000,
      })

      assert.equal(execution.receipt.messageId, MESSAGE_ID, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        'execution state should be Success',
      )
    })

    it('should execute via getExecutionInput (Fuji -> Sepolia)', async () => {
      assert.ok(fujiChain, 'source chain should be initialized')
      assert.ok(sepoliaChain, 'dest chain should be initialized')

      // 1. Get source transaction and extract CCIPRequest
      const tx = await fujiChain.getTransaction(EXEC_INPUT_TEST_MSG.txHash)
      const requests = await fujiChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === EXEC_INPUT_TEST_MSG.messageId)!
      assert.ok(request, 'should find the expected message')

      // 2. Discover OffRamp on destination chain
      const offRamp = await discoverOffRamp(fujiChain, sepoliaChain, request.lane.onRamp, fujiChain)
      assert.ok(offRamp, 'offRamp should be discovered')

      // 3. Get verifications from destination chain
      const verifications = await sepoliaChain.getVerifications({ offRamp, request })

      // 4. Build execution input via getExecutionInput (replaces manual proof + offchain steps)
      const input = await fujiChain.getExecutionInput({ request, verifications })

      // 5. Execute on destination
      const execution = await sepoliaChain.execute({
        offRamp,
        input,
        wallet,
        gasLimit: 500_000,
      })

      console.log(
        `  executed ${EXEC_INPUT_TEST_MSG.messageId.slice(0, 10)}… → state=${execution.receipt.state}`,
      )
      assert.equal(
        execution.receipt.messageId,
        EXEC_INPUT_TEST_MSG.messageId,
        'receipt messageId should match',
      )
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        'execution state should be Success',
      )
    })

    it('should execute a v2.0 message via API-driven path (Fuji -> Sepolia)', async () => {
      assert.ok(sepoliaInstance, 'sepolia anvil should be running')

      // Create a sepolia chain with staging API client (execution-inputs endpoint)
      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const sepoliaProvider = new JsonRpcProvider(
        `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
      )
      const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
        apiClient: stagingApi,
        logger: testLogger,
      })
      const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

      // Execute via messageId only — triggers API-driven path
      const execution = await sepoliaWithApi.execute({
        messageId: V2_API_EXEC_MSG.messageId,
        wallet: w,
        gasLimit: 500_000,
      })

      console.log(
        `  executed ${V2_API_EXEC_MSG.messageId.slice(0, 10)}… via API → state=${execution.receipt.state}`,
      )
      assert.equal(
        execution.receipt.messageId,
        V2_API_EXEC_MSG.messageId,
        'receipt messageId should match',
      )
      assert.ok(execution.log.transactionHash, 'should have tx hash')
      assert.ok(execution.timestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      sepoliaWithApi.destroy?.()
    })

    // TON-source messages were historically problematic due to data quality issues
    // on AtlasDB. This test verifies the API workaround that resolves the issue.
    it('should execute a TON-source message via API-driven path (TON -> Sepolia)', async () => {
      assert.ok(sepoliaInstance, 'sepolia anvil should be running')

      const messageId = '0xe913d21d8bc14316286646539db34bc7dd14b11c6ae3b0c307e7e52f6af02805'

      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const sepoliaProvider = new JsonRpcProvider(
        `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
      )
      const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
        apiClient: stagingApi,
        logger: testLogger,
      })
      const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

      // Execute via messageId only — triggers API-driven path
      const execution = await sepoliaWithApi.execute({
        messageId,
        wallet: w,
        gasLimit: 500_000,
      })

      console.log(
        `  executed ${messageId.slice(0, 10)}… via API (TON source) → state=${execution.receipt.state}`,
      )
      assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'should have tx hash')
      assert.ok(execution.timestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      sepoliaWithApi.destroy?.()
    })
  })
})
