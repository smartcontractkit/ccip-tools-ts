import assert from 'node:assert/strict'

import { Address } from '@ton/core'

import { createRateLimitedFetch } from '../fetch.ts'
import type { ChainLog, Logger } from '../types.ts'
import { tonRateLimitProfile } from './utils.ts'
import type { TONChain } from './index.ts'

/**
 * Fixture discovery for the live ton-testnet suites. Not a suite itself: the
 * `.test.ts` name only keeps it out of the published build (like the CLI's
 * `e2e-helpers.test.ts`).
 *
 * ton-testnet lanes are quiet and irregular: a lane can go days without a send or an
 * execution while its OffRamp still emits a pair of price-commit logs every few
 * minutes. A suite that looks for "a log in the last N hours" is therefore a bet on
 * recent traffic, and a suite that anchors on "the newest log of the account" lands
 * on commit noise.
 *
 * The fixtures here are instead anchored on a KNOWN log of the wanted kind, found
 * newest-first in ONE TonCenter v3 index call whatever its age (the index serves an
 * account's log messages in either order). The scans under test then run over a
 * small window PINNED around that log — the same rows on every run until the lane
 * moves again — so there is nothing to wait for and nothing to retry.
 *
 * LIMIT. The index finds a log of any age, but READING it takes the v2 endpoint (the
 * index drops a log's topic), and the public ton-testnet v2 endpoint serves a
 * transaction for about two days: measured 2026-11, every read fine up to 48h, about
 * half failing with `LITE_SERVER_UNKNOWN ... lt not in db` from 60h, all of them
 * after a week (`archival: true` is refused outright). A fixture older than that
 * cannot be read by any scan, whatever the SDK does.
 */

/** One log (external-out) message row of the TonCenter v3 index. */
export type TonLogRow = {
  /** Unix seconds of the emitting transaction. */
  createdAt: number
  /** The log's `index` in the SDK (unique per account message). */
  createdLt: bigint
  /** Hash (base64) of the emitting transaction. */
  txHash: string
}

export type TonIndex = { fetch: typeof fetch; v3Base: string }

/**
 * A v3 index fetch that waits out throttling. The public index's keyless quota is
 * per egress IP and CI runners share theirs, so a 429 says nothing about the request:
 * retrying THAT request (paced, with backoff — the limiter state is shared per origin
 * with every other TON fetch of the process) is the efficient answer. The SDK's own
 * default is fail-fast instead (a poller would rather fall back to the v2 walk than
 * stall), which is the wrong trade for a suite asserting on which path served a scan.
 */
export function patientIndexFetch(v3Base: string, logger?: Logger): typeof fetch {
  return createRateLimitedFetch(tonRateLimitProfile(v3Base, { maxRetries: 6 }), { logger })
}

async function v3Get<T>(
  { fetch: fetchV3, v3Base }: TonIndex,
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const base = new URL(v3Base)
  const url = new URL(`${base.pathname.replace(/\/+$/, '')}/${path}`, base)
  // The base may carry its own query (toncenter's `?api_key=`).
  for (const [key, value] of base.searchParams) url.searchParams.append(key, value)
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, value)
  const res = await fetchV3(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) assert.fail(`TON v3 index ${path} answered HTTP ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

/**
 * The index's `opcode` filter matches the first 32 bits of a message body. CCIP event
 * bodies carry no opcode, so those bits are the head of the event's first field —
 * which is a constant for the two events below, per source chain.
 */
export const bodyPrefix = {
  /** `ExecutionStateChanged` starts with the uint64 `sourceChainSelector`. */
  executionFrom: (sourceChainSelector: bigint) =>
    `0x${(sourceChainSelector >> 32n).toString(16).padStart(8, '0')}`,
  /** A `CommitReportAccepted` WITH a merkle root starts with the presence bit (1),
   * then the root's uint64 `sourceChainSelector`. Price-only reports start with 0. */
  rootedCommitFrom: (sourceChainSelector: bigint) =>
    `0x${((1n << 31n) | (sourceChainSelector >> 33n)).toString(16).padStart(8, '0')}`,
}

/**
 * The newest log rows of `address`, newest first: one index call, independent of how
 * old they are and of how much unrelated traffic the account has.
 */
export async function newestLogRows(
  index: TonIndex,
  address: string,
  opts: {
    /** Only rows whose body starts with these 32 bits (see {@link bodyPrefix}). */
    opcode?: string
    /** Only rows created at or before this unix time. */
    notAfter?: number
    limit?: number
  } = {},
): Promise<TonLogRow[]> {
  const { messages } = await v3Get<{
    messages?: { created_at: string; created_lt: string; out_msg_tx_hash?: string | null }[]
  }>(index, 'messages', {
    source: Address.parse(address).toRawString(),
    destination: 'null', // external-out ("log") messages only
    direction: 'out',
    sort: 'desc',
    limit: String(opts.limit ?? 10),
    opcode: opts.opcode,
    end_utime: opts.notAfter?.toString(),
  })
  return (messages ?? []).flatMap((m) =>
    m.out_msg_tx_hash
      ? [
          {
            createdAt: Number(m.created_at),
            createdLt: BigInt(m.created_lt),
            txHash: m.out_msg_tx_hash,
          },
        ]
      : [],
  )
}

/** Masterchain block (seqno) that committed transaction `txHash` of `address`. */
export async function txBlock(index: TonIndex, address: string, txHash: string): Promise<number> {
  const { transactions } = await v3Get<{ transactions?: { mc_block_seqno: number }[] }>(
    index,
    'transactions',
    { account: Address.parse(address).toRawString(), hash: txHash, limit: '1' },
  )
  const seqno = transactions?.[0]?.mc_block_seqno
  assert.ok(seqno, `the index lists log tx ${txHash} of ${address} but not its block`)
  return seqno
}

/**
 * The newest log of `topic` on `address` that `accept` takes, read through the SDK's
 * own scan over the one-block window that holds it.
 *
 * @returns the log, what `accept` made of it, and the pinned window
 *   (`startTime`..`endBlock`) that contains it.
 */
export async function newestLog<T>(
  chain: TONChain,
  index: TonIndex,
  q: {
    address: string
    topic: string
    opcode?: string
    /** Only logs created at or before this unix time. */
    notAfter?: number
    /** Newest rows inspected before giving up. */
    rows?: number
    accept: (log: ChainLog) => T | undefined
  },
): Promise<{ log: ChainLog; value: T; startTime: number; endBlock: number }> {
  const rows = await newestLogRows(index, q.address, {
    opcode: q.opcode,
    notAfter: q.notAfter,
    limit: q.rows ?? 20,
  })
  const tried = new Set<string>()
  for (const row of rows) {
    if (tried.has(row.txHash)) continue
    tried.add(row.txHash)
    const window = {
      startTime: row.createdAt,
      endBlock: await txBlock(index, q.address, row.txHash),
    }
    for await (const log of chain.getLogs({ address: q.address, topics: [q.topic], ...window })) {
      const value = q.accept(log)
      if (value !== undefined) return { log, value, ...window }
    }
  }
  assert.fail(
    `no ${q.topic} log accepted among the ${rows.length} newest log rows of ${q.address}` +
      (q.opcode ? ` with body prefix ${q.opcode}` : ''),
  )
}
