import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { TONChain } from './index.ts'
import { sleep } from '../utils.ts'
import { crc32 } from './utils.ts'
import type { ChainLog } from '../types.ts'

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
    /** v2 lookupBlock/getBlockHeader calls — the per-tx seqno-resolution cost that the
     * v3 meta oracle replaces on deep walks (a few per scan are unrelated: floor
     * resolution, the endBlock cap). */
    v2SeqnoLookups: 0,
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
            params?: { to_lt?: string }
          }
          if (m.method === 'getTransactions' && m.params?.to_lt != null) {
            calls.walkPages++
            calls.walkToLts.push(String(m.params.to_lt))
          } else if (m.method === 'lookupBlock' || m.method === 'getBlockHeader') {
            calls.v2SeqnoLookups++
          }
        } catch {
          // not a JSON-RPC body — ignore
        }
      }
    }
    return orig(input, init)
  }
  return { calls, restore: () => (globalThis.fetch = orig) }
}

describe('TON getLogs real-workload scans (live testnet)', { skip }, () => {
  let chain: TONChain

  before(async () => {
    chain = await TONChain.fromUrl(TON_TESTNET_RPC, {
      logger: VERBOSE ? console : { ...console, debug: () => {} },
    })
  })
  after(() => chain.destroy())

  it(
    'startTime-only 24h scan: v3 index fast path, no v2 tx-chain pagination',
    {
      timeout: 600_000,
    },
    async () => {
      let logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      let elapsed = 0
      // The tip is chain-cached ~30s: a retry attempt reuses it and shows 0 tip calls,
      // so count it across attempts (the messages page is re-queried every attempt).
      let v3tipCalls = 0
      // A degraded/lagging public index legitimately falls back to the v2 walk (the
      // probe is fail-fast by design); retry once before failing the fast-path shape.
      for (let attempt = 0; attempt < 2; attempt++) {
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
        } finally {
          spy.restore()
        }
        calls = spy.calls
        v3tipCalls += calls.v3tip
        elapsed = Date.now() - t0
        if (calls.walkPages === 0 || attempt === 1) break
        // Give the public index's shared keyless quota a beat to refill: back-to-back
        // attempts can land in the same 429 window (bursts from shared CI egress IPs
        // are outside this process's pacing). The poller spaces its retries too.
        await sleep(10_000)
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
      assert.equal(calls.walkPages, 0, 'no v2 tx-chain pagination on the fast path')
      // Pathology guard on the final attempt's wall time (a fallback retry can
      // legitimately double the total): this scan took ~80s of 429-retry hell before
      // the fast-path transport fixes (paced, fail-fast, tip-cached).
      assert.ok(elapsed < 240_000, `scan completes in a bounded time (${elapsed}ms)`)
    },
  )

  it(
    'startTime-only 24h scan with a matching topic: v3 seed + v2 hydration yields real logs',
    {
      timeout: 420_000,
    },
    async () => {
      const t0 = Date.now()
      let firstYieldMs: number | undefined
      const logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      // A scan may legitimately truncate early on index inconsistency (the block in
      // progress is dropped — the same contract as a chain gap on the v2 walk), fail
      // its probe on a transient 429, or fall back to v2 when the index degrades. A
      // clean attempt yields logs without touching v2 pagination; retry with spacing
      // (the quota refills; the poller spaces its retries the same way).
      for (let attempt = 0; attempt < 3; attempt++) {
        const spy = spyFetch()
        try {
          logs.length = 0
          let taken = 0
          for await (const log of chain.getLogs({
            address: ADDR,
            topics: ['CCIPMessageSent'],
            startTime: Math.floor(Date.now() / 1e3) - DAY_S,
          })) {
            firstYieldMs ??= Date.now() - t0
            logs.push(log)
            if (++taken >= 3) break // stream shape proven; the 24h tail lives in the repro
          }
        } finally {
          spy.restore()
        }
        calls = spy.calls
        if ((logs.length >= 1 && calls.walkPages === 0) || attempt === 2) break
        await sleep(10_000)
      }
      assert.ok(logs.length >= 1, 'v3 fast path yields real logs for an active stream')
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
      assert.equal(calls.walkPages, 0, 'no v2 tx-chain pagination on the fast path')
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
      timeout: 420_000,
    },
    async () => {
      const startBlock = await chain.getMCSeqNoByUnixtime(Math.floor(Date.now() / 1e3) - DAY_S)
      // Up to two scans: the oracle dies on a transient public-index 429 (fail-fast →
      // per-tx fallback — the designed degradation), so a first scan can legitimately
      // show no index meta. Two consecutive oracle-less deep scans mean it's broken.
      let logs: ChainLog[] = []
      let calls!: ReturnType<typeof spyFetch>['calls']
      let firstYieldMs: number | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const spy = spyFetch()
        const t0 = Date.now()
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
        if (calls.v3transactions >= 1 || attempt === 1) break // oracle engaged (or last try)
        // Same 429-refill spacing as the fast-path scans: the /transactions meta oracle
        // shares the public index's keyless quota with the other CI shares of the egress.
        await sleep(10_000)
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
    'since cursor a day old: resumes exclusively off the hint, no v3',
    {
      timeout: 420_000,
    },
    async () => {
      const spy = spyFetch()
      try {
        const logs: ChainLog[] = []
        for await (const log of chain.getLogs({
          address: ADDR,
          topics: ['CCIPMessageSent'],
          since: OLD_LOG,
        })) {
          logs.push(log)
          if (logs.length >= 3) break
        }
        assert.ok(logs.length >= 1, 'streams matching logs')
        const first = logs[0]!
        assert.notEqual(first.transactionHash, OLD_LOG.transactionHash, 'hinted tx not re-streamed')
        assert.ok(
          Number(first.blockNumber) > OLD_LOG.blockNumber ||
            (Number(first.blockNumber) === OLD_LOG.blockNumber && first.index > OLD_LOG.index),
          'resumes strictly past the cursor',
        )
        assert.equal(spy.calls.v3messages, 0, 'an lt-carrying hint keeps the scan on the v2 walk')
        // The walk seeds the ordered lt list from the index: one paged meta call for
        // a shallow scan — never the event index, never per-tx seqno lookups.
        assert.ok(
          spy.calls.v3transactions <= 3,
          `lt list seeded in pages (saw ${spy.calls.v3transactions})`,
        )
        assert.ok(
          spy.calls.v2SeqnoLookups <= 8,
          `no per-tx seqno resolution (saw ${spy.calls.v2SeqnoLookups})`,
        )
        // The composite hash's lt becomes the exclusive wire cursor (`to_lt` is
        // exclusive server-side — verified against toncenter v2 — so un-incremented).
        assert.ok(
          spy.calls.walkToLts.includes('91384259000015'),
          `walk paged with to_lt at the hinted lt; saw: ${spy.calls.walkToLts.slice(0, 3).join(',')}`,
        )
      } finally {
        spy.restore()
      }
    },
  )

  it(
    'quiet address: the v3 seed answers "no events in 24h" in one index call',
    {
      timeout: 120_000,
    },
    async (t) => {
      const spy = spyFetch()
      const t0 = Date.now()
      try {
        const logs: ChainLog[] = []
        for await (const log of chain.getLogs({
          address: QUIET_ADDR,
          topics: CONFIG_TOPICS,
          startTime: Math.floor(Date.now() / 1e3) - DAY_S,
        })) {
          logs.push(log)
        }
        // A degraded/lagging index falls back to the v2 walk — the fast-path shape this
        // test asserts never ran, so skip rather than fail on the probe's health.
        if (spy.calls.walkPages > 0) {
          t.skip('v3 probe fell back to the v2 walk (index degraded)')
          return
        }
        assert.equal(logs.length, 0, 'dormant address emits nothing')
        assert.ok(
          spy.calls.v3messages <= 3,
          `one strictly-filtered /messages query, plus at most paced 429 retries on the public index (saw ${spy.calls.v3messages})`,
        )
        assert.equal(spy.calls.walkPages, 0, 'never walks the v2 tx chain')
        // The pre-fast-path behavior here was a full tx-history walk per poll; now it's
        // one index call and done (~2s on a direct RPC, paced on the public one).
        assert.ok(Date.now() - t0 < 60_000, 'quiet scans are cheap')
      } finally {
        spy.restore()
      }
    },
  )
})
