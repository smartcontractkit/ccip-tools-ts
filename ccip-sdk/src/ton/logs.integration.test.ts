import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { TONChain } from './index.ts'
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
 *     Deep walks stamp block numbers via the lazily-engaged v3 meta oracle (paged
 *     /transactions, not per-tx lookupBlock/getBlockHeader); shallow scans stay pure v2.
 *  C. A `since` hint a day old — the v2 walk resumed exclusively off the cursor; the
 *     hinted transaction is not re-streamed (the exclusive lt cursor reaches the wire
 *     as `to_lt`), and the v3 index is not touched.
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
      const spy = spyFetch()
      const t0 = Date.now()
      try {
        const logs: ChainLog[] = []
        for await (const log of chain.getLogs({
          address: ADDR,
          topics: CONFIG_TOPICS,
          startTime: Math.floor(Date.now() / 1e3) - DAY_S,
        })) {
          logs.push(log)
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
        assert.ok(spy.calls.v3messages >= 1, 'v3 messages index queried')
        assert.ok(spy.calls.v3tip >= 1, 'v3 index tip consulted (lag guard)')
        assert.equal(spy.calls.walkPages, 0, 'no v2 tx-chain pagination on the fast path')
        // Pathology guard: this scan took ~80s of 429-retry hell before the fast-path
        // transport fixes (paced, fail-fast, tip-cached), and minutes more before that.
        assert.ok(Date.now() - t0 < 240_000, 'scan completes in a bounded time')
      } finally {
        spy.restore()
      }
    },
  )

  it(
    'startTime-only 24h scan with a matching topic: v3 seed + v2 hydration yields real logs',
    {
      timeout: 420_000,
    },
    async () => {
      const spy = spyFetch()
      const t0 = Date.now()
      let firstYieldMs: number | undefined
      try {
        const logs: ChainLog[] = []
        // A scan may legitimately truncate early on index inconsistency (the block in
        // progress is dropped — the same contract as a chain gap on the v2 walk). The
        // poller's answer is a retry with its hint; the test's is a plain retry.
        for (let attempt = 0; attempt < 2 && logs.length === 0; attempt++) {
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
        assert.ok(spy.calls.v3messages >= 1, 'v3 messages index seeded the scan')
        assert.equal(spy.calls.walkPages, 0, 'no v2 tx-chain pagination on the fast path')
        // The sparse index finds the events; only the raw event txs are hydrated over v2.
        // First yield is seconds even on the paced public index (repro: ~5s direct RPC).
        assert.ok(
          firstYieldMs != null && firstYieldMs < 120_000,
          `first yield timely (${firstYieldMs}ms)`,
        )
      } finally {
        spy.restore()
      }
    },
  )

  it(
    'startBlock a day old: v2 walk streams matches, v3 meta oracle stamps seqnos',
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
        assert.ok(
          calls.v3transactions >= 1 && calls.v3transactions <= 5,
          `seqno meta came in index pages, not per-tx lookups (saw ${calls.v3transactions})`,
        )
        assert.ok(
          calls.v2SeqnoLookups <= 64,
          `per-tx seqno RPCs bounded by the oracle (saw ${calls.v2SeqnoLookups}; ~90+ without it)`,
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
        assert.equal(
          spy.calls.v3transactions,
          0,
          'a handful of txs stays under the seqno-oracle threshold — hot path is pure v2',
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
    async () => {
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
