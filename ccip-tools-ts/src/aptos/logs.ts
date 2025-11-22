import {
  type Aptos,
  type Event as AptosEvent,
  type UserTransactionResponse,
  TransactionResponseType,
  getAptosFullNode,
} from '@aptos-labs/ts-sdk'
import moize from 'moize'

import type { LogFilter } from '../chain.ts'
import type { Log_ } from '../types.ts'

const eventToHandler = {
  CCIPMessageSent: 'OnRampState/ccip_message_sent_events',
  CommitReportAccepted: 'OffRampState/commit_report_accepted_events',
  ExecutionStateChanged: 'OffRampState/execution_state_changed_events',
} as const

export async function getUserTxByVersion(
  provider: Aptos,
  version: number,
): Promise<UserTransactionResponse> {
  const tx = await provider.getTransactionByVersion({
    ledgerVersion: version,
  })
  if (tx.type !== TransactionResponseType.User)
    throw new Error(`Unexpected transaction type="${tx.type}"`)
  return tx
}

export async function getVersionTimestamp(
  provider: Aptos,
  version: number | 'finalized',
): Promise<number> {
  if (version === 'finalized') {
    const info = await provider.getLedgerInfo()
    const tx = await provider.getTransactionByVersion({
      ledgerVersion: +info.ledger_version,
    })
    return +(tx as UserTransactionResponse).timestamp / 1e6
  }
  const tx = await getUserTxByVersion(provider, version)
  return +tx.timestamp / 1e6
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
  provider: Aptos,
  opts: LogFilter,
  eventHandlerField: string,
  stateAddr: string,
  limit = 100,
): AsyncGenerator<ResEvent> {
  const fetchBatch = moize.default(
    async (start?: number) => {
      const { data }: { data: ResEvent[] } = await getAptosFullNode({
        aptosConfig: provider.config,
        originMethod: 'getEventsByEventHandle',
        path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
        params: { start, limit },
      })
      if (!start) fetchBatch.set([+data[0].sequence_number], data)
      return data
    },
    { maxArgs: 1, maxSize: 100 },
  )

  const initialBatch = await fetchBatch()
  if (!initialBatch.length) return
  const end = +initialBatch[initialBatch.length - 1].sequence_number

  let start
  if (
    (!opts.startBlock || opts.startBlock < +initialBatch[0].version) &&
    (!opts.startTime ||
      opts.startTime < (await getVersionTimestamp(provider, +initialBatch[0].version)))
  ) {
    const i = await binarySearchFirst(0, Math.floor(end / limit) - 1, async (i) => {
      const batch = await fetchBatch(end - (i + 1) * limit + 1)
      const firstTimestamp = await getVersionTimestamp(provider, +batch[0].version)
      return firstTimestamp > opts.startTime!
    })
    start = end - (i + 1) * limit + 1
  } else {
    start = end - limit + 1
  }

  let first = true
  for (; start < end; start += limit) {
    const data = await fetchBatch(start)
    if (
      first &&
      opts.startTime &&
      (await getVersionTimestamp(provider, +data[0].version)) < opts.startTime
    ) {
      // the first batch may have some head which is not in the range
      const actualStart = await binarySearchFirst(0, data.length - 1, async (i) => {
        const timestamp = await getVersionTimestamp(provider, +data[i].version)
        return timestamp < opts.startTime!
      })
      data.splice(0, actualStart - 1)
    }
    first = false
    for (const ev of data) {
      if (opts.startBlock && +ev.version < opts.startBlock) continue
      if (opts.endBlock && +ev.version > opts.endBlock) return
      yield ev
    }
  }
}

async function* fetchEventsBackward(
  provider: Aptos,
  opts: LogFilter,
  eventHandlerField: string,
  stateAddr: string,
  limit = 100,
): AsyncGenerator<ResEvent> {
  let start
  let cont = true
  do {
    const { data } = await getAptosFullNode<object, ResEvent[]>({
      aptosConfig: provider.config,
      originMethod: 'getEventsByEventHandle',
      path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
      params: { start, limit },
    })

    if (!data.length) break
    else if (start === 1) cont = false
    else start = Math.max(+data[0].sequence_number - limit, 1)

    for (const ev of data.reverse()) {
      if (opts.endBlock && +ev.version > opts.endBlock) continue
      if (+ev.sequence_number <= 1) cont = false
      yield ev
    }
  } while (cont)
}

export async function* streamAptosLogs(
  provider: Aptos,
  opts: LogFilter & { versionAsHash?: boolean },
): AsyncGenerator<Log_> {
  const limit = 100
  if (!opts.address || !opts.address.includes('::'))
    throw new Error('address with module is required')
  if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string')
    throw new Error('single string topic required')
  let eventHandlerField = opts.topics[0]
  if (!eventHandlerField.includes('/')) {
    eventHandlerField = (eventToHandler as Record<string, string>)[eventHandlerField]
    if (!eventHandlerField) throw new Error(`Unknown topic event handler="${opts.topics[0]}"`)
  }
  const [stateAddr] = await provider.view<[string]>({
    payload: {
      function: `${opts.address}::get_state_address` as `0x${string}::${string}::get_state_address`,
    },
  })

  let eventsIter
  if (opts.startBlock || opts.startTime) {
    eventsIter = fetchEventsForward(provider, opts, eventHandlerField, stateAddr, limit)
  } else {
    // backwards, just paginate down to lowest sequence number
    eventsIter = fetchEventsBackward(provider, opts, eventHandlerField, stateAddr, limit)
  }

  let topics
  for await (const ev of eventsIter) {
    topics ??= [ev.type.slice(ev.type.lastIndexOf('::') + 2)]
    yield {
      address: opts.address,
      topics,
      index: +ev.sequence_number,
      blockNumber: +ev.version,
      transactionHash: opts?.versionAsHash
        ? `${ev.version}`
        : (await getUserTxByVersion(provider, +ev.version)).hash,
      data: ev.data as Record<string, unknown>,
    }
  }
}
