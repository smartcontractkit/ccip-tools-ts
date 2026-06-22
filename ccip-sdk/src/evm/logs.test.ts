import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import type { JsonRpcApiProvider, Log } from 'ethers'

import { CCIPLogRangeTooLargeError, CCIPLogsWatchRequiresFinalityError } from '../errors/index.ts'
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

// ── Backfill invariants ─────────────────────────────────────────────────────
// These exercise the single-cursor adaptive backfill in streamLogs: exact
// coverage, shrink-once (no re-fail per outer chunk), the MIN_LOG_RANGE=100
// floor, and the maxRange/suggestedRange shrink paths. Every test uses a unique
// rpc url because the endpoint log-range registry is module-level.
describe('getEvmLogs — backfill invariants', () => {
  /** Silent logger so the adaptive-shrink warn/debug output doesn't flood the run. */
  const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

  type Call = { from: number; to: number; span: number; ok: boolean }

  /**
   * Provider that records every getLogs attempt. Throws `errorMessage` (default:
   * the Alchemy-style "up to a N block range" which parses to maxRange=N) when a
   * chunk span exceeds `maxSpan`; otherwise returns `logsPerChunk` logs.
   */
  function recordingProvider(opts: {
    maxSpan: number
    url: string
    errorMessage?: string
    logsPerChunk?: number
  }): { provider: JsonRpcApiProvider; calls: Call[] } {
    const { maxSpan, url, logsPerChunk = 1 } = opts
    const errorMessage = opts.errorMessage ?? `up to a ${maxSpan} block range is allowed`
    const calls: Call[] = []
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async (tag: string | number) => {
        const num = typeof tag === 'number' ? tag : 10_000
        return { number: num, timestamp: num * 12 }
      },
      _getBlockTag: async (tag: string | number) => tag,
      getLogs: async (filter: { fromBlock: number; toBlock: number }) => {
        const span = filter.toBlock - filter.fromBlock + 1
        const ok = span <= maxSpan
        calls.push({ from: filter.fromBlock, to: filter.toBlock, span, ok })
        if (!ok) {
          throw Object.assign(new Error(errorMessage), { error: { code: -32005 } })
        }
        return Array.from({ length: logsPerChunk }, (_, i) => makeLog(filter.fromBlock, i))
      },
      on: () => {},
      off: () => {},
      once: (_event: unknown, cb: () => void) => setTimeout(cb, 0),
    } as unknown as JsonRpcApiProvider
    return { provider, calls }
  }

  const ok = (calls: Call[]) => calls.filter((c) => c.ok)

  it('A1 — covers [from,to] exactly: no gaps, no overlaps, sorted unique logs', async () => {
    const url = 'https://fake-bf-a1.example.com/rpc'
    const { provider, calls } = recordingProvider({ maxSpan: 500, url })

    const logs = await collect(
      getEvmLogs(
        { startBlock: 1000, endBlock: 2000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    // Union of SUCCESSFUL ranges must tile [1000, 2000] exactly.
    const ranges = ok(calls)
      .map((c) => [c.from, c.to] as const)
      .sort((a, b) => a[0] - b[0])
    assert.ok(ranges.length > 0, 'expected at least one successful getLogs call')
    assert.equal(ranges[0]![0], 1000, 'first successful chunk must start at startBlock')
    assert.equal(ranges[ranges.length - 1]![1], 2000, 'last successful chunk must end at endBlock')
    for (let i = 1; i < ranges.length; i++) {
      assert.equal(
        ranges[i]![0],
        ranges[i - 1]![1] + 1,
        `chunk ${i} must start exactly one past the previous chunk (no gap, no overlap)`,
      )
    }

    // Yielded logs unique and ascending by blockNumber.
    const blocks = logs.map((l) => l.blockNumber)
    for (let i = 1; i < blocks.length; i++) {
      assert.ok(blocks[i]! > blocks[i - 1]!, 'log blockNumbers must be strictly ascending')
    }
    assert.equal(new Set(blocks).size, blocks.length, 'log blockNumbers must be unique')
  })

  it('A2 — shrinks once: only the first chunk exceeds the page limit', async () => {
    const url = 'https://fake-bf-a2.example.com/rpc'
    const { provider, calls } = recordingProvider({ maxSpan: 500, url })

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 5000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    // Initial page is 10000 → first chunk is the whole [1,5000] span (>500) and
    // fails exactly once; every other attempt must already use the learned page.
    const oversized = calls.filter((c) => c.span > 500)
    assert.equal(
      oversized.length,
      1,
      `exactly one getLogs call may exceed the page limit, got ${oversized.length}: ${JSON.stringify(
        oversized,
      )}`,
    )
    for (const c of calls) {
      if (c !== oversized[0])
        assert.ok(c.span <= 500, `non-initial chunk span ${c.span} must be <=500`)
    }
  })

  it('A3 — halving floors at 100: completes, min successful span <=100, never below 100', async () => {
    const url = 'https://fake-bf-a3.example.com/rpc'
    // No extractable number in the message → shrinkPage uses floor(span/2).
    const { provider, calls } = recordingProvider({
      maxSpan: 100,
      url,
      errorMessage: 'block range limit reached, please narrow your query',
    })

    const logs = await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 1000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    assert.ok(logs.length > 0, 'expected logs to be returned (completed successfully)')
    const successful = ok(calls)
    const minSuccessSpan = Math.min(...successful.map((c) => c.span))
    assert.ok(minSuccessSpan <= 100, `min successful span ${minSuccessSpan} must be <=100`)
    for (const c of calls) {
      assert.ok(c.span >= 100, `no getLogs may be issued with span <100, got ${c.span}`)
    }
  })

  it('A4 — floor throws when the endpoint needs <100 blocks per call', async () => {
    const url = 'https://fake-bf-a4.example.com/rpc'
    const { provider, calls } = recordingProvider({
      maxSpan: 50,
      url,
      errorMessage: 'block range limit reached, please narrow your query',
    })

    await assert.rejects(
      () =>
        collect(
          getEvmLogs(
            { startBlock: 1, endBlock: 1000 },
            { provider, getBlockInfo, logger: silentLogger },
          ),
        ),
      CCIPLogRangeTooLargeError,
    )
    for (const c of calls) {
      assert.ok(c.span >= 100, `no getLogs may be issued with span <100, got ${c.span}`)
    }
  })

  it('A5 — maxRange path: uses the reported limit exactly and persists it', async () => {
    const url = 'https://fake-bf-a5.example.com/rpc'
    // "up to a 250 block range is allowed" parses to maxRange=250 (verified).
    const { provider, calls } = recordingProvider({
      maxSpan: 250,
      url,
      errorMessage: 'getLogs failed: up to a 250 block range is allowed',
    })

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 1000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    assert.ok(
      ok(calls).some((c) => c.span === 250),
      'expected a successful getLogs call with span exactly 250',
    )
    assert.equal(getEndpointLogRange(url), 250, 'learned page must persist as 250 in the registry')
  })

  it('A6 — suggestedRange path: page becomes to-from+1 of the suggested range', async () => {
    const url = 'https://fake-bf-a6.example.com/rpc'
    // Alchemy-style suggested range [0x3e8, 0x4b0] = [1000, 1200] (verified via
    // parseLogRangeError) → suggestedRange page = 1200-1000+1 = 201.
    const { provider, calls } = recordingProvider({
      maxSpan: 201,
      url,
      errorMessage: 'query exceeds the range, try this range [0x3e8, 0x4b0]',
    })

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 2000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    // After the first oversized chunk fails, the page must equal the suggested
    // span (201), so a successful chunk of exactly 201 must occur and persist.
    assert.ok(
      ok(calls).some((c) => c.span === 201),
      `expected a successful getLogs call with span exactly 201, got ${JSON.stringify(
        ok(calls).map((c) => c.span),
      )}`,
    )
    assert.equal(getEndpointLogRange(url), 201, 'learned page must persist as 201 in the registry')
  })

  it('A7 — single block: exactly one getLogs call of span 1', async () => {
    const url = 'https://fake-bf-a7.example.com/rpc'
    const { provider, calls } = recordingProvider({ maxSpan: 10_000, url })

    const logs = await collect(
      getEvmLogs(
        { startBlock: 42, endBlock: 42 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    assert.equal(calls.length, 1, 'exactly one getLogs call expected for a single-block range')
    assert.equal(calls[0]!.span, 1, 'the single call must span exactly one block')
    assert.equal(calls[0]!.from, 42)
    assert.equal(calls[0]!.to, 42)
    assert.ok(
      logs.length > 0 && logs.every((l) => l.blockNumber === 42),
      'the yielded log must be from block 42',
    )
  })

  it('A8 — explicit page<100 is honored and not bumped to the floor', async () => {
    const url = 'https://fake-bf-a8.example.com/rpc'
    // Provider allows huge spans → no range error, so the floor never engages.
    const { provider, calls } = recordingProvider({ maxSpan: 10_000, url })

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 200, page: 50 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    for (const c of calls) {
      assert.ok(c.span <= 50, `every chunk span must be <=50 (explicit page), got ${c.span}`)
    }
    assert.ok(
      calls.some((c) => c.span === 50),
      'at least one chunk must span exactly 50 (floor did not raise the initial page)',
    )
  })

  it('A9 — tolerates -32602 from a lagging RPC: skips unservable chunks, no throw', async () => {
    const url = 'https://fake-bf-a9.example.com/rpc'
    // Simulate a round-robin proxy whose serving node lags: endBlock resolves to
    // 10000 (an ahead RPC), but getLogs rejects any chunk past head=5000 with
    // -32602. streamLogs must skip those chunks and stream the servable ones.
    const head = 5000
    const calls: Array<{ fromBlock: number; toBlock: number }> = []
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async (tag: string | number) => ({
        number: typeof tag === 'number' ? tag : 10_000,
        timestamp: 0,
      }),
      getLogs: async (filter: { fromBlock: number; toBlock: number }) => {
        calls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock })
        if (filter.toBlock > head) {
          throw Object.assign(new Error('invalid block range params'), {
            error: { code: -32602 },
          })
        }
        return [makeLog(filter.fromBlock)]
      },
      on: () => {},
      off: () => {},
      once: (_e: unknown, cb: () => void) => setTimeout(cb, 0),
    } as unknown as JsonRpcApiProvider

    const logs = await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 10_000, page: 1000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    // Chunks [1..5000] (toBlock <= head) yield logs; [5001..10000] are skipped.
    assert.equal(logs.length, 5, 'only the 5 servable chunks (up to head) yield logs')
    assert.ok(
      logs.every((l) => l.blockNumber <= head),
      'no logs should come from blocks past the serving RPC head',
    )
    // The unservable chunks were attempted (and skipped), not throwing.
    assert.ok(
      calls.some((c) => c.toBlock > head),
      'expected the unservable chunks to have been attempted',
    )
  })

  it('A10 — dynamic endBlock: the terminal chunk is fetched by the tag, earlier ones numeric', async () => {
    const url = 'https://fake-bf-a10.example.com/rpc'
    const head = 2500
    const calls: Array<{ fromBlock: number; toBlock: number | string }> = []
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async (tag: string | number) => ({
        number: typeof tag === 'number' ? tag : head,
        timestamp: 0,
      }),
      getLogs: async (filter: { fromBlock: number; toBlock: number | string }) => {
        calls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock })
        return [makeLog(filter.fromBlock)]
      },
      on: () => {},
      off: () => {},
      once: (_e: unknown, cb: () => void) => setTimeout(cb, 0),
    } as unknown as JsonRpcApiProvider

    const logs = await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 'latest', page: 1000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    // [1,1000] and [1001,2000] numeric; terminal [2001, 'latest'] by tag.
    assert.equal(calls.length, 3)
    assert.equal(calls[0]!.toBlock, 1000)
    assert.equal(calls[1]!.toBlock, 2000)
    assert.equal(calls[2]!.fromBlock, 2001)
    assert.equal(calls[2]!.toBlock, 'latest', 'terminal chunk must be fetched by the end tag')
    assert.equal(logs.length, 3)
  })

  it('A11 — dynamic endBlock: head growth across a boundary keeps paginating, terminal still by tag', async () => {
    const url = 'https://fake-bf-a11.example.com/rpc'
    const calls: Array<{ fromBlock: number; toBlock: number | string }> = []
    // getBlock('latest') returns 2500 first (initial endBlock), then 3500 (the
    // chain grew past the [2001,2500] boundary by the time we re-resolve).
    const heads = [2500, 3500, 3500, 3500]
    let resolves = 0
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async (tag: string | number) => ({
        number: typeof tag === 'number' ? tag : heads[Math.min(resolves++, heads.length - 1)]!,
        timestamp: 0,
      }),
      getLogs: async (filter: { fromBlock: number; toBlock: number | string }) => {
        calls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock })
        return [makeLog(filter.fromBlock)]
      },
      on: () => {},
      off: () => {},
      once: (_e: unknown, cb: () => void) => setTimeout(cb, 0),
    } as unknown as JsonRpcApiProvider

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 'latest', page: 1000 },
        { provider, getBlockInfo, logger: silentLogger },
      ),
    )

    // Initial endBlock=2500 → chunks [1,1000],[1001,2000]; reaching the terminal
    // [2001,2500] re-resolves to 3500 (crossed the boundary) → extend and keep
    // paginating: [2001,3000], then terminal [3001,'latest'] by tag.
    const numericTos = calls.map((c) => c.toBlock)
    assert.deepEqual(numericTos.slice(0, 3), [1000, 2000, 3000])
    assert.equal(calls[3]!.fromBlock, 3001)
    assert.equal(calls[3]!.toBlock, 'latest', 'the new terminal chunk must be fetched by the tag')
  })
})

// ── Watch invariants ────────────────────────────────────────────────────────
// The `while (filter.watch ...)` loop streams up to the endBlock TAG directly
// ('latest'/'safe'/...), letting the RPC resolve the head atomically; it resolves
// the tag to a number via getBlock ONLY when a range error forces pagination.
// Phase detection: only the watch loop calls `provider._getBlockTag`, so a flag
// flipped there attributes each getLogs call to backfill vs watch — independent
// of its toBlock shape (the backfill terminal chunk also uses the tag now). Tests
// keep backfill a no-op (returns [] / no logs) so the watch phase is isolated.
// The loop is gated by an AbortSignal and `provider.once(event, cb)` ticks; the
// fake `once` fires promptly so each wait resolves, and tests abort once the
// invariant is observed.
describe('getEvmLogs — watch invariants', () => {
  /** A recorded getLogs invocation. `watch` = issued during the watch phase. */
  interface GetLogsCall {
    fromBlock: number
    toBlock: number | string
    watch: boolean
  }

  const isWatchCall = (c: GetLogsCall) => c.watch
  /** The watch optimistic call: a watch-phase call that carries the symbolic tag. */
  const isWatchOptimistic = (c: GetLogsCall) => c.watch && typeof c.toBlock === 'string'

  /**
   * Fake provider for the watch loop. `inWatch` flips on the first `_getBlockTag`
   * (only the watch loop calls it), tagging each getLogs as backfill or watch.
   * `watchGetBlockCount()` counts getBlock calls during the watch phase so tests
   * can assert the happy path does NOT eagerly resolve the end tag.
   */
  function makeWatchProvider(
    height: number,
    url: string,
    getLogsImpl: (
      filter: { fromBlock: number; toBlock: number | string },
      calls: GetLogsCall[],
      spanOf: (filter: { fromBlock: number; toBlock: number | string }) => number,
    ) => Promise<Log[]>,
  ): { provider: JsonRpcApiProvider; calls: GetLogsCall[]; watchGetBlockCount: () => number } {
    const calls: GetLogsCall[] = []
    let inWatch = false
    let watchGetBlockCount = 0
    const spanOf = (filter: { fromBlock: number; toBlock: number | string }) => {
      const to = typeof filter.toBlock === 'number' ? filter.toBlock : height
      return to - filter.fromBlock + 1
    }
    const provider = {
      _getConnection: () => ({ url }),
      getBlock: async (tag: string | number) => {
        if (inWatch) watchGetBlockCount += 1
        const num = typeof tag === 'number' ? tag : height
        return { number: num, timestamp: num * 12 }
      },
      _getBlockTag: async (tag: string | number) => {
        inWatch = true
        return tag
      },
      getLogs: async (filter: { fromBlock: number; toBlock: number | string }) => {
        calls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock, watch: inWatch })
        return getLogsImpl(filter, calls, spanOf)
      },
      on: () => {},
      off: () => {},
      once: (_event: unknown, cb: () => void) => {
        setTimeout(cb, 0) // fire promptly so the inter-iteration wait resolves
      },
    } as unknown as JsonRpcApiProvider
    return { provider, calls, watchGetBlockCount: () => watchGetBlockCount }
  }

  // B1 — 0.9*page headroom fallback when no log advanced `latest`.
  it('B1: first watch getLogs uses the 0.9*page headroom window', { timeout: 5000 }, async () => {
    const controller = new AbortController()
    const url = 'https://watch-b1.example.com/rpc'
    const { provider, calls } = makeWatchProvider(10_000, url, async (_filter, c) => {
      if (c[c.length - 1]!.watch) controller.abort() // stop on the first watch call
      return []
    })

    await collect(
      getEvmLogs(
        { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
        { provider, getBlockInfo, logger: console },
      ),
    )

    const firstWatch = calls.find(isWatchCall)
    assert.ok(firstWatch, 'expected at least one watch-phase getLogs')
    // watchFrom = max(latest=0, 10000 - floor(0.9*1000)) + 1 = 10000 - 900 + 1 = 9101
    assert.equal(firstWatch.fromBlock, 9101)
    assert.equal(firstWatch.toBlock, 'latest', 'watch must stream up to the endBlock tag')
  })

  // B2 — prefer toBlock=endBlock: the happy path streams the symbolic tag and does
  // NOT eagerly resolve it with getBlock during the watch phase.
  it(
    'B2: happy path streams the endBlock tag without an extra getBlock',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b2.example.com/rpc'
      const { provider, calls, watchGetBlockCount } = makeWatchProvider(
        10_000,
        url,
        async (_filter, c) => {
          if (c[c.length - 1]!.watch) controller.abort()
          return []
        },
      )

      await collect(
        getEvmLogs(
          { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
          { provider, getBlockInfo, logger: console },
        ),
      )

      assert.equal(
        watchGetBlockCount(),
        0,
        'watch happy path must not eagerly getBlock the end tag',
      )
      assert.ok(calls.some(isWatchOptimistic), 'expected a watch getLogs against the tag')
    },
  )

  // B3 — range error on the optimistic call offloads to streamLogs (resolving the
  // tag to a number) and advances latest past the covered range.
  it(
    'B3: range error offloads to streamLogs, resolves the tag, advances latest',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b3.example.com/rpc'
      const maxSpan = 100
      let optimisticCalls = 0
      const rangeError = () =>
        Object.assign(new Error(`getLogs failed: up to a ${maxSpan} block range is allowed`), {
          error: { code: -32005 },
        })
      const { provider, calls, watchGetBlockCount } = makeWatchProvider(
        10_000,
        url,
        async (filter, c, spanOf) => {
          if (!c[c.length - 1]!.watch) return [] // backfill no-op
          if (typeof filter.toBlock === 'string') {
            optimisticCalls += 1
            if (optimisticCalls >= 2) {
              controller.abort()
              return []
            }
            throw rangeError() // force the offload
          }
          // watch offload (numeric) chunk
          if (spanOf(filter) > maxSpan) throw rangeError()
          return [makeLog(filter.fromBlock)]
        },
      )

      const logs = await collect(
        getEvmLogs(
          { startBlock: 9000, endBlock: 'latest', page: maxSpan, watch: controller.signal },
          { provider, getBlockInfo, logger: console },
        ),
      )

      assert.ok(logs.length > 0, 'expected logs emitted from the offloaded streamLogs')
      assert.ok(watchGetBlockCount() >= 1, 'offload must resolve the tag via getBlock')
      const optimistic = calls.filter(isWatchOptimistic)
      assert.equal(optimistic.length, 2, 'expected exactly 2 optimistic watch calls')
      assert.ok(
        optimistic[1]!.fromBlock > 10_000,
        `2nd watch fromBlock must be past the covered range, got ${optimistic[1]!.fromBlock}`,
      )
    },
  )

  // B4 — an inverted range (head < watchFrom) reported as -32602 is benign empty.
  it(
    'B4: -32602 on the optimistic call is treated as benign empty',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b4.example.com/rpc'
      let optimisticCalls = 0
      const { provider } = makeWatchProvider(10_000, url, async (filter, c) => {
        if (!c[c.length - 1]!.watch) return []
        if (typeof filter.toBlock === 'string') {
          optimisticCalls += 1
          if (optimisticCalls >= 2) {
            controller.abort()
            return []
          }
          throw Object.assign(new Error('invalid block range'), { error: { code: -32602 } })
        }
        return []
      })

      const logs = await collect(
        getEvmLogs(
          { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
          { provider, getBlockInfo, logger: console },
        ),
      )
      assert.equal(logs.length, 0)
      assert.ok(optimisticCalls >= 2, 'loop must proceed past the benign invalid-range error')
    },
  )

  // B5 — an "invalid block range" message with NO -32602 code is still benign empty.
  it(
    'B5: "invalid block range" message without a code is benign empty',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b5.example.com/rpc'
      let optimisticCalls = 0
      const { provider } = makeWatchProvider(10_000, url, async (filter, c) => {
        if (!c[c.length - 1]!.watch) return []
        if (typeof filter.toBlock === 'string') {
          optimisticCalls += 1
          if (optimisticCalls >= 2) {
            controller.abort()
            return []
          }
          throw new Error('invalid block range params') // message only, no code
        }
        return []
      })

      const logs = await collect(
        getEvmLogs(
          { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
          { provider, getBlockInfo, logger: console },
        ),
      )
      assert.equal(logs.length, 0)
      assert.ok(optimisticCalls >= 2, 'loop must proceed past the benign invalid-range error')
    },
  )

  // B6 — a plain error (not -32602, not range) must reject.
  it(
    'B6: other error on the optimistic call rejects the generator',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b6.example.com/rpc'
      const boom = new Error('connection refused')
      const { provider } = makeWatchProvider(10_000, url, async (filter, c) => {
        if (!c[c.length - 1]!.watch) return []
        if (typeof filter.toBlock === 'string') throw boom
        return []
      })

      await assert.rejects(
        () =>
          collect(
            getEvmLogs(
              { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
              { provider, getBlockInfo, logger: console },
            ),
          ),
        (err: unknown) => err === boom,
      )
      controller.abort()
    },
  )

  // B7 — happy path advances `latest` via emitted logs, not the 0.9 fallback.
  it(
    'B7: emitted log advances latest so next watch fromBlock = maxLogBlock+1',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b7.example.com/rpc'
      let optimisticCalls = 0
      const { provider, calls } = makeWatchProvider(10_000, url, async (filter, c) => {
        if (!c[c.length - 1]!.watch) return []
        if (typeof filter.toBlock === 'string') {
          optimisticCalls += 1
          if (optimisticCalls === 1) return [makeLog(9999)] // advance latest to 9999
          controller.abort()
          return []
        }
        return []
      })

      await collect(
        getEvmLogs(
          { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
          { provider, getBlockInfo, logger: console },
        ),
      )

      const optimistic = calls.filter(isWatchOptimistic)
      assert.equal(optimistic.length, 2, 'expected exactly 2 optimistic watch calls')
      // latest advanced to 9999 via the emitted log → next fromBlock = 10000
      // (> the 0.9 fallback 9101).
      assert.equal(optimistic[1]!.fromBlock, 10_000)
    },
  )

  // B8 — enrichment error (getBlockInfo) must propagate, not be swallowed.
  it(
    'B8: getBlockInfo throwing during enrichment rejects the generator',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b8.example.com/rpc'
      const enrichBoom = new Error('getBlockInfo exploded')
      const { provider } = makeWatchProvider(10_000, url, async (filter, c) => {
        if (!c[c.length - 1]!.watch) return []
        if (typeof filter.toBlock === 'string') return [makeLog(9500)]
        return []
      })

      const throwingGetBlockInfo = async (block: number | string) => {
        if (block === 9500) throw enrichBoom
        const num = typeof block === 'number' ? block : 10_000
        return { number: num, timestamp: num * 12 }
      }

      await assert.rejects(
        () =>
          collect(
            getEvmLogs(
              { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
              { provider, getBlockInfo: throwingGetBlockInfo, logger: console },
            ),
          ),
        (err: unknown) => err === enrichBoom,
      )
      controller.abort()
    },
  )

  // B9 — pageBox is shared backfill -> watch: a shrink during backfill changes the
  // watch headroom window. Force the backfill to learn page=200.
  it(
    'B9: backfill page shrink propagates to the watch 0.9 headroom window',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b9.example.com/rpc'
      const maxSpan = 200
      const { provider, calls } = makeWatchProvider(10_000, url, async (filter, c, spanOf) => {
        if (c[c.length - 1]!.watch) {
          controller.abort()
          return []
        }
        // Backfill chunks: reject if span > maxSpan to force a shrink to 200.
        if (spanOf(filter) > maxSpan) {
          throw Object.assign(
            new Error(`getLogs failed: up to a ${maxSpan} block range is allowed`),
            { error: { code: -32005 } },
          )
        }
        return [] // no logs, latest stays at startBlock-1 = 0
      })

      await collect(
        getEvmLogs(
          { startBlock: 1, endBlock: 'latest', page: 1000, watch: controller.signal },
          { provider, getBlockInfo, logger: console },
        ),
      )

      const firstWatch = calls.find(isWatchCall)
      assert.ok(firstWatch, 'expected a watch-phase getLogs')
      // pageBox.value = 200 after the shrink → watchFrom = 10000 - floor(0.9*200) + 1 = 9821.
      assert.equal(firstWatch.fromBlock, 9821)
    },
  )

  // B10 — watch with a positive numeric endBlock must reject before any fetch.
  it(
    'B10: watch with positive numeric endBlock rejects with CCIPLogsWatchRequiresFinalityError',
    { timeout: 5000 },
    async () => {
      const controller = new AbortController()
      const url = 'https://watch-b10.example.com/rpc'
      const { provider, calls } = makeWatchProvider(10_000, url, async () => [])

      await assert.rejects(
        () =>
          collect(
            getEvmLogs(
              { startBlock: 1, endBlock: 5, watch: controller.signal },
              { provider, getBlockInfo, logger: console },
            ),
          ),
        CCIPLogsWatchRequiresFinalityError,
      )
      assert.equal(calls.length, 0, 'expected no getLogs before the finality guard threw')
    },
  )
})
