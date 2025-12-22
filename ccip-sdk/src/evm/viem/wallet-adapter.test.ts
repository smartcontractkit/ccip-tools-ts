import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { viemWallet } from './wallet-adapter.ts'
import { CCIPViemAdapterError } from '../../errors/index.ts'

describe('viemWallet', () => {
  it('should create signer from WalletClient with http transport', () => {
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
      request: mock.fn(),
      signMessage: mock.fn(),
      signTypedData: mock.fn(),
      sendTransaction: mock.fn(),
    }

    const signer = viemWallet(mockWalletClient as never)

    assert.ok(signer)
    assert.equal(typeof signer.getAddress, 'function')
    assert.equal(typeof signer.signMessage, 'function')
    assert.equal(typeof signer.sendTransaction, 'function')
  })

  it('should throw if account is not defined', () => {
    const mockWalletClient = {
      account: undefined,
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
    }

    assert.throws(
      () => viemWallet(mockWalletClient as never),
      (err: Error) => {
        assert.ok(err instanceof CCIPViemAdapterError)
        assert.equal(err.name, 'CCIPViemAdapterError')
        assert.ok(err.message.includes('account'))
        return true
      },
    )
  })

  it('should throw if chain is not defined', () => {
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      chain: undefined,
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
    }

    assert.throws(
      () => viemWallet(mockWalletClient as never),
      (err: Error) => {
        assert.ok(err instanceof CCIPViemAdapterError)
        assert.equal(err.name, 'CCIPViemAdapterError')
        assert.ok(err.message.includes('chain'))
        return true
      },
    )
  })

  it('should throw if transport URL cannot be extracted', () => {
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'custom' }, // No URL
    }

    assert.throws(
      () => viemWallet(mockWalletClient as never),
      (err: Error) => {
        assert.ok(err instanceof CCIPViemAdapterError)
        assert.equal(err.name, 'CCIPViemAdapterError')
        assert.ok(err.message.includes('RPC URL'))
        return true
      },
    )
  })

  it('should return correct address', async () => {
    const expectedAddress = '0x1234567890123456789012345678901234567890'
    const mockWalletClient = {
      account: { address: expectedAddress },
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
      request: mock.fn(),
    }

    const signer = viemWallet(mockWalletClient as never)
    const address = await signer.getAddress()

    assert.equal(address, expectedAddress)
  })

  it('should handle transport with URL in value property', () => {
    const mockWalletClient = {
      account: { address: '0x1234567890123456789012345678901234567890' },
      chain: { id: 1, name: 'Ethereum' },
      transport: {
        type: 'http',
        value: { url: 'https://eth.llamarpc.com' },
      },
      request: mock.fn(),
    }

    const signer = viemWallet(mockWalletClient as never)
    assert.ok(signer)
  })
})
