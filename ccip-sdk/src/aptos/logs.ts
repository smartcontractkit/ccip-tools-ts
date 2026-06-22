import {
  type Aptos,
  type Event as AptosEvent,
  type UserTransactionResponse,
  TransactionResponseType,
  getAptosFullNode,
} from '@aptos-labs/ts-sdk'
import { memoize } from 'micro-memoize'

import type { LogFilter } from '../chain.ts'
import {
  CCIPAptosAddressModuleRequiredError,
  CCIPAptosTransactionTypeUnexpectedError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import type { ChainLog, LeanNumbers } from '../types.ts'
import { signalToPromise } from '../utils.ts'

const DEFAULT_POLL_INTERVAL = 5e3

const eventToHandler = {
  CCIPMessageSent: 'OnRampState/ccip_message_sent_events',
  CommitReportAccepted: 'OffRampState/commit_report_accepted_events',
  ExecutionStateChanged: 'OffRampState/execution_state_changed_events',
} as const

/**
 * Fetches a user transaction by its version number.
 * @param provider - Aptos provider instance.
 * @param version - Transaction version number.
 * @returns User transaction response.
 */
export async function getUserTxByVersion(
  provider: Aptos,
  version: number,
): Promise<UserTransactionResponse> {
  const tx = await provider.getTransactionByVersion({
    ledgerVersion: version,
  })
  if (tx.type !== TransactionResponseType.User)
    throw new CCIPAptosTransactionTypeUnexpectedError(tx.type)
  return tx
}

/**
 * Gets the timestamp for a given transaction version.
 * @param provider - Aptos provider instance.
 * @param version - Positive version number, negative block depth finality, or 'finalized'.
 * @returns Epoch timestamp in seconds.
 */
export async function getVersionTimestamp(
  provider: Aptos,
  version: number | 'finalized',
): Promise<number> {
  if (typeof version !== 'number') version = 0
  if (version <= 0) version = +(await provider.getLedgerInfo()).ledger_version + version
  const tx = await provider.getTransactionByVersion({ ledgerVersion: version })
  return +(tx as UserTransactionResponse).timestamp / 1e6
}

type ResEvent = AptosEvent & { version: string }

/**
 * Binary search to find the first element that does NOT satisfy a condition.
 * Assumes the first element satisfies the condition, and elements after it may or may not.
 * @param low - The starting index (inclusive, must satisfy condition)
 * @param high - The ending index (inclusive)
 * @param predicate - Function that returns true when condition is met
 * @returns The first index where predicate returns false, or high + 1 if all elements satisfy the condition
 */
async function binarySearchFirst(
  low: number,
  high: number,
  predicate: (index: number) => Promise<boolean>,
): Promise<number> {
  let result = high + 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (await predicate(mid)) {
      low = mid + 1
    } else {
      result = mid
      high = mid - 1
    }
  }
  return result
}

async function* fetchEventsForward(
  { provider }: { provider: Aptos },
  opts: LeanNumbers<LogFilter> & { pollInterval?: number },
  eventHandlerField: string,
  stateAddr: string,
  limit = 100,
): AsyncGenerator<ResEvent> {
  if (
    opts.watch &&
    (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
    Number(opts.endBlock) > 0
  )
    throw new CCIPLogsWatchRequiresFinalityError(Number(opts.endBlock))
  opts.endBlock ??= 'latest'

  const fetchBatch = memoize(
    async (start?: number) => {
      const { data }: { data: ResEvent[] } = await getAptosFullNode({
        aptosConfig: provider.config,
        originMethod: 'getEventsByEventHandle',
        path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
        params: { start, limit },
      })
      if (!start && data.length)
        fetchBatch.cache.set([+data[0]!.sequence_number], Promise.resolve(data))
      return data
    },
    { maxArgs: 1, maxSize: 100, async: true },
  )

  const initialBatch = await fetchBatch()
  if (!initialBatch.length) return
  const end = +initialBatch[initialBatch.length - 1]!.sequence_number

  let start
  if (
    opts.startTime != null &&
    (opts.startBlock == null || Number(opts.startBlock) < +initialBatch[0]!.version) &&
    Number(opts.startTime) < (await getVersionTimestamp(provider, +initialBatch[0]!.version))
  ) {
    const i = await binarySearchFirst(0, Math.floor(end / limit) - 1, async (i) => {
      const batch = await fetchBatch(end - (i + 1) * limit + 1)
      const firstTimestamp = await getVersionTimestamp(provider, +batch[0]!.version)
      return firstTimestamp > Number(opts.startTime!)
    })
    start = Math.max(end - (i + 1) * limit + 1, 0)
  } else if (
    opts.startTime == null &&
    opts.startBlock != null &&
    Number(opts.startBlock) <= +initialBatch[0]!.version
  ) {
    start = 0
  } else {
    start = Math.max(end - limit + 1, 0)
  }

  let notAfter =
    typeof opts.endBlock !== 'number' && typeof opts.endBlock !== 'bigint'
      ? undefined
      : Number(opts.endBlock) < 0
        ? memoize(
            async () => +(await provider.getLedgerInfo()).ledger_version + Number(opts.endBlock),
            {
              async: true,
              maxArgs: 0,
              expires: opts.pollInterval || DEFAULT_POLL_INTERVAL,
            },
          )
        : opts.endBlock

  let first = true,
    catchedUp = false
  while (
    (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) ||
    !catchedUp
  ) {
    const startBefore: number = start
    const lastReq = performance.now()
    const data: ResEvent[] = await fetchBatch(start)
    if (
      first &&
      opts.startTime != null &&
      (await getVersionTimestamp(provider, +data[0]!.version)) < Number(opts.startTime)
    ) {
      // the first batch may have some head which is not in the range
      const actualStart = await binarySearchFirst(0, data.length - 1, async (i) => {
        const timestamp = await getVersionTimestamp(provider, +data[i]!.version)
        return timestamp < Number(opts.startTime!)
      })
      data.splice(0, actualStart - 1)
    }

    if (
      !first &&
      catchedUp &&
      (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
      Number(opts.endBlock) < 0
    )
      notAfter = +(await provider.getLedgerInfo()).ledger_version + Number(opts.endBlock)

    first = false

    for (const ev of data) {
      if (opts.startBlock != null && +ev.version < Number(opts.startBlock)) continue
      // there may be an unknown interval between yields, so we support memoized negative finality
      if (
        notAfter != null &&
        +ev.version > (typeof notAfter === 'function' ? await notAfter() : notAfter)
      ) {
        catchedUp = true
        break
      }
      const start_: number = +ev.sequence_number
      start = start_ + 1
      yield ev
    }
    if (start === startBefore && data.length > 0) {
      // All events in this batch were skipped (e.g. all below opts.startBlock). Advance start
      // past the tail of the batch so catchedUp can become true and the loop exits cleanly.
      // Without this, the memoized fetchBatch(start) spins as pure microtasks, starving the
      // event loop and making the process unresponsive.
      start = +data[data.length - 1]!.sequence_number + 1
    }
    catchedUp ||= start >= end
    if (opts.watch && catchedUp) {
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
}

/**
 * Streams logs from the Aptos blockchain based on filter options.
 * @param provider - Aptos provider instance.
 * @param opts - Log filter options.
 * @returns Async generator of log entries.
 */
export async function* streamAptosLogs(
  ctx: { provider: Aptos },
  opts: LeanNumbers<LogFilter> & { versionAsHash?: boolean },
): AsyncGenerator<ChainLog> {
  const limit = 100
  if (!opts.address || !opts.address.includes('::')) throw new CCIPAptosAddressModuleRequiredError()
  if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string')
    throw new CCIPTopicsInvalidError(opts.topics!)
  const hasStart = opts.startBlock != null || opts.startTime != null
  if (!hasStart) throw new CCIPLogsRequiresStartError()

  let eventHandlerField = opts.topics[0]
  if (!eventHandlerField.includes('/')) {
    eventHandlerField = (eventToHandler as Record<string, string>)[eventHandlerField]!
    if (!eventHandlerField) throw new CCIPTopicsInvalidError(opts.topics)
  }
  const [stateAddr] = await ctx.provider.view<[string]>({
    payload: {
      function: `${opts.address}::get_state_address` as `0x${string}::${string}::get_state_address`,
    },
  })

  let topics
  for await (const ev of fetchEventsForward(ctx, opts, eventHandlerField, stateAddr, limit)) {
    topics ??= [ev.type.slice(ev.type.lastIndexOf('::') + 2)]
    yield {
      address: opts.address,
      topics,
      index: +ev.sequence_number,
      blockNumber: +ev.version,
      transactionHash: opts.versionAsHash
        ? `${ev.version}`
        : (await getUserTxByVersion(ctx.provider, +ev.version)).hash,
      data: ev.data as Record<string, unknown>,
      blockTimestamp: await getVersionTimestamp(ctx.provider, +ev.version),
    }
  }
}
