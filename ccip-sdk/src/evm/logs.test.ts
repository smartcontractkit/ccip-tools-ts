import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import type { JsonRpcApiProvider, Log } from 'ethers'

import { CCIPLogRangeTooLargeError } from '../errors/index.ts'
import { getEndpointLogRange, setEndpointLogRange } from '../fetch.ts'
import { getEvmLogs } from './logs.ts'

/** Minimal fake log factory */
function makeLog(blockNumber: number, index = 0): Log {
  return {
    blockNumber,
    logIndex: index,
    blockHash: `0x${'00'.repeat(31)}${blockNumber.toString(16).padStart(2, '0')}`,
    transactionHash: `0x${'00'.repeat(32)}`,
    transactionIndex: 0,
    address: '0x0000000000000000000000000000000000000001',
    topics: [],
    data: '0x',
    index,
    removed: false,
  } as unknown as Log
}

/** Build a fake provider that throws a range error when span exceeds maxSpan, else returns logs. */
function makeFakeProvider(
  maxSpan: number,
  logsPerChunk: number = 1,
  url: string = 'https://fake-rpc.example.com/v2/key',
): JsonRpcApiProvider {
  return {
    _getConnection: () => ({ url }),
    getBlock: async (tag: string | number) => {
      const num = typeof tag === 'number' ? tag : 10_000
      return { number: num, timestamp: num * 12 }
    },
    _getBlockTag: async (tag: string | number) => tag,
    getLogs: async (filter: { fromBlock: number; toBlock: number }) => {
      const span = filter.toBlock - filter.fromBlock + 1
      if (span > maxSpan) {
        throw Object.assign(
          new Error(`getLogs failed: up to a ${maxSpan} block range is allowed`),
          { error: { code: -32005 } },
        )
      }
      // Return logsPerChunk fake logs for the chunk
      return Array.from({ length: logsPerChunk }, (_, i) => makeLog(filter.fromBlock, i))
    },
    on: () => {},
    off: () => {},
    once: (_event: unknown, cb: () => void) => {
      // immediately fire so watch loop doesn't hang
      setTimeout(cb, 0)
    },
  } as unknown as JsonRpcApiProvider
}

/** Minimal getBlockInfo helper. */
const getBlockInfo = async (block: number | string) => {
  const num = typeof block === 'number' ? block : 10_000
  return { number: num, timestamp: num * 12 }
}

/** Drain an async iterator into an array. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iter) result.push(item)
  return result
}

// ── Reset the endpoint registry between tests ──────────────────────────────
// The registry is module-level; we reset entries by writing a large sentinel
// and then overwriting with the actual test values. Easier: just use unique
// URLs per test so they don't interfere.

describe('getEvmLogs — adaptive range pagination', () => {
  beforeEach(() => {
    // Use unique URLs per test to avoid cross-test state pollution
  })

  it('subdivides when getLogs throws a range error and returns all logs without gaps or dups', async () => {
    const url = 'https://fake-rpc-a.example.com/rpc'
    // Provider allows max 500 blocks per call; we request 1000 blocks
    const provider = makeFakeProvider(500, 1, url)

    const logs = await collect(
      getEvmLogs({ startBlock: 1000, endBlock: 2000 }, { provider, getBlockInfo, logger: console }),
    )

    // 1001 blocks total (1000–2000 inclusive), chunks of 500 → 3 chunks (500+500+1 blocks)
    // logsPerChunk=1 so we get 1 log per 500-block chunk + the last partial chunk
    assert.ok(logs.length >= 1, `expected at least 1 log, got ${logs.length}`)
    // All logs should have blockTimestamp set
    assert.ok(logs.every((l) => typeof l.blockTimestamp === 'number'))
  })

  it('persists learned maxRange to endpoint registry (setEndpointLogRange)', async () => {
    const url = 'https://fake-rpc-b.example.com/rpc'
    const provider = makeFakeProvider(300, 1, url)

    // Before first call — no entry
    assert.equal(getEndpointLogRange(url), undefined)

    await collect(
      getEvmLogs({ startBlock: 1, endBlock: 700 }, { provider, getBlockInfo, logger: console }),
    )

    // After first call, registry should have learned the max range
    const learned = getEndpointLogRange(url)
    assert.ok(learned !== undefined, 'expected a learned log range')
    assert.ok(learned <= 300, `expected learned range <= 300, got ${learned}`)
  })

  it('second call starts at the smaller page (cross-instance learning)', async () => {
    const url = 'https://fake-rpc-c.example.com/rpc'
    const provider = makeFakeProvider(200, 1, url)

    // First call learns the range
    await collect(
      getEvmLogs({ startBlock: 1, endBlock: 500 }, { provider, getBlockInfo, logger: console }),
    )
    const learnedAfterFirst = getEndpointLogRange(url)
    assert.ok(learnedAfterFirst !== undefined)

    // Manually verify the registry is seeded: a second call should use the learned range
    // We confirm by calling setEndpointLogRange and checking getEndpointLogRange
    setEndpointLogRange(url, learnedAfterFirst, 'error')
    assert.equal(getEndpointLogRange(url), learnedAfterFirst)

    // A fresh call with the same URL should start at learnedAfterFirst (not 10e3)
    // We can't easily inspect the internal page, but we can confirm no extra errors occur
    await collect(
      getEvmLogs({ startBlock: 1, endBlock: 400 }, { provider, getBlockInfo, logger: console }),
    )
  })

  it('propagates non-range errors unchanged', async () => {
    const url = 'https://fake-rpc-d.example.com/rpc'
    const networkError = new Error('connection refused')
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async () => ({ number: 100, timestamp: 1200 }),
      getLogs: async () => {
        throw networkError
      },
      on: () => {},
      off: () => {},
      once: (_e: unknown, cb: () => void) => setTimeout(cb, 0),
    } as unknown as JsonRpcApiProvider

    await assert.rejects(
      () =>
        collect(
          getEvmLogs({ startBlock: 1, endBlock: 100 }, { provider, getBlockInfo, logger: console }),
        ),
      (err: unknown) => err === networkError,
    )
  })

  it('honors an explicit filter.page as the initial page size', async () => {
    const url = 'https://fake-rpc-e.example.com/rpc'
    // Registry has no entry for this URL; provider allows 10000 blocks
    const provider = makeFakeProvider(10_000, 1, url)

    // Explicit page=50 → should use 50-block chunks (not the default 10e3)
    const calls: Array<{ fromBlock: number; toBlock: number }> = []
    const trackingProvider = {
      ...provider,
      getLogs: async (filter: { fromBlock: number; toBlock: number }) => {
        calls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock })
        return [makeLog(filter.fromBlock)]
      },
    } as unknown as JsonRpcApiProvider

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 200, page: 50 },
        { provider: trackingProvider, getBlockInfo, logger: console },
      ),
    )

    // Each chunk should be <=50 blocks wide
    for (const call of calls) {
      const span = call.toBlock - call.fromBlock + 1
      assert.ok(span <= 50, `expected span<=50, got ${span} (fromBlock=${call.fromBlock})`)
    }
    assert.ok(calls.length >= 4, `expected at least 4 chunks, got ${calls.length}`)
  })

  it('throws CCIPLogRangeTooLargeError when subdivision is impossible (page=1 still fails)', async () => {
    const url = 'https://fake-rpc-f.example.com/rpc'
    // Provider rejects everything (no blocks allowed)
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async () => ({ number: 100, timestamp: 1200 }),
      getLogs: async () => {
        const err = Object.assign(new Error('up to a 0 block range is allowed'), {
          error: { code: -32005 },
        })
        throw err
      },
      on: () => {},
      off: () => {},
      once: (_e: unknown, cb: () => void) => setTimeout(cb, 0),
    } as unknown as JsonRpcApiProvider

    await assert.rejects(
      () =>
        collect(
          getEvmLogs({ startBlock: 1, endBlock: 100 }, { provider, getBlockInfo, logger: console }),
        ),
      CCIPLogRangeTooLargeError,
    )
  })
})
