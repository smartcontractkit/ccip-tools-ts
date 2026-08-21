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
function makeFakeClient(
  eventsByHandleSuffix: Record<string, FakeAptosEvent[]>,
  calls?: { url: string; params: unknown }[],
): Client {
  return {
    async provider<Req, Res>(req: ClientRequest<Req>) {
      const url = decodeURIComponent(req.url)
      calls?.push({ url, params: req.params })
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

function makeFakeProvider(
  eventsByHandleSuffix: Record<string, FakeAptosEvent[]>,
  calls?: { url: string; params: unknown }[],
): Aptos {
  const client = makeFakeClient(eventsByHandleSuffix, calls)
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

/**
 * Fake client answering `status` (not 200) for any handle whose suffix is in
 * `failing`, and serving canned batches for the rest. Proves a caller can pass the
 * handles for BOTH ramp sides and let each address answer only for the ones it
 * actually declares.
 */
function makeProviderWithFailingHandles(
  eventsByHandleSuffix: Record<string, FakeAptosEvent[]>,
  failing: Record<string, number>,
  onFailingRequest?: () => void,
): Aptos {
  const ok = makeFakeClient(eventsByHandleSuffix)
  const client: Client = {
    async provider<Req, Res>(req: ClientRequest<Req>) {
      const url = decodeURIComponent(req.url)
      for (const [suffix, status] of Object.entries(failing)) {
        if (url.includes(suffix)) {
          onFailingRequest?.()
          return {
            status,
            statusText: status === 404 ? 'Not Found' : 'Internal Server Error',
            data: { message: 'handle not found' } as unknown as Res,
            headers: {},
            config: req,
            request: null,
            response: null,
          }
        }
      }
      return ok.provider<Req, Res>(req)
    },
  }
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

const oneOnRampEvent = {
  ccip_message_sent_events: [
    {
      version: '100',
      sequence_number: '0',
      type: `${ADDRESS}::on_ramp::CCIPMessageSent`,
      data: { i: 'A0' },
    },
  ],
}

void describe('streamAptosLogs missing handles', () => {
  void it('skips a handle the address does not declare (404) and still streams the others', async () => {
    // An on-ramp address has no OffRampState handle: the node 404s for it.
    const provider = makeProviderWithFailingHandles(oneOnRampEvent, {
      commit_report_accepted_events: 404,
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
      [100],
      'the surviving handle must still stream; a 404 on a sibling handle must not fail the scan',
    )
  })

  void it('remembers a 404 handle and does not re-request it on later polls', async () => {
    let failingRequests = 0
    const provider = makeProviderWithFailingHandles(
      oneOnRampEvent,
      { commit_report_accepted_events: 404 },
      () => failingRequests++,
    )
    const opts = {
      address: ADDRESS,
      topics: ['CCIPMessageSent', 'CommitReportAccepted'],
      startBlock: 0,
      versionAsHash: true,
    }

    await collect(streamAptosLogs({ provider }, opts))
    assert.equal(failingRequests, 1, 'first poll must discover the absent handle')

    // Each poll is a fresh streamAptosLogs call with fresh per-handle state, so
    // without a cache spanning calls this would 404 again, once per poll forever.
    await collect(streamAptosLogs({ provider }, opts))
    await collect(streamAptosLogs({ provider }, opts))
    assert.equal(failingRequests, 1, 'later polls must skip the known-absent handle entirely')

    // …and the handle that DOES exist keeps streaming throughout.
    const logs = await collect(streamAptosLogs({ provider }, opts))
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [100],
    )
  })

  void it('propagates a non-404 failure rather than silently yielding nothing', async () => {
    // A transient RPC failure must NOT be mistaken for "no such handle" —
    // swallowing it would look identical to "nothing happened on chain".
    const provider = makeProviderWithFailingHandles(oneOnRampEvent, {
      commit_report_accepted_events: 500,
    })

    await assert.rejects(
      collect(
        streamAptosLogs(
          { provider },
          {
            address: ADDRESS,
            topics: ['CCIPMessageSent', 'CommitReportAccepted'],
            startBlock: 0,
            versionAsHash: true,
          },
        ),
      ),
    )
  })
})

void describe('streamAptosLogs since hint', () => {
  // One handle, four events: seq 0..3 at versions 100..103 (mock timestamps = version).
  const FOUR_EVENTS = {
    ccip_message_sent_events: [0, 1, 2, 3].map((i) => ({
      version: String(100 + i),
      sequence_number: String(i),
      type: `${ADDRESS}::on_ramp::CCIPMessageSent`,
      data: { i: `A${i}` },
    })),
  }
  const singleTopic = {
    address: ADDRESS,
    topics: ['CCIPMessageSent'],
    startBlock: 0,
    versionAsHash: true,
  }

  void it('resumes strictly after the hint index on single-handle streams', async () => {
    const calls: { url: string; params: unknown }[] = []
    const provider = makeFakeProvider(FOUR_EVENTS, calls)
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          ...singleTopic,
          since: {
            index: 1,
            blockNumber: 101,
            blockTimestamp: 101,
            address: ADDRESS,
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [102, 103],
      'events at seq 2,3 only — the hinted event (seq 1) itself is not re-emitted',
    )
    const starts = calls
      .filter((c) => c.url.includes('events/'))
      .map((c) => (c.params as { start?: number }).start)
    assert.deepEqual(
      starts,
      [undefined, 2],
      'tip fetch, then pagination resumes directly at the hint cursor (seq+1)',
    )
  })

  void it('skips the startTime floor search when the hint covers it', async () => {
    const calls: { url: string; params: unknown }[] = []
    const provider = makeFakeProvider(FOUR_EVENTS, calls)
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CCIPMessageSent'],
          startTime: 100.5, // floor inside the head page; would normally probe timestamps
          versionAsHash: true,
          since: {
            index: 1,
            blockNumber: 101,
            blockTimestamp: 101,
            address: ADDRESS,
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [102, 103],
    )
    const tsLookups = (
      provider.getTransactionByVersion as unknown as ReturnType<typeof mock.fn>
    ).mock.calls.map((c) => (c.arguments[0] as { ledgerVersion: number }).ledgerVersion)
    assert.deepEqual(
      [...tsLookups].sort(),
      [102, 103],
      'no floor-search probes — only the yielded logs’ own blockTimestamp lookups',
    )
    const starts = calls
      .filter((c) => c.url.includes('events/'))
      .map((c) => (c.params as { start?: number }).start)
    assert.deepEqual(starts, [undefined, 2])
  })

  void it('still applies the floor when the hint is older than startTime', async () => {
    const provider = makeFakeProvider(FOUR_EVENTS)
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CCIPMessageSent'],
          startTime: 102.5, // newer than the hint (seq 1, version 101): floor wins
          versionAsHash: true,
          since: {
            index: 1,
            blockNumber: 101,
            blockTimestamp: 101,
            address: ADDRESS,
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [102, 103],
      'same as the no-hint baseline: the startTime splice still runs (it keeps one ' +
        'below-floor event — pre-existing behavior), unaffected by the stale hint',
    )
    const tsLookups = (
      provider.getTransactionByVersion as unknown as ReturnType<typeof mock.fn>
    ).mock.calls.map((c) => (c.arguments[0] as { ledgerVersion: number }).ledgerVersion)
    assert.ok(
      tsLookups.some((v) => v <= 102),
      'the first-batch timestamp check still runs when the hint does not cover the floor',
    )
  })

  void it('multi-handle streams resume past the hint blockNumber, exclusively', async () => {
    const provider = makeFakeProvider({
      ...FOUR_EVENTS,
      commit_report_accepted_events: [0, 1].map((i) => ({
        version: String(100 + i),
        sequence_number: String(i),
        type: `${ADDRESS}::off_ramp::CommitReportAccepted`,
        data: { i: `B${i}` },
      })),
    })
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CCIPMessageSent', 'CommitReportAccepted'],
          startBlock: 0,
          versionAsHash: true,
          // index 99 is bogus for EITHER handle (sequence spaces are per-handle) and
          // must be ignored; blockNumber 102 is a global ledger version — and a
          // version carries exactly one transaction, whose events every getLogs
          // call emits complete (see the batch-boundary test below) — so the floor
          // is 102 + 1 = 103, exclusive, with no redelivery slack.
          since: {
            index: 99,
            blockNumber: 102,
            blockTimestamp: 102,
            address: ADDRESS,
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => (l.data as { i: string }).i),
      ['A3'],
      'floor at hint.blockNumber + 1 = 103: only strictly-later versions are emitted',
    )
  })

  void it('emits a version complete even when it straddles a batch boundary', async () => {
    // 101 events on one handle ALL at version 100 (a version is one tx, but a tx
    // can own more events than one 100-event batch holds): the first batch is cut
    // mid-version. The whole version must still be released in a single round —
    // a resume hint taken from any of these logs floors at 101 and must never
    // skip the stragglers.
    const provider = makeFakeProvider({
      ccip_message_sent_events: Array.from({ length: 101 }, (_, i) => ({
        version: '100',
        sequence_number: String(i),
        type: `${ADDRESS}::on_ramp::CCIPMessageSent`,
        data: { i: `A${i}` },
      })),
      commit_report_accepted_events: [
        {
          version: '100',
          sequence_number: '0',
          type: `${ADDRESS}::off_ramp::CommitReportAccepted`,
          data: { i: 'B0' },
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
    const flat = logs.map((l) => (l.data as { i: string }).i)
    assert.equal(flat.length, 102, 'no event past a full batch boundary is lost')
    assert.ok(
      flat.indexOf('A100') < flat.indexOf('B0'),
      'the whole version releases in one round: the global sort keeps handle A’s ' +
        'straggler (A100) before handle B’s event (B0)',
    )
  })

  void it('since alone satisfies the start requirement', async () => {
    // No startBlock/startTime: the hint's index is the exact cursor and its
    // blockNumber/timestamp the merged floors.
    const provider = makeFakeProvider(FOUR_EVENTS)
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CCIPMessageSent'],
          versionAsHash: true,
          since: {
            index: 1,
            blockNumber: 101,
            blockTimestamp: 101,
            address: ADDRESS,
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [102, 103],
    )
  })

  void it('takes the larger of startBlock and since.blockNumber', async () => {
    // startBlock 103 is newer than the hint's block 101: the explicit floor wins,
    // and the seq cursor only ever raises it further (it doesn't here).
    const provider = makeFakeProvider(FOUR_EVENTS)
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          ...singleTopic,
          startBlock: 103,
          since: {
            index: 1,
            blockNumber: 101,
            blockTimestamp: 101,
            address: ADDRESS,
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [103],
    )
  })

  void it('ignores a foreign-address hint', async () => {
    const provider = makeFakeProvider(FOUR_EVENTS)
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          ...singleTopic,
          since: {
            index: 99,
            blockNumber: 103,
            blockTimestamp: 103,
            address: '0xbeef::other',
            transactionHash: '0xabc',
          },
        },
      ),
    )
    assert.deepEqual(
      logs.map((l) => l.blockNumber),
      [100, 101, 102, 103],
    )
  })
})
