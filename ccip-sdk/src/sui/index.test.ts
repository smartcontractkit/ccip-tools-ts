/**
 * Tests for multi-topic support in SuiChain.getLogs (and, transitively,
 * streamSuiLogs). A minimal fake SuiJsonRpcClient is built directly (mirroring
 * the plain-object provider mocks already used in ../aptos/index.test.ts),
 * implementing only the methods `fetchEventsForward` and the SuiChain
 * constructor actually touch: `queryEvents`, `multiGetTransactionBlocks`,
 * `getLatestCheckpointSequenceNumber`, and a `getTransactionBlock` stub (the
 * constructor wraps it in a memoizer, so it must at least exist).
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

import { type ChainFamily, type NetworkInfo, networkInfo } from '../networks.ts'
import { SuiChain } from './index.ts'

const ADDRESS = '0xpkg::module'

type TxMeta = { checkpoint: number; timestampMs: string }

/** Fake SuiEvent, minimal fields actually read by events.ts's toEventNode/resolveTxMetas. */
function fakeEvent(type: string, txDigest: string, data: unknown, timestampMs: string) {
  return {
    id: { txDigest, eventSeq: '0' },
    packageId: ADDRESS.split('::')[0],
    parsedJson: data,
    sender: '0xsender',
    timestampMs,
    transactionModule: 'module',
    type,
  }
}

function makeFakeClient(txMetaByDigest: Record<string, TxMeta>): SuiJsonRpcClient {
  const queryEvents = mock.fn(async ({ query }: { query: { MoveEventType: string } }) => {
    if (query.MoveEventType === `${ADDRESS}::EventA`) {
      return {
        // descending: cp12 before cp10 (mirrors real queryEvents ordering)
        data: [
          fakeEvent(`${ADDRESS}::EventA`, 'DIGEST_A1', { i: 'A1' }, '12000'),
          fakeEvent(`${ADDRESS}::EventA`, 'DIGEST_A0', { i: 'A0' }, '10000'),
        ],
        hasNextPage: false,
        nextCursor: null,
      }
    }
    if (query.MoveEventType === `${ADDRESS}::EventB`) {
      return {
        data: [
          fakeEvent(`${ADDRESS}::EventB`, 'DIGEST_B1', { i: 'B1' }, '13000'),
          fakeEvent(`${ADDRESS}::EventB`, 'DIGEST_B0', { i: 'B0' }, '11000'),
        ],
        hasNextPage: false,
        nextCursor: null,
      }
    }
    throw new Error(`unmocked MoveEventType: ${query.MoveEventType}`)
  })

  const multiGetTransactionBlocks = mock.fn(async ({ digests }: { digests: string[] }) =>
    digests.map((digest) => ({
      digest,
      checkpoint: String(txMetaByDigest[digest]!.checkpoint),
      timestampMs: txMetaByDigest[digest]!.timestampMs,
    })),
  )

  const getLatestCheckpointSequenceNumber = mock.fn(async () => '1000')

  return {
    queryEvents,
    multiGetTransactionBlocks,
    getLatestCheckpointSequenceNumber,
    getTransactionBlock: mock.fn(async () => ({})),
  } as unknown as SuiJsonRpcClient
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of gen) out.push(v)
  return out
}

type RawEvent = ReturnType<typeof fakeEvent>

/**
 * Fake SuiJsonRpcClient with PROPER descending-cursor pagination per Move
 * type (unlike `makeFakeClient` above, which always returns everything in a
 * single page) — needed to prove that Sui's checkpoint-window design stays
 * globally ascending across MANY rounds/pages, the way `logs.test.ts`'s
 * Aptos regression test proves the ceiling fix does for handles' independent
 * sequence-number windows.
 *
 * `eventsAscendingByType` gives each type's events in ascending checkpoint
 * order; this fakes them back out in the descending order `queryEvents`
 * actually returns, paginated by `limit`, using the array index (encoded in
 * a throwaway EventId) as the cursor.
 */
function makeFakeClientForPagination(
  eventsAscendingByType: Record<string, RawEvent[]>,
  checkpointByDigest: Record<string, number>,
): SuiJsonRpcClient {
  const descendingByType = Object.fromEntries(
    Object.entries(eventsAscendingByType).map(([type, events]) => [type, [...events].reverse()]),
  )

  const queryEvents = mock.fn(
    async ({
      query,
      cursor,
      limit,
    }: {
      query: { MoveEventType: string }
      cursor?: { eventSeq: string } | null
      limit: number
    }) => {
      const descending = descendingByType[query.MoveEventType]
      if (!descending) throw new Error(`unmocked MoveEventType: ${query.MoveEventType}`)
      const startIdx = cursor ? Number(cursor.eventSeq) + 1 : 0
      const page = descending.slice(startIdx, startIdx + limit)
      return {
        data: page,
        hasNextPage: startIdx + limit < descending.length,
        nextCursor: page.length
          ? { txDigest: 'cursor', eventSeq: String(startIdx + page.length - 1) }
          : null,
      }
    },
  )

  const multiGetTransactionBlocks = mock.fn(async ({ digests }: { digests: string[] }) =>
    digests.map((digest) => ({
      digest,
      checkpoint: String(checkpointByDigest[digest]!),
      timestampMs: '0',
    })),
  )

  return {
    queryEvents,
    multiGetTransactionBlocks,
    getLatestCheckpointSequenceNumber: mock.fn(async () => '100000'),
    getTransactionBlock: mock.fn(async () => ({})),
  } as unknown as SuiJsonRpcClient
}

void describe('SuiChain.getLogs multi-topic', () => {
  void it('merges multiple event types into one globally ascending stream, each event keeping its own topic', async () => {
    const client = makeFakeClient({
      DIGEST_A0: { checkpoint: 10, timestampMs: '10000' },
      DIGEST_A1: { checkpoint: 12, timestampMs: '12000' },
      DIGEST_B0: { checkpoint: 11, timestampMs: '11000' },
      DIGEST_B1: { checkpoint: 13, timestampMs: '13000' },
    })
    const chain = new SuiChain(client, networkInfo('sui:2') as NetworkInfo<typeof ChainFamily.Sui>)

    const logs = await collect(
      chain.getLogs({ address: ADDRESS, topics: ['EventA', 'EventB'], startBlock: 0 }),
    )

    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [10, 11, 12, 13],
      'events from both types must merge into one globally ascending stream by checkpoint',
    )
    assert.deepEqual(
      logs.map((l) => l.topics[0]),
      ['EventA', 'EventB', 'EventA', 'EventB'],
      'each emitted log must carry its OWN event name, not the caller-provided filter list',
    )
    assert.deepEqual(
      logs.map((l) => (l.data as { i: string }).i),
      ['A0', 'B0', 'A1', 'B1'],
    )
  })

  void it('still accepts a single-element topics array (existing single-topic callers unchanged)', async () => {
    const client = makeFakeClient({
      DIGEST_A0: { checkpoint: 10, timestampMs: '10000' },
      DIGEST_A1: { checkpoint: 12, timestampMs: '12000' },
    })
    const chain = new SuiChain(client, networkInfo('sui:2') as NetworkInfo<typeof ChainFamily.Sui>)

    const logs = await collect(
      chain.getLogs({ address: ADDRESS, topics: ['EventA'], startBlock: 0 }),
    )

    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [10, 12],
    )
    assert.deepEqual(
      logs.map((l) => l.topics[0]),
      ['EventA', 'EventA'],
    )
  })

  void it('rejects an empty topics array', async () => {
    const client = makeFakeClient({})
    const chain = new SuiChain(client, networkInfo('sui:2') as NetworkInfo<typeof ChainFamily.Sui>)

    await assert.rejects(
      () => collect(chain.getLogs({ address: ADDRESS, topics: [], startBlock: 0 })),
      { name: 'CCIPTopicsInvalidError' },
    )
  })

  void it('keeps the FULL cross-round output ascending with a sparse (far-future) type and a dense, multi-page type — no ceiling needed', async () => {
    // Companion to the Aptos regression test in ../aptos/logs.test.ts, but
    // here to demonstrate Sui does NOT need the same fix: every type's
    // per-round pagination is bounded by the SAME shared `batchEndCheckpoint`
    // (see events.ts's fetchEventsForward), and each type fully drains that
    // shared checkpoint window — via as many `queryEvents` pages as it takes
    // — before the round is sorted and yielded. So a sparse type's far-future
    // event can never "jump ahead" of a dense type's still-unfetched, lower
    // checkpoints the way an Aptos handle's independent, item-count-bounded
    // batch window could.
    const DENSE_COUNT = 250 // several queryEvents pages at the default limit=50
    const sparseEvents: RawEvent[] = [
      fakeEvent(`${ADDRESS}::SparseEvent`, 'SPARSE_0', { i: 0 }, '0'),
      fakeEvent(`${ADDRESS}::SparseEvent`, 'SPARSE_1', { i: 1 }, '0'),
    ]
    const denseEvents: RawEvent[] = Array.from({ length: DENSE_COUNT }, (_, i) =>
      fakeEvent(`${ADDRESS}::DenseEvent`, `DENSE_${i}`, { i }, '0'),
    )
    const checkpointByDigest: Record<string, number> = {
      SPARSE_0: 10,
      SPARSE_1: 5000, // far future, well beyond the dense type's whole range
    }
    denseEvents.forEach((_, i) => (checkpointByDigest[`DENSE_${i}`] = 20 + i)) // 20..269

    const client = makeFakeClientForPagination(
      { [`${ADDRESS}::SparseEvent`]: sparseEvents, [`${ADDRESS}::DenseEvent`]: denseEvents },
      checkpointByDigest,
    )
    const chain = new SuiChain(client, networkInfo('sui:2') as NetworkInfo<typeof ChainFamily.Sui>)

    const logs = await collect(
      chain.getLogs({ address: ADDRESS, topics: ['SparseEvent', 'DenseEvent'], startBlock: 0 }),
    )

    // Sanity check that this actually exercised multi-page pagination for the
    // dense type (250 events / default limit 50 = 5 pages) rather than
    // trivially returning everything in one page.
    assert.ok(
      (client.queryEvents as unknown as { mock: { calls: unknown[] } }).mock.calls.length >= 5,
      'expected the dense type to require multiple queryEvents pages',
    )

    assert.equal(logs.length, sparseEvents.length + denseEvents.length)
    for (let i = 1; i < logs.length; i++) {
      assert.ok(
        logs[i]!.blockNumber >= logs[i - 1]!.blockNumber,
        `checkpoint went backwards at index ${i}: ${logs[i - 1]!.blockNumber} -> ${logs[i]!.blockNumber}`,
      )
    }
    // The sparse type's far-future event still comes out last.
    assert.equal(logs[logs.length - 1]!.blockNumber, 5000)
  })
})
