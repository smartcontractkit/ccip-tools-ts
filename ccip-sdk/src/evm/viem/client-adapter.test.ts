import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ViemTransportProvider, fromViemClient } from './client-adapter.ts'
import { CCIPViemAdapterError } from '../../errors/index.ts'

describe('fromViemClient', () => {
  it('should throw if chain is not defined', async () => {
    const mockClient = {
      chain: undefined,
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
    }

    await assert.rejects(
      () => fromViemClient(mockClient as never),
      (err: Error) => {
        assert.ok(err instanceof CCIPViemAdapterError)
        assert.equal(err.name, 'CCIPViemAdapterError')
        assert.ok(err.message.includes('chain'))
        return true
      },
    )
  })

  it('should throw if chain.id is not defined', async () => {
    const mockClient = {
      chain: { name: 'Ethereum' }, // Missing id
      request: async () => '0x1',
    }

    await assert.rejects(
      () => fromViemClient(mockClient as never),
      (err: Error) => {
        assert.ok(err instanceof CCIPViemAdapterError)
        assert.ok(err.message.includes('chain'))
        return true
      },
    )
  })

  it('should work with http transport', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
      request: async () => '0x1',
    }

    // This will fail at EVMChain.fromProvider level due to network detection,
    // but we're testing that it doesn't throw CCIPViemAdapterError about URL extraction
    try {
      await fromViemClient(mockClient as never)
    } catch (err) {
      // Expected to fail at provider level, but not with CCIPViemAdapterError
      assert.ok(!(err instanceof CCIPViemAdapterError && err.message.includes('RPC URL')))
    }
  })

  it('should work with custom transport (browser wallet)', async () => {
    // Simulate MetaMask-style injected provider - no URL available
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'custom' }, // No URL - simulates MetaMask
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x1'
        if (method === 'eth_blockNumber') return '0x123'
        throw new Error(`Unmocked: ${method}`)
      },
    }

    // Should NOT throw about URL extraction - custom transports are now supported
    try {
      await fromViemClient(mockClient as never)
    } catch (err) {
      // May fail at EVMChain.fromProvider level, but NOT with URL extraction error
      assert.ok(!(err instanceof CCIPViemAdapterError && err.message.includes('RPC URL')))
    }
  })

  it('should work with transport.value.url pattern', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      transport: {
        type: 'http',
        value: { url: 'https://eth.llamarpc.com' },
      },
      request: async () => '0x1',
    }

    // This will fail at EVMChain.fromProvider level, but we're testing URL extraction
    try {
      await fromViemClient(mockClient as never)
    } catch (err) {
      // Expected to fail at provider level, but not with CCIPViemAdapterError about URL
      assert.ok(!(err instanceof CCIPViemAdapterError && err.message.includes('RPC URL')))
    }
  })
})

describe('ViemTransportProvider', () => {
  it('should forward RPC calls through viem client', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x1'
        if (method === 'eth_blockNumber') return '0x123456'
        throw new Error(`Unmocked: ${method}`)
      },
    }

    const provider = new ViemTransportProvider(mockClient as never)

    // Test _send method with JsonRpcPayload format
    const results = await provider._send({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    })
    assert.equal(results.length, 1)
    assert.ok('result' in results[0]!)
    if ('result' in results[0]) {
      assert.equal(results[0].result, '0x123456')
    }
  })

  it('should handle batched RPC requests', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x1'
        if (method === 'eth_blockNumber') return '0x123456'
        if (method === 'eth_getBalance') return '0x1000'
        throw new Error(`Unmocked: ${method}`)
      },
    }

    const provider = new ViemTransportProvider(mockClient as never)

    // Test batched _send with JsonRpcPayload format
    const results = await provider._send([
      { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0x123', 'latest'] },
    ])
    assert.equal(results.length, 2)
    assert.ok('result' in results[0]!)
    assert.ok('result' in results[1]!)
    if ('result' in results[0]) {
      assert.equal(results[0].result, '0x123456')
    }
    if ('result' in results[1]) {
      assert.equal(results[1].result, '0x1000')
    }
  })

  it('should handle RPC errors gracefully', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      request: async () => {
        throw new Error('RPC error')
      },
    }

    const provider = new ViemTransportProvider(mockClient as never)

    const results = await provider._send({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [],
    })
    assert.equal(results.length, 1)
    assert.ok('error' in results[0]!)
    const errorResult = results[0] as { error: { message: string } }
    assert.ok(errorResult.error.message.includes('RPC error'))
  })
})

describe('fromViemClient - Structural Type Acceptance', () => {
  it('should accept minimal structural client (RainbowKit pattern)', async () => {
    const minimalClient = {
      chain: { id: 1, name: 'Ethereum' },
      request: async () => '0x1',
    }

    // Should not throw type-related errors
    try {
      await fromViemClient(minimalClient as never)
    } catch (err) {
      // May fail at provider level, but type acceptance should work
      assert.ok(!(err instanceof CCIPViemAdapterError && err.message.includes('type')))
    }
  })

  it('should accept client with readonly chain (wagmi freezes configs)', async () => {
    const frozenClient = {
      chain: Object.freeze({ id: 1, name: 'Ethereum' }),
      request: async () => '0x1',
    }

    try {
      await fromViemClient(frozenClient as never)
    } catch (err) {
      assert.ok(!(err instanceof CCIPViemAdapterError))
    }
  })

  it('should reject client without chain', async () => {
    const noChainClient = { request: async () => '0x1' }

    await assert.rejects(() => fromViemClient(noChainClient as never), /must have a chain defined/)
  })

  it('should reject client with null chain', async () => {
    const nullChainClient = { chain: null, request: async () => '0x1' }

    await assert.rejects(
      () => fromViemClient(nullChainClient as never),
      /must have a chain defined/,
    )
  })
})
