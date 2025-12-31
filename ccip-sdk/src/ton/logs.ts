import { Address } from '@ton/core'
import type { TonClient, Transaction } from '@ton/ton'

import type { LogFilter } from '../chain.ts'
import {
  CCIPLogsWatchRequiresFinalityError,
  CCIPLogsWatchRequiresStartError,
} from '../errors/index.ts'
import { CCIPLogsAddressRequiredError } from '../errors/specialized.ts'
import type { ChainTransaction } from '../types.ts'
import { sleep } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5000

async function* fetchTxsForward(
  opts: LogFilter & { pollInterval?: number },
  { provider }: { provider: TonClient },
) {
  const limit = Math.min(opts.page || 99, 99)

  // forward collect all matching txs in array
  const allTxs = [] as Transaction[]
  let batch: typeof allTxs, until: bigint | undefined
  do {
    batch = await provider.getTransactions(Address.parse(opts.address!), {
      limit,
      ...(!!allTxs.length && {
        lt: allTxs[allTxs.length - 1]!.lt.toString(),
        hash: allTxs[allTxs.length - 1]!.hash().toString('base64'),
        to_lt: opts.startBlock?.toString(),
      }),
    })
    until ??= batch[0]?.lt

    while (batch.length > 0 && batch[batch.length - 1]!.now < (opts.startTime || 0)) {
      batch.length-- // truncate tail of txs which are older than requested start
    }

    allTxs.push(...batch) // concat in descending order
  } while (batch.length >= limit)

  allTxs.reverse() // forward

  const notAfter =
    typeof opts.endBlock !== 'number' || opts.endBlock < 0 ? undefined : BigInt(opts.endBlock)
  while (notAfter && allTxs.length > 0 && allTxs[allTxs.length - 1]!.lt > notAfter) {
    allTxs.length-- // truncate head (after reverse) of txs newer than requested end
  }
  yield* allTxs // all past logs

  if (allTxs.length) until = allTxs[allTxs.length - 1]!.lt
  let lastReq = performance.now()
  // if not watch mode, returns
  while (opts.watch) {
    let break$ = sleep(
      Math.max((opts.pollInterval || DEFAULT_POLL_INTERVAL) - (performance.now() - lastReq), 1),
    ).then(() => false)
    if (opts.watch instanceof Promise) break$ = Promise.race([break$, opts.watch.then(() => true)])
    if (await break$) break

    lastReq = performance.now()
    batch = await provider.getTransactions(Address.parse(opts.address!), {
      limit,
      to_lt: until?.toString(),
    })

    batch.reverse() // forward

    for (const tx of batch) {
      until = tx.lt
      yield tx
    }
  }
}

async function* fetchTxsBackwards(
  opts: LogFilter & { pollInterval?: number },
  { provider }: { provider: TonClient },
) {
  const limit = Math.min(opts.page || 100, 100)

  if (typeof opts.endBlock === 'number' && opts.endBlock < 0) opts.endBlock = 'latest'

  let batch: Transaction[] | undefined
  do {
    batch = await provider.getTransactions(Address.parse(opts.address!), {
      limit,
      ...(batch?.length
        ? {
            lt: batch[batch.length - 1]!.lt.toString(),
            hash: batch[batch.length - 1]!.hash().toString('base64'),
          }
        : opts.endBefore && opts.endBlock
          ? { lt: opts.endBlock.toString(), hash: opts.endBefore }
          : {}),
    })
    for (const tx of batch) {
      if (typeof opts.endBlock === 'number' && tx.lt > BigInt(opts.endBlock)) continue
      yield tx
    }
  } while (batch.length >= limit)
}

/**
 * Internal method to get transactions for an address with pagination.
 * @param opts - Log filter options.
 * @returns Async generator of Solana transactions.
 */
export async function* streamTransactionsForAddress(
  opts: Omit<LogFilter, 'topics'> & { pollInterval?: number },
  ctx: {
    provider: TonClient
    getTransaction: (tx: Transaction) => Promise<ChainTransaction>
  },
): AsyncGenerator<ChainTransaction> {
  if (!opts.address) throw new CCIPLogsAddressRequiredError()

  opts.endBlock ||= 'latest'

  let allTransactions
  if (opts.startBlock != null || opts.startTime != null) {
    if (opts.watch && ((typeof opts.endBlock === 'number' && opts.endBlock > 0) || opts.endBefore))
      throw new CCIPLogsWatchRequiresFinalityError(opts.endBlock)

    allTransactions = fetchTxsForward(opts, ctx)
  } else {
    if (opts.watch) throw new CCIPLogsWatchRequiresStartError()

    allTransactions = fetchTxsBackwards(opts, ctx) // generate backwards until depleting getSignaturesForAddress
  }

  // Process signatures
  for await (const tx of allTransactions) {
    yield await ctx.getTransaction(tx)
  }
}
