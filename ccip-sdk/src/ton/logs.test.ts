import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { beginCell } from '@ton/core'
import type { TonClient4 } from '@ton/ton'

import { type LogDecoders, fetchLogs } from './logs.ts'

const TEST_ADDRESS = '0:9f2e995aebceb97ae094dbe4cf973cbc8a402b4f0ac5287a00be8aca042d51b9'

// Mock decoders that accept all messages
const mockDecoders: LogDecoders = {
  tryDecodeAsMessage: () => ({ messageId: '0x' + '1'.repeat(64) }),
  tryDecodeAsCommit: () => [{}],
  tryDecodeAsReceipt: () => ({ messageId: '0x' + '1'.repeat(64) }),
}

// Mock decoders that reject all messages
const rejectingDecoders: LogDecoders = {
  tryDecodeAsMessage: () => undefined,
  tryDecodeAsCommit: () => undefined,
  tryDecodeAsReceipt: () => undefined,
}

function createMockTransaction(lt: number, timestamp: number) {
  const txHash = Buffer.alloc(32)
  txHash.writeUInt32BE(lt, 0)

  const mockCell = beginCell().storeUint(0, 8).endCell()

  return {
    tx: {
      lt: BigInt(lt),
      hash: () => txHash,
      now: timestamp,
      outMessages: {
        values: () => [
          {
            info: { type: 'external-out' as const },
            body: mockCell,
          },
        ],
      },
    },
  }
}

function createMockClient(
  transactions: ReturnType<typeof createMockTransaction>[],
  opts?: { noAccount?: boolean },
) {
  const sortedTxs = [...transactions].sort((a, b) => Number(b.tx.lt) - Number(a.tx.lt))
  const latestTx = sortedTxs[0]

  // allows setTimeout callbacks to run
  const yieldToMacrotasks = () => new Promise((resolve) => setImmediate(resolve))

  return {
    getLastBlock: async () => {
      await yieldToMacrotasks()
      return { last: { seqno: 12345678 } }
    },
    getAccountLite: async () => {
      await yieldToMacrotasks()
      return {
        account: {
          last:
            opts?.noAccount || !latestTx
              ? null
              : {
                  lt: latestTx.tx.lt.toString(),
                  hash: latestTx.tx.hash().toString('base64'),
                },
        },
      }
    },
    getAccountTransactions: async (_address: unknown, lt: bigint, _hash: Buffer) => {
      await yieldToMacrotasks()
      // Simulate pagination: return transactions starting from the given lt
      const startIndex = sortedTxs.findIndex((t) => t.tx.lt === lt)
      if (startIndex === -1) return []
      // Return from startIndex onwards
      return sortedTxs.slice(startIndex)
    },
  } as unknown as TonClient4
}
describe('fetchLogs', () => {
  describe('validation', () => {
    it('should throw when address is missing', async () => {
      const client = createMockClient([])
      const cache = new Map<number, number>()

      await assert.rejects(async () => {
        for await (const _log of fetchLogs(client, {}, cache, mockDecoders)) {
          // should not reach
        }
      }, /Address is required/)
    })

    it('should throw when watch is used without startBlock or startTime', async () => {
      const client = createMockClient([createMockTransaction(1000, 1700000000)])
      const cache = new Map<number, number>()

      await assert.rejects(async () => {
        for await (const _log of fetchLogs(
          client,
          { address: TEST_ADDRESS, watch: true },
          cache,
          mockDecoders,
        )) {
          break
        }
      }, /watch.*requires.*start/i)
    })

    it('should throw when watch is used with specific numeric endBlock', async () => {
      const client = createMockClient([createMockTransaction(1000, 1700000000)])
      const cache = new Map<number, number>()

      await assert.rejects(async () => {
        for await (const _log of fetchLogs(
          client,
          { address: TEST_ADDRESS, startBlock: 1, endBlock: 100, watch: true },
          cache,
          mockDecoders,
        )) {
          break
        }
      }, /finality/i)
    })

    it('should allow watch with finalized endBlock', { timeout: 5000 }, async () => {
      const client = createMockClient([createMockTransaction(1000, 1700000000)])
      const cache = new Map<number, number>()

      let cancel!: () => void
      const cancelPromise = new Promise<void>((resolve) => {
        cancel = resolve
      })

      // Cancel quickly
      setTimeout(() => cancel(), 50)

      const logs = []
      for await (const log of fetchLogs(
        client,
        {
          address: TEST_ADDRESS,
          startBlock: 1,
          endBlock: 'finalized',
          watch: cancelPromise,
          pollInterval: 10,
        },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      assert.ok(true, 'should complete without error')
    })
  })

  describe('pagination', () => {
    it('should respect page limit', async () => {
      const txs = [
        createMockTransaction(1000, 1700000000),
        createMockTransaction(2000, 1700001000),
        createMockTransaction(3000, 1700002000),
      ]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, page: 2 },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      assert.equal(logs.length, 2, 'should return only 2 logs')
    })
  })

  describe('ordering', () => {
    it('should return logs in descending order (newest first) for backward mode', async () => {
      const txs = [
        createMockTransaction(1000, 1700000000),
        createMockTransaction(2000, 1700001000),
        createMockTransaction(3000, 1700002000),
      ]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(client, { address: TEST_ADDRESS }, cache, mockDecoders)) {
        logs.push(log)
      }

      // Newest first (no startBlock/startTime = backward mode)
      assert.equal(logs[0].blockNumber, 3000)
      assert.equal(logs[1].blockNumber, 2000)
      assert.equal(logs[2].blockNumber, 1000)
    })

    it('should return logs in ascending order (oldest first) for forward mode', async () => {
      const txs = [
        createMockTransaction(1000, 1700000000),
        createMockTransaction(2000, 1700001000),
        createMockTransaction(3000, 1700002000),
      ]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, startBlock: 500 },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      // Oldest first (startBlock set = forward mode)
      assert.equal(logs[0].blockNumber, 1000)
      assert.equal(logs[1].blockNumber, 2000)
      assert.equal(logs[2].blockNumber, 3000)
    })
  })

  describe('stop conditions', () => {
    it('should stop at startBlock boundary', async () => {
      const txs = [
        createMockTransaction(1000, 1700000000),
        createMockTransaction(2000, 1700001000),
        createMockTransaction(3000, 1700002000),
      ]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, startBlock: 1500 },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      // Should only get logs with lt >= 1500
      assert.equal(logs.length, 2)
      assert.ok(logs.every((l) => l.blockNumber >= 1500))
    })

    it('should stop at startTime boundary', async () => {
      const txs = [
        createMockTransaction(1000, 1700000000),
        createMockTransaction(2000, 1700001000),
        createMockTransaction(3000, 1700002000),
      ]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, startTime: 1700001500 },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      // Should only get logs with timestamp >= 1700001500
      assert.equal(logs.length, 1)
      assert.equal(logs[0].blockNumber, 3000)
    })

    it('should filter by endBlock', async () => {
      const txs = [
        createMockTransaction(1000, 1700000000),
        createMockTransaction(2000, 1700001000),
        createMockTransaction(3000, 1700002000),
      ]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, endBlock: 2500 },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      // Should only get logs with lt <= 2500
      assert.equal(logs.length, 2)
      assert.ok(logs.every((l) => l.blockNumber <= 2500))
    })
  })

  describe('topic filtering', () => {
    it('should filter by CCIPMessageSent topic', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, topics: ['CCIPMessageSent'] },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      assert.equal(logs.length, 1)
      assert.deepEqual(logs[0].topics, ['CCIPMessageSent'])
    })

    it('should filter by CommitReportAccepted topic', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, topics: ['CommitReportAccepted'] },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      assert.equal(logs.length, 1)
      assert.deepEqual(logs[0].topics, ['CommitReportAccepted'])
    })

    it('should filter by ExecutionStateChanged topic', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, topics: ['ExecutionStateChanged'] },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      assert.equal(logs.length, 1)
      assert.deepEqual(logs[0].topics, ['ExecutionStateChanged'])
    })

    it('should return no logs when decoder rejects all', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, topics: ['CCIPMessageSent'] },
        cache,
        rejectingDecoders,
      )) {
        logs.push(log)
      }

      assert.equal(logs.length, 0)
    })
  })

  describe('caching', () => {
    it('should populate ltTimestampCache', async () => {
      const txs = [createMockTransaction(1000, 1700000000), createMockTransaction(2000, 1700001000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      for await (const _log of fetchLogs(client, { address: TEST_ADDRESS }, cache, mockDecoders)) {
        // consume all
      }

      assert.equal(cache.get(1000), 1700000000)
      assert.equal(cache.get(2000), 1700001000)
    })
  })

  describe('empty account', () => {
    it('should return empty when account has no transactions', async () => {
      const client = createMockClient([], { noAccount: true })
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(client, { address: TEST_ADDRESS }, cache, mockDecoders)) {
        logs.push(log)
      }

      assert.equal(logs.length, 0)
    })
  })

  describe('watch mode', () => {
    it('should cancel when promise resolves during iteration', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      let cancel: () => void
      const cancelPromise = new Promise<void>((resolve) => {
        cancel = resolve
      })

      // Cancel after a short delay
      setTimeout(() => cancel!(), 50)

      const logs = []
      const startTime = Date.now()

      for await (const log of fetchLogs(
        client,
        { address: TEST_ADDRESS, startBlock: 500, watch: cancelPromise, pollInterval: 10 },
        cache,
        mockDecoders,
      )) {
        logs.push(log)
      }

      const elapsed = Date.now() - startTime

      // Should exit quickly and not hang
      assert.ok(elapsed < 1000, `should exit quickly, took ${elapsed}ms`)
    })
  })

  describe('log structure', () => {
    it('should create correct composite hash format', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(client, { address: TEST_ADDRESS }, cache, mockDecoders)) {
        logs.push(log)
      }

      const [workchain, address, lt, hash] = logs[0].transactionHash.split(':')
      assert.equal(workchain, '0')
      assert.equal(address.length, 64)
      assert.equal(lt, '1000')
      assert.equal(hash.length, 64)
    })

    it('should set correct log properties', async () => {
      const txs = [createMockTransaction(1000, 1700000000)]
      const client = createMockClient(txs)
      const cache = new Map<number, number>()

      const logs = []
      for await (const log of fetchLogs(client, { address: TEST_ADDRESS }, cache, mockDecoders)) {
        logs.push(log)
      }

      assert.equal(logs[0].blockNumber, 1000)
      assert.equal(logs[0].index, 0)
      assert.ok(logs[0].address.includes(':'))
      assert.ok(logs[0].data) // base64 encoded
      assert.ok(Array.isArray(logs[0].topics))
    })
  })
})
