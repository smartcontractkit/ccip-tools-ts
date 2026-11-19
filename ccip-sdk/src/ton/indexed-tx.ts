import { Address, Cell } from '@ton/core'

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
 * — which is where a TON log keeps its topic. This module rebuilds such a transaction
 * from the index and names its logs by their exact body layout instead.
 *
 * That is only sound where the layouts are known: the CCIP ramps whose versions are
 * listed by the caller (see TONChain). Every body is parsed in full (all bits and
 * refs consumed), and the layouts below never match one another, so a body maps to
 * one event or to none. Logs that match no layout are left out of the rebuilt
 * transaction: it holds the ramp's CCIP events, not every external-out message.
 * Callers only fall back here after v2 failed with {@link isRetentionError}.
 */

/** The CCIP ramp kinds whose event layouts {@link topicOfEventBody} knows. */
export type TonRampKind = 'OnRamp' | 'OffRamp'

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

const TOPIC_CCIP_MESSAGE_SENT = crc32('CCIPMessageSent')
export const TOPIC_EXECUTION_STATE_CHANGED = crc32('ExecutionStateChanged')
export const TOPIC_COMMIT_REPORT_ACCEPTED = crc32('CommitReportAccepted')
const TOPIC_OCR3_TRANSMITTED = crc32('OCR3Base_Transmitted')

/**
 * The topic of a ramp's log body, by its exact layout (chainlink-ton
 * `onramp/events.tolk`, `offramp/events.tolk`, `lib/ocr/multi_ocr3_base.tolk`):
 * - OnRamp `CCIPMessageSent { RampMessageHeader (512 bits), sender: address,
 *   body: ^Cell, feeValueJuels: uint96 }` — 875 bits and 1 ref;
 * - OffRamp `ExecutionStateChanged { uint64, uint64, uint256, state: uint8 }` —
 *   392 bits, a state of 1 to 3;
 * - OffRamp `OCR3Base_Transmitted { ocrPluginType: uint16, uint256, uint64 }` —
 *   336 bits, plugin type 0 (commit) or 1 (execute);
 * - OffRamp `CommitReportAccepted { MerkleRoot?, ^PriceUpdates? }` — variable;
 *   parsed in full.
 * @returns the topic, or undefined when the body matches no layout.
 */
export function topicOfEventBody(kind: TonRampKind, body: Cell): string | undefined {
  try {
    const slice = body.beginParse()
    if (kind === 'OnRamp') {
      if (body.bits.length !== 875 || body.refs.length !== 1) return
      slice.skip(512)
      slice.loadAddress() // the sender: throws unless an internal address
      return TOPIC_CCIP_MESSAGE_SENT
    }
    if (body.refs.length === 0 && body.bits.length === 392) {
      slice.skip(384)
      const state = slice.loadUint(8)
      return state >= 1 && state <= 3 ? TOPIC_EXECUTION_STATE_CHANGED : undefined
    }
    if (body.refs.length === 0 && body.bits.length === 336)
      return slice.loadUint(16) <= 1 ? TOPIC_OCR3_TRANSMITTED : undefined
    // CommitReportAccepted: `MerkleRoot?` inline, then `Cell<PriceUpdates>?`.
    if (slice.loadBit()) {
      slice.skip(64) // sourceChainSelector
      const onRampLength = slice.loadUint(8)
      if (onRampLength === 0 || onRampLength > 32) return
      slice.skip(8 * onRampLength + 64 + 64 + 256) // onRamp, minSeqNr, maxSeqNr, merkleRoot
    }
    if (slice.loadBit()) slice.loadRef()
    return slice.remainingBits === 0 && slice.remainingRefs === 0
      ? TOPIC_COMMIT_REPORT_ACCEPTED
      : undefined
  } catch {
    return // shorter than the layout
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
type TonV3TransactionWithMessages = {
  account: string
  hash: string
  lt: string
  now: number
  mc_block_seqno: number
  prev_trans_lt: string
  out_msgs?: {
    source: string | null
    destination: string | null
    created_lt: string
    message_content?: { body?: string | null } | null
  }[]
}

/**
 * A ramp transaction rebuilt from the index (see the module comment): the same
 * {@link ChainTransaction} shape TONChain builds from a v2 read — composite hash,
 * the index's masterchain block, the logs as base64 BOCs indexed by their message lt
 * — holding only the logs whose topic {@link topicOfEventBody} names.
 *
 * @param txHash - The transaction hash, as hex.
 * @returns the transaction, or undefined when the index does not have it.
 */
export async function fetchIndexedTransaction(
  ctx: Pick<TonV3Context, 'rateLimitedFetch'> & { v3BaseUrl: string },
  account: Address,
  txHash: string,
  kind: TonRampKind,
): Promise<ChainTransaction | undefined> {
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
  const tx = transactions?.[0]
  if (!tx) return
  const from = Address.parse(tx.account).toRawString()
  const hash = `${from}:${tx.lt}:${Buffer.from(tx.hash, 'base64').toString('hex')}`
  const res_: ChainTransaction & { lt: string; prevTransactionLt: string } = {
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
    if (msg.destination != null || !msg.source || !msg.message_content?.body) continue
    if (Address.parse(msg.source).toRawString() !== from) continue
    const body = Cell.fromBase64(msg.message_content.body)
    const topic = topicOfEventBody(kind, body)
    if (!topic) continue
    logs.push({
      address: from,
      topics: [topic],
      data: body.toBoc().toString('base64'),
      blockNumber: res_.blockNumber,
      blockTimestamp: tx.now,
      transactionHash: hash,
      index: Number(msg.created_lt),
      tx: res_,
    })
  }
  res_.logs = logs.sort((a, b) => a.index - b.index)
  return res_
}
