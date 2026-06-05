import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256, parseUnits, toBeHex } from 'ethers'
import { Instance } from 'prool'
import { createPublicClient, http } from 'viem'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import '../solana/index.ts' // register Solana chain family for cross-family message decoding
import '../ton/index.ts' // register TON chain family for cross-family message decoding
import { CCIPAPIClient } from '../api/index.ts'
import { LaneFeature } from '../chain.ts'
import { calculateManualExecProof, discoverOffRamp } from '../execution.ts'
import { type ExecutionInput, ExecutionState, MessageStatus } from '../types.ts'
import { interfaces } from './const.ts'
import { FUJI_TO_SEPOLIA, SOLANA_DEVNET_TO_SEPOLIA, TON_TO_SEPOLIA } from './fork.test.data.ts'
import { EVMChain } from './index.ts'
import { ViemTransportProvider } from './viem/client-adapter.ts'

// ── Chain constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://sepolia.gateway.tenderly.co'
const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://api.avax-test.network/ext/bc/C/rpc'
const FUJI_CHAIN_ID = 43113

const ARB_SEP_RPC = process.env['RPC_ARB_SEPOLIA'] || 'https://arbitrum-sepolia-rpc.publicnode.com'
const ARB_SEP_CHAIN_ID = 421614

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

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

// ── getLaneFeatures / ViemTransportProvider constants ──

// v2.0 router for Sepolia -> Fuji lane
const SEPOLIA_V2_0_ROUTER = '0x784d49a71BB4C48eB7dA4cD7e6Ecb424f9b5EAB1'
// Token served by FTF_ENABLED_POOL_SEPOLIA — works with V3 extra args on Sepolia→Fuji v2.0 lane
const FTF_TOKEN_SEPOLIA = '0xa41a773a7b68e80d4760a176cfec8f50e80d65a7'

// ── execute constants ──

// Known message stuck in FAILED state on sepolia, sent from fuji (v1.6)
const EXEC_TEST_MSG = FUJI_TO_SEPOLIA.find(
  (m) => m.status === MessageStatus.Failed && m.version === '1.6',
)!
const SOURCE_TX_HASH = EXEC_TEST_MSG.txHash
const MESSAGE_ID = EXEC_TEST_MSG.messageId
// Arb-Sep → Fuji v2.0.0 message that FAILED on-chain due to intentional OOG
// (ccipReceive gasLimit=100). CCV verification is COMPLETED so the message is
// readyForManualExecution — re-executing it on a Fuji fork with a higher
// gasLimit succeeds, exercising the API-driven manual-exec recovery path.
const V2_API_EXEC_MSG = {
  messageId: '0x2dedf76b3e16020807ca43a28f3c7210bf4305a6eadf98df9d2c5ceddd4a4f71',
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

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

describe('EVM Fork Tests', { skip, timeout: 180_000 }, () => {
  let sepoliaChain: EVMChain | undefined
  let fujiChain: EVMChain | undefined
  let arbSepChain: EVMChain | undefined
  let wallet: Wallet
  let sepoliaInstance: ReturnType<typeof Instance.anvil> | undefined
  let fujiInstance: ReturnType<typeof Instance.anvil> | undefined
  let arbSepInstance: ReturnType<typeof Instance.anvil> | undefined

  before(async () => {
    sepoliaInstance = Instance.anvil({
      forkUrl: SEPOLIA_RPC,
      chainId: SEPOLIA_CHAIN_ID,
      port: 8646,
    })
    fujiInstance = Instance.anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8645 })
    arbSepInstance = Instance.anvil({
      forkUrl: ARB_SEP_RPC,
      chainId: ARB_SEP_CHAIN_ID,
      port: 8644,
    })
    await Promise.all([sepoliaInstance.start(), fujiInstance.start(), arbSepInstance.start()])

    const sepoliaProvider = new JsonRpcProvider(
      `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
    )
    const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)
    const arbSepProvider = new JsonRpcProvider(
      `http://${arbSepInstance.host}:${arbSepInstance.port}`,
    )

    sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, {
      apiClient: null,
      logger: testLogger,
    })
    fujiChain = await EVMChain.fromProvider(fujiProvider, { apiClient: null, logger: testLogger })
    arbSepChain = await EVMChain.fromProvider(arbSepProvider, {
      apiClient: null,
      logger: testLogger,
    })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)
  })

  after(async () => {
    sepoliaChain?.provider.destroy()
    fujiChain?.provider.destroy()
    arbSepChain?.provider.destroy()
    await Promise.all([sepoliaInstance?.stop(), fujiInstance?.stop(), arbSepInstance?.stop()])
  })

  // ── State-mutating tests (sendMessage / execute / ViemTransportProvider) ──

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
      const messagesInBatch = await fujiChain.getMessagesInBatch(request, verifications.report, {
        page: 999,
      })

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
      assert.ok(execution.log.blockTimestamp > 0, 'execution should have a positive timestamp')
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
      assert.ok(execution.log.blockTimestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        'execution state should be Success',
      )
    })

    it('should execute a v2.0 message via API-driven path (Arb-Sep -> Fuji)', async () => {
      assert.ok(fujiInstance, 'fuji anvil should be running')

      // Create a fuji chain with staging API client (execution-inputs endpoint)
      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)
      const fujiWithApi = await EVMChain.fromProvider(fujiProvider, {
        apiClient: stagingApi,
        logger: testLogger,
      })
      const w = new Wallet(ANVIL_PRIVATE_KEY, fujiProvider)

      // Execute via messageId only — triggers API-driven path
      const execution = await fujiWithApi.execute({
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
      assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      fujiWithApi.provider.destroy()
    })

    it('should execute a v1.5 message via API-driven path (Sepolia -> Fuji)', async () => {
      assert.ok(fujiInstance, 'fuji anvil should be running')

      const messageId = '0xe654dc68b4d98e8ea2f182ee45d5766af4f62e2417395153a90c4b377d3fcd07'

      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)
      const fujiWithApi = await EVMChain.fromProvider(fujiProvider, {
        apiClient: stagingApi,
        logger: testLogger,
      })
      const w = new Wallet(ANVIL_PRIVATE_KEY, fujiProvider)

      const execution = await fujiWithApi.execute({
        messageId,
        wallet: w,
        gasLimit: 500_000,
      })

      console.log(
        `  executed ${messageId.slice(0, 10)}… via API (v1.5 Sepolia→Fuji) → state=${execution.receipt.state}`,
      )
      assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'should have tx hash')
      assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      fujiWithApi.provider.destroy()
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
      assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      sepoliaWithApi.provider.destroy()
    })

    // Another problematic TON-source message with gasLimit=1 and data payload.
    // Validates the API-driven manual execution path for TON → Sepolia.
    it('should execute a problematic TON-source message via API-driven path (TON -> Sepolia, gasLimit=1)', async () => {
      assert.ok(sepoliaInstance, 'sepolia anvil should be running')

      const msg = TON_TO_SEPOLIA[0]!

      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const sepoliaProvider = new JsonRpcProvider(
        `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
      )
      const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
        apiClient: stagingApi,
        logger: testLogger,
      })
      const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

      const execution = await sepoliaWithApi.execute({
        messageId: msg.messageId,
        wallet: w,
        gasLimit: 500_000,
      })

      console.log(
        `  executed ${msg.messageId.slice(0, 10)}… via API (TON source, gasLimit=1) → state=${execution.receipt.state}`,
      )
      assert.equal(execution.receipt.messageId, msg.messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'should have tx hash')
      assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      sepoliaWithApi.provider.destroy()
    })

    // Solana Devnet → Sepolia message whose lane.version reported by the API is "1.6.2".
    // The CCIPVersion enum only knows "1.6.0", so the API-driven manual-exec codepath
    // must normalize patch-level versions to avoid breaking downstream handling
    // (e.g. leaf hasher selection in calculateManualExecProof).
    it('should execute a Solana-source message via API-driven path (Solana Devnet -> Sepolia)', async () => {
      assert.ok(sepoliaInstance, 'sepolia anvil should be running')

      const msg = SOLANA_DEVNET_TO_SEPOLIA[0]!

      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const sepoliaProvider = new JsonRpcProvider(
        `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
      )
      const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
        apiClient: stagingApi,
        logger: testLogger,
      })
      const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

      const execution = await sepoliaWithApi.execute({
        messageId: msg.messageId,
        wallet: w,
        gasLimit: 500_000,
      })

      console.log(
        `  executed ${msg.messageId.slice(0, 10)}… via API (Solana source) → state=${execution.receipt.state}`,
      )
      assert.equal(execution.receipt.messageId, msg.messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'should have tx hash')
      assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success)

      sepoliaWithApi.provider.destroy()
    })
  })

  describe('ViemTransportProvider — revert data forwarding', () => {
    // Triggers a real pool-capacity revert through the viem adapter and asserts the
    // SDK's error-decoding machinery recovers the custom error name + args.
    // Pre-fix (before Patch B): `ViemTransportProvider._send` drops viem's error.data;
    // `EVMChain.parse(err)` only sees the calldata selector and returns `method: "ccipSend"`
    // with no `revert` key.
    // Post-fix: the walk preserves error.data; `parseWithFragment` matches the selector
    // against the pool ABI and returns `TokenMaxCapacityExceeded` with decoded args.
    // BigInt-safe JSON stringifier — `parsed` contains decoded revert args as bigints.
    const stringifyParsed = (v: unknown): string =>
      JSON.stringify(v, (_, val) => (typeof val === 'bigint' ? val.toString() : val))

    // Reads the pool's current outbound capacity through the SDK and returns 10× it, so
    // the post-fee amount still exceeds capacity regardless of the pool's transfer-fee
    // config. The pool deducts a percentage fee BEFORE the rate-limit check, so sending
    // exactly `capacity + 1` underflows capacity after the fee and is accepted. Keeps
    // the test dynamic across rate-limit reconfigs on the upstream pool.
    const overCapacityAmount = async (): Promise<bigint> => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized for capacity probe')
      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        token: FTF_TOKEN_SEPOLIA,
      })
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      assert.ok(rateLimits?.capacity, 'pool must have rate-limit capacity configured')
      return rateLimits.capacity * 10n + 1n
    }

    // Each test in this block submits real txs through a dedicated `EVMChain` instance
    // so nonce caches start empty and re-fetch from the fork. The shared `sepoliaChain`
    // used elsewhere in the suite holds cached nonces from prior tests, which become
    // stale once other chains on the same fork consume nonces for this wallet.

    it('decodes TokenMaxCapacityExceeded custom error on pool-capacity revert', async () => {
      assert.ok(sepoliaInstance, 'sepolia anvil should be running')
      const anvilUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`
      const walletAddress = await wallet.getAddress()

      // Amount = 10× pool's outbound capacity (see overCapacityAmount). Dynamic so the
      // test survives rate-limit reconfig upstream. `sendMessage` handles approve internally.
      const oversizedAmount = await overCapacityAmount()
      const ethersProvider = wallet.provider as JsonRpcProvider
      await setERC20Balance(ethersProvider, FTF_TOKEN_SEPOLIA, walletAddress, oversizedAmount)

      // Build a viem PublicClient pointed at the same Anvil fork, wrap with
      // ViemTransportProvider, and bind a Wallet to it. Every RPC call
      // (estimateGas, eth_call, eth_sendTransaction) now flows through the adapter.
      const viemClient = createPublicClient({
        chain: { id: SEPOLIA_CHAIN_ID, name: 'Sepolia Fork' } as never,
        transport: http(anvilUrl),
      })
      const viemProvider = new ViemTransportProvider(viemClient as never)
      const viemWallet = new Wallet(ANVIL_PRIVATE_KEY, viemProvider)
      const viemChain = await EVMChain.fromProvider(viemProvider, {
        apiClient: null,
        logger: testLogger,
      })
      // Bypass SDK preflight so the on-chain TokenMaxCapacityExceeded revert reaches EVMChain.parse.
      viemChain.checkSendMessage = async () => true as const

      let caught: unknown
      try {
        await viemChain.sendMessage({
          router: SEPOLIA_V2_0_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: walletAddress,
            tokenAmounts: [{ token: FTF_TOKEN_SEPOLIA, amount: oversizedAmount }],
            extraArgs: { gasLimit: 0n },
          },
          wallet: viemWallet,
        })
      } catch (err) {
        caught = err
      }

      assert.ok(caught, 'sendMessage should throw on over-capacity amount')

      const parsed = EVMChain.parse(caught)
      assert.ok(parsed, 'EVMChain.parse should return a decoded envelope')

      const flat = stringifyParsed(parsed)
      assert.match(
        flat,
        /TokenMaxCapacityExceeded/,
        `viem-adapter path should surface the decoded custom error name. Parsed: ${flat}`,
      )

      viemChain.provider.destroy()
    })

    // Cross-check: same over-capacity send via the ethers-direct chain (sepoliaChain)
    // must produce an equivalent decoded output. Proves the viem adapter achieves
    // functional parity with the ethers-direct baseline.
    it('produces equivalent decoded output on ethers-direct path', async () => {
      assert.ok(sepoliaInstance, 'sepolia anvil should be running')
      const anvilUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`
      const walletAddress = await wallet.getAddress()

      const oversizedAmount = await overCapacityAmount()
      const ethersProvider = wallet.provider as JsonRpcProvider
      await setERC20Balance(ethersProvider, FTF_TOKEN_SEPOLIA, walletAddress, oversizedAmount)

      // Dedicated EVMChain for this test (see describe-block preamble).
      const ethersChainLocal = await EVMChain.fromProvider(new JsonRpcProvider(anvilUrl), {
        apiClient: null,
        logger: testLogger,
      })
      // Bypass SDK preflight so the on-chain TokenMaxCapacityExceeded revert reaches EVMChain.parse.
      ethersChainLocal.checkSendMessage = async () => true as const
      const ethersWalletLocal = new Wallet(ANVIL_PRIVATE_KEY, ethersChainLocal.provider)

      let caught: unknown
      try {
        await ethersChainLocal.sendMessage({
          router: SEPOLIA_V2_0_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: walletAddress,
            tokenAmounts: [{ token: FTF_TOKEN_SEPOLIA, amount: oversizedAmount }],
            extraArgs: { gasLimit: 0n },
          },
          wallet: ethersWalletLocal,
        })
      } catch (err) {
        caught = err
      }

      assert.ok(caught, 'sendMessage should throw on oversized amount (ethers-direct)')
      const parsed = EVMChain.parse(caught)
      assert.ok(parsed, 'EVMChain.parse should decode the revert on ethers-direct path')

      const flat = stringifyParsed(parsed)
      assert.match(
        flat,
        /TokenMaxCapacityExceeded/,
        `ethers-direct path should surface the decoded custom error name. Parsed: ${flat}`,
      )

      ethersChainLocal.provider.destroy()
    })
  })
})
