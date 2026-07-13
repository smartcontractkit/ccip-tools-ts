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
import {
  type LogRangeErrorInfo,
  getEndpointLogRange,
  parseLogRangeError,
  setEndpointLogRange,
} from '../fetch.ts'
import { getSomeBlockNumberBefore, signalToPromise } from '../utils.ts'
import { getAllFragmentsMatchingEvents } from './const.ts'
import type { ChainLog, LeanNumbers, Logger, WithLogger } from '../types.ts'

/** Tags or values which can be used as `endBlock` in {@link EVMChain.getLogs} filter */
export type EVMEndBlockTag = FinalityRequested | 'latest'

/**
 * Floor for adaptive page shrinking: never request fewer than this many blocks
 * per `eth_getLogs` call. Fast-block chains can mint over 100 blocks between
 * watch ticks; shrinking under this just multiplies round-trips without helping, and
 * an endpoint that can't serve 100 blocks is surfaced as an error instead.
 */
const MIN_LOG_RANGE = 100

/** Topic/address subset of a {@link LogFilter}, as accepted by `provider.getLogs`. */
type BaseFilter = { address?: string | string[]; topics?: (string | string[] | null)[] }

/**
 * True for JSON-RPC "invalid block range" errors (code -32602) — the watch loop
 * can hit this when the end tag resolves below `watchFrom` (no new blocks yet),
 * which is a benign no-op, not a failure. Matches across the common provider
 * error shapes and message texts so the case is recognized however it's reported.
 */
function isInvalidBlockRangesError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const e = err as {
    code?: unknown
    error?: { code?: unknown }
    info?: { error?: { code?: unknown } }
  }
  if (e.code === -32602 || e.error?.code === -32602 || e.info?.error?.code === -32602) return true
  return /-32602\b/.test(err.message) || /invalid block range/i.test(err.message)
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
 * Computes the next (smaller) page size from a range-too-large error and the
 * span that triggered it, floored at {@link MIN_LOG_RANGE}. Prefers the limit
 * the RPC reported (`maxRange`/`suggestedRange`); otherwise halves the span.
 */
function shrinkPage(info: LogRangeErrorInfo, span: number): number {
  const page =
    info.maxRange ??
    (info.suggestedRange
      ? info.suggestedRange[1] - info.suggestedRange[0] + 1
      : Math.floor(span / 2))
  return Math.max(MIN_LOG_RANGE, page)
}

/**
 * Streams raw logs over `[fromBlock, toBlock]`, paginating by `pageBox.value`
 * and adaptively shrinking the page (down to {@link MIN_LOG_RANGE}) whenever the
 * RPC rejects a chunk as too wide. The learned page is propagated through
 * `pageBox` (and the endpoint registry) so subsequent chunks — and the watch
 * loop — start at the smaller size without re-failing. Throws
 * {@link CCIPLogRangeTooLargeError} when a single chunk can't be subdivided.
 *
 * When `endTag` (a dynamic end tag like 'latest'/'safe', whose numeric value is
 * `toBlock`) is given, the terminal chunk is fetched against that tag instead of
 * a number, so a serving RPC resolves the head itself — avoiding -32602 from a
 * numeric toBlock that is ahead of a lagging node's tip.
 */
async function* streamLogs(
  provider: JsonRpcApiProvider,
  baseFilter: BaseFilter,
  fromBlock: number,
  toBlock: number,
  pageBox: { value: number },
  url: string | undefined,
  logger: Logger,
  endTag?: EVMEndBlockTag | bigint,
): AsyncGenerator<Log> {
  // `cursor <= toBlock` makes an inverted range (fromBlock > toBlock) yield
  // nothing without ever issuing a getLogs; the page is clamped to >=1 so a
  // degenerate page can't invert a chunk either.
  for (let cursor = fromBlock; cursor <= toBlock;) {
    const page = Math.max(1, pageBox.value)
    let chunkTo = Math.min(cursor + page - 1, toBlock)

    // The terminal chunk (the one reaching the end) is fetched against the end
    // TAG rather than a numeric block, so a serving RPC resolves the head itself
    // instead of rejecting a numeric toBlock that may be ahead of its tip. When
    // this isn't the first/only chunk (the caller already resolved the head once),
    // re-resolve first to catch chain growth: if the head moved past the chunk
    // boundary, extend and keep paginating numerically, re-checking when the new
    // terminal chunk is reached.
    let useTag = false
    if (endTag !== undefined && chunkTo >= toBlock) {
      if (cursor > fromBlock) {
        // Null (block momentarily unavailable) → don't extend; the tag fetch below
        // still resolves the head on the serving RPC.
        const fresh = await provider.getBlock(endTag)
        if (fresh && fresh.number > toBlock) {
          toBlock = fresh.number
          chunkTo = Math.min(cursor + page - 1, toBlock)
        }
      }
      useTag = chunkTo >= toBlock // still terminal after any growth → fetch by tag
    }

    // toBlock derives from the FINAL chunkTo: the tag when terminal, else the
    // (possibly extended) numeric boundary.
    const toFilter: number | EVMEndBlockTag | bigint = useTag ? endTag! : chunkTo
    const filter_ = { fromBlock: cursor, toBlock: toFilter, ...baseFilter }
    logger.debug('evm getLogs:', filter_)
    try {
      yield* await provider.getLogs(filter_)
      cursor = chunkTo + 1 // advance only after a chunk succeeds
    } catch (err) {
      // An invalid/inverted range (-32602) — e.g. a round-robin proxy landed on a
      // downstream node whose head lags behind this chunk — is deliberately NOT
      // swallowed here. In a bounded (non-watch) backfill there is no later tick to
      // re-scan the tail, so skipping the chunk as empty would let the caller
      // checkpoint past blocks that were never actually read (silent log loss).
      // Let it bubble: the activity fails and Temporal retries from the same
      // startBlock, hitting a healthier node. parseLogRangeError returns null for
      // -32602, so the throw below covers it.
      const rangeInfo = parseLogRangeError(err)
      if (rangeInfo === null) throw err

      const span = chunkTo - cursor + 1
      const newPage = shrinkPage(rangeInfo, span)
      if (newPage >= span) {
        // Already at the floor and still too large — cannot subdivide further.
        throw new CCIPLogRangeTooLargeError(
          { requestedRange: span, ...rangeInfo },
          { cause: err instanceof Error ? err : undefined },
        )
      }

      logger.warn(`evm getLogs: range too large (span=${span}), shrinking page to ${newPage}`, {
        url,
        err,
      })
      if (url !== undefined) setEndpointLogRange(url, newPage, 'error')
      pageBox.value = Math.min(pageBox.value, newPage)
      // Retry the same cursor with the smaller page on the next iteration.
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
  // Work on a shallow copy: getEvmLogs resolves page/endBlock/startBlock/topics
  // in place, and must not mutate the caller's filter object.
  filter = { ...filter }

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
    if (!topics.size) throw new CCIPLogTopicsNotFoundError(filter.topics)
    filter.topics = [Array.from(topics)]
  }

  // Determine endpoint URL for cross-instance log-range learning
  const endpointUrl = getProviderUrl(provider)

  // Seed initial page: explicit user value > learned endpoint value > default 10e3.
  // MIN_LOG_RANGE only floors error-driven shrinks, never this initial size.
  filter.page ??= getEndpointLogRange(endpointUrl ?? 'unknown') ?? 10e3
  filter.page = Number(filter.page)
  // Mutable box so streamLogs can propagate learned page shrinks back to the watch loop.
  const pageBox = { value: filter.page }

  filter.endBlock ||= 'latest'
  const endTag = filter.endBlock
  // Dynamic ends (a tag like 'latest'/'safe', or a negative depth) move with the
  // chain head; stream the terminal backfill chunk against the tag so a lagging
  // RPC resolves the head itself. A fixed positive endBlock is inert (the "tag"
  // is just the number), so pass undefined and keep plain numeric chunking.
  const endIsDynamic = typeof endTag === 'string' || Number(endTag) < 0
  const { number: endBlock } = (await provider.getBlock(endTag))!
  filter.startBlock ??= await getSomeBlockNumberBefore(
    async (block: number) => (await ctx.getBlockInfo(block)).timestamp,
    endBlock,
    Number(filter.startTime!),
    ctx,
  )
  filter.startBlock = Number(filter.startBlock)
  let latestLogBlockNumber = filter.startBlock - 1

  const baseFilter: BaseFilter = {
    ...(filter.address ? { address: filter.address } : {}),
    ...(filter.topics?.length ? { topics: filter.topics } : {}),
  }

  // Enrich each raw log with its block timestamp and track the highest block
  // seen, so the watch loop knows where to resume.
  async function* emit(logs: AsyncIterable<Log> | Iterable<Log>): AsyncGenerator<ChainLog> {
    for await (const log of logs) {
      if (log.blockNumber > latestLogBlockNumber) latestLogBlockNumber = log.blockNumber
      yield { ...log, blockTimestamp: (await ctx.getBlockInfo(log.blockNumber)).timestamp }
    }
  }

  // Backfill: stream [startBlock, endBlock], paginating + shrinking adaptively.
  // The terminal chunk is fetched against the end tag when it's dynamic.
  yield* emit(
    streamLogs(
      provider,
      baseFilter,
      filter.startBlock,
      endBlock,
      pageBox,
      endpointUrl,
      logger,
      endIsDynamic ? endTag : undefined,
    ),
  )

  // Watch mode, otherwise return.
  let lastEvent
  while (filter.watch && (!(filter.watch instanceof AbortSignal) || !filter.watch.aborted)) {
    // When no log advanced latestLogBlockNumber, fall back to a window ending at
    // `endBlock`, sized at 0.9*page so that if `latest` moves forward between this
    // resolution and the getLogs call the span still stays under the page limit.
    const watchFrom = Math.max(latestLogBlockNumber, endBlock - Math.floor(pageBox.value * 0.9)) + 1
    // Prefer streaming up to the endBlock TAG itself ('latest'/'safe'/'finalized')
    // so the RPC resolves the head atomically — a separate getBlock could land on
    // a slightly different head. Resolve to a number only if we must paginate.
    const toBlockTag = await provider._getBlockTag(filter.endBlock)
    const filter_ = { fromBlock: watchFrom, toBlock: toBlockTag, ...baseFilter }
    logger.debug('evm watch getLogs:', { ...filter_, lastEvent })

    // Optimistic single call; the new tail is usually small. Keep getLogs alone in
    // the try so enrichment errors propagate rather than being mistaken for range
    // errors.
    let watchLogs: Log[] = []
    try {
      watchLogs = await provider.getLogs(filter_)
    } catch (err) {
      if (!isInvalidBlockRangesError(err)) {
        // An inverted range (head < watchFrom, no new blocks yet) is benign and
        // leaves watchLogs empty; otherwise it must be a range-too-large error.
        const rangeInfo = parseLogRangeError(err)
        if (rangeInfo === null) throw err

        // Range too large: now resolve the tag to a number so streamLogs can
        // paginate it (streamLogs guards an inverted [watchFrom, toBlock] as empty).
        const toBlockNum = /^0x/i.test(toBlockTag)
          ? parseInt(toBlockTag, 16)
          : (await provider.getBlock(toBlockTag))!.number
        yield* emit(
          streamLogs(provider, baseFilter, watchFrom, toBlockNum, pageBox, endpointUrl, logger),
        )
        // Advance past the whole covered range so the next watchFrom doesn't
        // re-request these blocks even if none of them held logs.
        latestLogBlockNumber = Math.max(latestLogBlockNumber, toBlockNum)
      }
    }
    yield* emit(watchLogs)

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
