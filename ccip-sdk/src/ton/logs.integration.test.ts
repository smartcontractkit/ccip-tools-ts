import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { NetworkType } from '../networks.ts'
import type { ChainLog } from '../types.ts'
import {
  type TonIndex,
  newestLogRows,
  patientIndexFetch,
  txBlock,
} from './live-fixtures.integration.test.ts'
import { tonV3BaseUrl } from './logs.ts'
import { crc32 } from './utils.ts'
import { TONChain } from './index.ts'

await useResource(['ton-testnet'])

/**
 * Live-testnet coverage of the getLogs scan shapes the ccip-o11y Temporal pollers
 * drive (pollConfigs/pollRequests:ton-testnet), on the lane's active OffRamp:
 *
 *  A.  startTime-only, topics that match nothing — the cold backfill. Served by the
 *      TonCenter v3 index (the fast path): /messages rows, the tx list for block
 *      numbers, batched v2 hydration — never a walk of the account's tx chain.
 *  A2. startTime-only with a MATCHING topic — same path, and it yields real logs.
 *  B.  startBlock floor — the v2 walk; on a deep window it is driven by the index's
 *      ordered tx list (bounded pages, index-stamped block numbers).
 *  C.  `since` hint without its per-log index — resumes on the walk, tx-exclusive.
 *  C2. `since` hint with its index — resumes on the index, message-granular.
 *  D.  A dormant address — "no events since T" in exactly one index call.
 *
 * WINDOW. Every scan on the OffRamp runs over ONE window pinned around known log
 * transactions of the account, found in a single index call (see
 * live-fixtures.integration.test.ts). Two facts of ton-testnet bound its age:
 *  - the public v2 endpoint serves a transaction for about two days (measured: every
 *    read fine up to 48h, about half failing with "lt not in db" from 60h, all of
 *    them after a week), and the SDK needs v2 for a log's topic;
 *  - the SDK takes B's deep-window path for floors it ESTIMATES to be over ~4h old,
 *    from the account's recent lt rate, and that estimate can be a few times off.
 * So the window is the newest activity between 25h and 48h old: deep for sure, still
 * served, and ended by a block the index ingested long ago — the scans see the same
 * rows on every run of the day, with no near-tip race and no retry loop. A scan that
 * misbehaves fails the test with what it returned and what it put on the wire.
 * Without activity in that band the window is the newest activity of any age (B then
 * asserts results only, not the deep path's wire shape); activity older than what v2
 * serves cannot be scanned at all, and the suite says so.
 *
 * The scans match on every log an OffRamp emits while it commits and executes, not
 * on one lane's executions: the lane can be quiet for days, while price commits
 * alone keep the account active.
 *
 * Because A2, B, C and C2 read the SAME window through different paths, B/C/C2 are
 * asserted against A2's result log for log, not just on their shape.
 *
 * Throttling: the v3 index calls go through a fetch that waits out 429s request by
 * request (see patientIndexFetch); the wire counters below count ANSWERED requests,
 * so a throttled-and-retried request counts once.
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

const ONRAMP = 'EQDioi9PI32Wo1oBwkUp0pj1AhwvAHiKiZCfgrr0iDqu3lTA'
const SEPOLIA_SELECTOR = 16015286601757825753n
const CONFIG_TOPICS = [
  'ConfigSet',
  'DestChainSelectorAdded',
  'DestChainConfigUpdated',
  'SourceChainSelectorAdded',
  'SourceChainConfigUpdated',
  'DynamicConfigSet',
]
/** What an OffRamp emits while it commits and executes (a commit transaction emits
 * the first two). */
const EVENT_TOPICS = ['OCR3Base_Transmitted', 'CommitReportAccepted', 'ExecutionStateChanged']
const EVENT_TOPIC_HASHES = EVENT_TOPICS.map((topic) => crc32(topic))
const HOUR_S = 3_600
const DAY_S = 24 * HOUR_S
/** Age band of the preferred window (see WINDOW above): at least this old ... */
const DEEP_AGE_S = 25 * HOUR_S
/** ... and not past the age the public v2 endpoint serves transactions reliably. */
const V2_RETENTION_S = 48 * HOUR_S
/** The window spans this many log-carrying transactions. */
const WINDOW_TXS = 4

// A dormant testnet OffRamp (from the older skipped integration suite): no
// external-out messages in months — the "quiet address" case. Test D fails with a
// clear message if it ever wakes up.
const QUIET_ADDR = 'EQBoGLxL52YDV1OwcaDLcNHyGVOxtcHQDxFb0WqVUQeyRHBd'

/** Counts ANSWERED requests by class, observing the SDK's own rate-limited fetches
 * at the globalThis.fetch seam (createRateLimitedFetch calls through it). A request
 * answered 429 is retried by the SDK and counted only once it is served. */
function spyFetch() {
  const calls = {
    v3messages: 0,
    v3transactions: 0,
    v3tip: 0,
    /** v2 getTransactions with a `to_lt` floor and NO (lt, hash) anchor: the first
     * page of a plain tx-chain walk from the account's tip. */
    walkStarts: 0,
    /** v2 getTransactions with a `to_lt` floor AND an (lt, hash) anchor: a bounded
     * page of consecutive txs — the fast path's batched hydration, the index-driven
     * walk's pages, and the plain walk's continuation pages. */
    anchoredPages: 0,
    /** `to_lt` values seen on v2 getTransactions calls (the walk's wire cursor). */
    toLts: [] as string[],
    /** v2 getTransactions with limit:1 and no `to_lt`: one event tx hydrated by
     * (lt, hash). */
    v2Hydrate: 0,
    /** v2 lookupBlock/getBlockHeader: block-number resolution over v2. The fast path
     * makes none (the index stamps block numbers); a walk makes a few for its floor
     * and cap, and one or more per tx when the index's tx list does not drive it. */
    v2SeqnoLookups: 0,
    /** HTTP 429 answers (each retried by the SDK's fetch). */
    rateLimited: 0,
  }
  const orig = globalThis.fetch
  globalThis.fetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = String(input instanceof Request ? input.url : input)
    let count: (() => void) | undefined
    if (url.includes('/api/v3/messages')) count = () => calls.v3messages++
    else if (url.includes('/api/v3/transactions')) count = () => calls.v3transactions++
    else if (url.includes('/api/v3/masterchainInfo')) count = () => calls.v3tip++
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
            params?: { to_lt?: string; lt?: string; limit?: number }
          }
          const params = m.params
          if (m.method === 'getTransactions' && params?.to_lt != null) {
            const toLt = String(params.to_lt)
            count = () => {
              calls.toLts.push(toLt)
              if (params.lt != null) calls.anchoredPages++
              else calls.walkStarts++
            }
          } else if (m.method === 'getTransactions' && params?.limit === 1) {
            count = () => calls.v2Hydrate++
          } else if (m.method === 'lookupBlock' || m.method === 'getBlockHeader') {
            count = () => calls.v2SeqnoLookups++
          }
        } catch {
          // not a JSON-RPC body — ignore
        }
      }
    }
    const res = await orig(input, init)
    if (res.status === 429) calls.rateLimited++
    else count?.()
    return res
  }
  return { calls, restore: () => (globalThis.fetch = orig) }
}
type Calls = ReturnType<typeof spyFetch>['calls']

/** One-line counter snapshot, for assertion messages. */
const diag = ({ toLts: _, ...counts }: Calls) =>
  Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')

/** Runs one scan to its end under a fresh wire spy. */
async function spied(scan: AsyncIterable<ChainLog>): Promise<{ logs: ChainLog[]; calls: Calls }> {
  const spy = spyFetch()
  try {
    const logs: ChainLog[] = []
    for await (const log of scan) logs.push(log)
    LOGGER.debug(`scan: ${logs.length} logs; ${diag(spy.calls)}`)
    return { logs, calls: spy.calls }
  } finally {
    spy.restore()
  }
}

/** Identity of a log across scan paths. */
const ids = (logs: ChainLog[]) => logs.map((l) => `${l.transactionHash}#${l.index}`)

/** The index answered the scan: no tx-chain walk, no block-number resolution over v2. */
function assertServedByIndex(calls: Calls) {
  assert.ok(calls.v3messages >= 1, `the index's /messages served the scan (${diag(calls)})`)
  assert.equal(calls.walkStarts, 0, `no tx-chain walk (${diag(calls)})`)
  assert.equal(
    calls.v2SeqnoLookups,
    0,
    `block numbers come from the index, not from v2 lookups (${diag(calls)})`,
  )
}

describe('TON getLogs real-workload scans (live testnet)', { skip }, () => {
  let chain: TONChain
  let address: string
  /** The pinned window every OffRamp scan below runs over. */
  let window: { startTime: number; endBlock: number }
  /** Whether the window sits in the deep, still-served age band (see WINDOW above). */
  let deep: boolean
  let windowScan$: ReturnType<typeof spied> | undefined

  before(async () => {
    const index: TonIndex = { fetch: patientIndexFetch(V3_BASE, LOGGER), v3Base: V3_BASE }
    chain = await TONChain.fromUrl(TON_TESTNET_RPC, { logger: LOGGER, v3Fetch: index.fetch })
    const router = await chain.getRouterForOnRamp(ONRAMP, SEPOLIA_SELECTOR)
    const offRamps = await chain.getOffRampsForRouter(router, SEPOLIA_SELECTOR)
    assert.ok(offRamps[0], 'an active Sepolia OffRamp must exist')
    address = offRamps[0]

    // The account's newest log transactions at or before `notAfter`, newest first.
    const logTxs = async (notAfter?: number) => {
      const rows = await newestLogRows(index, address, {
        limit: 4 * WINDOW_TXS,
        ...(notAfter != null && { notAfter }),
      })
      return rows.filter((row, i) => rows.findIndex((r) => r.txHash === row.txHash) === i)
    }
    const nowS = Math.floor(Date.now() / 1e3)
    const served = (tx?: { createdAt: number }) =>
      tx != null && tx.createdAt >= nowS - V2_RETENTION_S
    let txs = (await logTxs(nowS - DEEP_AGE_S)).slice(0, WINDOW_TXS)
    deep = txs.length >= 2 && served(txs[txs.length - 1])
    if (!deep) txs = (await logTxs()).slice(0, WINDOW_TXS)
    const newest = txs[0]
    const oldest = txs[txs.length - 1]
    assert.ok(
      newest && oldest && txs.length >= 2,
      `the index knows fewer than two log transactions on OffRamp ${address}`,
    )
    assert.ok(
      served(oldest),
      `the newest logs of OffRamp ${address} are ${Math.round((nowS - oldest.createdAt) / HOUR_S)}h old: ` +
        'the public TON v2 endpoint no longer serves their transactions, so no scan can read them',
    )
    window = {
      startTime: oldest.createdAt,
      endBlock: await txBlock(index, address, newest.txHash),
    }
    LOGGER.debug('window', window, 'deep', deep)
  })
  after(() => chain.destroy())

  /**
   * The window's logs through the startTime-only scan (test A2), shared as
   * the reference for B, C and C2. They need a cursor log and a later log in another
   * transaction, so fewer than two transactions is a fixture problem, reported here.
   */
  const scanWindow = async () => {
    const scan = await (windowScan$ ??= spied(
      chain.getLogs({ address, topics: EVENT_TOPICS, ...window }),
    ))
    assert.ok(
      new Set(scan.logs.map((l) => l.transactionHash)).size >= 2,
      `the window ${JSON.stringify(window)} holds logs of at least two transactions ` +
        `(got ${scan.logs.length} logs; ${diag(scan.calls)})`,
    )
    return scan
  }

  it(
    'startTime-only scan, topics that match nothing: served by the index, no walk',
    { timeout: 600_000 },
    async () => {
      const { logs, calls } = await spied(
        chain.getLogs({ address, topics: CONFIG_TOPICS, ...window }),
      )
      // Whatever the (usually zero) config events of the window, every emitted log
      // matches the filter and carries a block number.
      for (const l of logs) {
        assert.ok(
          CONFIG_TOPICS.some((t) => crc32(t) === l.topics[0]),
          `log topic ${l.topics[0]} matches the config filter`,
        )
        assert.ok(l.blockNumber > 0 && l.blockNumber <= window.endBlock)
      }
      assertServedByIndex(calls)
    },
  )

  it(
    'startTime-only scan with a matching topic: the index finds the logs, v2 hydrates them',
    { timeout: 600_000 },
    async () => {
      const { logs, calls } = await scanWindow()
      for (const l of logs) {
        assert.ok(EVENT_TOPIC_HASHES.includes(l.topics[0]!), `topic ${l.topics[0]} matches`)
        assert.ok(l.blockNumber > 0, 'stamped with the index-authoritative block number')
        assert.ok(l.blockNumber <= window.endBlock, 'at or below the pinned endBlock')
        assert.ok(l.blockTimestamp >= window.startTime, 'at or after startTime')
      }
      assert.ok(
        logs.every((l, i, arr) => i === 0 || arr[i - 1]!.blockNumber <= l.blockNumber),
        'blocks non-decreasing',
      )
      assert.equal(new Set(ids(logs)).size, logs.length, 'no log emitted twice')
      assertServedByIndex(calls)
      // The index drops the topic, so every log-carrying tx of the window is read
      // from v2 — in pages of consecutive txs where they sit close, one by one where
      // they do not — and never more calls than transactions.
      const hydrations = calls.anchoredPages + calls.v2Hydrate
      assert.ok(hydrations >= 1, `raw transactions hydrated over v2 (${diag(calls)})`)
    },
  )

  it(
    'startBlock floor: the v2 walk returns the same logs, block-granular',
    { timeout: 600_000 },
    async () => {
      const { logs: expected } = await scanWindow()
      const startBlock = expected[0]!.blockNumber
      const { logs, calls } = await spied(
        chain.getLogs({
          address,
          topics: EVENT_TOPICS,
          startBlock,
          endBlock: window.endBlock,
        }),
      )
      for (const l of logs) {
        assert.ok(EVENT_TOPIC_HASHES.includes(l.topics[0]!), `topic ${l.topics[0]} matches`)
        assert.ok(
          l.blockNumber >= startBlock && l.blockNumber <= window.endBlock,
          `log block ${l.blockNumber} within [${startBlock}, ${window.endBlock}]`,
        )
      }
      // A block floor is coarser than the window's time floor: the walk may add logs
      // of the first block that precede startTime, but it must not miss any.
      const got = new Set(ids(logs))
      assert.deepEqual(
        ids(expected).filter((id) => !got.has(id)),
        [],
        'every log of the index scan is in the walk',
      )
      assert.deepEqual(
        ids(logs.filter((l) => l.blockTimestamp >= window.startTime)),
        ids(expected),
        'same logs, same order, from the time floor on',
      )
      assert.equal(calls.v3messages, 0, `a startBlock floor never opens /messages (${diag(calls)})`)
      assert.ok(
        calls.walkStarts + calls.anchoredPages >= 1,
        `v2 tx-chain pages read (${diag(calls)})`,
      )
      if (deep) {
        // Deep window: the index's ordered tx list drives bounded v2 pages and stamps
        // the block numbers, so v2 block lookups stay at the walk's own floor and cap
        // — without it the walk pays 2-3 lookups per walked tx.
        assert.equal(calls.walkStarts, 0, `no unbounded walk from the tip (${diag(calls)})`)
        assert.ok(calls.v3transactions >= 1, `the index's tx list engaged (${diag(calls)})`)
        assert.ok(
          calls.v2SeqnoLookups <= 16,
          `no per-tx block lookups on the index-driven walk (${diag(calls)})`,
        )
      }
    },
  )

  it(
    'since hint without its index: resumes on the v2 walk, excluding the hinted tx',
    { timeout: 600_000 },
    async () => {
      const { logs: expected } = await scanWindow()
      const cursor = expected[0]!
      // A hint WITHOUT its per-log index has no message-granular cursor: it stays
      // on the v2 walk (composite lt, tx-exclusive `to_lt`).
      const { logs, calls } = await spied(
        chain.getLogs({
          address,
          topics: EVENT_TOPICS,
          since: { ...cursor, index: undefined },
          endBlock: window.endBlock,
        }),
      )
      assert.deepEqual(
        ids(logs),
        ids(expected.filter((l) => l.transactionHash !== cursor.transactionHash)),
        'exactly the logs of the transactions after the hinted one',
      )
      assert.equal(
        calls.v3messages,
        0,
        `a hint without an index keeps the scan on the v2 walk (${diag(calls)})`,
      )
      assert.ok(
        calls.toLts.includes(cursor.transactionHash.split(':')[2]!),
        `the walk's wire floor is the hinted tx lt (exclusive); saw to_lt: ${calls.toLts.slice(0, 3).join(',')}`,
      )
    },
  )

  it(
    'since hint with its index: resumes on the index, right after the hinted log',
    { timeout: 600_000 },
    async () => {
      // The hint's `index` IS its log's created_lt: the index floors at index + 1, so
      // later logs of the same tx and block still flow and the hinted log is never
      // read again — no v2 walk at all.
      const { logs: expected } = await scanWindow()
      const { logs, calls } = await spied(
        chain.getLogs({
          address,
          topics: EVENT_TOPICS,
          since: expected[0]!,
          endBlock: window.endBlock,
        }),
      )
      assert.deepEqual(ids(logs), ids(expected.slice(1)), 'exactly the logs after the hinted one')
      assertServedByIndex(calls)
    },
  )

  it(
    'quiet address: the index answers "no events in 24h" in one call',
    { timeout: 600_000 },
    async () => {
      const { logs, calls } = await spied(
        chain.getLogs({
          address: QUIET_ADDR,
          topics: CONFIG_TOPICS,
          startTime: Math.floor(Date.now() / 1e3) - DAY_S,
        }),
      )
      assert.equal(
        logs.length,
        0,
        `QUIET_ADDR is no longer dormant (${logs.length} config logs in 24h): pick another dormant address`,
      )
      assertServedByIndex(calls)
      // The pre-fast-path behavior here was a full tx-history walk per poll.
      assert.equal(calls.v3messages, 1, `one /messages query (${diag(calls)})`)
      assert.equal(
        calls.v3transactions + calls.anchoredPages + calls.v2Hydrate,
        0,
        `nothing to place or hydrate (${diag(calls)})`,
      )
    },
  )
})
