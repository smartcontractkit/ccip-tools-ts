import { Address } from '@ton/core'
import type { TonClient4 } from '@ton/ton'

import type { LogFilter } from '../chain.ts'
import { CCIPArgumentInvalidError, CCIPTransactionNotFoundError } from '../errors/specialized.ts'
import type { Log_, WithLogger } from '../types.ts'

/**
 * Looks up a transaction by raw hash using the TonCenter V3 API.
 *
 * This is necessary because TON's V4 API requires (address, lt, hash) for lookups,
 * but users typically only have the raw transaction hash from explorers.
 * TonCenter V3 provides an index that allows hash-only lookups.
 *
 * @param hash - Raw 64-char hex transaction hash
 * @param isTestnet - Whether to use testnet API
 * @param rateLimitedFetch - Rate-limited fetch function
 * @param logger - Logger instance
 * @returns Transaction identifier components needed for V4 API lookup
 */
export async function lookupTxByRawHash(
  hash: string,
  isTestnet: boolean,
  rateLimitedFetch: typeof fetch,
  logger: WithLogger['logger'],
): Promise<{
  account: string
  lt: string
  hash: string
}> {
  const baseUrl = isTestnet
    ? 'https://testnet.toncenter.com/api/v3/transactions'
    : 'https://toncenter.com/api/v3/transactions'

  // TonCenter V3 accepts hex directly
  const cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash

  const url = `${baseUrl}?hash=${cleanHash}`
  logger?.debug?.(`TonCenter V3 lookup: ${url}`)

  let response: Response
  try {
    response = await rateLimitedFetch(url, {
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    logger?.error?.(`TonCenter V3 fetch failed:`, error)
    throw new CCIPTransactionNotFoundError(hash, { cause: error as Error })
  }

  let data: { transactions?: Array<{ account: string; lt: string; hash: string }> }
  try {
    data = (await response.json()) as typeof data
  } catch (error) {
    logger?.error?.(`TonCenter V3 JSON parse failed:`, error)
    throw new CCIPTransactionNotFoundError(hash, { cause: error as Error })
  }

  logger?.debug?.(`TonCenter V3 response:`, data)

  if (!data.transactions || data.transactions.length === 0) {
    logger?.debug?.(`TonCenter V3: no transactions found for hash ${cleanHash}`)
    throw new CCIPTransactionNotFoundError(hash)
  }

  return data.transactions[0]
}

/** Decoder functions passed to fetchLogs to avoid circular imports */
export interface LogDecoders {
  decodeMessage: (log: Pick<Log_, 'data'>) => { messageId: string } | undefined
  decodeCommits: (log: Log_) => unknown[] | undefined
}

/**
 * Fetches logs from a TON address by iterating through account transactions.
 *
 * @param provider - TonClient4 instance
 * @param opts - Log filter options
 * @param timestampCache - Cache for block timestamps
 * @param decoders - Message decoder functions
 */
export async function* fetchLogs(
  provider: TonClient4,
  opts: LogFilter,
  timestampCache: Map<number, number>,
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

  let lt: bigint = BigInt(account.account.last.lt)
  let hash: Buffer = Buffer.from(account.account.last.hash, 'base64')

  const collectedLogs: Log_[] = []

  // Helper to yield collected logs in reverse order (for forward search)
  function* yieldCollected() {
    for (let j = collectedLogs.length - 1; j >= 0; j--) {
      yield collectedLogs[j]
    }
  }

  while (true) {
    const txs = await provider.getAccountTransactions(address, lt, hash)

    if (!txs || txs.length === 0) break

    // Skip the first transaction when paginating (it's the same as last from previous batch)
    const startIdx = collectedLogs.length > 0 || !searchForward ? 1 : 0

    for (let i = startIdx; i < txs.length; i++) {
      const { tx } = txs[i]
      const blockNumber = Number(tx.lt)
      const timestamp = tx.now

      // Cache timestamp for getBlockTimestamp lookups
      timestampCache.set(blockNumber, timestamp)

      // Filter by block/time range
      if (opts.startBlock && typeof opts.startBlock === 'number' && blockNumber < opts.startBlock) {
        if (searchForward) yield* yieldCollected()
        return
      }

      if (opts.startTime && timestamp < opts.startTime) {
        if (searchForward) yield* yieldCollected()
        return
      }

      if (opts.endBlock && typeof opts.endBlock === 'number' && blockNumber > opts.endBlock) {
        continue
      }

      // Extract logs from outgoing external messages
      const outMessages = tx.outMessages.values()
      let index = 0
      for (const msg of outMessages) {
        if (msg.info.type === 'external-out') {
          const data = msg.body.toBoc().toString('base64')
          const topicFilter = opts.topics?.[0]

          // Only decode what we need based on filter
          if (topicFilter === 'CommitReportAccepted') {
            if (!decoders.decodeCommits({ data } as Log_)) {
              index++
              continue
            }
          } else if (topicFilter) {
            if (!decoders.decodeMessage({ data })) {
              index++
              continue
            }
          }

          const decoded = decoders.decodeMessage({ data })
          const compositeHash = `${address.toRawString()}:${tx.lt}:${tx.hash().toString('hex')}`

          const log: Log_ = {
            address: address.toRawString(),
            topics: decoded ? [decoded.messageId] : [],
            data,
            blockNumber,
            transactionHash: compositeHash,
            index,
          }

          if (searchForward) {
            collectedLogs.push(log)
          } else {
            yield log
          }
        }
        index++
      }
    }

    // Set up pagination for next batch
    if (txs.length < 2) break
    const lastTx = txs[txs.length - 1].tx
    lt = lastTx.lt
    hash = Buffer.from(lastTx.hash())

    if (
      opts.startBlock &&
      typeof opts.startBlock === 'number' &&
      Number(lastTx.lt) < opts.startBlock
    )
      break
    if (opts.startTime && lastTx.now < opts.startTime) break
  }

  if (searchForward) yield* yieldCollected()
}
