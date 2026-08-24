import { Address } from '@ton/core'
import type { TonClient, Transaction } from '@ton/ton'

import type { LogFilter } from '../chain.ts'
import {
  CCIPHttpError,
  CCIPLogsRequiresStartError,
  CCIPLogsStreamInconsistentError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import { CCIPLogsAddressRequiredError } from '../errors/specialized.ts'
import { NetworkType } from '../networks.ts'
import type { ChainTransaction, LeanNumbers, Logger } from '../types.ts'
import { signalToPromise } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5000

/** Batch size for v2 hydration pages in the meta-driven walk (≤ the meta page size). */
const WALK_CHUNK = 100

async function* fetchTxsForward(
  opts: LeanNumbers<Omit<LogFilter, 'topics' | 'startBlock' | 'startTime'>> & {
    /** Exclusive account-lt cursor: only txs with `lt > sinceLt` stream. `to_lt` is
     * exclusive server-side (verified against toncenter v2), so the boundary tx is
     * never even fetched; the tail truncation below is only a defensive duplicate. */
    sinceLt: bigint
    pollInterval?: number
  },
  ctx: {
    provider: TonClient
    /** Ordered lt list from the v3 index (paged `/transactions`, ascending from
     * strictly after the given cursor). When present, the backfill hydrates the window
     * in bounded forward batches — O(chunk) memory at any window depth. */
    v3Meta?: (afterLt: bigint) => AsyncGenerator<TonV3Transaction, void, undefined>
  },
): AsyncGenerator<{ tx: Transaction; seqno?: number }> {
  const limit = Math.min(Number(opts.page) || 99, 99)
  const { sinceLt } = opts

  const notAfter =
    (typeof opts.endBlock !== 'number' && typeof opts.endBlock !== 'bigint') ||
    Number(opts.endBlock) < 0
      ? undefined
      : BigInt(opts.endBlock)

  if (ctx.v3Meta) {
    let yielded = 0
    const { v3Meta } = ctx
    try {
      for await (const item of streamAccountTxsByMeta(
        opts.address!,
        sinceLt,
        {
          provider: ctx.provider,
          v3Meta,
        },
        notAfter,
      )) {
        yielded++
        yield item
      }
      return // meta path completed the window
    } catch (err) {
      // Mid-stream failures truncate by error (the consumer drops the block in
      // progress; the poller resumes from its hint). A DISAGREEMENT between the index
      // and the v2 RPC always throws, even before the first yield — falling back would
      // silently hide it. Only a pre-yield FETCH failure (index down) falls through to
      // the legacy walk below.
      if (yielded > 0 || err instanceof CCIPLogsStreamInconsistentError) throw err
    }
  }

  // Legacy v2-only fallback: page the account's tx chain backward from the tip,
  // collecting the whole window before draining. Memory-heavy on deep windows — used
  // only when no usable v3 index answers (the meta path above failed before yielding).
  const allTxs = [] as Transaction[]
  let batch: typeof allTxs,
    until: bigint = sinceLt
  do {
    batch = await ctx.provider.getTransactions(Address.parse(opts.address!), {
      limit,
      ...(!!allTxs.length && {
        lt: allTxs[allTxs.length - 1]!.lt.toString(),
        hash: allTxs[allTxs.length - 1]!.hash().toString('base64'),
      }),
      to_lt: sinceLt.toString(),
    })

    while (batch.length > 0 && batch[batch.length - 1]!.lt <= sinceLt) {
      batch.length-- // truncate tail of txs at/older than the exclusive cursor (defensive)
    }

    allTxs.push(...batch) // concat in descending order
  } while (batch.length >= limit)

  allTxs.reverse() // forward

  while (notAfter != null && allTxs.length > 0 && allTxs[allTxs.length - 1]!.lt > notAfter) {
    allTxs.length-- // truncate head (after reverse) of txs newer than requested end
  }
  // Drain the walk buffer progressively: release each tx right after yielding it, so
  // a consumer suspended mid-stream (e.g. rate-limited decode) or abandoning the
  // stream pins only the un-yielded suffix, never the already-emitted prefix. The
  // backfill window is gone once drained; `until` (the watch loop's resume cursor)
  // is the newest tx's lt — captured before the drain, since the drain nulls slots.
  const headLt = allTxs.length ? allTxs[allTxs.length - 1]!.lt : undefined
  for (let i = 0; i < allTxs.length; i++) {
    const tx = allTxs[i]!
    allTxs[i] = undefined as never
    yield { tx }
  }
  allTxs.length = 0 // gc

  if (headLt != null) until = headLt
  // if not watch mode, returns
  while (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) {
    const lastReq = performance.now()
    batch = await ctx.provider.getTransactions(Address.parse(opts.address!), {
      limit,
      to_lt: until.toString(),
    })

    batch.reverse() // forward

    for (const tx of batch) {
      until = tx.lt
      yield { tx }
    }

    let delay$ = AbortSignal.timeout(
      Math.max(
        Math.ceil((opts.pollInterval || DEFAULT_POLL_INTERVAL) - (performance.now() - lastReq)),
        1,
      ),
    )
    if (opts.watch instanceof AbortSignal) {
      if (opts.watch.aborted) break
      delay$ = AbortSignal.any([opts.watch, delay$])
    }
    await signalToPromise(delay$).catch(() => false)
  }
}

/**
 * The account's transactions strictly after `sinceLt`, streamed forward in bounded
 * batches: the v3 index's paged meta supplies the ordered lt list (and authoritative
 * masterchain seqnos), and each ≤WALK_CHUNK window of it is hydrated in ONE v2
 * `getTransactions` call — anchored at the chunk's newest (lt, hash), which is
 * INCLUSIVE server-side, with `to_lt` at the chunk's exclusive lower bound. Memory
 * stays O(chunk) regardless of window depth.
 *
 * The two sources are cross-validated per chunk (exact lt-list equality) and the
 * account tx chain is verified link by link (`prevTransactionLt`): any disagreement
 * throws {@link CCIPLogsStreamInconsistentError}, which the consumer treats like a
 * chain gap — the block in progress is dropped and the poller resumes from its hint.
 */
async function* streamAccountTxsByMeta(
  address: string,
  sinceLt: bigint,
  ctx: {
    provider: TonClient
    v3Meta: (afterLt: bigint) => AsyncGenerator<TonV3Transaction, void, undefined>
  },
  notAfter?: bigint,
): AsyncGenerator<{ tx: Transaction; seqno: number }> {
  const acct = Address.parse(address)
  let cursorLt = sinceLt
  let prevLt: bigint | undefined
  let metas: TonV3Transaction[] = []

  const flush = async function* (): AsyncGenerator<{ tx: Transaction; seqno: number }> {
    if (!metas.length) return
    const anchor = metas[metas.length - 1]!
    // `inclusive: true`: @ton/ton otherwise fetches limit+1 and shifts the anchor off
    // (its pagination-cursor behavior). We want the chunk INCLUDING the anchor.
    const page = await ctx.provider.getTransactions(acct, {
      limit: metas.length,
      lt: anchor.lt,
      hash: anchor.hash,
      to_lt: cursorLt.toString(),
      inclusive: true,
    })
    page.reverse() // forward
    if (page.length !== metas.length || page.some((tx, i) => tx.lt !== BigInt(metas[i]!.lt)))
      throw new CCIPLogsStreamInconsistentError(
        `v2 page (${page.length} txs) != index meta (${metas.length} txs) under lt=${anchor.lt}`,
      )
    for (let i = 0; i < page.length; i++) {
      const tx = page[i]!
      if (prevLt !== undefined && tx.prevTransactionLt !== prevLt)
        throw new CCIPLogsStreamInconsistentError(
          `account tx chain link broken at lt=${tx.lt} (after ${prevLt})`,
        )
      prevLt = tx.lt
      yield { tx, seqno: metas[i]!.mc_block_seqno }
      page[i] = undefined as never // release as yielded
    }
    metas = []
    cursorLt = prevLt!
  }

  for await (const meta of ctx.v3Meta(sinceLt)) {
    const lt = BigInt(meta.lt)
    if (notAfter != null && lt > notAfter) break
    if (lt <= sinceLt) continue // index rows at/below the exclusive cursor (defensive)
    metas.push(meta)
    if (metas.length >= WALK_CHUNK) yield* flush()
  }
  yield* flush()
}

/**
 * Internal method to get transactions for an address with pagination.
 * @param opts - Log filter options.
 * @returns Async generator of TON transactions.
 */
export async function* streamTransactionsForAddress(
  opts: LeanNumbers<Omit<LogFilter, 'topics' | 'startBlock' | 'startTime'>> & {
    /** Exclusive account-lt cursor to resume from: only txs with `lt > sinceLt` stream.
     * Callers resolve `startBlock`/`startTime`/`since` hints into lt space beforehand
     * (see TONChain.getLogs — floorLtForTime covers startTime). */
    sinceLt: bigint
    pollInterval?: number
  },
  ctx: {
    provider: TonClient
    /** Decode/stamp a raw tx; `seqno` is the index-authoritative committing block when
     * the meta-driven backfill supplied it (otherwise resolved via committingSeqno). */
    getTransaction: (tx: Transaction, seqno?: number) => Promise<ChainTransaction>
    v3Meta?: (afterLt: bigint) => AsyncGenerator<TonV3Transaction, void, undefined>
  },
): AsyncGenerator<ChainTransaction> {
  if (!opts.address) throw new CCIPLogsAddressRequiredError()

  opts.endBlock ??= 'latest'

  // Required by type; guarded at runtime for untyped (JS) callers.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (opts.sinceLt == null) throw new CCIPLogsRequiresStartError()
  if (
    opts.watch &&
    (((typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
      Number(opts.endBlock) > 0) ||
      opts.endBefore)
  )
    throw new CCIPLogsWatchRequiresFinalityError(
      typeof opts.endBlock === 'bigint' ? Number(opts.endBlock) : opts.endBlock,
    )

  const allTransactions = fetchTxsForward(opts, ctx)

  // Process transactions
  for await (const { tx, seqno } of allTransactions) {
    yield await ctx.getTransaction(tx, seqno)
  }
}

// ---------------------------------------------------------------------------
// TonCenter v3 fast path (startTime-only scans)
// ---------------------------------------------------------------------------

/** Max page size for TonCenter v3 index queries. */
const V3_PAGE_LIMIT = 100

/**
 * Max acceptable lag (in masterchain blocks) of the v3 index behind the v2 tip for the
 * fast path to be trusted. A healthy TonCenter v3 index lags by a few blocks; a larger
 * gap means a degraded index, in which case the caller falls back to the v2 walk.
 * Exported for the live integration suite's health probe (it skips shape assertions
 * whenever scans would legitimately fall back).
 */
export const V3_MAX_INDEX_LAG = 300

/** Subset of a TonCenter v3 `/messages` entry the fast path relies on. */
type TonV3Message = {
  hash: string
  source: string | null
  destination: string | null
  created_lt: string
  created_at: string
  out_msg_tx_hash?: string | null
}

/** Subset of a TonCenter v3 `/transactions` entry: meta for stamping/hydration. */
export type TonV3Transaction = {
  account: string
  hash: string
  lt: string
  now: number
  mc_block_seqno: number
}

/**
 * One item of the v3 event stream: a hydrated event-carrying transaction, or an
 * end-of-stream marker signalling the stream stopped early on index inconsistency —
 * the block in progress may be incomplete and must be dropped, the same contract as a
 * chain gap on the v2 walk (already-emitted blocks stand; the poller resumes from its
 * hint).
 */
export type TonV3Event = { tx: ChainTransaction } | { truncated: true }

/** Dependencies of the v3 fast path, provided by TONChain. */
export type TonV3Context = {
  provider: TonClient
  /** TonCenter v3 index base URL (see {@link tonV3BaseUrl}); without one there is no fast path. */
  v3BaseUrl?: string
  /** Dedicated v3-index fetch: the chain seeds it paced and fail-fast (few retries) —
   * the public index's keyless quota is ~1 RPS per egress IP, so bursting or patiently
   * retrying here is what used to stall probes for minutes before the v2 fallback. */
  rateLimitedFetch: typeof fetch
  /** The index's masterchain tip, for the lag guard. Network-global — implementations
   * should cache it briefly (~30s) rather than re-query per scan. */
  getIndexedTip: () => Promise<number>
  /** Decode a raw transaction, stamping it with the index-authoritative masterchain seqno. */
  getTransaction: (tx: Transaction, blockSeqno: number) => Promise<ChainTransaction>
  logger?: Pick<Logger, 'debug' | 'warn'>
}

/**
 * The TonCenter v3 index base URL for a chain: derived from the v2 RPC endpoint when
 * it has an `/api/v2` path (`https://toncenter.com/api/v2/jsonRPC` →
 * `https://toncenter.com/api/v3`); otherwise the public TonCenter index for the
 * chain's network — the same fallback `lookupTxByRawHash` uses for hash lookups.
 * StartTime-only scans are rare (cold backfills), so leaning on the public index for
 * them is acceptable even for chains otherwise served by a private endpoint.
 * @internal
 */
export function tonV3BaseUrl(endpoint: string, networkType: NetworkType): string {
  const base = /^https?:\/\/[^/]+\/api\/v2(?=\/|$)/.exec(endpoint)?.[0]
  if (base) return base.replace(/\/v2$/, '/v3')
  return networkType === NetworkType.Mainnet
    ? 'https://toncenter.com/api/v3'
    : 'https://testnet.toncenter.com/api/v3'
}

async function fetchV3Messages(
  ctx: TonV3Context & { v3BaseUrl: string },
  q: { source: string; startUtime: number; startLt?: bigint; limit: number; offset?: number },
): Promise<TonV3Message[]> {
  const url = new URL(`${ctx.v3BaseUrl}/messages`)
  url.searchParams.set('source', q.source)
  url.searchParams.set('destination', 'null') // external-out ("log") messages only
  url.searchParams.set('direction', 'out')
  if (q.startUtime > 0) url.searchParams.set('start_utime', String(q.startUtime))
  if (q.startLt != null) url.searchParams.set('start_lt', q.startLt.toString())
  url.searchParams.set('sort', 'asc') // the index orders rows by created_at; page turns use start_utime (see generateV3Events)
  url.searchParams.set('limit', String(q.limit))
  if (q.offset) url.searchParams.set('offset', String(q.offset))
  const res = await ctx.rateLimitedFetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new CCIPHttpError(res.status, `TON v3 messages query failed: ${await res.text()}`)
  }
  const { messages } = (await res.json()) as { messages?: TonV3Message[] }
  return messages ?? []
}

/**
 * The account's transactions from the v3 index, paged ascending by lt. Used as a lazy
 * meta oracle for the event stream: one index page per ~100 account txs instead of one
 * `/transactions?hash=` lookup per event tx — the public index's keyless quota is the
 * scarce resource, and raw-tx hydration below already stays on the owned v2 RPC.
 */
export async function* streamV3TxMeta(
  ctx: Pick<TonV3Context, 'rateLimitedFetch'> & { v3BaseUrl: string },
  acct: Address,
  startUtime: number,
  /** Seed the stream strictly after this account lt (exclusive, matching the index's
   * `start_lt`) — used by the v2 walk's seqno oracle, which engages mid-walk. */
  afterLt?: bigint,
): AsyncGenerator<TonV3Transaction, void, undefined> {
  let startLt: bigint | undefined = afterLt
  for (;;) {
    const url = new URL(`${ctx.v3BaseUrl}/transactions`)
    url.searchParams.set('account', acct.toRawString())
    if (startUtime > 0) url.searchParams.set('start_utime', String(startUtime))
    url.searchParams.set('sort', 'asc')
    url.searchParams.set('limit', String(V3_PAGE_LIMIT))
    if (startLt != null) url.searchParams.set('start_lt', startLt.toString()) // exclusive
    const res = await ctx.rateLimitedFetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      throw new CCIPHttpError(res.status, `TON v3 transactions query failed: ${await res.text()}`)
    }
    const { transactions } = (await res.json()) as { transactions?: TonV3Transaction[] }
    const txs = transactions ?? []
    yield* txs
    if (txs.length < V3_PAGE_LIMIT) return
    // v3 `start_lt` is INCLUSIVE (verified live): +1 so the boundary tx isn't repeated.
    startLt = BigInt(txs[txs.length - 1]!.lt) + 1n
  }
}

/** Fetches the v3 index's masterchain tip seqno (`/masterchainInfo`), for the lag guard. */
export async function fetchV3IndexedTip(
  ctx: Pick<TonV3Context, 'rateLimitedFetch'> & { v3BaseUrl: string },
): Promise<number> {
  const res = await ctx.rateLimitedFetch(`${ctx.v3BaseUrl}/masterchainInfo`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new CCIPHttpError(res.status, `TON v3 masterchainInfo failed: ${await res.text()}`)
  }
  const seqno = ((await res.json()) as { last?: { seqno?: unknown } }).last?.seqno
  if (typeof seqno !== 'number' || !Number.isFinite(seqno)) {
    throw new CCIPHttpError(0, 'TON v3 masterchainInfo: missing last seqno')
  }
  return seqno
}

/**
 * Open the TonCenter v3 fast path for a startTime-only cold backfill or a
 * `since`-hinted scan whose hint carries a per-log `index`, or return null (no v3 API
 * at this endpoint, or it errors/lags — the caller then falls back to the v2 walk).
 * The probe (first messages page + indexed tip) doubles as the lag check; once it
 * succeeds the stream is committed: later irregularities only truncate it gracefully
 * (see {@link TonV3Event}), they never fall back mid-stream.
 *
 * Instead of walking the account's whole transaction chain from the tip with
 * rate-limited v2 pages, the index answers "this account's log messages since T"
 * directly from its (source, created_lt) index and stamps each transaction with the
 * index-authoritative `mc_block_seqno` — sparing both the pagination over
 * event-less transactions and a `committingSeqno` resolution per block. Only the
 * event-carrying transactions are then hydrated from v2, because the index drops
 * external addresses, so the event topic (the external dest's uint32) exists only in
 * the raw transaction.
 *
 * `startLt` seeds the message stream strictly after an account message lt (a
 * `since` hint's `index`, which IS its log's created_lt): the index is
 * message-granular, so flooring there ALWAYS includes the hinted tx's own later
 * messages (same-tx logs) and same-block logs, and the hinted log itself is never
 * re-fetched. `start_lt` is INCLUSIVE (verified live), so the seed is the hint's
 * created_lt + 1. Page turns after the seed are driven by created_at (the index's
 * native order) — never by created_lt, which can regress across rows.
 *
 * The scan is clamped to the index's INGESTED tip: blocks past it are not in the
 * index yet, so emitting up to the requested cutoff would silently under-deliver.
 * When the clamp cuts the scan short, the stream ends with a `truncated` marker
 * (see {@link TonV3Event}) instead of pretending the window was complete.
 *
 * @internal
 */
export async function openV3EventStream(
  opts: LeanNumbers<Omit<LogFilter, 'topics'>>,
  ctx: TonV3Context,
  cutoff: number,
  /** Resume strictly after this account message lt (a hint's `index`). */
  startLt?: bigint,
): Promise<AsyncGenerator<TonV3Event, void, undefined> | null> {
  const { v3BaseUrl } = ctx
  if (!v3BaseUrl) return null // fast path explicitly disabled by the caller
  const ctxV3 = { ...ctx, v3BaseUrl }
  const acct = Address.parse(opts.address!)
  const limit = Math.min(Number(opts.page) || V3_PAGE_LIMIT, V3_PAGE_LIMIT)
  const startUtime = Math.max(0, Math.floor(Number(opts.startTime ?? 0)))
  let firstPage: TonV3Message[]
  let indexedTip: number
  try {
    // Serialized (never concurrent): firing both at once would self-trip the public
    // index's 1-burst keyless quota and 429 the probe. Messages page first — it is the
    // load-bearing call; the tip is cached chain-side (~30s), so a steady-state probe
    // costs exactly ONE index call.
    firstPage = await fetchV3Messages(ctxV3, {
      source: acct.toRawString(),
      startUtime,
      ...(startLt != null ? { startLt } : {}),
      limit,
    })
    indexedTip = await ctx.getIndexedTip()
    if (indexedTip < cutoff - V3_MAX_INDEX_LAG) {
      // Far-behind index: the v2 walk talks to the liteserver and is complete, so
      // fall back to it instead of serving a sliver of the requested window.
      throw new CCIPHttpError(
        0,
        `TON v3 index lagging: tip ${indexedTip} vs requested cutoff ${cutoff}`,
      )
    }
  } catch (err) {
    ctx.logger?.debug('TON getLogs: v3 fast path unavailable, falling back to v2 walk:', err)
    return null
  }
  // Within tolerance, CLAMP the scan to what the index has actually ingested:
  // blocks (indexedTip, cutoff] aren't in the index yet, and emitting up to the
  // requested cutoff would silently skip them (the lag threshold alone can't see
  // a shortfall inside it). `clamped` surfaces the shortfall at stream end so the
  // consumer re-polls instead of trusting the scan as complete.
  const clamped = indexedTip < cutoff
  return generateV3Events(ctxV3, acct, firstPage, {
    startUtime,
    limit,
    ...(startLt != null ? { startLt } : {}),
    clamped,
  })
}

async function* generateV3Events(
  ctx: TonV3Context & { v3BaseUrl: string },
  acct: Address,
  firstPage: TonV3Message[],
  q: { startUtime: number; limit: number; startLt?: bigint; clamped: boolean },
): AsyncGenerator<TonV3Event, void, undefined> {
  // The index orders /messages rows by created_at, NOT by created_lt — lts can
  // regress across rows of the same second (parallel shards). Page turns therefore
  // use a TIME cursor, each page is re-sorted by created_lt so same-second rows
  // arrive block-ordered, and the `seen` set dedupes rows repeated across a
  // same-second page boundary. The page COMMENT above the loop documents the
  // column of truth.
  const seen = new Set<string>()
  // Unique rows seen per second (pages arrive created_at-ordered, so rows of a
  // second already seen form a prefix of its query order — the boundary-second
  // drain below skips exactly that prefix by offset).
  const seenRows = new Set<string>()
  const rowsBySecond = new Map<number, number>()
  const rowsSeenAt = (utime: number) => rowsBySecond.get(utime) ?? 0
  // Lazy lt-ordered meta oracle over the account's txs (one index page per ~100 txs).
  // Rows are joined BY TX HASH, so the oracle never outruns a lookup: entries are
  // NOT pruned — a later-arriving row can reference an EARLIER tx (out-of-order
  // created_at vs created_lt), whose meta must still be here. The map is bounded
  // by the window's tx count (a few thousand entries at most).
  const metaStream = streamV3TxMeta(ctx, acct, q.startUtime)
  const metaByHash = new Map<string, TonV3Transaction>()
  let metaDone = false
  const metaLookup = async (hash: string): Promise<TonV3Transaction | undefined> => {
    for (;;) {
      const hit = metaByHash.get(hash)
      if (hit) return hit
      if (metaDone) return undefined
      const next = await metaStream.next()
      if (next.done) {
        metaDone = true
        return undefined
      }
      metaByHash.set(next.value.hash, next.value)
    }
  }
  // Ends the stream: `clamped` means the index's ingested tip sat below the
  // requested cutoff, so the tail may still be arriving — the consumer must not
  // treat the scan as complete (it re-polls; see emitSealedV3Events).
  const end = function* (): Generator<TonV3Event, void, undefined> {
    if (q.clamped) yield { truncated: true }
  }
  let page = firstPage
  for (;;) {
    // The index sorts rows by created_at; restore lt/block order within the page.
    page.sort((a, b) => Number(BigInt(a.created_lt) - BigInt(b.created_lt)))
    for (const msg of page) {
      if (!seenRows.has(msg.hash)) {
        seenRows.add(msg.hash)
        const sec = Number(msg.created_at)
        rowsBySecond.set(sec, (rowsBySecond.get(sec) ?? 0) + 1)
      }
      const txHash = msg.out_msg_tx_hash
      if (!txHash) {
        // An external-out row without its producing tx's hash is an index
        // inconsistency — the event can't be placed or verified, and dropping it
        // would silently lose a log. Truncate loudly instead; the caller re-polls.
        ctx.logger?.warn('TON v3 event stream truncated: a log message carries no tx hash')
        yield { truncated: true }
        return
      }
      if (seen.has(txHash)) continue
      seen.add(txHash)
      let meta: TonV3Transaction | undefined, raw: Transaction | null | undefined
      try {
        meta = await metaLookup(txHash)
        raw = meta ? await ctx.provider.getTransaction(acct, meta.lt, txHash) : undefined
      } catch (err) {
        ctx.logger?.warn(`TON v3 event stream truncated (tx ${txHash}):`, err)
        yield { truncated: true }
        return
      }
      if (!meta || !raw) {
        // The index (or the liteserver behind it) hasn't caught up with its own
        // message stream — treat like a chain gap: stop, the poller retries.
        ctx.logger?.warn(
          `TON v3 event stream truncated: tx ${txHash} missing from ${!meta ? 'index' : 'liteserver'}`,
        )
        yield { truncated: true }
        return
      }
      // Decode errors propagate (deterministic — failing loudly beats stalling silently).
      yield { tx: await ctx.getTransaction(raw, meta.mc_block_seqno) }
    }
    if (page.length < q.limit) {
      // Natural end of the index's message list for this account.
      yield* end()
      return
    }
    // Page full: turn by TIME (start_utime is an inclusive floor) with NO lt
    // floor, so rows of the boundary second keep ANY created_lt — a created_lt
    // cursor here would silently skip rows whose lt sits below a later page's
    // boundary. Rows of the boundary second repeat across the turn and are deduped
    // by `seen`. Turn from the page's NEWEST second (max created_at — after the lt
    // re-sort above, the last row needn't hold it): the time cursor then never
    // regresses into earlier seconds, which would burn extra calls of the index's
    // scarce keyless quota on re-covered rows (and could masquerade as overflow).
    const turnUtime = Math.max(q.startUtime, ...page.map((m) => Number(m.created_at)))
    let next: TonV3Message[]
    const turn = async (startUtime: number, offset?: number): Promise<TonV3Message[]> =>
      fetchV3Messages(ctx, {
        source: acct.toRawString(),
        startUtime,
        limit: q.limit,
        ...(offset ? { offset } : {}),
      })
    // A hash-less row always counts as fresh: it must reach the loop above, which
    // truncates on it (an index inconsistency), rather than being advanced past.
    const fresh = (rows: TonV3Message[]) =>
      rows.some((m) => !m.out_msg_tx_hash || !seen.has(m.out_msg_tx_hash))
    try {
      next = await turn(turnUtime)
      if (!fresh(next) && next.length >= q.limit) {
        // A FULL page of only repeats: the boundary second may hold more rows than
        // one page — the index pages by size within the same second. Its seen rows
        // are a prefix of the query's (deterministic) order, so skip exactly past
        // them by offset to drain any remainder rather than cutting it silently.
        next = await turn(turnUtime, rowsSeenAt(turnUtime))
      }
      if (!fresh(next)) next = await turn(turnUtime + 1) // boundary second drained → advance
    } catch (err) {
      ctx.logger?.warn('TON v3 event stream truncated (page turn):', err)
      yield { truncated: true }
      return
    }
    // Both the boundary second and the next one returned nothing new: the index has
    // no further rows for this account (its ingested tip was reached).
    if (!fresh(next)) {
      yield* end()
      return
    }
    page = next
  }
}
