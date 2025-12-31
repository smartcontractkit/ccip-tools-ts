/**
 * Integration tests for viem adapter with mocked browser wallets.
 * Tests ensure the SDK works correctly with viem's custom transports (MetaMask, etc.)
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createPublicClient, createWalletClient, custom, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, sepolia } from 'viem/chains'

import { ViemTransportProvider, fromViemClient, viemWallet } from './index.ts'
import { createMockEthereumProvider } from '../__mocks__/ethereum-provider.ts'

describe('SDK Integration - Viem Browser (custom transport)', () => {
  beforeEach(() => {
    global.ethereum = createMockEthereumProvider({})
  })

  it('should create PublicClient with custom transport', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    const chainId = await client.getChainId()
    assert.equal(chainId, 1)
  })

  it('should create WalletClient with custom transport', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )

    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(global.ethereum),
      account,
    })

    assert.ok(walletClient.account)
    assert.equal(
      (walletClient.account.address as string).toLowerCase(),
      (account.address as string).toLowerCase(),
    )
  })

  it('should create signer from viemWallet with custom transport', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )

    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(global.ethereum),
      account,
    })

    const signer = viemWallet(walletClient)
    const address = await signer.getAddress()

    assert.equal(address.toLowerCase(), (account.address as string).toLowerCase())
  })

  it('should sign message via viemWallet', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )

    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(global.ethereum),
      account,
    })

    const signer = viemWallet(walletClient)
    const signature = await signer.signMessage('Hello CCIP')

    assert.ok(signature.startsWith('0x'))
    assert.ok(signature.length > 100)
  })

  it('should create ViemTransportProvider from PublicClient', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    const provider = new ViemTransportProvider(client)
    const network = await provider.getNetwork()

    assert.equal(network.chainId, 1n)
  })

  it('should create EVMChain from fromViemClient with custom transport', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    const chain = await fromViemClient(client)

    assert.ok(chain)
    assert.equal(chain.network.family, 'evm')
    assert.equal(chain.network.chainId, 1)
  })

  it('should handle user rejection (code 4001)', async () => {
    global.ethereum = createMockEthereumProvider({
      rejectWith: { code: 4001, message: 'User rejected the request' },
    })

    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    await assert.rejects(
      async () => client.getChainId(),
      (err: Error) => {
        assert.ok(err.message.includes('User rejected'))
        return true
      },
    )
  })
})

describe('SDK Integration - Viem Node.js (http transport)', () => {
  it('should create PublicClient with http transport', () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    })

    assert.ok(client)
    assert.equal(client.chain.id, 1)
  })

  it('should create WalletClient with local account', () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )

    const walletClient = createWalletClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
      account,
    })

    assert.ok(walletClient.account)
    assert.equal(walletClient.chain.id, 1)
  })

  it('should create signer from viemWallet with local account', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )

    const walletClient = createWalletClient({
      chain: sepolia, // Use sepolia to avoid making real mainnet calls
      transport: http('https://rpc.sepolia.org'),
      account,
    })

    const signer = viemWallet(walletClient)
    const address = await signer.getAddress()

    assert.equal(address.toLowerCase(), (account.address as string).toLowerCase())
  })

  it('should sign message with local account (no RPC needed)', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )

    const walletClient = createWalletClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
      account,
    })

    const signer = viemWallet(walletClient)
    const signature = await signer.signMessage('Hello CCIP')

    // Local accounts sign locally, no RPC call needed
    assert.ok(signature.startsWith('0x'))
    assert.ok(signature.length > 100)
  })
})

describe('ViemTransportProvider', () => {
  beforeEach(() => {
    global.ethereum = createMockEthereumProvider({})
  })

  it('should forward RPC calls through viem client', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    const provider = new ViemTransportProvider(client)

    // Test direct _send method
    const results = await provider._send({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    })

    assert.equal(results.length, 1)
    assert.ok('result' in results[0]!)
  })

  it('should handle batched requests', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    const provider = new ViemTransportProvider(client)

    const results = await provider._send([
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    ])

    assert.equal(results.length, 2)
    assert.ok('result' in results[0]!)
    assert.ok('result' in results[1]!)
  })

  it('should work as ethers provider for basic operations', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: custom(global.ethereum),
    })

    const provider = new ViemTransportProvider(client)

    const blockNumber = await provider.getBlockNumber()
    assert.ok(blockNumber > 0)
  })
})
