import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256, parseUnits, toBeHex } from 'ethers'
import { anvil } from 'prool/instances'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

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

describe(
  'sendMessage - Anvil Fork Tests',
  { skip: !!process.env.SKIP_INTEGRATION_TESTS, timeout: 120_000 },
  () => {
    let chain: EVMChain | undefined
    let wallet: Wallet
    let instance: ReturnType<typeof anvil> | undefined

    before(async () => {
      instance = anvil({
        forkUrl: SEPOLIA_RPC,
        chainId: SEPOLIA_CHAIN_ID,
      })
      await instance.start()

      const provider = new JsonRpcProvider(`http://${instance.host}:${instance.port}`)
      chain = await EVMChain.fromProvider(provider, { apiClient: null })
      wallet = new Wallet(ANVIL_PRIVATE_KEY, provider)
    })

    after(async () => {
      chain?.destroy?.()
      await instance?.stop()
    })

    it('should send via v1.5 lane (Sepolia -> Fuji) and emit CCIPSendRequested', async () => {
      assert.ok(chain, 'chain should be initialized')
      const walletAddress = await wallet.getAddress()

      const request = await chain.sendMessage({
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
      assert.ok(chain, 'chain should be initialized')
      const walletAddress = await wallet.getAddress()

      const request = await chain.sendMessage({
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
      assert.ok(chain, 'chain should be initialized')
      const provider = wallet.provider as JsonRpcProvider
      const walletAddress = await wallet.getAddress()

      const amount = parseUnits('0.1', 18)
      await setERC20Balance(provider, APTOS_SUPPORTED_TOKEN, walletAddress, amount)

      const request = await chain.sendMessage({
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
  },
)
