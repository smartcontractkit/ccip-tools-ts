import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { CCIPError, CCIPLogsStreamInconsistentError } from '../errors/index.ts'
import { createRateLimitedFetch } from '../fetch.ts'
import { isTransientHttpStatus } from '../http-status.ts'
import { NetworkType } from '../networks.ts'
import type { ChainLog } from '../types.ts'
import { sleep } from '../utils.ts'
import { fetchV3IndexedTip, tonV3BaseUrl } from './logs.ts'
import { crc32, tonRateLimitProfile } from './utils.ts'
import { TONChain } from './index.ts'

await useResource(['ton-testnet'])

/**
 * Live-testnet coverage of the three getLogs scan shapes the ccip-o11y Temporal
 * pollers actually drive (pollConfigs/pollRequests:ton-testnet, observed 2026-08):
 *
 *  A. startTime-only (24h lookback, watermark 0) on a busy address with unmatched
 *     topics — the cold backfill. Must take the TonCenter v3 index fast path: one
 *     /messages page + cached /masterchainInfo tip + paged /transactions meta — never
 *     the per-tx v2 chain walk.
 *  A2. startTime-only with a MATCHING topic — same fast path, and it actually yields:
 *     real logs hydrated from v2 by (lt, hash) after the sparse index seeding.
 *  B. startBlock a day old, no hint — the v2 walk: paginates the account's tx chain
 *     over the window and streams matches progressively (first yield in seconds).
 *     Deep windows (floor older than ~4h, estimated live from the account's lt rate)
 *     hydrate in bounded ≤100-tx v2 pages driven by the index's ordered lt list —
 *     memory stays O(batch) at any depth; shallow scans stay on plain v2 pagination.
 *  C. A `since` hint a day old — the walk resumes exclusively off the cursor; the
 *     hinted transaction is not re-streamed (the exclusive lt cursor reaches the wire
 *     as `to_lt`). The lt list itself is one paged index read; hydration stays on v2.
 *  D. A quiet (dormant) address — the v3 seed answers "no events since T" in exactly
 *     one /messages call (plus the cached tip), never touching the v2 walk.
 *
 * Address is the ton-testnet OnRamp that both pollers target. The `since` cursor is
 * captured at RUNTIME: the first CCIPMessageSent log of the last ~25h, read through
 * the SDK's own startTime scan, so the window stays day-scale on every run. Activity
 * on these contracts is organic, so assertions are on shapes and call patterns, not
 * exact counts. A scan that never comes back clean within the retry budget fails
 * with the last error and the wire counters.
 *
 * Run against any TON v2 endpoint; defaults to the public index (paced, so slow):
 *   node --test src/ton/logs.integration.test.ts
 *   RPC_TON_TESTNET=https://rpc-gateway.example/ton/testnet/node1/jsonRPC node --test …
 *   SKIP_INTEGRATION_TESTS=1 npm test   # CI hermetic runs
 */
const TON_TESTNET_RPC = rpcEndpoint('RPC_TON_TESTNET')
const V3_BASE = tonV3BaseUrl(TON_TESTNET_RPC, NetworkType.Testnet)
const skip = !!process.env.SKIP_INTEGRATION_TESTS
const VERBOSE = !!process.env.VERBOSE
const LOGGER = VERBOSE ? console : { ...console, debug: () => {} }

const ADDR = 'EQDioi9PI32Wo1oBwkUp0pj1AhwvAHiKiZCfgrr0iDqu3lTA' // raw 0:e2a22f4f…aaede
const CONFIG_TOPICS = [
  'ConfigSet',
  'DestChainSelectorAdded',
  'DestChainConfigUpdated',
  'SourceChainSelectorAdded',
  'SourceChainConfigUpdated',
  'DynamicConfigSet',
]
const CCIP_MESSAGE_SENT = crc32('CCIPMessageSent') // 0xa45d293c
const DAY_S = 86_400

// A dormant testnet OffRamp (from the older skipped integration suite): no
// external-out messages in months — the "quiet address" case. Test D fails with a
// clear message if it ever wakes up.
const QUIET_ADDR = 'EQBoGLxL52YDV1OwcaDLcNHyGVOxtcHQDxFb0WqVUQeyRHBd'

/** Counts requests by class, observing the SDK's own rate-limited fetches at the
 * globalThis.fetch seam (createRateLimitedFetch calls through it). */
function spyFetch() {
  const calls = {
    v3messages: 0,
    v3transactions: 0,
    v3tip: 0,
    /** v2 getTransactions carrying a `to_lt` floor = tx-chain WALK pages. NB
     * `@ton/ton`'s getTransaction(lt, hash) hydration hits the same method name with
     * limit:1 and no to_lt, so only to_lt-carrying calls count as pagination. */
    walkPages: 0,
    /** `to_lt` params seen on v2 getTransactions calls (the walk's wire cursor). */
    walkToLts: [] as string[],
    /** v2 getTransactions with limit:1 and no `to_lt` — the hydration of event txs
     * by (lt, hash) on the fast path (and of walked txs on the v2 path). */
    v2Hydrate: 0,
    /** v2 lookupBlock/getBlockHeader calls — the per-tx seqno-resolution cost that the
     * v3 meta oracle replaces on deep walks (a few per scan are unrelated: floor
     * resolution, the endBlock cap). */
    v2SeqnoLookups: 0,
    /** HTTP 429 responses observed on any fetch: the public index's shared-egress
     * storm signature; retries after a 429 wait longer. */
    rateLimited: 0,
  }
  const orig = globalThis.fetch
  globalThis.fetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/api/v3/messages')) calls.v3messages++
    else if (url.includes('/api/v3/transactions')) calls.v3transactions++
    else if (url.includes('/api/v3/masterchainInfo')) calls.v3tip++
    else {
      // Bodies arrive in several shapes (string / bytes / Request payload — the
      // axios fetch adapter differs); normalize before sniffing the JSON-RPC method.
      let bodyText: string | undefined
      if (typeof init?.body === 'string') bodyText = init.body
      else if (init?.body instanceof Uint8Array) bodyText = new TextDecoder().decode(init.body)
      else if (input instanceof Request && init?.body == null)
        bodyText = await input
          .clone()
          .text()
          .catch(() => undefined)
      if (bodyText) {
        try {
          const m = JSON.parse(bodyText) as {
            method?: string
            params?: { to_lt?: string; limit?: number }
          }
          if (m.method === 'getTransactions' && m.params?.to_lt != null) {
            calls.walkPages++
            calls.walkToLts.push(String(m.params.to_lt))
          } else if (m.method === 'getTransactions' && m.params?.limit === 1) {
            calls.v2Hydrate++
          } else if (m.method === 'lookupBlock' || m.method === 'getBlockHeader') {
            calls.v2SeqnoLookups++
          }
        } catch {
          // not a JSON-RPC body — ignore
        }
      }
    }
    const res = await orig(input, init)
    if (res.status === 429) calls.rateLimited++
    return res
  }
  return { calls, restore: () => (globalThis.fetch = orig) }
}
type Calls = ReturnType<typeof spyFetch>['calls']

/** One-line counter snapshot of an attempt, for failure diagnostics. */
const callsDiag = ({ walkToLts: _, ...counts }: Calls) =>
  `calls: ${Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')}`

/** Live scans retry until an attempt's shapes hold (each test's clean condition):
 * the shared public index 429-storms shared-egress networks in minute-scale
 * bursts, and the index can lag the v2 tip in the same window — both transient.
 * Spacing grows so a storm is ridden out without hammering the index further. A
 * 429'd attempt waits longer: the SDK already paces this endpoint, so a 429 means
 * something ELSE on the same egress spends the keyless per-IP budget, and only
 * waiting out the window clears it. */
const RETRY_SPACING_MS = [10_000, 20_000, 40_000]
const THROTTLED_SPACING_MS = [20_000, 45_000, 90_000]
/** Wall-clock a single test spends retrying before it fails. */
const RETRY_BUDGET_MS = 240_000
const MAX_SCAN_ATTEMPTS = RETRY_SPACING_MS.length + 1

/** Transport degradation (throttling, 5xx, network blips, a mid-stream index
 * self-contradiction) — retried. Anything else is a bug and fails at once. */
function isTransient(err: unknown): boolean {
  if (err instanceof CCIPError) return err.isTransient
  // AxiosError from @ton/ton's HttpApi: the response status is the verdict.
  const status = Number((err as { response?: { status?: unknown } } | null)?.response?.status)
  if (status > 0) return isTransientHttpStatus(status)
  return /\b(429|rate.?limit|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket)/i.test(
    String((err as Error | null)?.message),
  )
}

/** Collects up to `max` logs. The SDK ends a stream on an index self-contradiction
 * after a valid prefix: the prefix is returned with `truncated` set. */
async function collect(logs: AsyncIterable<ChainLog>, max = Infinity) {
  const t0 = Date.now()
  const out = {
    logs: [] as ChainLog[],
    truncated: false,
    firstYieldMs: undefined as number | undefined,
  }
  try {
    for await (const log of logs) {
      out.firstYieldMs ??= Date.now() - t0
      out.logs.push(log)
      if (out.logs.length >= max) break
    }
  } catch (err) {
    if (!(err instanceof CCIPLogsStreamInconsistentError) || !out.logs.length) throw err
    out.truncated = true
  }
  return out
}

/**
 * Runs `scan` (under a fresh spyFetch) until `problem` returns undefined for an
 * attempt, retrying transient errors and unclean shapes with growing spacing.
 * Fails with the last error or problem and the wire counters when the attempts or
 * the retry budget run out.
 */
async function runAttempts<T>(
  scan: () => Promise<T>,
  problem: (result: T, calls: Calls) => string | undefined,
): Promise<{ result: T; calls: Calls; elapsedMs: number; attempts: Calls[] }> {
  const startedAt = Date.now()
  const attempts: Calls[] = []
  for (let attempt = 0; ; attempt++) {
    const spy = spyFetch()
    const t0 = Date.now()
    let why: string | undefined
    try {
      const result = await scan()
      why = problem(result, spy.calls)
      if (why === undefined)
        return {
          result,
          calls: spy.calls,
          elapsedMs: Date.now() - t0,
          attempts: [...attempts, spy.calls],
        }
    } catch (err) {
      if (!isTransient(err)) throw err
      why = `transient error: ${err instanceof Error ? err.message : JSON.stringify(err)}`
    } finally {
      spy.restore()
    }
    attempts.push(spy.calls)
    const ladder = spy.calls.rateLimited ? THROTTLED_SPACING_MS : RETRY_SPACING_MS
    const wait = ladder[Math.min(attempt, ladder.length - 1)]!
    if (attempt + 1 >= MAX_SCAN_ATTEMPTS || Date.now() - startedAt + wait > RETRY_BUDGET_MS)
      assert.fail(
        `no clean scan in ${attempt + 1} attempts; last: ${why} (${callsDiag(spy.calls)})`,
      )
    await sleep(wait)
  }
}

describe('TON getLogs real-workload scans (live testnet)', { skip }, () => {
  let chain: TONChain
  /** Indexed-tip snapshot taken once at suite start: the pinned scan window END for
   * every scan and retry attempt below, so every attempt scans the SAME fixed ~24h
   * window (a deterministic shape for the wire assertions) instead of one that grows
   * with each backoff. The fast path never declines on the pin (the index tip only
   * moves forward), and the walk fallback is bounded by the same snapshot. */
  let endBlockPin: number
  let cursor: Promise<ChainLog> | undefined

  before(async () => {
    chain = await TONChain.fromUrl(TON_TESTNET_RPC, { logger: LOGGER })
    endBlockPin = await fetchV3IndexedTip({
      rateLimitedFetch: createRateLimitedFetch(tonRateLimitProfile(V3_BASE, { maxRetries: 3 }), {
        logger: LOGGER,
      }),
      v3BaseUrl: V3_BASE,
    })
  })
  after(() => chain.destroy())

  const lastDay = () => ({ startTime: Math.floor(Date.now() / 1e3) - DAY_S, endBlock: endBlockPin })

  /** The `since` cursor for tests C: the first CCIPMessageSent log of the last ~25h. */
  const getCursor = () =>
    (cursor ??= runAttempts(
      () =>
        collect(
          chain.getLogs({
            address: ADDR,
            topics: ['CCIPMessageSent'],
            startTime: Math.floor(Date.now() / 1e3) - DAY_S - 3600,
            endBlock: endBlockPin,
          }),
          1,
        ),
      (r) => (r.logs.length ? undefined : 'no CCIPMessageSent log of the OnRamp in the last 25h'),
    ).then(({ result }) => result.logs[0]!))

  it(
    'startTime-only 24h scan: v3 index fast path, no v2 tx-chain pagination',
    { timeout: 600_000 },
    async () => {
      const { result, calls, elapsedMs, attempts } = await runAttempts(
        () => collect(chain.getLogs({ address: ADDR, topics: CONFIG_TOPICS, ...lastDay() })),
        (r, c) =>
          r.truncated
            ? 'the index self-contradicted mid-stream'
            : c.walkPages
              ? 'fell back to the v2 walk'
              : undefined,
      )
      // Whatever the (usually zero) config events, every emitted log must match the
      // filter and carry an authoritative masterchain block number.
      for (const l of result.logs) {
        assert.ok(
          CONFIG_TOPICS.some((t) => crc32(t) === l.topics[0]),
          `log topic ${l.topics[0]} matches the config filter`,
        )
        assert.ok(Number(l.blockNumber) > 0)
      }
      assert.ok(calls.v3messages >= 1, 'v3 messages index queried')
      // The tip is chain-cached ~30s: a retry attempt reuses it, so count across attempts.
      assert.ok(
        attempts.some((c) => c.v3tip >= 1),
        'v3 index tip consulted (lag guard)',
      )
      // Pathology guard: this scan took ~80s of 429-retry hell before the fast-path
      // transport fixes (paced, fail-fast, tip-cached).
      assert.ok(elapsedMs < 240_000, `scan completes in a bounded time (${elapsedMs}ms)`)
    },
  )

  it(
    'startTime-only 24h scan with a matching topic: v3 seed + v2 hydration yields real logs',
    { timeout: 600_000 },
    async () => {
      // A truncated prefix is valid (the block in progress is dropped — the same
      // contract as a chain gap on the v2 walk).
      const { result, calls } = await runAttempts(
        () =>
          collect(chain.getLogs({ address: ADDR, topics: ['CCIPMessageSent'], ...lastDay() }), 3),
        (r, c) =>
          !r.logs.length ? 'no log yielded' : c.walkPages ? 'fell back to the v2 walk' : undefined,
      )
      for (const l of result.logs) {
        assert.equal(l.topics[0], CCIP_MESSAGE_SENT)
        assert.ok(Number(l.blockNumber) > 0, 'stamped with the index-authoritative mc seqno')
      }
      assert.ok(
        result.logs.every(
          (l, i, arr) => i === 0 || Number(arr[i - 1]!.blockNumber) <= Number(l.blockNumber),
        ),
        'blocks non-decreasing',
      )
      assert.ok(calls.v3messages >= 1, 'v3 messages index seeded the scan')
      // The sparse index finds the events; only the raw event txs are hydrated over v2.
      // First yield is seconds even on the paced public index (repro: ~5s direct RPC).
      assert.ok(
        result.firstYieldMs != null && result.firstYieldMs < 120_000,
        `first yield timely (${result.firstYieldMs}ms)`,
      )
    },
  )

  it(
    'startBlock a day old: bounded index-driven walk streams matches progressively',
    { timeout: 600_000 },
    async () => {
      const startBlock = await chain.getMCSeqNoByUnixtime(Math.floor(Date.now() / 1e3) - DAY_S)
      // 25 matching logs ≈ 57 txs walked here — past the 16-tx threshold, so the v3
      // seqno oracle must have engaged; without it this many txs cost ~100+
      // lookupBlock/getBlockHeader calls (the pre-oracle 24h walk was 444 total). The
      // oracle dies on a transient public-index 429 (fail-fast → per-tx fallback — the
      // designed degradation), so an attempt without index meta is retried.
      const { result, calls } = await runAttempts(
        () =>
          collect(
            chain.getLogs({
              address: ADDR,
              topics: ['CCIPMessageSent'],
              startBlock,
              endBlock: endBlockPin,
            }),
            25,
          ),
        (r, c) =>
          r.truncated
            ? 'the index self-contradicted mid-stream'
            : c.v3transactions === 0
              ? 'the v3 seqno oracle never engaged'
              : undefined,
      )
      const { logs } = result
      assert.ok(logs.length >= 3, 'streams matching logs')
      for (const l of logs) {
        assert.equal(l.topics[0], CCIP_MESSAGE_SENT)
        assert.ok(Number(l.blockNumber) >= startBlock, 'log at/above the requested floor')
      }
      assert.ok(
        logs.every(
          (l, i, arr) => i === 0 || Number(arr[i - 1]!.blockNumber) <= Number(l.blockNumber),
        ),
        'blocks non-decreasing',
      )
      assert.equal(calls.v3messages, 0, 'a startBlock floor never opens the event index')
      assert.ok(calls.walkPages >= 1, 'v2 tx-chain pagination used')
      // Bounded by PAGES, not by walked txs: the walked count drifts with organic
      // traffic, but a per-tx seqno fallback for 25 logs would mean ~100+ index
      // calls — a few pages is the oracle's signature either way.
      assert.ok(
        calls.v3transactions <= 12,
        `seqno meta came in index pages, not per-tx lookups (saw ${calls.v3transactions})`,
      )
      // Bounds the DESIGNED degradation: txs newer than the index's tip (tail lag) fall
      // back to per-tx seqno resolution. CI's healthy observed run on the public index
      // did 97; the pre-oracle walk pays ~2-3 RPCs per walked tx (444+ for 24h).
      assert.ok(
        calls.v2SeqnoLookups <= 320,
        `per-tx seqno RPCs bounded by the oracle (saw ${calls.v2SeqnoLookups}; ~2-3 per walked tx without it)`,
      )
      assert.ok(
        result.firstYieldMs != null && result.firstYieldMs < 120_000,
        `first yield timely (${result.firstYieldMs}ms; ~7s on a direct RPC)`,
      )
    },
  )

  it(
    'since cursor a day old, composite-only hint: resumes on the v2 walk, tx-exclusive',
    { timeout: 900_000 },
    async () => {
      const oldLog = await getCursor()
      // A hint WITHOUT its per-log index has no message-granular cursor: it stays
      // on the v2 walk (composite lt, tx-exclusive `to_lt`).
      const hint = { ...oldLog, index: undefined }
      // Clean attempt: the meta seed either never engaged (legacy v2-only walk, per-tx
      // lookups bounded) or fully covered the window (no per-tx seqno resolution, and
      // seed pages proportionate to the walk's own depth — each ≤100 txs). A
      // 429'd/truncated seed walks the rest on per-tx seqno resolution (correct, just
      // slower) — transient, retried.
      const { result, calls } = await runAttempts(
        () =>
          collect(
            chain.getLogs({
              address: ADDR,
              topics: ['CCIPMessageSent'],
              since: hint,
              endBlock: endBlockPin,
            }),
            3,
          ),
        (r, c) =>
          r.truncated
            ? 'the index self-contradicted mid-stream'
            : !r.logs.length
              ? 'no log after the cursor'
              : c.v3transactions === 0
                ? c.v2SeqnoLookups < 200
                  ? undefined
                  : 'legacy per-tx seqno resolution exceeded its bound'
                : c.v2SeqnoLookups <= 8 && c.v3transactions <= Math.max(3, c.walkPages + 1)
                  ? undefined
                  : 'the lt-list seed did not cover the walk',
      )
      const first = result.logs[0]!
      assert.notEqual(
        first.transactionHash,
        hint.transactionHash,
        'the hinted tx is not re-streamed (tx-exclusive floor)',
      )
      assert.ok(
        Number(first.blockNumber) > hint.blockNumber ||
          (Number(first.blockNumber) === hint.blockNumber && first.index > oldLog.index),
        'resumes strictly past the cursor',
      )
      assert.equal(calls.v3messages, 0, 'a hint without an index keeps the scan on the v2 walk')
      assert.ok(
        calls.walkToLts.includes(oldLog.transactionHash.split(':')[2]!),
        `walk paged with to_lt at the hinted tx lt (exclusive); saw: ${calls.walkToLts.slice(0, 3).join(',')}`,
      )
    },
  )

  it(
    'since cursor a day old, with per-log index: hint scan on the v3 /messages fast path',
    { timeout: 900_000 },
    async () => {
      // The hint's `index` IS its log's created_lt: the message-granular index floors
      // at index + 1 (`start_lt` is inclusive), so same-tx/same-block logs still flow
      // and the hinted log is never re-fetched — no v2 walk at all.
      const oldLog = await getCursor()
      const { result, calls } = await runAttempts(
        () =>
          collect(
            chain.getLogs({
              address: ADDR,
              topics: ['CCIPMessageSent'],
              since: oldLog,
              endBlock: endBlockPin,
            }),
            3,
          ),
        (r, c) =>
          !r.logs.length
            ? 'no log after the cursor'
            : c.walkPages
              ? 'fell back to the v2 walk'
              : undefined,
      )
      const first = result.logs[0]!
      assert.ok(
        Number(first.blockNumber) > oldLog.blockNumber ||
          (Number(first.blockNumber) === oldLog.blockNumber && first.index > oldLog.index),
        'resumes strictly past the cursor',
      )
      assert.ok(calls.v3messages >= 1, 'the /messages fast path served the hint scan')
      assert.equal(calls.v2SeqnoLookups, 0, 'no per-tx seqno resolution (index stamps them)')
      assert.ok(calls.v2Hydrate > 0, 'event txs hydrated from v2 by (lt, hash)')
    },
  )

  it(
    'quiet address: the v3 seed answers "no events in 24h" in one index call',
    { timeout: 600_000 },
    async () => {
      const { result, calls, elapsedMs } = await runAttempts(
        () =>
          collect(
            chain.getLogs({
              address: QUIET_ADDR,
              topics: CONFIG_TOPICS,
              startTime: Math.floor(Date.now() / 1e3) - DAY_S,
            }),
          ),
        (r, c) =>
          r.truncated
            ? 'the index self-contradicted mid-stream'
            : c.walkPages
              ? 'fell back to the v2 walk'
              : undefined,
      )
      assert.equal(
        result.logs.length,
        0,
        `QUIET_ADDR is no longer dormant (${result.logs.length} config logs in 24h): pick another dormant address`,
      )
      assert.ok(
        calls.v3messages <= 3,
        `one strictly-filtered /messages query, plus at most paced 429 retries on the public index (saw ${calls.v3messages})`,
      )
      // The pre-fast-path behavior here was a full tx-history walk per poll; now it's
      // one index call and done (~2s on a direct RPC, paced on the public one).
      assert.ok(elapsedMs < 60_000, 'quiet scans are cheap')
    },
  )
})
