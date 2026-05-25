import { type JsonRpcApiProvider, type Log, isHexString } from 'ethers'
import type { SetFieldType } from 'type-fest'

import type { LogFilter } from '../chain.ts'
import {
  CCIPLogTopicsNotFoundError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import type { FinalityRequested } from '../extra-args.ts'
import { blockRangeGenerator, getSomeBlockNumberBefore, signalToPromise } from '../utils.ts'
import { getAllFragmentsMatchingEvents } from './const.ts'
import type { WithLogger } from '../types.ts'

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
 * Implements Chain.getLogs for EVM.
 * Walks logs forward from `startBlock` or `startTime`; if neither is provided, throws.
 * @param filter - Chain LogFilter
 * @param ctx - Context object containing provider, logger and optional abort signal
 * @returns Async iterator of logs.
 */
export async function* getEvmLogs(
  filter: SetFieldType<LogFilter, 'endBlock', EVMEndBlockTag>,
  ctx: {
    provider: JsonRpcApiProvider
    getBlockInfo: (block: EVMEndBlockTag) => Promise<{ number: number; timestamp: number }>
    abort?: AbortSignal
  } & WithLogger,
): AsyncIterableIterator<Log & { blockTimestamp: number }> {
  const { provider, logger = console } = ctx

  if (filter.startBlock == null && filter.startTime == null) throw new CCIPLogsRequiresStartError()
  if (filter.watch && typeof filter.endBlock === 'number' && filter.endBlock > 0)
    throw new CCIPLogsWatchRequiresFinalityError(filter.endBlock)

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

  filter.page ??= 10e3
  filter.endBlock ||= 'latest'
  const { number: endBlock } = (await provider.getBlock(filter.endBlock))!
  filter.startBlock ??= await getSomeBlockNumberBefore(
    async (block: number) => (await ctx.getBlockInfo(block)).timestamp,
    endBlock,
    filter.startTime!,
    ctx,
  )
  let latestLogBlockNumber = filter.startBlock - 1

  for (const blockRange of blockRangeGenerator({
    ...filter,
    startBlock: filter.startBlock,
    endBlock,
  })) {
    const filter_ = {
      ...blockRange,
      ...(filter.address ? { address: filter.address } : {}),
      ...(filter.topics?.length ? { topics: filter.topics } : {}),
    }
    logger.debug('evm getLogs:', filter_)
    const logs = await provider.getLogs(filter_)
    if (logs.length)
      latestLogBlockNumber = Math.max(latestLogBlockNumber, logs[logs.length - 1]!.blockNumber)
    const logs_ = await Promise.all(
      logs.map(async (l) =>
        Object.assign(l, { blockTimestamp: (await ctx.getBlockInfo(l.blockNumber)).timestamp }),
      ),
    )
    yield* logs_
  }

  // watch mode, otherwise return
  let lastEvent
  while (filter.watch && (!(filter.watch instanceof AbortSignal) || !filter.watch.aborted)) {
    const filter_ = {
      fromBlock: Math.max(latestLogBlockNumber, endBlock - filter.page) + 1,
      toBlock: await provider._getBlockTag(filter.endBlock),
      ...(filter.address ? { address: filter.address } : {}),
      ...(filter.topics?.length ? { topics: filter.topics } : {}),
    }
    logger.debug('evm watch getLogs:', { ...filter_, lastEvent })
    const logs = await provider.getLogs(filter_).catch((err) => {
      // when querying a tag (e.g. `finalized`), it can be "before" `fromBlock`; threat as empty
      if (isInvalidBlockRangesError(err)) return []
      throw err
    })
    if (logs.length)
      latestLogBlockNumber = Math.max(latestLogBlockNumber, logs[logs.length - 1]!.blockNumber)
    const logs_ = await Promise.all(
      logs.map(async (l) =>
        Object.assign(l, { blockTimestamp: (await ctx.getBlockInfo(l.blockNumber)).timestamp }),
      ),
    )
    yield* logs_

    const contAc = new AbortController()
    let contSignal = contAc.signal
    const contEvent =
      typeof filter.endBlock === 'number' || filter.endBlock == 'latest' ? 'block' : filter.endBlock // finalized | safe
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
