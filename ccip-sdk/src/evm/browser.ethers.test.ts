/**
 * Browser integration tests for ethers.js with mocked window.ethereum.
 * Tests ensure the SDK works correctly with BrowserProvider (MetaMask, etc.)
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { BrowserProvider, Wallet } from 'ethers'

import { createMockEthereumProvider } from './__mocks__/ethereum-provider.ts'

// Track providers for cleanup
const activeProviders: BrowserProvider[] = []

describe('SDK Integration - Ethers.js Browser', () => {
  beforeEach(() => {
    // Reset global ethereum mock before each test
    global.ethereum = createMockEthereumProvider({})
  })

  afterEach(async () => {
    // Destroy all providers to stop background polling
    for (const provider of activeProviders) {
      try {
        provider.destroy()
      } catch {
        // Ignore errors during cleanup
      }
    }
    activeProviders.length = 0
  })

  it('should create BrowserProvider from window.ethereum', async () => {
    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)
    const network = await provider.getNetwork()

    assert.equal(network.chainId, 1n)
  })

  it('should get signer from BrowserProvider', async () => {
    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)
    const signer = await provider.getSigner()
    const address = await signer.getAddress()

    assert.equal(address.toLowerCase(), '0x1234567890123456789012345678901234567890')
  })

  it('should create BrowserProvider compatible with EVMChain', async () => {
    // This test verifies that BrowserProvider from window.ethereum
    // creates a provider with the expected interface for EVMChain
    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)

    // Verify the provider has the expected interface
    assert.equal(typeof provider.getNetwork, 'function')
    assert.equal(typeof provider.getSigner, 'function')
    assert.equal(typeof provider.getBlockNumber, 'function')

    // Verify basic RPC calls work through the mock
    const network = await provider.getNetwork()
    assert.equal(network.chainId, 1n)

    const blockNumber = await provider.getBlockNumber()
    assert.ok(blockNumber > 0)
  })

  it('should sign message with JsonRpcSigner', async () => {
    global.ethereum = createMockEthereumProvider({
      signMessageResult: '0xsignature123',
    })

    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)
    const signer = await provider.getSigner()
    const signature = await signer.signMessage('Hello CCIP')

    assert.equal(signature, '0xsignature123')
  })

  it('should handle user rejection (code 4001)', async () => {
    global.ethereum = createMockEthereumProvider({
      rejectWith: { code: 4001, message: 'User rejected the request' },
    })

    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)

    await assert.rejects(
      async () => provider.getSigner(),
      (err: Error & { code?: number }) => {
        assert.ok(err.message.includes('User rejected'))
        return true
      },
    )
  })

  it('should handle resource unavailable (code -32002)', async () => {
    global.ethereum = createMockEthereumProvider({
      rejectWith: { code: -32002, message: 'Resource unavailable' },
    })

    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)

    await assert.rejects(async () => provider.getSigner())
  })
})

describe('SDK Integration - Ethers.js Node.js', () => {
  afterEach(async () => {
    // Destroy all providers to stop background polling
    for (const provider of activeProviders) {
      try {
        provider.destroy()
      } catch {
        // Ignore errors during cleanup
      }
    }
    activeProviders.length = 0
  })

  it('should work with Wallet (private key signer)', async () => {
    // Use a test private key (never use in production)
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const wallet = new Wallet(testPrivateKey)

    const address = await wallet.getAddress()
    assert.ok(address.startsWith('0x'))
    assert.equal(address.length, 42)
  })

  it('should sign message with Wallet', async () => {
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const wallet = new Wallet(testPrivateKey)

    const signature = await wallet.signMessage('Hello CCIP')

    assert.ok(signature.startsWith('0x'))
    assert.ok(signature.length > 100) // Signatures are typically 132 chars
  })

  it('should create connected wallet with BrowserProvider', async () => {
    // Set up mock ethereum provider
    global.ethereum = createMockEthereumProvider({})

    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

    // Create BrowserProvider from mock and connect wallet
    const provider = new BrowserProvider(global.ethereum)
    activeProviders.push(provider)
    const wallet = new Wallet(testPrivateKey, provider)

    const address = await wallet.getAddress()
    assert.ok(address.startsWith('0x'))
    assert.equal(address.length, 42)
  })
})
