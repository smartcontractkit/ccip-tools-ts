/**
 * Tests for multi-topic support in streamAptosLogs.
 *
 * Strategy: build a minimal fake Aptos `Client` (same shape used by
 * fetch-client.test.ts) that serves canned event-handle batches keyed by the
 * handler suffix embedded in the request URL, plugged into a REAL
 * `AptosConfig` so `getAptosFullNode` (a free function reading
 * `provider.config`) routes through it. `.view()` and `.getTransactionByVersion()`
 * are plain mocked methods on the fake provider object (mirroring the
 * `{} as Aptos` / `chainWithViewSpy` pattern already used in this repo's
 * aptos tests), since those don't need the low-level HTTP-shim machinery.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type Aptos,
  type Client,
  type ClientRequest,
  AptosConfig,
  Network,
} from '@aptos-labs/ts-sdk'

import { streamAptosLogs } from './logs.ts'

const ADDRESS = '0xcafe::ccip_offramp'

type FakeAptosEvent = {
  version: string
  sequence_number: string
  type: string
  data: unknown
}

/**
 * Fake Aptos fullnode Client serving canned event-handle batches by handler
 * suffix. Properly paginates by `req.params.{start,limit}` (rather than
 * always returning the whole array) so tests can exercise handles whose
 * history spans more than one `limit`-sized round — array index must equal
 * `sequence_number` for each handle's event list, mirroring how Aptos's real
 * "events by creation number" endpoint indexes a handle.
 */
function makeFakeClient(eventsByHandleSuffix: Record<string, FakeAptosEvent[]>): Client {
  return {
    async provider<Req, Res>(req: ClientRequest<Req>) {
      const url = decodeURIComponent(req.url)
      for (const [suffix, data] of Object.entries(eventsByHandleSuffix)) {
        if (url.includes(suffix)) {
          const { start, limit = 100 } = (req.params ?? {}) as { start?: number; limit?: number }
          // No `start`: the real endpoint returns the most recent `limit` events.
          const page =
            start == null
              ? data.slice(Math.max(data.length - limit, 0))
              : data.slice(start, start + limit)
          return {
            status: 200,
            statusText: 'OK',
            data: page as unknown as Res,
            headers: {},
            config: req,
            request: null,
            response: null,
          }
        }
      }
      throw new Error(`unmocked Aptos fullnode request: ${url}`)
    },
  }
}

function makeFakeProvider(eventsByHandleSuffix: Record<string, FakeAptosEvent[]>): Aptos {
  const client = makeFakeClient(eventsByHandleSuffix)
  const config = new AptosConfig({
    network: Network.MAINNET,
    fullnode: 'https://fake.aptos.internal',
    client,
  })
  return {
    config,
    view: mock.fn(async () => ['0xstate']),
    getTransactionByVersion: mock.fn(async ({ ledgerVersion }: { ledgerVersion: number }) => ({
      type: 'user_transaction',
      hash: `0xhash${ledgerVersion}`,
      timestamp: `${ledgerVersion}000000`,
    })),
  } as unknown as Aptos
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of gen) out.push(v)
  return out
}

void describe('streamAptosLogs multi-topic', () => {
  void it('merges multiple event handles into one globally ascending stream, each event keeping its own topic', async () => {
    const provider = makeFakeProvider({
      // Handle A: OnRampState/ccip_message_sent_events (via named topic 'CCIPMessageSent')
      ccip_message_sent_events: [
        {
          version: '100',
          sequence_number: '0',
          type: `${ADDRESS}::on_ramp::CCIPMessageSent`,
          data: { i: 'A0' },
        },
        {
          version: '102',
          sequence_number: '1',
          type: `${ADDRESS}::on_ramp::CCIPMessageSent`,
          data: { i: 'A1' },
        },
      ],
      // Handle B: OffRampState/commit_report_accepted_events (via named topic 'CommitReportAccepted')
      commit_report_accepted_events: [
        {
          version: '101',
          sequence_number: '0',
          type: `${ADDRESS}::off_ramp::CommitReportAccepted`,
          data: { i: 'B0' },
        },
        {
          version: '103',
          sequence_number: '1',
          type: `${ADDRESS}::off_ramp::CommitReportAccepted`,
          data: { i: 'B1' },
        },
      ],
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CCIPMessageSent', 'CommitReportAccepted'],
          startBlock: 0,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [100, 101, 102, 103],
      'events from both handles must merge into one globally ascending stream by version',
    )
    assert.deepEqual(
      logs.map((l) => l.topics[0]),
      ['CCIPMessageSent', 'CommitReportAccepted', 'CCIPMessageSent', 'CommitReportAccepted'],
      'each emitted log must carry its OWN event name, not the first handle seen',
    )
    assert.deepEqual(
      logs.map((l) => (l.data as { i: string }).i),
      ['A0', 'B0', 'A1', 'B1'],
    )
  })

  void it('still accepts a single-element topics array (existing single-topic callers unchanged)', async () => {
    const provider = makeFakeProvider({
      ccip_message_sent_events: [
        {
          version: '100',
          sequence_number: '0',
          type: `${ADDRESS}::on_ramp::CCIPMessageSent`,
          data: { i: 'A0' },
        },
      ],
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CCIPMessageSent'],
          startBlock: 0,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((l) => l.topics[0]),
      ['CCIPMessageSent'],
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [100],
    )
  })

  void it('rejects an unmapped topic name that has no "/" handle path', async () => {
    const provider = makeFakeProvider({})

    await assert.rejects(
      () =>
        collect(
          streamAptosLogs(
            { provider },
            { address: ADDRESS, topics: ['NotARealEvent'], startBlock: 0 },
          ),
        ),
      { name: 'CCIPTopicsInvalidError' },
    )
  })

  void it('rejects an empty topics array', async () => {
    const provider = makeFakeProvider({})

    await assert.rejects(
      () => collect(streamAptosLogs({ provider }, { address: ADDRESS, topics: [], startBlock: 0 })),
      { name: 'CCIPTopicsInvalidError' },
    )
  })

  void it('keeps the FULL cross-round output monotonically ascending when one handle is sparse (with a far-future event) and another is dense (spanning many rounds)', async () => {
    // Regression for a real bug: batches are windows of `limit` SEQUENCE
    // NUMBERS, not versions, and each handle's window can span an arbitrary,
    // per-handle-different version range. A sparse handle can drain its
    // entire (tiny) history — including a far-future version — in round 1,
    // while a dense handle is still crawling through history versions far
    // BELOW that. Sorting only *within* each round isn't enough: without a
    // cross-round version ceiling, the sparse handle's far-future event would
    // get yielded in round 1, and the dense handle's later, lower-versioned
    // events would arrive in round 2+ — breaking global ascending order and
    // silently corrupting a caller's per-address block watermark (see
    // fetchEventsForward's `ceiling` computation).
    //
    // Handle A ("sparse"): 2 events total, versions 100 and 5000.
    // Handle B ("dense"): 250 events, versions 100..349 (spans 3 rounds at
    // the default limit=100).
    const DENSE_COUNT = 250
    const sparseEvents: FakeAptosEvent[] = [
      { version: '100', sequence_number: '0', type: `${ADDRESS}::on_ramp::SparseEvent`, data: {} },
      { version: '5000', sequence_number: '1', type: `${ADDRESS}::on_ramp::SparseEvent`, data: {} },
    ]
    const denseEvents: FakeAptosEvent[] = Array.from({ length: DENSE_COUNT }, (_, i) => ({
      version: String(100 + i),
      sequence_number: String(i),
      type: `${ADDRESS}::on_ramp::DenseEvent`,
      data: {},
    }))

    const provider = makeFakeProvider({
      sparse_handle_events: sparseEvents,
      dense_handle_events: denseEvents,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['OnRampState/sparse_handle_events', 'OnRampState/dense_handle_events'],
          startBlock: 0,
          versionAsHash: true,
        },
      ),
    )

    // Every event from both handles must show up exactly once.
    assert.equal(logs.length, sparseEvents.length + denseEvents.length)
    const expectedVersions = [...sparseEvents, ...denseEvents]
      .map((ev) => +ev.version)
      .sort((a, b) => a - b)
    assert.deepEqual(
      logs.map((l) => l.blockNumber).sort((a, b) => a - b),
      expectedVersions,
    )

    // The FULL concatenated stream (across every round) must be
    // monotonically non-decreasing by version — a per-round-only check would
    // not catch this bug, since each round was already sorted internally.
    for (let i = 1; i < logs.length; i++) {
      assert.ok(
        logs[i]!.blockNumber >= logs[i - 1]!.blockNumber,
        `version went backwards across rounds at index ${i}: ${logs[i - 1]!.blockNumber} -> ${logs[i]!.blockNumber}`,
      )
    }

    // The sparse handle's far-future event (5000) must come out LAST, only
    // once the dense handle has fully caught up — not in round 1 alongside
    // the dense handle's first (much lower-versioned) batch.
    assert.equal(logs[logs.length - 1]!.blockNumber, 5000)
  })
})
