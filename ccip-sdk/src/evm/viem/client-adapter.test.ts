import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fromViemClient } from './client-adapter.ts'
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

  it('should throw if transport URL cannot be extracted', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'custom' }, // No URL
    }

    await assert.rejects(
      () => fromViemClient(mockClient as never),
      (err: Error) => {
        assert.ok(err instanceof CCIPViemAdapterError)
        assert.equal(err.name, 'CCIPViemAdapterError')
        assert.ok(err.message.includes('RPC URL'))
        return true
      },
    )
  })

  it('should extract URL from transport.url directly', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      transport: { type: 'http', url: 'https://eth.llamarpc.com' },
    }

    // This will fail at EVMChain.fromProvider level, but we're testing URL extraction
    try {
      await fromViemClient(mockClient as never)
    } catch (err) {
      // Expected to fail at provider level, but not with CCIPViemAdapterError
      assert.ok(!(err instanceof CCIPViemAdapterError && err.message.includes('RPC URL')))
    }
  })

  it('should extract URL from transport.value.url', async () => {
    const mockClient = {
      chain: { id: 1, name: 'Ethereum' },
      transport: {
        type: 'http',
        value: { url: 'https://eth.llamarpc.com' },
      },
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
