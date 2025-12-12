import {
  type JsonRpcApiProvider,
  type Log,
  FetchRequest,
  JsonRpcProvider,
  isHexString,
} from 'ethers'
import { memoize } from 'micro-memoize'

import type { LogFilter } from '../chain.ts'
import {
  CCIPLogTopicsNotFoundError,
  CCIPLogsNotFoundError,
  CCIPRpcNotFoundError,
} from '../errors/index.ts'
import { blockRangeGenerator, getSomeBlockNumberBefore } from '../utils.ts'
import { getAllFragmentsMatchingEvents } from './const.ts'
import type { WithLogger } from '../types.ts'

const MAX_PARALLEL_JOBS = 24
const PER_REQUEST_TIMEOUT = 5000

const getFallbackRpcsList = memoize(
  async () => {
    const response = await fetch('https://chainlist.org/rpcs.json')
    const data = await response.json()
    return data as {
      chainId: number
      rpc: { url: string }[]
      explorers: { url: string }[]
    }[]
  },
  { async: true },
)

// like Promise.any, but receives Promise factories and spawn a maximum number of them in parallel
function anyPromiseMax<T>(
  promises: readonly (() => Promise<T>)[],
  maxParallelJobs: number,
  cancel?: Promise<unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = new Array(promises.length)
    let index = 0
    let inFlight = 0
    let completed = 0

    if (promises.length === 0) {
      reject(new AggregateError([], 'All promises were rejected'))
      return
    }
    let cancelled = false
    void cancel?.finally(() => {
      cancelled = true
    })

    const startNext = () => {
      while (!cancelled && inFlight < maxParallelJobs && index < promises.length) {
        const currentIndex = index++
        inFlight++

        void promises[currentIndex]()
          .then(resolve)
          .catch((error) => {
            errors[currentIndex] = error
            completed++
            inFlight--

            if (completed === promises.length) {
              reject(new AggregateError(errors, 'All promises were rejected'))
            } else {
              startNext()
            }
          })
      }
    }

    startNext()
  })
}

// cache
const archiveRpcs: Record<number, Promise<JsonRpcApiProvider>> = {}

/**
 * Like provider.getLogs, but from a public list of archive nodes and wide range, races the first to reply
 * @param chainId - The chain ID of the network to query
 * @param filter - Log filter options
 * @param destroy$ - An optional promise that, when resolved, cancels the requests
 * @returns Array of Logs
 */
async function getFallbackArchiveLogs(
  chainId: number,
  filter: {
    address: string
    topics: (string | string[] | null)[]
    startBlock?: number
    endBlock?: number | 'latest'
  },
  { logger = console, destroy$ }: { destroy$?: Promise<unknown> } & WithLogger = {},
) {
  const provider = archiveRpcs[chainId]
  if (provider != null) {
    return (await provider).getLogs({
      ...filter,
      fromBlock: filter.startBlock ?? 1,
      toBlock: filter.endBlock ?? 'latest',
    })
  }
  let cancel!: (_?: unknown) => void
  let cancel$ = new Promise<unknown>((resolve) => (cancel = resolve))
  if (destroy$) cancel$ = Promise.race([destroy$, cancel$])

  let winner: string
  const providerLogs$ = getFallbackRpcsList()
    .then((rpcs) => {
      const rpc = rpcs.find(({ chainId: id }) => id === chainId)
      if (!rpc) throw new CCIPRpcNotFoundError(chainId)
      return Array.from(
        new Set(rpc.rpc.map(({ url }) => url).filter((url) => url.match(/^https?:\/\//))),
      )
    })
    .then((urls) =>
      anyPromiseMax(
        urls.map((url) => async () => {
          const fetchReq = new FetchRequest(url)
          fetchReq.timeout = PER_REQUEST_TIMEOUT
          const provider = new JsonRpcProvider(fetchReq, chainId)
          void cancel$.finally(() => {
            if (url === winner) return
            provider.destroy()
            try {
              fetchReq.cancel()
            } catch (_) {
              // ignore
            }
          })
          return [
            provider,
            await provider
              .getLogs({
                ...filter,
                fromBlock: filter.startBlock ?? 1,
                toBlock: filter.endBlock ?? 'latest',
              })
              .then((logs) => {
                if (!logs.length) throw new CCIPLogsNotFoundError(filter)
                logger.debug(
                  'getFallbackArchiveLogs raced',
                  url,
                  'from',
                  urls.length,
                  'urls, got',
                  logs.length,
                  'logs for',
                  filter,
                )
                winner ??= url
                cancel()
                return logs
              }),
          ] as const // return both winner provider and logs
        }),
        MAX_PARALLEL_JOBS,
        cancel$,
      ),
    )
    .finally(cancel)
  archiveRpcs[chainId] = providerLogs$.then(([provider]) => provider) // cache provider
  archiveRpcs[chainId].catch(() => {
    delete archiveRpcs[chainId]
  })
  return providerLogs$.then(([, logs]) => logs) // return logs
}

/**
 * Implements Chain.getLogs for EVM.
 * If !(filter.startBlock|startTime), walks backwards from endBlock, otherwise forward from then.
 * @param filter - Chain LogFilter. The `onlyFallback` option controls pagination behavior:
 *   - If undefined (default): paginate main provider only by filter.page
 *   - If false: first try whole range with main provider, then fallback to archive provider
 *   - If true: don't paginate (throw if can't fetch wide range from either provider)
 * @param ctx - Context object containing provider, logger and destry$ notify promise
 * @returns Async iterator of logs.
 */
export async function* getEvmLogs(
  filter: LogFilter & { onlyFallback?: boolean },
  ctx: { provider: JsonRpcApiProvider; destroy$?: Promise<unknown> } & WithLogger,
): AsyncIterableIterator<Log> {
  const { provider, logger = console } = ctx
  const endBlock = filter.endBlock ?? (await provider.getBlockNumber())
  if (
    filter.topics?.length &&
    filter.topics.every((t: string | string[] | null): t is string => typeof t === 'string')
  ) {
    const topics = new Set(
      filter.topics
        .filter(isHexString)
        .concat(Object.keys(getAllFragmentsMatchingEvents(filter.topics)) as `0x${string}`[])
        .flat(),
    )
    if (!topics.size) {
      throw new CCIPLogTopicsNotFoundError(filter.topics)
    }
    filter.topics = [Array.from(topics)]
  }
  if (filter.startBlock == null && filter.startTime) {
    filter.startBlock = await getSomeBlockNumberBefore(
      async (block: number | 'finalized') => (await provider.getBlock(block))!.timestamp, // cached
      endBlock,
      filter.startTime,
      ctx,
    )
  }
  if (filter.onlyFallback != null && filter.address && filter.topics?.length) {
    let logs
    try {
      logs = await provider.getLogs({
        ...filter,
        fromBlock: filter.startBlock ?? 1,
        toBlock: filter.endBlock ?? 'latest',
      })
    } catch (_) {
      try {
        logs = await getFallbackArchiveLogs(
          Number((await provider.getNetwork()).chainId),
          {
            address: filter.address,
            topics: filter.topics,
            startBlock: filter.startBlock ?? 1,
            endBlock: filter.endBlock ?? 'latest',
          },
          ctx,
        )
      } catch (err) {
        if (filter.onlyFallback === true) throw err
      }
    }
    if (logs) {
      if (!filter.startBlock) logs.reverse()
      yield* logs
      return
    }
  }
  // paginate only if filter.onlyFallback is nullish
  for (const blockRange of blockRangeGenerator({ ...filter, endBlock })) {
    logger.debug('evm getLogs:', {
      ...blockRange,
      ...(filter.address ? { address: filter.address } : {}),
      ...(filter.topics?.length ? { topics: filter.topics } : {}),
    })
    const logs = await provider.getLogs({
      ...blockRange,
      ...(filter.address ? { address: filter.address } : {}),
      ...(filter.topics?.length ? { topics: filter.topics } : {}),
    })
    if (!filter.startBlock) logs.reverse()
    yield* logs
  }
}
