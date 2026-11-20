import { type Message, Address, Cell, ExternalAddress, beginCell, storeMessage } from '@ton/core'

import { CCIPError, CCIPHttpError } from '../errors/index.ts'
import type { ChainLog, ChainTransaction } from '../types.ts'
import { sleep } from '../utils.ts'
import { type TonV3Context, type TonV3Message, fetchV3Messages, v3Url } from './logs.ts'
import { crc32 } from './utils.ts'

/**
 * Index fallback for transactions the v2 endpoint no longer serves.
 *
 * The SDK reads TON transactions over the v2 API: a thin proxy to the liteservers,
 * with no indexer in between. A liteserver keeps blocks only for a while (the public
 * ton-testnet endpoint: about two days), and an older read fails with
 * `LITE_SERVER_UNKNOWN ... lt not in db`. The TonCenter v3 index keeps every
 * transaction with its messages, but it drops an external-out message's destination
 * — which is where a TON log keeps its topic (chainlink-ton `emit()`: an
 * `ExtOutLogBucket`, the topic as a 256-bit external address).
 *
 * The index keeps each message's hash, though: the hash of the whole message cell,
 * destination included. This module rebuilds the cell for each known topic and keeps
 * the one whose hash matches ({@link verifiedLogTopic}). A topic found so is proven,
 * not inferred from the body. A log whose topic is not in {@link KNOWN_LOG_TOPICS} is
 * kept with no topic. Callers fall back here only when v2 cannot serve the read (see
 * `v2CannotServe` in utils.ts).
 */

/** Waits between index reads the index throttled: the fallback has no other source. */
const INDEX_RETRY_DELAYS_MS = [1_500, 3_000, 6_000]

/**
 * Runs an index read, waiting out throttling (a transient {@link CCIPError}). The
 * chain's index fetch gives up early on purpose, because the scan it serves prefers a
 * quick fall back to v2; the index fallback has no further source, so it waits.
 */
export async function withIndexRetries<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read()
    } catch (err) {
      const delay = INDEX_RETRY_DELAYS_MS[attempt]
      if (delay == null || !(err instanceof CCIPError && err.isTransient)) throw err
      await sleep(delay)
    }
  }
}

export const TOPIC_EXECUTION_STATE_CHANGED = crc32('ExecutionStateChanged')
export const TOPIC_COMMIT_REPORT_ACCEPTED = crc32('CommitReportAccepted')

/**
 * The topics of the events chainlink-ton contracts emit (`"Name".crc32()`), the
 * frequent CCIP ones first: {@link verifiedLogTopic} tries them in this order.
 */
export const KNOWN_LOG_TOPICS: readonly string[] = [
  'OCR3Base_Transmitted',
  'CommitReportAccepted',
  'ExecutionStateChanged',
  'CCIPMessageSent',
  'UsdPerTokenUpdated',
  'UsdPerUnitGasUpdated',
  'TokenPool_LockedOrBurned',
  'TokenPool_ReleasedOrMinted',
  'TokenPool_InboundRateLimitConsumed',
  'TokenPool_OutboundRateLimitConsumed',
  'TokenPool_FastFinalityInboundRateLimitConsumed',
  'TokenPool_FastFinalityOutboundRateLimitConsumed',
  'TokenPool_InboundRateLimitRefunded',
  'TokenPool_OutboundRateLimitRefunded',
  'TokenPool_FastFinalityInboundRateLimitRefunded',
  'TokenPool_FastFinalityOutboundRateLimitRefunded',
  'JettonLockBox_Deposit',
  'JettonLockBox_Withdrawal',
  'MessageToOffRampBounced',
  'ReceiveExecutorInitExecuteBounced',
  'RouteMessageBounced',
  'DeployableInitializeBounced',
  'OCR3Base_ConfigSet',
  'ConfigSet',
  'DynamicConfigSet',
  'SourceChainConfigUpdated',
  'SourceChainSelectorAdded',
  'DestChainConfigUpdated',
  'DestChainSelectorAdded',
  'OffRampAdded',
  'OffRampRemoved',
  'OnRampSet',
  'Cursed',
  'Uncursed',
  'TokenPool_ChainAdded',
  'TokenPool_ChainRemoved',
  'TokenPool_DynamicConfigSet',
  'TokenPool_FinalityConfigSet',
  'TokenPool_RampAccessUpdated',
  'TokenPool_RateLimitConfigured',
  'TokenPool_RemotePoolAdded',
  'TokenPool_RemotePoolRemoved',
  'TokenPool_TokenTransferFeeConfigDeleted',
  'TokenPool_TokenTransferFeeConfigUpdated',
  'MCMS_BounceHandled',
  'Timelock_BounceHandled',
  'Timelock_BypasserCallExecuted',
  'Timelock_CallExecuted',
  'Timelock_CallScheduled',
].map(crc32)

/** The fields of an index message row (`/messages`, or a `/transactions` row's
 * `out_msgs`) that {@link verifiedLogTopic} reads. */
export type TonV3LogMessage = {
  hash: string
  source: string | null
  created_lt: string
  created_at: string | number
  message_content?: { body?: string | null } | null
}

/**
 * The topic of a log message from the index, proven by its hash: the external-out
 * message cell rebuilt with that topic (a 256-bit external destination, as
 * chainlink-ton emits it) hashes to the row's `hash`. The body may be stored inline or
 * as a ref, so both forms are tried.
 *
 * @param candidates - The topics to try, in order (default: {@link KNOWN_LOG_TOPICS});
 *   a caller that expects one topic passes only that one.
 * @returns the topic, or undefined when no candidate matches (or the row has no body).
 */
export function verifiedLogTopic(
  msg: TonV3LogMessage,
  candidates: readonly string[] = KNOWN_LOG_TOPICS,
): string | undefined {
  if (!msg.source || !msg.message_content?.body) return
  const body = Cell.fromBase64(msg.message_content.body)
  const src = Address.parse(msg.source)
  const createdLt = BigInt(msg.created_lt)
  const createdAt = Number(msg.created_at)
  const want = Buffer.from(msg.hash, 'base64')
  for (const topic of candidates) {
    const message: Message = {
      info: {
        type: 'external-out',
        src,
        dest: new ExternalAddress(BigInt(topic), 256),
        createdLt,
        createdAt,
      },
      body,
    }
    const inline = beginCell().store(storeMessage(message)).endCell()
    if (inline.hash().equals(want)) return topic
    // storeMessage puts a body that fits inline; the contract may still use a ref.
    const asRef = beginCell()
      .store(storeMessage(message, { forceRef: true }))
      .endCell()
    if (!asRef.equals(inline) && asRef.hash().equals(want)) return topic
  }
}

/**
 * The first 32 bits of an OffRamp log body, which the index stores per message as
 * `opcode` and filters on. A CCIP event body has no opcode of its own, so these are the
 * head of its first field — a constant per source chain for the two events below.
 */
export const offRampBodyPrefix = {
  /** `ExecutionStateChanged` starts with the uint64 `sourceChainSelector`. */
  execution: (sourceChainSelector: bigint) =>
    `0x${(sourceChainSelector >> 32n).toString(16).padStart(8, '0')}`,
  /** A `CommitReportAccepted` with a merkle root starts with its presence bit (1), then
   * the root's uint64 `sourceChainSelector`. */
  rootedCommit: (sourceChainSelector: bigint) =>
    `0x${((1n << 31n) | (sourceChainSelector >> 33n)).toString(16).padStart(8, '0')}`,
}

/**
 * The account's log rows whose body starts with `opcode`, from `startUtime` on, read
 * from the index in chain order. Pages turn by time, as the getLogs fast path does
 * (the index orders rows by `created_at`): rows of a boundary second repeat across a
 * turn and are skipped, and a second holding more rows than a page is drained by
 * offset before the time cursor moves on. Throttled reads are waited out
 * ({@link withIndexRetries}).
 */
export async function* indexRowsByPrefix(
  ctx: Pick<TonV3Context, 'rateLimitedFetch'> & { v3BaseUrl: string },
  account: Address,
  opcode: string,
  startUtime: number,
): AsyncGenerator<TonV3Message, void, undefined> {
  const limit = 100
  const seen = new Set<string>()
  /** Distinct rows seen per second: rows of a second come in the query's order, so
   * those seen form a prefix the offset read skips. */
  const perSecond = new Map<number, number>()
  const read = (from: number, offset?: number) =>
    withIndexRetries(() =>
      fetchV3Messages(ctx, {
        source: account.toRawString(),
        startUtime: from,
        opcode,
        limit,
        ...(offset ? { offset } : {}),
      }),
    )
  const fresh = (rows: TonV3Message[]) => rows.some((row) => !seen.has(row.hash))
  let from = startUtime
  let page = await read(from)
  for (;;) {
    page.sort((a, b) => Number(BigInt(a.created_lt) - BigInt(b.created_lt)))
    for (const row of page) {
      if (seen.has(row.hash)) continue
      seen.add(row.hash)
      const second = Number(row.created_at)
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1)
      yield row
    }
    if (page.length < limit) return
    from = Math.max(from, ...page.map((row) => Number(row.created_at)))
    let next = await read(from)
    // A full page of repeats: the boundary second holds more than a page of rows.
    if (!fresh(next) && next.length >= limit) next = await read(from, perSecond.get(from))
    if (!fresh(next)) next = await read(++from) // the boundary second is drained
    if (!fresh(next)) return
    page = next
  }
}

/** Subset of a TonCenter v3 `/transactions` entry this module reads. */
export type TonV3TransactionWithMessages = {
  account: string
  hash: string
  lt: string
  now: number
  mc_block_seqno: number
  prev_trans_lt: string
  out_msgs?: (TonV3LogMessage & { destination: string | null })[]
}

/**
 * The index's row of the account's transaction `txHash`, with its out-messages.
 *
 * @param txHash - The transaction hash, as hex.
 * @returns the row, or undefined when the index does not have it.
 */
export async function fetchIndexedTransactionRow(
  ctx: Pick<TonV3Context, 'rateLimitedFetch'> & { v3BaseUrl: string },
  account: Address,
  txHash: string,
): Promise<TonV3TransactionWithMessages | undefined> {
  const url = v3Url(ctx.v3BaseUrl, '/transactions')
  url.searchParams.set('account', account.toRawString())
  url.searchParams.set('hash', txHash)
  url.searchParams.set('limit', '1')
  const { transactions } = await withIndexRetries(async () => {
    const res = await ctx.rateLimitedFetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok)
      throw new CCIPHttpError(res.status, `TON v3 transactions query failed: ${await res.text()}`)
    return (await res.json()) as { transactions?: TonV3TransactionWithMessages[] }
  })
  return transactions?.[0]
}

/**
 * A transaction rebuilt from its index row (see the module comment): the same
 * {@link ChainTransaction} shape TONChain builds from a v2 read — composite hash, the
 * index's masterchain block, every log of the account as a base64 BOC indexed by its
 * message lt. A log's topic is set when {@link verifiedLogTopic} proves it; a log with
 * an unknown topic has none.
 */
export function indexedTransactionFromRow(tx: TonV3TransactionWithMessages): ChainTransaction {
  const from = Address.parse(tx.account).toRawString()
  const hash = `${from}:${tx.lt}:${Buffer.from(tx.hash, 'base64').toString('hex')}`
  const res: ChainTransaction & { lt: string; prevTransactionLt: string } = {
    hash,
    logs: [],
    blockNumber: tx.mc_block_seqno,
    timestamp: tx.now,
    from,
    lt: tx.lt,
    prevTransactionLt: tx.prev_trans_lt,
  }
  const logs: ChainLog[] = []
  for (const msg of tx.out_msgs ?? []) {
    // External-out ("log") messages of this account: the index keeps no destination.
    if (msg.destination != null || !msg.source) continue
    if (Address.parse(msg.source).toRawString() !== from) continue
    const body = msg.message_content?.body
    const topic = verifiedLogTopic(msg)
    logs.push({
      address: from,
      topics: topic ? [topic] : [],
      data: body ? Cell.fromBase64(body).toBoc().toString('base64') : '',
      blockNumber: res.blockNumber,
      blockTimestamp: tx.now,
      transactionHash: hash,
      index: Number(msg.created_lt),
      tx: res,
    })
  }
  res.logs = logs.sort((a, b) => a.index - b.index)
  return res
}

/**
 * The account's transaction `txHash`, rebuilt from the index
 * ({@link indexedTransactionFromRow}).
 *
 * @param txHash - The transaction hash, as hex.
 * @returns the transaction, or undefined when the index does not have it.
 */
export async function fetchIndexedTransaction(
  ctx: Pick<TonV3Context, 'rateLimitedFetch'> & { v3BaseUrl: string },
  account: Address,
  txHash: string,
): Promise<ChainTransaction | undefined> {
  const row = await fetchIndexedTransactionRow(ctx, account, txHash)
  return row && indexedTransactionFromRow(row)
}
