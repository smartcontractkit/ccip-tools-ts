import { Address } from '@ton/core'
import type { TonClient4 } from '@ton/ton'

import type { LogFilter } from '../chain.ts'
import {
  CCIPLogsWatchRequiresFinalityError,
  CCIPLogsWatchRequiresStartError,
} from '../errors/index.ts'
import { CCIPArgumentInvalidError } from '../errors/specialized.ts'
import type { Log_ } from '../types.ts'
import { bytesToBuffer, sleep } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5000

/** Decoder functions passed to fetchLogs to identify and parse TON log events avoiding circular imports */
export interface LogDecoders {
  /** Try to decode as CCIP message, returns messageId if successful */
  tryDecodeAsMessage: (log: Pick<Log_, 'data'>) => { messageId: string } | undefined
  /** Try to decode as commit report, returns truthy if successful */
  tryDecodeAsCommit: (log: Pick<Log_, 'data'>) => unknown[] | undefined
  /** Try to decode as execution receipt, returns truthy if successful */
  tryDecodeAsReceipt: (log: Pick<Log_, 'data'>) => { messageId: string } | undefined
}

/**
 * Fetches logs from a TON address by iterating through account transactions.
 *
 * Note: For TON, `startBlock` and `endBlock` in opts represent logical time (lt),
 * not block sequence numbers. This is because TON transaction APIs are indexed by lt.
 * The lt is monotonically increasing per account and suitable for ordering.
 *
 * Supports watch mode: if opts.watch is set and forward mode is used (startBlock/startTime),
 * the generator will poll for new logs after catching up to the latest transaction.
 * When opts.watch is a Promise, resolving it will cancel the watch loop.
 * When opts.watch is `true`, the loop runs indefinitely until the consumer breaks.
 *
 * @param provider - TonClient4 instance
 * @param opts - Log filter options (startBlock/endBlock are lt values)
 * @param ltTimestampCache - Cache mapping lt to Unix timestamp
 * @param decoders - Message decoder functions
 */
export async function* fetchLogs(
  provider: TonClient4,
  opts: LogFilter & { pollInterval?: number },
  ltTimestampCache: Map<number, number>,
  decoders: LogDecoders,
): AsyncIterableIterator<Log_> {
  if (!opts.address) {
    throw new CCIPArgumentInvalidError('address', 'Address is required for TON log filtering')
  }

  const address = Address.parse(opts.address)
  const searchForward = !!(opts.startBlock || opts.startTime)

  // Validate watch mode constraints
  if (opts.watch) {
    if (!searchForward) {
      throw new CCIPLogsWatchRequiresStartError()
    }
    if (typeof opts.endBlock === 'number' && opts.endBlock > 0) {
      throw new CCIPLogsWatchRequiresFinalityError(opts.endBlock)
    }
  }

  // Get the latest block for account state lookup
  const lastBlock = await provider.getLastBlock()
  const account = await provider.getAccountLite(lastBlock.last.seqno, address)

  if (!account.account.last) {
    if (opts.watch) {
      yield* pollForNewLogs(provider, address, opts, ltTimestampCache, decoders, undefined)
    }
    return
  }

  const latestLt = BigInt(account.account.last.lt)
  const latestHash = bytesToBuffer(account.account.last.hash)

  // Define stop condition based on startBlock/startTime
  const stopCondition = (lt: number, timestamp: number): boolean => {
    if (opts.startBlock && typeof opts.startBlock === 'number' && lt < opts.startBlock) {
      return true
    }
    if (opts.startTime && timestamp < opts.startTime) {
      return true
    }
    return false
  }

  // Collect historical logs
  const { logs } = await collectLogsFromTransactions(
    provider,
    address,
    latestLt,
    latestHash,
    stopCondition,
    ltTimestampCache,
    opts,
    decoders,
  )

  // Yield logs in appropriate order
  if (searchForward) {
    // Forward mode: yield oldest first
    for (const log of logs.reverse()) {
      yield log
    }
  } else {
    // Backward mode: yield newest first
    for (const log of logs) {
      yield log
    }
  }

  // Watch mode: poll for new logs
  if (opts.watch) {
    yield* pollForNewLogs(provider, address, opts, ltTimestampCache, decoders, latestLt)
  }
}

/**
 * Polls for new logs in watch mode.
 * Continuously fetches new transactions until cancelled.
 *
 * When opts.watch is a Promise, resolving it will cancel the loop.
 * When opts.watch is `true`, loops indefinitely until the consumer breaks.
 */
async function* pollForNewLogs(
  provider: TonClient4,
  address: ReturnType<typeof Address.parse>,
  opts: LogFilter & { pollInterval?: number },
  ltTimestampCache: Map<number, number>,
  decoders: LogDecoders,
  lastSeenLt: bigint | undefined,
): AsyncIterableIterator<Log_> {
  const pollInterval = opts.pollInterval ?? DEFAULT_POLL_INTERVAL
  let cancelled = false

  // Set up cancellation listener once, not on every iteration
  if (opts.watch instanceof Promise) {
    void opts.watch.then(() => {
      cancelled = true
    })
  }

  while (!cancelled) {
    // Race sleep against cancellation promise to allow early exit
    if (opts.watch instanceof Promise) {
      await Promise.race([sleep(pollInterval), opts.watch])
    } else {
      await sleep(pollInterval)
    }
    if (cancelled) break

    const lastBlock = await provider.getLastBlock()
    if (cancelled) break

    const account = await provider.getAccountLite(lastBlock.last.seqno, address)
    if (cancelled) break

    if (!account.account.last) continue

    const currentLt = BigInt(account.account.last.lt)
    if (lastSeenLt !== undefined && currentLt <= lastSeenLt) continue

    // Stop condition: stop when we reach previously seen transactions
    const stopCondition = (lt: number, _timestamp: number): boolean => {
      return lastSeenLt !== undefined && BigInt(lt) <= lastSeenLt
    }

    const { logs } = await collectLogsFromTransactions(
      provider,
      address,
      currentLt,
      bytesToBuffer(account.account.last.hash),
      stopCondition,
      ltTimestampCache,
      { topics: opts.topics },
      decoders,
    )

    // Yield new logs in forward order (oldest first)
    for (const log of logs.reverse()) {
      yield log
    }

    lastSeenLt = currentLt
  }
}

/**
 * Iterates through account transactions and extracts logs.
 * Stops when stopCondition returns true, page limit is reached, or no more transactions.
 *
 * @returns Array of logs (in reverse chronological order - newest first)
 */
async function collectLogsFromTransactions(
  provider: TonClient4,
  address: ReturnType<typeof Address.parse>,
  startLt: bigint,
  startHash: Buffer,
  stopCondition: (lt: number, timestamp: number) => boolean,
  ltTimestampCache: Map<number, number>,
  opts: Pick<LogFilter, 'topics' | 'endBlock' | 'page'>,
  decoders: LogDecoders,
): Promise<{ logs: Log_[]; reachedStop: boolean }> {
  const logs: Log_[] = []
  let cursorLt = startLt
  let cursorHash = startHash
  let isFirstBatch = true
  let reachedStop = false
  const pageLimit = opts.page

  while (!reachedStop) {
    const txs = await provider.getAccountTransactions(address, cursorLt, cursorHash)
    if (!txs || txs.length === 0) break

    const startIdx = isFirstBatch ? 0 : 1
    isFirstBatch = false

    for (let i = startIdx; i < txs.length; i++) {
      const { tx } = txs[i]
      const txLt = Number(tx.lt)
      const compositeHash = `${address.toRawString()}:${tx.lt}:${tx.hash().toString('hex')}`

      // Cache lt -> timestamp
      ltTimestampCache.set(txLt, tx.now)

      // Check stop condition
      if (stopCondition(txLt, tx.now)) {
        reachedStop = true
        break
      }

      // Skip if after end boundary
      if (opts.endBlock && typeof opts.endBlock === 'number' && txLt > opts.endBlock) {
        continue
      }

      // Extract logs from external-out messages
      let msgIndex = 0
      for (const msg of tx.outMessages.values()) {
        if (msg.info.type !== 'external-out') {
          msgIndex++
          continue
        }

        const data = msg.body.toBoc().toString('base64')
        const log = tryDecodeLog(
          address,
          txLt,
          compositeHash,
          msgIndex,
          data,
          opts.topics,
          decoders,
        )
        if (log) {
          logs.push(log)

          // Check page limit
          if (pageLimit && logs.length >= pageLimit) {
            reachedStop = true
            break
          }
        }
        msgIndex++
      }

      if (reachedStop) break
    }

    // Update pagination cursor for next batch
    if (txs.length < 2) break
    const lastTx = txs[txs.length - 1].tx
    cursorLt = lastTx.lt
    cursorHash = bytesToBuffer(lastTx.hash())

    // Check stop condition on cursor for early exit
    const lastTs = ltTimestampCache.get(Number(cursorLt))
    if (lastTs !== undefined && stopCondition(Number(cursorLt), lastTs)) {
      reachedStop = true
    }
  }

  return { logs, reachedStop }
}

/**
 * Helper to decode a log from message data and filter by topic.
 */
function tryDecodeLog(
  address: ReturnType<typeof Address.parse>,
  txLt: number,
  compositeHash: string,
  index: number,
  data: string,
  topicsFilter: LogFilter['topics'],
  decoders: LogDecoders,
): Log_ | undefined {
  const topicFilter = topicsFilter?.[0]
  const topics: string[] = []

  if (topicFilter === 'CommitReportAccepted') {
    if (!decoders.tryDecodeAsCommit({ data })) return undefined
    topics.push('CommitReportAccepted')
  } else if (topicFilter === 'ExecutionStateChanged') {
    if (!decoders.tryDecodeAsReceipt({ data })) return undefined
    topics.push('ExecutionStateChanged')
  } else {
    const message = decoders.tryDecodeAsMessage({ data })
    if (topicFilter && !message) return undefined
    if (message) topics.push('CCIPMessageSent')
  }

  return {
    address: address.toRawString(),
    topics,
    data,
    blockNumber: txLt,
    transactionHash: compositeHash,
    index,
  }
}
