import { type Connection, PublicKey } from '@solana/web3.js'

import type { LogFilter } from '../chain.ts'
import type { SolanaTransaction } from './index.ts'
import {
  CCIPLogsAddressRequiredError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import { sleep } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5e3

async function* fetchSigsForward(
  opts: LogFilter & { pollInterval?: number },
  ctx: { connection: Connection },
) {
  const { connection } = ctx
  const limit = Math.min(opts.page || 1000, 1000)
  const commitment = opts.endBlock === 'finalized' ? 'finalized' : 'confirmed'

  // forward collect all matching sigs in array
  const allSigs = [] as Awaited<ReturnType<typeof connection.getSignaturesForAddress>>
  let batch: typeof allSigs, until: string | undefined
  do {
    batch = await connection.getSignaturesForAddress(
      new PublicKey(opts.address!),
      { limit, before: allSigs[allSigs.length - 1]?.signature ?? opts.endBefore },
      commitment,
    )
    until ??= batch[0]?.signature

    while (
      batch.length > 0 &&
      (batch[batch.length - 1]!.slot < (opts.startBlock ?? 0) ||
        (batch[batch.length - 1]!.blockTime ?? -1) < (opts.startTime ?? 0))
    ) {
      batch.length-- // truncate tail of txs which are older than requested start
    }

    allSigs.push(...batch) // concat in descending order
    // special case: if startBlock=0, do a single pass
  } while (batch.length >= limit && (opts.startBlock || opts.startTime))

  allSigs.reverse() // forward

  const notAfter =
    typeof opts.endBlock !== 'number'
      ? undefined
      : opts.endBlock < 0
        ? (await connection.getSlot('confirmed')) + opts.endBlock
        : opts.endBlock
  while (notAfter != null && allSigs.length > 0 && allSigs[allSigs.length - 1]!.slot > notAfter) {
    allSigs.length-- // truncate head (after reverse) of txs newer than requested end
  }
  yield* allSigs // all past logs

  if (allSigs.length) until = allSigs[allSigs.length - 1]!.signature
  let lastReq = performance.now()
  // if not watch mode, returns
  while (opts.watch) {
    let break$ = sleep(
      Math.max((opts.pollInterval || DEFAULT_POLL_INTERVAL) - (performance.now() - lastReq), 1),
    ).then(() => false)
    if (opts.watch instanceof Promise) break$ = Promise.race([break$, opts.watch.then(() => true)])
    if (await break$) break

    lastReq = performance.now()
    batch = await connection.getSignaturesForAddress(
      new PublicKey(opts.address!),
      { limit, until },
      commitment,
    )

    batch.reverse() // forward

    const notAfter =
      batch.length === 0 || typeof opts.endBlock !== 'number'
        ? undefined
        : opts.endBlock < 0
          ? (await connection.getSlot('confirmed')) + opts.endBlock
          : opts.endBlock

    for (const sig of batch) {
      if (notAfter != null && sig.slot > notAfter) break
      until = sig.signature
      yield sig
    }
  }
}

/**
 * Internal method to get transactions for an address with pagination.
 * @param opts - Log filter options.
 * @returns Async generator of Solana transactions.
 */
export async function* getTransactionsForAddress(
  opts: Omit<LogFilter, 'topics'> & { pollInterval?: number },
  ctx: {
    connection: Connection
    getTransaction: (signature: string) => Promise<SolanaTransaction>
  },
): AsyncGenerator<SolanaTransaction> {
  if (!opts.address) throw new CCIPLogsAddressRequiredError()

  opts.endBlock ??= 'latest'

  const hasStart = opts.startBlock != null || opts.startTime != null
  if (!hasStart) throw new CCIPLogsRequiresStartError()
  if (opts.watch && ((typeof opts.endBlock === 'number' && opts.endBlock > 0) || opts.endBefore))
    throw new CCIPLogsWatchRequiresFinalityError(opts.endBlock)

  const allSignatures = fetchSigsForward(opts, ctx)

  // Process signatures
  for await (const signatureInfo of allSignatures) {
    yield await ctx.getTransaction(signatureInfo.signature)
  }
}
