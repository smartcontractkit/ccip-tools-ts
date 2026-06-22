import { type JsonRpcApiProvider, type Log, isHexString } from 'ethers'
import type { SetFieldType } from 'type-fest'

import type { LogFilter } from '../chain.ts'
import {
  CCIPLogRangeTooLargeError,
  CCIPLogTopicsNotFoundError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import type { FinalityRequested } from '../extra-args.ts'
import { getEndpointLogRange, parseLogRangeError, setEndpointLogRange } from '../fetch.ts'
import { blockRangeGenerator, getSomeBlockNumberBefore, signalToPromise } from '../utils.ts'
import { getAllFragmentsMatchingEvents } from './const.ts'
import type { ChainLog, LeanNumbers, Logger, WithLogger } from '../types.ts'

/** Tags or values which can be used as `endBlock` in {@link EVMChain.getLogs} filter */
export type EVMEndBlockTag = FinalityRequested | 'latest'

function isInvalidBlockRangesError(
  err: unknown,
): err is { error: { code: number; message: string } } {
  return !!(
    (
      err instanceof Error &&
      (('error' in err &&
        typeof err.error === 'object' &&
        err.error &&
        'code' in err.error &&
        err.error.code === -32602) ||
        err.message.match(/-32602\b/g))
    ) // err: invalid block range params
  )
}

/**
 * Derives a stable URL string from a JsonRpcApiProvider, or undefined if not obtainable.
 * Tries `_getConnection()` which works for JsonRpcProvider (HTTP/HTTPS).
 */
function getProviderUrl(provider: JsonRpcApiProvider): string | undefined {
  try {
    const conn = (provider as { _getConnection?: () => { url: string } })._getConnection?.()
    if (conn?.url) return conn.url
  } catch {
    // WebSocketProvider or other providers may not have _getConnection
  }
  return undefined
}

/**
 * Yields logs for a single [fromBlock, toBlock] range, subdividing adaptively on range errors.
 * Mutates `pageBox` so caller can observe learned page size.
 */
async function* getLogsPaginated(
  provider: JsonRpcApiProvider,
  baseFilter: { address?: string | string[]; topics?: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
  pageBox: { value: number },
  url: string | undefined,
  logger: Logger,
): AsyncGenerator<Log> {
  if (fromBlock > toBlock) return
  const filter_ = {
    fromBlock,
    toBlock,
    ...(baseFilter.address ? { address: baseFilter.address } : {}),
    ...(baseFilter.topics?.length ? { topics: baseFilter.topics } : {}),
  }
  logger.debug('evm getLogs:', filter_)
  try {
    const logs = await provider.getLogs(filter_)
    yield* logs
  } catch (err) {
    const rangeInfo = parseLogRangeError(err)
    if (rangeInfo === null) throw err

    const currentSpan = toBlock - fromBlock + 1
    let newPage: number
    if (rangeInfo.maxRange !== undefined) {
      newPage = rangeInfo.maxRange
    } else if (rangeInfo.suggestedRange !== undefined) {
      newPage = rangeInfo.suggestedRange[1] - rangeInfo.suggestedRange[0] + 1
    } else {
      newPage = Math.floor(currentSpan / 2)
    }
    // Clamp: must be >=1 and strictly less than currentSpan to make progress
    newPage = Math.max(1, newPage)
    if (newPage >= currentSpan) {
      // Cannot subdivide further — surface a typed error
      throw new CCIPLogRangeTooLargeError(
        { requestedRange: currentSpan, ...rangeInfo },
        { cause: err instanceof Error ? err : undefined },
      )
    }

    logger.warn(
      `evm getLogs: range too large (span=${currentSpan}), shrinking page to ${newPage}`,
      { url, err },
    )
    if (url !== undefined) setEndpointLogRange(url, newPage, 'error')
    pageBox.value = Math.min(pageBox.value, newPage)

    // Re-chunk the same [fromBlock, toBlock] with the smaller page
    for (const chunk of blockRangeGenerator({
      startBlock: fromBlock,
      endBlock: toBlock,
      page: newPage,
    })) {
      yield* getLogsPaginated(
        provider,
        baseFilter,
        chunk.fromBlock,
        chunk.toBlock,
        pageBox,
        url,
        logger,
      )
    }
  }
}

/**
 * Implements Chain.getLogs for EVM.
 * Walks logs forward from `startBlock` or `startTime`; if neither is provided, throws.
 * @param filter - Chain LogFilter
 * @param ctx - Context object containing provider, logger and optional abort signal
 * @returns Async iterator of logs.
 */
export async function* getEvmLogs(
  filter: SetFieldType<LeanNumbers<LogFilter>, 'endBlock', EVMEndBlockTag | bigint | undefined>,
  ctx: {
    provider: JsonRpcApiProvider
    getBlockInfo: (block: EVMEndBlockTag) => Promise<{ number: number; timestamp: number }>
    abort?: AbortSignal
  } & WithLogger,
): AsyncIterableIterator<ChainLog> {
  const { provider, logger = console } = ctx

  if (filter.startBlock == null && filter.startTime == null) throw new CCIPLogsRequiresStartError()
  if (
    filter.watch &&
    (typeof filter.endBlock === 'number' || typeof filter.endBlock === 'bigint') &&
    Number(filter.endBlock) > 0
  )
    throw new CCIPLogsWatchRequiresFinalityError(Number(filter.endBlock))

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

  // Determine endpoint URL for cross-instance log-range learning
  const endpointUrl = getProviderUrl(provider)

  // Seed initial page: explicit user value > learned endpoint value > default 10e3
  filter.page ??= getEndpointLogRange(endpointUrl ?? 'unknown') ?? 10e3
  filter.page = Number(filter.page)
  // Mutable box so getLogsPaginated can propagate learned page shrinks back to watch loop
  const pageBox = { value: filter.page }

  filter.endBlock ||= 'latest'
  const { number: endBlock } = (await provider.getBlock(filter.endBlock))!
  filter.startBlock ??= await getSomeBlockNumberBefore(
    async (block: number) => (await ctx.getBlockInfo(block)).timestamp,
    endBlock,
    Number(filter.startTime!),
    ctx,
  )
  filter.startBlock = Number(filter.startBlock)
  let latestLogBlockNumber = filter.startBlock - 1

  const baseFilter = {
    ...(filter.address ? { address: filter.address } : {}),
    ...(filter.topics?.length ? { topics: filter.topics } : {}),
  }

  for (const blockRange of blockRangeGenerator({
    ...filter,
    startBlock: filter.startBlock,
    endBlock,
    page: pageBox.value,
  })) {
    for await (const log of getLogsPaginated(
      provider,
      baseFilter,
      blockRange.fromBlock,
      blockRange.toBlock,
      pageBox,
      endpointUrl,
      logger,
    )) {
      if (log.blockNumber > latestLogBlockNumber) latestLogBlockNumber = log.blockNumber
      yield { ...log, blockTimestamp: (await ctx.getBlockInfo(log.blockNumber)).timestamp }
    }
  }

  // watch mode, otherwise return
  let lastEvent
  while (filter.watch && (!(filter.watch instanceof AbortSignal) || !filter.watch.aborted)) {
    const watchFrom = Math.max(latestLogBlockNumber, endBlock - pageBox.value) + 1
    const toBlockTag = await provider._getBlockTag(filter.endBlock)
    const filter_ = {
      fromBlock: watchFrom,
      toBlock: toBlockTag,
      ...baseFilter,
    }
    logger.debug('evm watch getLogs:', { ...filter_, lastEvent })
    let watchLogs: Log[]
    try {
      watchLogs = await provider.getLogs(filter_)
    } catch (err) {
      if (isInvalidBlockRangesError(err)) {
        watchLogs = []
      } else {
        const rangeInfo = parseLogRangeError(err)
        if (rangeInfo === null) throw err

        // Resolve symbolic tags (e.g. 'latest') to a block number so we can
        // offload to getLogsPaginated regardless of how toBlock was expressed.
        const toBlockNum = /^0x/i.test(toBlockTag)
          ? parseInt(toBlockTag, 16)
          : (await provider.getBlock(toBlockTag))!.number
        const currentSpan = toBlockNum - watchFrom + 1
        let newPage: number
        if (rangeInfo.maxRange !== undefined) {
          newPage = rangeInfo.maxRange
        } else if (rangeInfo.suggestedRange !== undefined) {
          newPage = rangeInfo.suggestedRange[1] - rangeInfo.suggestedRange[0] + 1
        } else {
          newPage = Math.floor(currentSpan / 2)
        }
        // Floor at 100: fast-block chains can produce >100 new blocks per watch
        // interval; don't let the page shrink to 1 just because the span keeps
        // exceeding the endpoint limit — getLogsPaginated handles large spans.
        newPage = Math.max(100, newPage)
        logger.warn(
          `evm watch getLogs: range too large (span=${currentSpan}), shrinking page to ${newPage}`,
          { url: endpointUrl, err },
        )
        if (endpointUrl !== undefined) setEndpointLogRange(endpointUrl, newPage, 'error')
        pageBox.value = Math.min(pageBox.value, newPage)

        for await (const log of getLogsPaginated(
          provider,
          baseFilter,
          watchFrom,
          toBlockNum,
          pageBox,
          endpointUrl,
          logger,
        )) {
          if (log.blockNumber > latestLogBlockNumber) latestLogBlockNumber = log.blockNumber
          yield { ...log, blockTimestamp: (await ctx.getBlockInfo(log.blockNumber)).timestamp }
        }
        // Advance past the entire covered range so next watchFrom doesn't
        // re-request the same blocks (even if no logs were found in them).
        latestLogBlockNumber = Math.max(latestLogBlockNumber, toBlockNum)
        continue
      }
    }
    if (watchLogs.length)
      latestLogBlockNumber = Math.max(
        latestLogBlockNumber,
        watchLogs[watchLogs.length - 1]!.blockNumber,
      )
    const logs_ = await Promise.all(
      watchLogs.map(async (l) => ({
        ...l,
        blockTimestamp: (await ctx.getBlockInfo(l.blockNumber)).timestamp,
      })),
    )
    yield* logs_

    const contAc = new AbortController()
    let contSignal = contAc.signal
    const contEvent =
      typeof filter.endBlock === 'number' ||
      typeof filter.endBlock === 'bigint' ||
      filter.endBlock == 'latest'
        ? 'block'
        : filter.endBlock // finalized | safe
    const contListener = (number?: number) => {
      contAc.abort()
      lastEvent = [contEvent, number] as const
    }
    void provider.once(contEvent, contListener)
    if (filter.watch instanceof AbortSignal) {
      if (filter.watch.aborted) break
      contSignal = AbortSignal.any([filter.watch, contSignal])
    }
    try {
      await signalToPromise(contSignal).catch(() => {})
    } finally {
      void provider.off(contEvent, contListener)
    }
  }
}
