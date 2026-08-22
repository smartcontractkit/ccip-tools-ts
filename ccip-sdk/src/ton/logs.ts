import { Address } from '@ton/core'
import type { TonClient, Transaction } from '@ton/ton'

import type { LogFilter } from '../chain.ts'
import {
  CCIPHttpError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import { CCIPLogsAddressRequiredError } from '../errors/specialized.ts'
import { NetworkType } from '../networks.ts'
import type { ChainTransaction, LeanNumbers, Logger } from '../types.ts'
import { signalToPromise } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5000

async function* fetchTxsForward(
  opts: LeanNumbers<Omit<LogFilter, 'topics' | 'startBlock' | 'startTime'>> & {
    sinceLt: bigint
    pollInterval?: number
  },
  { provider }: { provider: TonClient },
) {
  const limit = Math.min(Number(opts.page) || 99, 99)
  // Exclusive resume cursor: only txs with lt > sinceLt stream. `to_lt` is exclusive
  // server-side (verified against toncenter v2), so the boundary tx is never even
  // fetched; the tail truncation below is only a defensive duplicate of that.
  const { sinceLt } = opts

  // forward collect all matching txs in array
  const allTxs = [] as Transaction[]
  let batch: typeof allTxs,
    until: bigint = sinceLt
  do {
    batch = await provider.getTransactions(Address.parse(opts.address!), {
      limit,
      ...(!!allTxs.length && {
        lt: allTxs[allTxs.length - 1]!.lt.toString(),
        hash: allTxs[allTxs.length - 1]!.hash().toString('base64'),
      }),
      to_lt: sinceLt.toString(),
    })

    while (batch.length > 0 && batch[batch.length - 1]!.lt <= sinceLt) {
      batch.length-- // truncate tail of txs at/older than the exclusive cursor
    }

    allTxs.push(...batch) // concat in descending order
  } while (batch.length >= limit)

  allTxs.reverse() // forward

  const notAfter =
    (typeof opts.endBlock !== 'number' && typeof opts.endBlock !== 'bigint') ||
    Number(opts.endBlock) < 0
      ? undefined
      : BigInt(opts.endBlock)
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
    yield tx
  }
  allTxs.length = 0 // gc

  if (headLt != null) until = headLt
  // if not watch mode, returns
  while (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) {
    const lastReq = performance.now()
    batch = await provider.getTransactions(Address.parse(opts.address!), {
      limit,
      to_lt: until.toString(),
    })

    batch.reverse() // forward

    for (const tx of batch) {
      until = tx.lt
      yield tx
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
 * Internal method to get transactions for an address with pagination.
 *
 * Takes the start position as a resolved, exclusive account-lt cursor (`sinceLt`):
 * only transactions with `lt > sinceLt` stream. Callers resolve `startBlock`/
 * `startTime`/`since` hints into lt space beforehand (see TONChain.getLogs).
 *
 * @param opts - Log filter options plus the required `sinceLt` cursor.
 * @returns Async generator of TON transactions.
 */
export async function* streamTransactionsForAddress(
  opts: LeanNumbers<Omit<LogFilter, 'topics' | 'startBlock' | 'startTime'>> & {
    /** Exclusive account-lt cursor to resume from: only txs with `lt > sinceLt` stream. */
    sinceLt: bigint
    pollInterval?: number
  },
  ctx: {
    provider: TonClient
    getTransaction: (tx: Transaction) => Promise<ChainTransaction>
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
  for await (const tx of allTransactions) {
    yield await ctx.getTransaction(tx)
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
 */
const V3_MAX_INDEX_LAG = 300

/** Subset of a TonCenter v3 `/messages` entry the fast path relies on. */
type TonV3Message = {
  hash: string
  source: string | null
  destination: string | null
  created_lt: string
  created_at: string
  out_msg_tx_hash?: string | null
}

/** Subset of a TonCenter v3 `/transactions` entry the fast path relies on. */
type TonV3Transaction = {
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
  rateLimitedFetch: typeof fetch
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
  q: { source: string; startUtime: number; startLt?: bigint; limit: number },
): Promise<TonV3Message[]> {
  const url = new URL(`${ctx.v3BaseUrl}/messages`)
  url.searchParams.set('source', q.source)
  url.searchParams.set('destination', 'null') // external-out ("log") messages only
  url.searchParams.set('direction', 'out')
  if (q.startUtime > 0) url.searchParams.set('start_utime', String(q.startUtime))
  if (q.startLt != null) url.searchParams.set('start_lt', q.startLt.toString())
  url.searchParams.set('sort', 'asc') // ascending by created_lt
  url.searchParams.set('limit', String(q.limit))
  const res = await ctx.rateLimitedFetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new CCIPHttpError(res.status, `TON v3 messages query failed: ${await res.text()}`)
  }
  const { messages } = (await res.json()) as { messages?: TonV3Message[] }
  return messages ?? []
}

async function fetchV3TransactionByHash(
  ctx: TonV3Context & { v3BaseUrl: string },
  hash: string,
): Promise<TonV3Transaction | undefined> {
  const url = new URL(`${ctx.v3BaseUrl}/transactions`)
  url.searchParams.set('hash', hash)
  const res = await ctx.rateLimitedFetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new CCIPHttpError(res.status, `TON v3 transaction query failed: ${await res.text()}`)
  }
  const { transactions } = (await res.json()) as { transactions?: TonV3Transaction[] }
  return transactions?.[0]
}

async function fetchV3IndexedTip(ctx: TonV3Context & { v3BaseUrl: string }): Promise<number> {
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
 * Open the TonCenter v3 fast path for a startTime-only getLogs scan, or return null
 * (no v3 API at this endpoint, or it errors/lags — the caller then falls back to the
 * v2 walk). The probe (first messages page + indexed tip) doubles as the lag check;
 * once it succeeds the stream is committed: later irregularities only truncate it
 * gracefully (see {@link TonV3Event}), they never fall back mid-stream.
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
 * @internal
 */
export async function openV3EventStream(
  opts: LeanNumbers<Omit<LogFilter, 'topics'>>,
  ctx: TonV3Context,
  cutoff: number,
): Promise<AsyncGenerator<TonV3Event, void, undefined> | null> {
  const { v3BaseUrl } = ctx
  if (!v3BaseUrl) return null // fast path explicitly disabled by the caller
  const ctxV3 = { ...ctx, v3BaseUrl }
  const acct = Address.parse(opts.address!)
  const limit = Math.min(Number(opts.page) || V3_PAGE_LIMIT, V3_PAGE_LIMIT)
  const startUtime = Math.max(0, Math.floor(Number(opts.startTime ?? 0)))
  let firstPage: TonV3Message[]
  try {
    const [page, indexedTip] = await Promise.all([
      fetchV3Messages(ctxV3, { source: acct.toRawString(), startUtime, limit }),
      fetchV3IndexedTip(ctxV3),
    ])
    if (indexedTip < cutoff - V3_MAX_INDEX_LAG) {
      throw new CCIPHttpError(
        0,
        `TON v3 index lagging: tip ${indexedTip} vs requested cutoff ${cutoff}`,
      )
    }
    firstPage = page
  } catch (err) {
    ctx.logger?.debug('TON getLogs: v3 fast path unavailable, falling back to v2 walk:', err)
    return null
  }
  return generateV3Events(ctxV3, acct, firstPage, { startUtime, limit })
}

async function* generateV3Events(
  ctx: TonV3Context & { v3BaseUrl: string },
  acct: Address,
  firstPage: TonV3Message[],
  q: { startUtime: number; limit: number },
): AsyncGenerator<TonV3Event, void, undefined> {
  // Pages are ascending by created_lt (unique per account message), so a tx's first
  // message marks its position and the created_lt cursor is a safe page boundary.
  const seen = new Set<string>()
  let page = firstPage
  for (;;) {
    for (const msg of page) {
      const txHash = msg.out_msg_tx_hash
      if (!txHash || seen.has(txHash)) continue
      seen.add(txHash)
      let meta: TonV3Transaction | undefined, raw: Transaction | null | undefined
      try {
        meta = await fetchV3TransactionByHash(ctx, txHash)
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
    if (page.length < q.limit) return
    const nextLt = BigInt(page[page.length - 1]!.created_lt) + 1n
    try {
      page = await fetchV3Messages(ctx, {
        source: acct.toRawString(),
        startUtime: q.startUtime,
        startLt: nextLt,
        limit: q.limit,
      })
    } catch (err) {
      ctx.logger?.warn('TON v3 event stream truncated (page turn):', err)
      yield { truncated: true }
      return
    }
  }
}
