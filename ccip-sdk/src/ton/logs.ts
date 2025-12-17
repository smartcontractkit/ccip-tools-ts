import { Address } from '@ton/core'
import type { TonClient4 } from '@ton/ton'

import type { LogFilter } from '../chain.ts'
import { CCIPArgumentInvalidError } from '../errors/specialized.ts'
import type { Log_ } from '../types.ts'

/** Decoder functions passed to fetchLogs to identify and parse TON log events avoiding circular imports */
export interface LogDecoders {
  /** Try to decode as CCIP message, returns messageId if successful */
  tryDecodeAsMessage: (log: Pick<Log_, 'data'>) => { messageId: string } | undefined
  /** Try to decode as commit report, returns truthy if successful */
  tryDecodeAsCommit: (log: Pick<Log_, 'data'>) => unknown[] | undefined
}

/**
 * Fetches logs from a TON address by iterating through account transactions.
 *
 * Note: For TON, `startBlock` and `endBlock` in opts represent logical time (lt),
 * not block sequence numbers. This is because TON transaction APIs are indexed by lt.
 * The lt is monotonically increasing per account and suitable for ordering.
 *
 * @param provider - TonClient4 instance
 * @param opts - Log filter options (startBlock/endBlock are lt values)
 * @param ltTimestampCache - Cache mapping lt to Unix timestamp
 * @param decoders - Message decoder functions
 */
export async function* fetchLogs(
  provider: TonClient4,
  opts: LogFilter,
  ltTimestampCache: Map<number, number>,
  decoders: LogDecoders,
): AsyncIterableIterator<Log_> {
  if (!opts.address) {
    throw new CCIPArgumentInvalidError('address', 'Address is required for TON log filtering')
  }

  const address = Address.parse(opts.address)
  const searchForward = !!(opts.startBlock || opts.startTime)

  // Get the latest block for account state lookup
  const lastBlock = await provider.getLastBlock()

  // Get account state to find the last transaction
  const account = await provider.getAccountLite(lastBlock.last.seqno, address)
  if (!account.account.last) {
    return // No transactions
  }

  // Pagination cursor
  let cursorLt: bigint = BigInt(account.account.last.lt)
  let cursorHash: Buffer = Buffer.from(account.account.last.hash, 'base64')

  const collectedLogs: Log_[] = []
  let isFirstBatch = true

  while (true) {
    const txs = await provider.getAccountTransactions(address, cursorLt, cursorHash)
    if (!txs || txs.length === 0) break

    // Skip first tx when paginating (it's the same as last from previous batch)
    const startIdx = isFirstBatch ? 0 : 1
    isFirstBatch = false

    for (let i = startIdx; i < txs.length; i++) {
      const { tx } = txs[i]
      const txLt = Number(tx.lt)
      const timestamp = tx.now

      // Cache lt → timestamp
      ltTimestampCache.set(txLt, timestamp)

      // Range filters
      if (opts.startBlock && typeof opts.startBlock === 'number' && txLt < opts.startBlock) {
        if (searchForward) yield* collectedLogs.reverse()
        return
      }
      if (opts.startTime && timestamp < opts.startTime) {
        if (searchForward) yield* collectedLogs.reverse()
        return
      }
      if (opts.endBlock && typeof opts.endBlock === 'number' && txLt > opts.endBlock) {
        continue
      }

      // Extract logs from external-out messages
      const compositeHash = `${address.toRawString()}:${tx.lt}:${tx.hash().toString('hex')}`
      let index = 0

      for (const msg of tx.outMessages.values()) {
        if (msg.info.type !== 'external-out') {
          index++
          continue
        }

        const data = msg.body.toBoc().toString('base64')
        const topicFilter = opts.topics?.[0]

        // Try to identify log type and build topics array
        const topics: string[] = []

        if (topicFilter === 'CommitReportAccepted') {
          // Looking for commits - skip if not a valid commit
          if (!decoders.tryDecodeAsCommit({ data })) {
            index++
            continue
          }
          topics.push('CommitReportAccepted')
        } else {
          // Try to decode as CCIP message
          const message = decoders.tryDecodeAsMessage({ data })
          if (topicFilter && !message) {
            // Topic filter set but couldn't decode as message - skip
            index++
            continue
          }
          if (message) {
            topics.push('CCIPMessageSent')
          }
        }

        const log: Log_ = {
          address: address.toRawString(),
          topics,
          data,
          blockNumber: txLt,
          transactionHash: compositeHash,
          index,
        }

        if (searchForward) {
          collectedLogs.push(log)
        } else {
          yield log
        }
        index++
      }
    }

    // Update pagination cursor
    if (txs.length < 2) break
    const lastTx = txs[txs.length - 1].tx
    cursorLt = lastTx.lt
    cursorHash = Buffer.from(lastTx.hash())

    // Early exit if past start boundary
    if (
      opts.startBlock &&
      typeof opts.startBlock === 'number' &&
      Number(cursorLt) < opts.startBlock
    )
      break
    if (opts.startTime && lastTx.now < opts.startTime) break
  }

  if (searchForward) yield* collectedLogs.reverse()
}
