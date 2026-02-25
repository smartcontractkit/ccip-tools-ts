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
  CCIPLogsWatchRequiresFinalityError,
  CCIPLogsWatchRequiresStartError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import type { ChainLog } from '../types.ts'
import { sleep } from '../utils.ts'

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
  opts: LogFilter & { pollInterval?: number },
  eventHandlerField: string,
  stateAddr: string,
  limit = 100,
): AsyncGenerator<ResEvent> {
  if (opts.watch && typeof opts.endBlock === 'number' && opts.endBlock > 0)
    throw new CCIPLogsWatchRequiresFinalityError(opts.endBlock)
  opts.endBlock ||= 'latest'

  const fetchBatch = memoize(
    async (start?: number) => {
      const { data }: { data: ResEvent[] } = await getAptosFullNode({
        aptosConfig: provider.config,
        originMethod: 'getEventsByEventHandle',
        path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
        params: { start, limit },
      })
      if (!start) fetchBatch.cache.set([+data[0]!.sequence_number], Promise.resolve(data))
      return data
    },
    { maxArgs: 1, maxSize: 100, async: true },
  )

  const initialBatch = await fetchBatch()
  if (!initialBatch.length) return
  const end = +initialBatch[initialBatch.length - 1]!.sequence_number

  let start
  if (
    (!opts.startBlock || opts.startBlock < +initialBatch[0]!.version) &&
    (!opts.startTime ||
      opts.startTime < (await getVersionTimestamp(provider, +initialBatch[0]!.version)))
  ) {
    const i = await binarySearchFirst(0, Math.floor(end / limit) - 1, async (i) => {
      const batch = await fetchBatch(end - (i + 1) * limit + 1)
      const firstTimestamp = await getVersionTimestamp(provider, +batch[0]!.version)
      return firstTimestamp > opts.startTime!
    })
    start = end - (i + 1) * limit + 1
  } else {
    start = end - limit + 1
  }

  let notAfter =
    typeof opts.endBlock !== 'number'
      ? undefined
      : opts.endBlock < 0
        ? memoize(
            async () =>
              +(await provider.getLedgerInfo()).ledger_version + (opts.endBlock as number),
            {
              async: true,
              maxArgs: 0,
              expires: opts.pollInterval || DEFAULT_POLL_INTERVAL,
            },
          )
        : opts.endBlock

  let first = true,
    catchedUp = false
  while (opts.watch || !catchedUp) {
    const lastReq = performance.now()
    const data = await fetchBatch(start)
    if (
      first &&
      opts.startTime &&
      (await getVersionTimestamp(provider, +data[0]!.version)) < opts.startTime
    ) {
      // the first batch may have some head which is not in the range
      const actualStart = await binarySearchFirst(0, data.length - 1, async (i) => {
        const timestamp = await getVersionTimestamp(provider, +data[i]!.version)
        return timestamp < opts.startTime!
      })
      data.splice(0, actualStart - 1)
    }

    if (!first && catchedUp && typeof opts.endBlock === 'number' && opts.endBlock < 0)
      notAfter = +(await provider.getLedgerInfo()).ledger_version + opts.endBlock

    first = false

    for (const ev of data) {
      if (opts.startBlock && +ev.version < opts.startBlock) continue
      // there may be an unknown interval between yields, so we support memoized negative finality
      if (
        notAfter &&
        +ev.version > (typeof notAfter === 'function' ? await notAfter() : notAfter)
      ) {
        catchedUp = true
        break
      }
      const start_: number = +ev.sequence_number
      start = start_ + 1
      yield ev
    }
    catchedUp ||= start >= end
    if (opts.watch && catchedUp) {
      let break$ = sleep(
        Math.max((opts.pollInterval || DEFAULT_POLL_INTERVAL) - (performance.now() - lastReq), 1),
      ).then(() => false)
      if (opts.watch instanceof Promise)
        break$ = Promise.race([break$, opts.watch.then(() => true)])
      if (await break$) break
    }
  }
}

async function* fetchEventsBackward(
  { provider }: { provider: Aptos },
  opts: LogFilter,
  eventHandlerField: string,
  stateAddr: string,
  limit = 100,
): AsyncGenerator<ResEvent> {
  let start
  let cont = true
  const notAfter =
    typeof opts.endBlock !== 'number'
      ? undefined
      : opts.endBlock < 0
        ? +(await provider.getLedgerInfo()).ledger_version + opts.endBlock
        : opts.endBlock
  do {
    const { data } = await getAptosFullNode<object, ResEvent[]>({
      aptosConfig: provider.config,
      originMethod: 'getEventsByEventHandle',
      path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
      params: { start, limit },
    })

    if (!data.length) break
    else if (start === 1) cont = false
    else start = Math.max(+data[0]!.sequence_number - limit, 1)

    for (const ev of data.reverse()) {
      if (notAfter && +ev.version > notAfter) continue
      if (+ev.sequence_number <= 1) cont = false
      yield ev
    }
  } while (cont)
}

/**
 * Streams logs from the Aptos blockchain based on filter options.
 * @param provider - Aptos provider instance.
 * @param opts - Log filter options.
 * @returns Async generator of log entries.
 */
export async function* streamAptosLogs(
  ctx: { provider: Aptos },
  opts: LogFilter & { versionAsHash?: boolean },
): AsyncGenerator<ChainLog> {
  const limit = 100
  if (!opts.address || !opts.address.includes('::')) throw new CCIPAptosAddressModuleRequiredError()
  if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string')
    throw new CCIPTopicsInvalidError(opts.topics!)
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

  let eventsIter
  if (opts.startBlock || opts.startTime) {
    eventsIter = fetchEventsForward(ctx, opts, eventHandlerField, stateAddr, limit)
  } else if (opts.watch) {
    throw new CCIPLogsWatchRequiresStartError()
  } else {
    // backwards, just paginate down to lowest sequence number
    eventsIter = fetchEventsBackward(ctx, opts, eventHandlerField, stateAddr, limit)
  }

  let topics
  for await (const ev of eventsIter) {
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
    }
  }
}
