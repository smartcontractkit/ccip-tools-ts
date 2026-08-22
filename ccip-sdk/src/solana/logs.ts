import { type Connection, PublicKey } from '@solana/web3.js'

import { type LogFilter, withSinceStart } from '../chain.ts'
import type { LeanNumbers } from '../types.ts'
import type { SolanaTransaction } from './index.ts'
import {
  CCIPLogsAddressRequiredError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import { signalToPromise } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5e3

async function* fetchSigsForward(
  opts: LeanNumbers<LogFilter> & { pollInterval?: number },
  ctx: { connection: Connection },
) {
  const { connection } = ctx
  const limit = Math.min(Number(opts.page) || 1000, 1000)
  const commitment = opts.endBlock === 'finalized' ? 'finalized' : 'confirmed'
  const addrKey = new PublicKey(opts.address!)

  // Resume hint: the signature doubles as Solana's native `until` cursor (exclusive —
  // the hinted sig itself is not re-emitted). But `until` only has an effect when the
  // queried node actually knows the signature, so the hint's blockNumber is ALSO an
  // absolute slot floor: a lagging or pruning node silently matches nothing, and the
  // floor is what then keeps sigs older than the hint from being included.
  const startFloor = Math.max(
    Number(opts.startBlock ?? 0) || 0,
    Number(opts.since?.blockNumber ?? 0) || 0,
  )

  // forward collect all matching sigs in array
  const allSigs: Awaited<ReturnType<typeof connection.getSignaturesForAddress>> = []
  let batch: typeof allSigs,
    until = opts.since?.transactionHash ? opts.since.transactionHash : undefined
  do {
    batch = await connection.getSignaturesForAddress(
      addrKey,
      { before: allSigs[allSigs.length - 1]?.signature ?? opts.endBefore, until, limit },
      commitment,
    )
    // Newest sig seen, captured even when the whole batch is about to be truncated
    // away below: it becomes the watch-mode resume cursor when the scan collects
    // nothing — an empty allSigs must not restart polling from the unbounded head.
    until ??= batch[0]?.signature

    while (
      batch.length > 0 &&
      (batch[batch.length - 1]!.slot < startFloor ||
        (batch[batch.length - 1]!.blockTime ?? -1) < Number(opts.startTime ?? 0))
    ) {
      batch.length-- // truncate tail of txs which are older than requested start
    }

    allSigs.push(...batch) // concat in descending order
    // special case: with no start floor (startBlock=0 and no hint), do a single pass
  } while (batch.length >= limit && (startFloor || opts.startTime))

  until = allSigs[0]?.signature || until
  allSigs.reverse() // forward

  const notAfter =
    (typeof opts.endBlock !== 'number' && typeof opts.endBlock !== 'bigint') || !opts.endBlock
      ? undefined
      : Number(opts.endBlock) < 0
        ? (await connection.getSlot('confirmed')) + Number(opts.endBlock)
        : Number(opts.endBlock)
  while (notAfter != null && allSigs.length > 0 && allSigs[allSigs.length - 1]!.slot > notAfter) {
    allSigs.length-- // truncate head (after reverse) of txs newer than requested end
  }
  yield* allSigs // all past logs

  until = allSigs[allSigs.length - 1]?.signature || until
  // if not watch mode, returns
  while (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) {
    const lastReq = performance.now()
    batch = await connection.getSignaturesForAddress(addrKey, { limit, until }, commitment)

    batch.reverse() // forward

    const notAfter =
      batch.length === 0 || (typeof opts.endBlock !== 'number' && typeof opts.endBlock !== 'bigint')
        ? undefined
        : Number(opts.endBlock) < 0
          ? (await connection.getSlot('confirmed')) + Number(opts.endBlock)
          : Number(opts.endBlock)

    for (const sig of batch) {
      if (notAfter != null && sig.slot > notAfter) break
      until = sig.signature
      // The start floor is absolute: a poll whose `until` the node doesn't know
      // returns the newest page — never emit sigs older than requested from it.
      if (sig.slot < startFloor || (sig.blockTime ?? -1) < Number(opts.startTime ?? 0)) continue
      yield sig
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
 * @param opts - Log filter options.
 * @returns Async generator of Solana transactions.
 */
export async function* getTransactionsForAddress(
  opts: LeanNumbers<Omit<LogFilter, 'topics'>> & {
    /** interval to poll for new signatures in watch mode */
    pollInterval?: number
    /** signatures including these addresses are skipped from yield on first pass */
    excludeAddresses?: string[]
  },
  ctx: {
    connection: Connection
    getTransaction: (signature: string) => Promise<SolanaTransaction>
  },
): AsyncGenerator<SolanaTransaction> {
  if (!opts.address) throw new CCIPLogsAddressRequiredError()

  opts.endBlock ??= 'latest'

  // `since.blockNumber`/`blockTimestamp` stand in for (or raise) startBlock/startTime.
  // No address gating here, unlike other chains: a log's address is the EMITTING
  // program, not the queried account, so hints from cross-program streams are valid.
  opts = withSinceStart(opts)

  const hasStart = opts.startBlock != null || opts.startTime != null
  if (!hasStart) throw new CCIPLogsRequiresStartError()
  if (
    opts.watch &&
    (((typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
      Number(opts.endBlock) > 0) ||
      opts.endBefore)
  )
    throw new CCIPLogsWatchRequiresFinalityError(
      typeof opts.endBlock === 'bigint' ? Number(opts.endBlock) : opts.endBlock,
    )

  const allSignatures = fetchSigsForward(opts, ctx)
  const excludeSet = new Set<string>()
  for (const addr of opts.excludeAddresses ?? []) {
    // The resume hint tracks the primary address's stream; applying it to an
    // exclude-address walk would truncate that stream at a foreign signature.
    const { watch: _, since: _s, ...optsWithoutWatch } = opts
    for await (const { signature } of fetchSigsForward(
      { ...optsWithoutWatch, address: addr },
      ctx,
    )) {
      excludeSet.add(signature)
    }
  }

  // Process signatures
  for await (const signatureInfo of allSignatures) {
    if (excludeSet.has(signatureInfo.signature)) continue
    yield await ctx.getTransaction(signatureInfo.signature)
  }
}
