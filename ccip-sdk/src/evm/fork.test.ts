import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256, parseUnits, toBeHex } from 'ethers'
import { anvil } from 'prool/instances'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import { CCIPAPIClient } from '../api/index.ts'
import { calculateManualExecProof, discoverOffRamp } from '../execution.ts'
import { type ExecutionInput, ExecutionState } from '../types.ts'
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

// ── executeReport constants ──

// Known message stuck in FAILED state on sepolia, sent from fuji (v1.6)
const EXEC_TEST_MSG = FUJI_TO_SEPOLIA.find((m) => m.status === 'FAILED' && m.version === '1.6')!
const SOURCE_TX_HASH = EXEC_TEST_MSG.txHash
const MESSAGE_ID = EXEC_TEST_MSG.messageId

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

describe('EVM Fork Tests', { skip, timeout: 180_000 }, () => {
  let sepoliaChain: EVMChain | undefined
  let fujiChain: EVMChain | undefined
  let wallet: Wallet
  let sepoliaInstance: ReturnType<typeof anvil> | undefined
  let fujiInstance: ReturnType<typeof anvil> | undefined

  before(async () => {
    sepoliaInstance = anvil({ forkUrl: SEPOLIA_RPC, chainId: SEPOLIA_CHAIN_ID, port: 8646 })
    fujiInstance = anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8645 })
    await Promise.all([sepoliaInstance.start(), fujiInstance.start()])

    const sepoliaProvider = new JsonRpcProvider(
      `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
    )
    const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)

    sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, { apiClient: null })
    fujiChain = await EVMChain.fromProvider(fujiProvider, { apiClient: null })
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

      const apiClient = new CCIPAPIClient()

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

      assert.ok(nonZeroNative > 0, `expected some nonzero native balances, got ${nonZeroNative}`)
      assert.ok(nonZeroToken > 0, `expected some nonzero token balances, got ${nonZeroToken}`)
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

  describe('executeReport', () => {
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
  })
})
