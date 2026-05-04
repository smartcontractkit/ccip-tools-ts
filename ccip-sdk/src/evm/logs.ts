import { type JsonRpcApiProvider, type Log, isHexString } from 'ethers'
import type { SetFieldType } from 'type-fest'

import type { LogFilter } from '../chain.ts'
import {
  CCIPLogTopicsNotFoundError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
} from '../errors/index.ts'
import type { FinalityRequested } from '../extra-args.ts'
import { blockRangeGenerator, getSomeBlockNumberBefore } from '../utils.ts'
import { getAllFragmentsMatchingEvents } from './const.ts'
import type { WithLogger } from '../types.ts'

/** Tags or values which can be used as `endBlock` in {@link EVMChain.getLogs} filter */
export type EVMEndBlockTag = FinalityRequested | 'latest'

/**
 * Implements Chain.getLogs for EVM.
 * Walks logs forward from `startBlock` or `startTime`; if neither is provided, throws.
 * @param filter - Chain LogFilter
 * @param ctx - Context object containing provider, logger and destroy$ notify promise
 * @returns Async iterator of logs.
 */
export async function* getEvmLogs(
  filter: SetFieldType<LogFilter, 'endBlock', EVMEndBlockTag>,
  ctx: { provider: JsonRpcApiProvider; destroy$?: Promise<unknown> } & WithLogger,
): AsyncIterableIterator<Log> {
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

  const { number: endBlock } = (await provider.getBlock(filter.endBlock || 'latest'))!

  if (filter.startBlock == null && filter.startTime != null) {
    filter.startBlock = await getSomeBlockNumberBefore(
      async (block: number) => (await provider.getBlock(block))!.timestamp, // cached
      endBlock,
      filter.startTime,
      ctx,
    )
  }
  let latestLogBlockNumber = filter.startBlock!
  for (const blockRange of blockRangeGenerator({
    ...filter,
    startBlock: filter.startBlock!,
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
    yield* logs
  }

  // watch mode, otherwise return
  while (filter.watch) {
    let cont$ = new Promise<number | false>(
      (resolve) =>
        void provider.once(
          !filter.endBlock || typeof filter.endBlock === 'number' || filter.endBlock == 'latest'
            ? 'block'
            : filter.endBlock, // finalized | safe
          resolve,
        ),
    )
    if (filter.watch instanceof Promise)
      cont$ = Promise.race([filter.watch.then(() => false as const), cont$])
    if ((await cont$) === false) break

    const filter_ = {
      fromBlock: Math.max(latestLogBlockNumber, endBlock - (filter.page ?? 10e3)) + 1,
      toBlock: filter.endBlock || 'latest',
      ...(filter.address ? { address: filter.address } : {}),
      ...(filter.topics?.length ? { topics: filter.topics } : {}),
    }
    logger.debug('evm watch getLogs:', filter_)
    const logs = await provider.getLogs(filter_)
    if (logs.length)
      latestLogBlockNumber = Math.max(latestLogBlockNumber, logs[logs.length - 1]!.blockNumber)
    yield* logs
  }
}
