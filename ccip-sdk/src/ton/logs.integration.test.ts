import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { useResource } from '../../../scripts/useResource.ts'
import { CCIPLogsStreamInconsistentError } from '../errors/index.ts'
import { NetworkType } from '../networks.ts'
import type { ChainLog } from '../types.ts'
import { sleep } from '../utils.ts'
import { V3_MAX_INDEX_LAG, tonV3BaseUrl } from './logs.ts'
import { crc32 } from './utils.ts'
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
 * Address is the ton-testnet OnRamp that both pollers target; the `since` cursor is a
 * real CCIPMessageSent log of it, captured from the v3 index (/messages +
 * /transactions?hash=). Activity on these contracts is organic, so assertions are on
 * shapes and call patterns, not exact counts.
 *
 * Run against any TON v2 endpoint; defaults to the public index (paced, so slow):
 *   node --test src/ton/logs.integration.test.ts
 *   TON_TESTNET_RPC=https://rpc-gateway.example/ton/testnet/node1/jsonRPC node --test …
 *   SKIP_INTEGRATION_TESTS=1 npm test   # CI hermetic runs
 */
const TON_TESTNET_RPC = process.env['TON_TESTNET_RPC'] || 'https://testnet.toncenter.com/api/v2'
const skip = !!process.env.SKIP_INTEGRATION_TESTS
const VERBOSE = !!process.env.VERBOSE

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
// external-out messages in months — the "quiet address" case. If it ever wakes up,
// the strict call-count assertions below should be revisited.
const QUIET_ADDR = 'EQBoGLxL52YDV1OwcaDLcNHyGVOxtcHQDxFb0WqVUQeyRHBd'

// A CCIPMessageSent log of ADDR ~24h old at capture (v3 /messages created_lt +
// /transactions lt and mc_block_seqno; hash re-encoded hex per ChainTransaction).
const OLD_LOG = {
  address: ADDR,
  blockNumber: 79634014,
  blockTimestamp: 1787337184,
  transactionHash:
    '0:e2a22f4f237d96a35a01c24529d298f5021c2f00788a89909f82baf4883aaede:91384259000015:fcc8182747fb59d9e1bcde020e84f57224ce838e828b14f731a7147db003b19f',
  index: 91384259000016,
}

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
     * storm signature. The suite-start probe can miss bursty storms that never touch
     * masterchainInfo, so retry loops key off these and failure messages carry them. */
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

/** Headroom over the fast path's own lag tolerance (V3_MAX_INDEX_LAG mc blocks, a
 * few seconds of testnet traffic at ~1 block/s) for probe/scan timing skew — the
 * probe runs once in `before`, the scans later. Beyond (V3_MAX_INDEX_LAG +
 * headroom) blocks, near-tip scans legitimately fall back to the v2 walk and the
 * shape assertions have nothing to prove; a reachable-but-lagging index is
 * exactly the CI failure mode this guards. */
const V3_HEALTH_MAX_LAG = V3_MAX_INDEX_LAG + 60

/** Probe the v3 index tip twice; unhealthy = unreachable, rate-limiting us (the
 * public index 429-storms hostile shared-egress networks, e.g. CI runners), or
 * lagging more than {@link V3_HEALTH_MAX_LAG} blocks behind the v2 tip. */
async function v3IndexHealthy(base: string, v2Tip?: number): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/masterchainInfo`, {
        headers: { Accept: 'application/json' },
      })
      if (res.ok) {
        const seqno = ((await res.json()) as { last?: { seqno?: unknown } }).last?.seqno
        if (typeof seqno !== 'number' || !Number.isFinite(seqno)) return false
        if (v2Tip != null && v2Tip - seqno > V3_HEALTH_MAX_LAG) {
          console.warn(`v3 index degraded: ${v2Tip - seqno} mc blocks behind the v2 tip (${base})`)
          return false
        }
        return true
      }
    } catch {
      // network-level failure or bad body — retry once
    }
    if (attempt === 0) await sleep(1500)
  }
  return false
}

/** Live scans retry until an attempt's shapes hold (each test's clean condition):
 * the shared public index 429-storms shared-egress networks in minute-scale
 * bursts, and the index can lag the v2 tip in the same window — both transient.
 * Spacing grows so a storm is ridden out without hammering the index further,
 * while a dead index (every attempt yields nothing) still skips in bounded time. */
const RETRY_SPACING_MS = [10_000, 20_000, 40_000]
/** Maximum scan attempts per live test; the shapes are asserted on the last one. */
const MAX_SCAN_ATTEMPTS = RETRY_SPACING_MS.length + 1

/** Growing spacing between scan attempts (caps at the last entry). */
function retrySpacingMs(attempt: number): number {
  return RETRY_SPACING_MS[Math.min(attempt, RETRY_SPACING_MS.length - 1)] ?? 30_000
}

describe('TON getLogs real-workload scans (live testnet)', { skip }, () => {
  let chain: TONChain
  let indexHealthy = true

  before(async () => {
    chain = await TONChain.fromUrl(TON_TESTNET_RPC, {
      logger: VERBOSE ? console : { ...console, debug: () => {} },
    })
    // Self-skip under hostile networks (CI runners' shared egress gets 429-stormed by
    // the keyless public index, and the index itself can lag hours behind the tip)
    // instead of flapping; the mocked unit suite covers the logic hermetically, and
    // these run fully on healthy networks.
    indexHealthy = await probeIndexHealth()
    if (!indexHealthy)
      console.warn(
        'skipping live TON getLogs scans: v3 index unreachable, rate-limited, or lagging',
      )
  })
  after(() => chain.destroy())

  /** Probe the v3 index against the v2 tip: the before hook's suite gate. */
  async function probeIndexHealth(): Promise<boolean> {
    let v2Tip: number | undefined
    try {
      v2Tip = (await chain.getBlockInfo('latest')).number
    } catch {
      // v2 endpoint unreachable too — the probe falls back to reachability-only
    }
    return v3IndexHealthy(tonV3BaseUrl(TON_TESTNET_RPC, NetworkType.Testnet), v2Tip)
  }

  /**
   * Skip when a fast-path property degraded WHILE the index was throttling us.
   *
   * The public index is keyless, so a CI runner's shared egress gets 429-stormed;
   * under that the scan legitimately falls back to the v2 walk, which is the same
   * hostile-network condition the `before` hook's probe already self-skips for —
   * it just started mid-run rather than before it. Degradation with NO 429 is a
   * real shape regression and still fails.
   */
  function skipIfThrottled(
    t: { skip: (msg?: string) => void },
    degraded: boolean,
    rateLimited: number,
    what: string,
  ): boolean {
    if (!degraded || !rateLimited) return false
    t.skip(`${what}: index rate-limited ${rateLimited}x mid-scan, fast path degraded`)
    return true
  }

  /** Skip the test when the live index probe failed (see before hook). */
  function guard(t: { skip: (msg?: string) => void }): boolean {
    if (indexHealthy) return false
    t.skip('toncenter v3 index unreachable, rate-limiting, or lagging this network')
    return true
  }

  it(
    'startTime-only 24h scan: v3 index fast path, no v2 tx-chain pagination',
    {
      timeout: 600_000,
    },
    async (t) => {
      if (guard(t)) return
      let logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      let elapsed = 0
      // The tip is chain-cached ~30s: a retry attempt reuses it and shows 0 tip calls,
      // so count it across attempts (the messages page is re-queried every attempt).
      let v3tipCalls = 0
      // A degraded/lagging public index legitimately falls back to the v2 walk (the
      // probe is fail-fast by design). The storm or lag is transient: retry with
      // growing spacing until a clean fast-path attempt completes, then assert on
      // it. Only a mid-stream index self-contradiction (data inconsistency, not
      // transport) on the last attempt skips.
      let lastTruncated = false
      for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
        lastTruncated = false
        const spy = spyFetch()
        const t0 = Date.now()
        try {
          logs = []
          for await (const log of chain.getLogs({
            address: ADDR,
            topics: CONFIG_TOPICS,
            startTime: Math.floor(Date.now() / 1e3) - DAY_S,
          })) {
            logs.push(log)
          }
        } catch (err) {
          // Genuine mid-stream index self-contradiction (e.g. a message row without
          // its producing tx's hash) truncates loudly once logs were emitted:
          // transient, by design — retryable, not a shape failure.
          if (!(err instanceof CCIPLogsStreamInconsistentError)) throw err
          lastTruncated = true
        } finally {
          spy.restore()
        }
        calls = spy.calls
        v3tipCalls += calls.v3tip
        elapsed = Date.now() - t0
        if (!lastTruncated && calls.walkPages === 0) break
        // Throttled: further attempts only add load to an endpoint already
        // refusing us, and the degraded result skips below rather than failing.
        if (calls.rateLimited) break
        await sleep(retrySpacingMs(attempt))
      }
      if (lastTruncated) {
        t.skip('index degraded: no clean attempt, the last scan self-contradicted mid-stream')
        return
      }
      // Whatever the (usually zero) config events, every emitted log must match the
      // filter and carry an authoritative masterchain block number.
      for (const l of logs) {
        assert.ok(
          CONFIG_TOPICS.some((t) => crc32(t) === l.topics[0]),
          `log topic ${l.topics[0]} matches the config filter`,
        )
        assert.ok(Number(l.blockNumber) > 0)
      }
      assert.ok(calls.v3messages >= 1, 'v3 messages index queried')
      assert.ok(v3tipCalls >= 1, 'v3 index tip consulted (lag guard)')
      if (skipIfThrottled(t, calls.walkPages > 0, calls.rateLimited, 'v2 tx-chain pagination'))
        return
      assert.equal(
        calls.walkPages,
        0,
        `no v2 tx-chain pagination on the fast path${calls.rateLimited ? ` (rate-limited ${calls.rateLimited}×)` : ''}`,
      )
      // Pathology guard on the final attempt's wall time (a fallback retry can
      // legitimately double the total): this scan took ~80s of 429-retry hell before
      // the fast-path transport fixes (paced, fail-fast, tip-cached).
      assert.ok(elapsed < 240_000, `scan completes in a bounded time (${elapsed}ms)`)
    },
  )

  it(
    'startTime-only 24h scan with a matching topic: v3 seed + v2 hydration yields real logs',
    {
      timeout: 600_000,
    },
    async (t) => {
      if (guard(t)) return
      let firstYieldMs: number | undefined
      const logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      // A scan may legitimately truncate early on index inconsistency (the block in
      // progress is dropped — the same contract as a chain gap on the v2 walk), fail
      // its probe on a transient 429, or fall back to v2 when the index degrades.
      // A clean attempt yields logs WITHOUT touching v2 pagination; stormed or
      // lagging attempts finish on the v2 walk with the wrong shapes, so retry with
      // growing spacing until the fast path is back, then assert on the clean
      // attempt (the quota refills; the poller spaces its retries the same way).
      for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
        const spy = spyFetch()
        const attemptT0 = Date.now()
        firstYieldMs = undefined
        try {
          logs.length = 0
          let taken = 0
          for await (const log of chain.getLogs({
            address: ADDR,
            topics: ['CCIPMessageSent'],
            startTime: Math.floor(Date.now() / 1e3) - DAY_S,
          })) {
            firstYieldMs ??= Date.now() - attemptT0
            logs.push(log)
            if (++taken >= 3) break // stream shape proven; the 24h tail lives in the repro
          }
        } catch (err) {
          // Genuine mid-stream index self-contradiction (see the first fast-path
          // test): the emitted prefix is valid, retry.
          if (!(err instanceof CCIPLogsStreamInconsistentError)) throw err
        } finally {
          spy.restore()
        }
        calls = spy.calls
        if (logs.length >= 1 && calls.walkPages === 0) break
        // Throttled: further attempts only add load to an endpoint already
        // refusing us, and the degraded result skips below rather than failing.
        if (calls.rateLimited) break
        await sleep(retrySpacingMs(attempt))
      }
      if (logs.length === 0) {
        // Every attempt truncated before the first sealed block: a degraded index is
        // an environment condition, not a regression — the wire assertions below only
        // have meaning once a scan actually yields.
        t.skip('index degraded: every attempt truncated before the first sealed block')
        return
      }
      for (const l of logs) {
        assert.equal(l.topics[0], CCIP_MESSAGE_SENT)
        assert.ok(Number(l.blockNumber) > 0, 'stamped with the index-authoritative mc seqno')
      }
      assert.ok(
        logs.every(
          (l, i, arr) => i === 0 || Number(arr[i - 1]!.blockNumber) <= Number(l.blockNumber),
        ),
        'blocks non-decreasing',
      )
      assert.ok(calls.v3messages >= 1, 'v3 messages index seeded the scan')
      if (skipIfThrottled(t, calls.walkPages > 0, calls.rateLimited, 'v2 tx-chain pagination'))
        return
      assert.equal(
        calls.walkPages,
        0,
        `no v2 tx-chain pagination on the fast path${calls.rateLimited ? ` (rate-limited ${calls.rateLimited}×)` : ''}`,
      )
      // The sparse index finds the events; only the raw event txs are hydrated over v2.
      // First yield is seconds even on the paced public index (repro: ~5s direct RPC).
      assert.ok(
        firstYieldMs != null && firstYieldMs < 120_000,
        `first yield timely (${firstYieldMs}ms)`,
      )
    },
  )

  it(
    'startBlock a day old: bounded index-driven walk streams matches progressively',
    {
      timeout: 600_000,
    },
    async (t) => {
      if (guard(t)) return
      const startBlock = await chain.getMCSeqNoByUnixtime(Math.floor(Date.now() / 1e3) - DAY_S)
      // The seqno oracle dies on a transient public-index 429 (fail-fast → per-tx
      // fallback — the designed degradation), so a first scan can legitimately show
      // no index meta. Retry with growing spacing until the oracle engages, or until
      // attempts run out and the pre-existing degraded-index skip applies.
      let logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      let firstYieldMs: number | undefined
      for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
        const spy = spyFetch()
        const t0 = Date.now()
        firstYieldMs = undefined
        try {
          logs = []
          // 25 matching logs ≈ 57 txs walked here — past the 16-tx threshold, so the v3
          // seqno oracle must have engaged; without it this many txs cost ~100+
          // lookupBlock/getBlockHeader calls (the pre-oracle 24h walk was 444 total).
          for await (const log of chain.getLogs({
            address: ADDR,
            topics: ['CCIPMessageSent'],
            startBlock,
          })) {
            firstYieldMs ??= Date.now() - t0
            logs.push(log)
            if (logs.length >= 25) break // the 24h tail is covered by the repro script
          }
        } finally {
          spy.restore()
        }
        calls = spy.calls
        if (calls.v3transactions >= 1) break // oracle engaged
        // Throttled: further attempts only add load to an endpoint already
        // refusing us, and the degraded result skips below rather than failing.
        if (calls.rateLimited) break
        await sleep(retrySpacingMs(attempt))
      }
      if (calls.v3transactions === 0) {
        // The index never answered across attempts; the logs arrived via the legacy
        // v2-only fallback, so the index-path assertions below have nothing to prove.
        t.skip('index degraded: meta never engaged; the scan ran on the v2 fallback')
        return
      }
      {
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
          calls.v3transactions >= 1 && calls.v3transactions <= 12,
          `seqno meta came in index pages, not per-tx lookups (saw ${calls.v3transactions})`,
        )
        // Oracle engagement is already guaranteed above (the retry loop requires
        // v3transactions >= 1); this cap bounds the DESIGNED degradation instead:
        // txs newer than the index's tip (tail lag) fall back to per-tx seqno
        // resolution, and the public index lags a few blocks, so a healthy run can
        // legitimately fall back for its most recent txs. Keep it loose but grounded:
        // CI's healthy observed run on the public index did 97, and the pre-oracle
        // walk pays ~2-3 lookupBlock/getBlockHeader RPCs per walked tx (444+ for the
        // full 24h window this prefix comes from).
        assert.ok(
          calls.v2SeqnoLookups <= 320,
          `per-tx seqno RPCs bounded by the oracle (saw ${calls.v2SeqnoLookups}; ~2-3 per walked tx without it)`,
        )
        assert.ok(
          firstYieldMs != null && firstYieldMs < 120_000,
          `first yield timely (${firstYieldMs}ms; ~7s on a direct RPC)`,
        )
      }
    },
  )

  it(
    'since cursor a day old, composite-only hint: resumes on the v2 walk, tx-exclusive',
    {
      timeout: 600_000,
    },
    async (t) => {
      if (guard(t)) return
      // A hint WITHOUT its per-log index has no message-granular cursor: it stays
      // on the v2 walk (composite lt, tx-exclusive `to_lt`).
      const hint = { ...OLD_LOG, index: undefined }
      let logs: ChainLog[] = []
      let spy!: ReturnType<typeof spyFetch>
      for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
        spy = spyFetch()
        try {
          logs = []
          for await (const log of chain.getLogs({
            address: ADDR,
            topics: ['CCIPMessageSent'],
            since: hint,
          })) {
            logs.push(log)
            if (logs.length >= 3) break
          }
        } finally {
          spy.restore()
        }
        // Clean attempt: the meta seed either never engaged (legacy v2-only walk,
        // per-tx lookups bounded) or fully covered the window (no per-tx seqno
        // resolution, and seed pages proportionate to the walk's own depth — each
        // ≤100 txs, so they grow with the window's organic traffic, not a fixed
        // count). A 429'd/truncated seed walks the rest on per-tx seqno resolution
        // (correct, just slower) — transient, retry with spacing.
        const { v3transactions, v2SeqnoLookups, walkPages } = spy.calls
        if (
          logs.length >= 1 &&
          ((v3transactions === 0 && v2SeqnoLookups < 200) ||
            (v3transactions > 0 &&
              v2SeqnoLookups <= 8 &&
              v3transactions <= Math.max(3, walkPages + 1)))
        )
          break
        // Throttled: further attempts only add load to an endpoint already
        // refusing us, and the degraded result skips below rather than failing.
        if (spy.calls.rateLimited) break
        await sleep(retrySpacingMs(attempt))
      }
      if (logs.length === 0) {
        t.skip('index degraded: every attempt truncated before the first sealed block')
        return
      }
      const first = logs[0]!
      assert.notEqual(
        first.transactionHash,
        hint.transactionHash,
        'the hinted tx is not re-streamed (tx-exclusive floor)',
      )
      assert.ok(
        Number(first.blockNumber) > hint.blockNumber ||
          (Number(first.blockNumber) === hint.blockNumber && first.index > OLD_LOG.index),
        'resumes strictly past the cursor',
      )
      assert.equal(spy.calls.v3messages, 0, 'a hint without an index keeps the scan on the v2 walk')
      // The walk seeds the ordered lt list from the index: one paged meta call for
      // a shallow scan — never the event index, never per-tx seqno lookups.
      if (spy.calls.v3transactions > 0) {
        assert.ok(
          spy.calls.v3transactions <= Math.max(3, spy.calls.walkPages + 1),
          `lt list seeded in pages proportionate to the walk (saw ${spy.calls.v3transactions} seed pages for ${spy.calls.walkPages} walk pages)`,
        )
        if (
          skipIfThrottled(
            t,
            spy.calls.v2SeqnoLookups > 8,
            spy.calls.rateLimited,
            'per-tx seqno resolution',
          )
        )
          return
        assert.ok(
          spy.calls.v2SeqnoLookups <= 8,
          `no per-tx seqno resolution (saw ${spy.calls.v2SeqnoLookups}${spy.calls.rateLimited ? `, rate-limited ${spy.calls.rateLimited}×` : ''})`,
        )
      } else {
        assert.ok(
          spy.calls.v2SeqnoLookups < 200,
          `legacy per-tx resolution under a degraded index (saw ${spy.calls.v2SeqnoLookups})`,
        )
      }
      assert.ok(
        spy.calls.walkToLts.includes('91384259000015'),
        `walk paged with to_lt at the hinted tx lt (exclusive); saw: ${spy.calls.walkToLts.slice(0, 3).join(',')}`,
      )
    },
  )

  it(
    'since cursor a day old, with per-log index: hint scan on the v3 /messages fast path',
    {
      timeout: 600_000,
    },
    async (t) => {
      if (guard(t)) return
      // The hint's `index` IS its log's created_lt: the message-granular index
      // floors at index + 1 (`start_lt` is inclusive), so same-tx/same-block logs
      // still flow and the hinted log is never re-fetched — no v2 walk at all.
      // A degraded/lagging public index legitimately falls back to the v2 walk
      // (the probe is fail-fast by design); stormed or lagging attempts finish on
      // the v2 walk with the wrong shapes, so retry with growing spacing until the
      // fast path is back, then assert on the clean attempt.
      let logs: ChainLog[] = []
      let spy!: ReturnType<typeof spyFetch>
      for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
        spy = spyFetch()
        try {
          logs = []
          for await (const log of chain.getLogs({
            address: ADDR,
            topics: ['CCIPMessageSent'],
            since: OLD_LOG,
          })) {
            logs.push(log)
            if (logs.length >= 3) break
          }
        } catch (err) {
          // Genuine mid-stream index self-contradiction (see the first fast-path
          // test): the emitted prefix is valid, retry.
          if (!(err instanceof CCIPLogsStreamInconsistentError)) throw err
        } finally {
          spy.restore()
        }
        if (logs.length >= 1 && spy.calls.walkPages === 0) break
        // Throttled: further attempts only add load to an endpoint already
        // refusing us, and the degraded result skips below rather than failing.
        if (spy.calls.rateLimited) break
        await sleep(retrySpacingMs(attempt))
      }
      if (logs.length === 0) {
        t.skip('index degraded: every attempt truncated before the first sealed block')
        return
      }
      const first = logs[0]!
      assert.ok(
        Number(first.blockNumber) > OLD_LOG.blockNumber ||
          (Number(first.blockNumber) === OLD_LOG.blockNumber && first.index > OLD_LOG.index),
        'resumes strictly past the cursor',
      )
      assert.ok(spy.calls.v3messages >= 1, 'the /messages fast path served the hint scan')
      if (
        skipIfThrottled(t, spy.calls.walkPages > 0, spy.calls.rateLimited, 'v2 tx-chain pagination')
      )
        return
      assert.equal(
        spy.calls.walkPages,
        0,
        `no v2 tx-chain pagination on the fast path${spy.calls.rateLimited ? ` (rate-limited ${spy.calls.rateLimited}×)` : ''}`,
      )
      assert.equal(spy.calls.v2SeqnoLookups, 0, 'no per-tx seqno resolution (index stamps them)')
      assert.ok(spy.calls.v2Hydrate > 0, 'event txs hydrated from v2 by (lt, hash)')
    },
  )

  it(
    'quiet address: the v3 seed answers "no events in 24h" in one index call',
    {
      timeout: 600_000,
    },
    async (t) => {
      if (guard(t)) return
      let logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      let elapsedMs = 0
      for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
        const spy = spyFetch()
        const t0 = Date.now()
        try {
          logs = []
          for await (const log of chain.getLogs({
            address: QUIET_ADDR,
            topics: CONFIG_TOPICS,
            startTime: Math.floor(Date.now() / 1e3) - DAY_S,
          })) {
            logs.push(log)
          }
        } finally {
          spy.restore()
        }
        calls = spy.calls
        elapsedMs = Date.now() - t0
        // A degraded/lagging index falls back to the v2 walk — the fast-path shape
        // this test asserts never ran on that attempt; retry with spacing.
        if (calls.walkPages === 0) break
        // Throttled: further attempts only add load to an endpoint already
        // refusing us, and the degraded result skips below rather than failing.
        if (calls.rateLimited) break
        await sleep(retrySpacingMs(attempt))
      }
      if (calls.walkPages > 0) {
        t.skip('v3 probe fell back to the v2 walk (index degraded)')
        return
      }
      assert.equal(logs.length, 0, 'dormant address emits nothing')
      assert.ok(
        calls.v3messages <= 3,
        `one strictly-filtered /messages query, plus at most paced 429 retries on the public index (saw ${calls.v3messages})`,
      )
      assert.equal(calls.walkPages, 0, 'never walks the v2 tx chain')
      // The pre-fast-path behavior here was a full tx-history walk per poll; now it's
      // one index call and done (~2s on a direct RPC, paced on the public one).
      assert.ok(elapsedMs < 60_000, 'quiet scans are cheap')
    },
  )
})
