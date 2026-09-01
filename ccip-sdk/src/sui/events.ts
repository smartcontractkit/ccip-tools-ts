import type { EventId, SuiEvent, SuiEventFilter, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { memoize } from 'micro-memoize'

import { withSinceStart } from '../chain.ts'
import {
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import type { Logger, WithLogger } from '../types.ts'
import { getBlockNumberAtOrAfter, signalToPromise } from '../utils.ts'
import {
  type SuiLogStreamOpts,
  SUI_OFFRAMP_EXECUTE_FUNCTIONS,
  SUI_OFFRAMP_MODULE,
  getSuiExecutionFailureLog,
} from './logs.ts'

type MerkleRoot = {
  on_ramp_address: string
  source_chain_selector: string
  merkle_root: string
  min_seq_nr: string
  max_seq_nr: string
}

/**
 * Commit event data structure from Sui blockchain.
 */
export type CommitEvent = {
  blessed_merkle_roots: MerkleRoot[]
  unblessed_merkle_roots: MerkleRoot[]
}

type EventNode<T = unknown> = {
  sequenceNumber: string
  sender: {
    address: string
  }
  timestamp: string
  /** Raw Move event type (`pkg::module::EventName`); lets callers derive the topic per event. */
  type: string
  contents?: {
    json: T
  }
  transaction?: {
    effects: {
      checkpoint: {
        sequenceNumber: number
      }
    }
    digest: string
  }
}

/** Checkpoint metadata (number + timestamp + execution status) of a transaction, cached per tx digest. */
type TxMeta = { checkpoint: number; timestampMs: number; status?: 'success' | 'failure' }

/** Max digests per `multiGetTransactionBlocks` call. */
const MULTI_GET_CHUNK = 50

/**
 * Load-balanced RPC proxies may route lookups to a backend whose store hasn't
 * caught up (or is partially synced): event cursor lookups answer -32603
 * "Could not find the referenced transaction ...", object reads come back
 * empty/missing (state pointers, pool objects, metadata). These are
 * transient: another attempt usually lands on a synced backend. Retry only
 * those, with small backoff.
 */
const TRANSIENT_LOOKUP_ERROR =
  /could not find the referenced transaction|No CCIP ObjectRef Pointer found|Invalid token pool type|Error loading Sui token metadata|not a CoinMetadata object or coin type|Unexpected status code: (429|5\d\d)/i

/**
 * The deprecated `queryEvents` API is broken chain-wide on current nodes: every
 * match walk eventually references a transaction whose events the node can no
 * longer resolve (retention-boundary), even cursor-less. When this is hit, the
 * stream falls back to walking checkpoints (`getCheckpoints` +
 * `multiGetTransactionBlocks`), which serves whatever the node still retains.
 */
const REFERENCED_TX_EVENTS_ERROR = /could not find the referenced transaction events/i

/** Retries RPC lookups which may transiently fail on unsynced proxy backends. */
export async function withLookupRetry<T>(op: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await op()
    } catch (err) {
      lastErr = err
      // The retention-boundary failure is permanent for the failing query —
      // retrying it only delays the caller's switch to the checkpoint walk.
      if (err instanceof Error && REFERENCED_TX_EVENTS_ERROR.test(err.message)) throw err
      if (!(err instanceof Error) || !TRANSIENT_LOOKUP_ERROR.test(err.message)) throw err
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
    }
  }
  throw lastErr
}

/** Cap on the tx-meta cache, so long-running watch streams don't grow it unboundedly. */
const TX_META_CACHE_MAX = 10_000

/**
 * Gets the latest checkpoint sequence number from the JSON-RPC endpoint.
 */
async function getLatestCheckpoint(client: SuiJsonRpcClient): Promise<number> {
  return Number(await client.getLatestCheckpointSequenceNumber())
}

async function getCheckpointTimestamp(client: SuiJsonRpcClient, seq: number): Promise<number> {
  const checkpoint = await client.getCheckpoint({ id: String(seq) })
  return Number(checkpoint.timestampMs) / 1000
}

/**
 * Finds the first checkpoint at or after `startTime` (in seconds), by searching
 * checkpoint timestamps over JSON-RPC.
 *
 * `logger` must be forwarded: getBlockNumberAtOrAfter defaults it to `console`, so
 * omitting it sends this search's per-probe debug lines straight to stdout,
 * bypassing whatever logger the caller configured.
 */
async function getCheckpointAtOrAfter(
  client: SuiJsonRpcClient,
  startTime: number,
  logger?: Logger,
): Promise<number> {
  const latest = await getLatestCheckpoint(client)
  return getBlockNumberAtOrAfter((seq) => getCheckpointTimestamp(client, seq), latest, startTime, {
    logger,
  })
}

/**
 * Resolves checkpoint number and timestamp for every tx digest in `events`,
 * caching per digest and batching lookups with `multiGetTransactionBlocks`.
 */
async function resolveTxMetas(
  client: SuiJsonRpcClient,
  events: SuiEvent[],
  cache: Map<string, TxMeta>,
  withStatus = false,
): Promise<void> {
  if (cache.size > TX_META_CACHE_MAX) cache.clear()
  const missing = [...new Set(events.map((e) => e.id.txDigest).filter((d) => !cache.has(d)))]
  for (let i = 0; i < missing.length; i += MULTI_GET_CHUNK) {
    const txs = await withLookupRetry(() =>
      client.multiGetTransactionBlocks({
        digests: missing.slice(i, i + MULTI_GET_CHUNK),
        ...(withStatus ? { options: { showEffects: true } } : {}),
      }),
    )
    for (const tx of txs) {
      cache.set(tx.digest, {
        checkpoint: Number(tx.checkpoint ?? 0),
        timestampMs: Number(tx.timestampMs ?? 0),
        ...(withStatus && tx.effects?.status.status ? { status: tx.effects.status.status } : {}),
      })
    }
  }
}

async function collectByCheckpointWalk<T>(
  client: SuiJsonRpcClient,
  types: string[],
  fromCheckpoint: number,
  toCheckpoint: number,
  txMetas: Map<string, TxMeta>,
  withStatus = false,
): Promise<EventNode<T>[]> {
  const collected: EventNode<T>[] = []
  let cursor: string | null | undefined = String(fromCheckpoint)
  for (;;) {
    const page = await withLookupRetry(() =>
      client.getCheckpoints({ cursor, limit: 100, descendingOrder: false }),
    )
    // Walk mode fills the shared tx-meta cache directly, bypassing the cap check
    // in resolveTxMetas — enforce the same bound here so long-running watch
    // streams (e.g. after a queryEvents retention-boundary failure) can't grow
    // it unboundedly. Lookups below only consume digests set on THIS page, so
    // clearing an overfull cache just before inserting never evicts an entry
    // still in flight.
    if (txMetas.size > TX_META_CACHE_MAX) txMetas.clear()
    const digests: string[] = []
    let pastWindow = false
    for (const checkpoint of page.data) {
      const seq = Number(checkpoint.sequenceNumber)
      if (seq < fromCheckpoint) continue
      if (seq > toCheckpoint) {
        pastWindow = true
        break
      }
      const meta: TxMeta = {
        checkpoint: seq,
        timestampMs: Number(checkpoint.timestampMs),
      }
      for (const digest of checkpoint.transactions) {
        txMetas.set(digest, meta)
        digests.push(digest)
      }
    }

    for (let i = 0; i < digests.length; i += MULTI_GET_CHUNK) {
      const txs = await withLookupRetry(() =>
        client.multiGetTransactionBlocks({
          digests: digests.slice(i, i + MULTI_GET_CHUNK),
          options: withStatus ? { showEvents: true, showEffects: true } : { showEvents: true },
        }),
      )
      for (const tx of txs) {
        const meta = txMetas.get(tx.digest)
        if (!meta) continue
        for (const event of tx.events ?? []) {
          if (!types.includes(event.type)) continue
          // A failed PTB's partial events can carry a stale success
          // ExecutionStateChanged (the event fires before the final steps); the
          // failure scan synthesizes the state=3 log instead.
          if (
            withStatus &&
            tx.effects?.status.status === 'failure' &&
            isExecutionStateEvent(event.type)
          )
            continue
          collected.push(toEventNode<T>(event, meta))
        }
      }
    }

    if (pastWindow || !page.hasNextPage) break
    cursor = page.nextCursor
  }

  // walk order is ascending; sort for a deterministic merge
  collected.sort(
    (a, b) =>
      a.transaction!.effects.checkpoint.sequenceNumber -
        b.transaction!.effects.checkpoint.sequenceNumber ||
      a.transaction!.digest.localeCompare(b.transaction!.digest) ||
      Number(a.sequenceNumber) - Number(b.sequenceNumber),
  )
  return collected
}

function toEventNode<T>(event: SuiEvent, meta: TxMeta): EventNode<T> {
  return {
    sequenceNumber: event.id.eventSeq,
    sender: { address: event.sender },
    timestamp: new Date(meta.timestampMs || Number(event.timestampMs ?? 0)).toISOString(),
    type: event.type,
    contents: { json: event.parsedJson as T },
    transaction: {
      digest: event.id.txDigest,
      effects: {
        checkpoint: { sequenceNumber: meta.checkpoint },
      },
    },
  }
}

/** True when a Move event type is the OffRamp's execution-state event. */
function isExecutionStateEvent(type: string): boolean {
  return type.endsWith('::ExecutionStateChanged')
}

/**
 * Descending scan for FAILED OffRamp executions within a checkpoint window,
 * merged into the round's ascending collection. Failed executions emit no
 * ExecutionStateChanged event (and a failed PTB's partial events can include a
 * stale success one), so they are found from the transactions themselves: the
 * MoveFunction filter keeps the scan per-contract server-side — no chain-wide
 * walk, no indexer needed. Each execute function runs its own walk from the
 * tip, stopping once a confirmed checkpoint drops below the window floor (the
 * same early-exit the per-type event queries use); un-checkpointed (0) txs at
 * the tip are skipped rather than allowed to end the walk.
 */
async function fetchSuiFailureScanRound(
  client: SuiJsonRpcClient,
  offRampAddress: string,
  fromCheckpoint: number,
  toCheckpoint: number,
  collected: EventNode<unknown>[],
  startTime?: number,
  limit = 50,
): Promise<void> {
  // the caller's package, not the current latest: the Move event types the
  // stream filters prefix with the package the execution ran on, and this
  // scan's MoveFunction filter must match the same package — the latest at
  // execution time, not the current latest (historical windows predate upgrades)
  const offRampPkg = normalizeSuiAddress(offRampAddress.split('::')[0]!)
  for (const fn of SUI_OFFRAMP_EXECUTE_FUNCTIONS) {
    let cursor: string | null | undefined
    let pastFloor = false
    for (;;) {
      if (pastFloor) break
      const res = await withLookupRetry(() =>
        client.queryTransactionBlocks({
          filter: {
            MoveFunction: { package: offRampPkg, module: SUI_OFFRAMP_MODULE, function: fn },
          },
          options: { showEffects: true, showInput: true },
          cursor,
          limit,
          order: 'descending',
        }),
      )
      for (const block of res.data) {
        const checkpoint = Number(block.checkpoint ?? 0)
        // descending: once a confirmed checkpoint is below the window floor,
        // everything after is older; un-checkpointed (0) tip txs are deferred —
        // the next round re-walks the tail and finds them checkpointed
        if (checkpoint && checkpoint < fromCheckpoint) {
          pastFloor = true
          break
        }
        if (!checkpoint || checkpoint > toCheckpoint) continue
        if (startTime != null && Number(block.timestampMs ?? 0) / 1000 < startTime) continue
        const failureLog = getSuiExecutionFailureLog(block)
        if (!failureLog) continue
        collected.push({
          sequenceNumber: '0',
          sender: { address: block.transaction?.data.sender ?? '' },
          timestamp: new Date(Number(block.timestampMs ?? 0)).toISOString(),
          // full Move event type — the synthetic log's address is the bare
          // package (like real event logs), the module comes from the scan's own
          // filter
          type: `${offRampPkg}::${SUI_OFFRAMP_MODULE}::ExecutionStateChanged`,
          contents: { json: failureLog.data as Record<string, unknown> },
          transaction: {
            digest: block.digest,
            effects: { checkpoint: { sequenceNumber: checkpoint } },
          },
        } satisfies EventNode<Record<string, unknown>>)
      }
      if (!res.hasNextPage || !res.data.length) break
      if (cursor && res.nextCursor === cursor) break
      cursor = res.nextCursor
    }
  }
}

/**
 * Fetches events in forward direction (ascending checkpoint order), using only
 * the JSON-RPC API (`queryEvents` + `multiGetTransactionBlocks`).
 *
 * Since JSON-RPC can't filter events by checkpoint range, each batch paginates
 * `queryEvents` descending from the tip until it reaches events older than the
 * batch start, resolving checkpoints per tx digest (cached), then yields the
 * collected range in ascending order.
 *
 * Unlike Aptos event handles, Sui checkpoints are a single global clock shared
 * by every Move event type — there's no per-type sequence-number space to
 * track independently. So all `types` share ONE checkpoint cursor/window;
 * each type just runs its own `queryEvents` pagination pass (with its own
 * early-exit once it walks past the window) into the SAME `collected` array,
 * which is then merge-sorted once before yielding for the round.
 */
async function* fetchEventsForward<T>(
  ctx: { client: SuiJsonRpcClient } & WithLogger,
  opts: SuiLogStreamOpts,
  types: string[],
  limit = 50,
): AsyncGenerator<EventNode<T>> {
  const DEFAULT_POLL_INTERVAL = 5e3

  if (
    opts.watch &&
    (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
    Number(opts.endBlock) > 0
  )
    throw new CCIPLogsWatchRequiresFinalityError(Number(opts.endBlock))

  // Determine starting checkpoint
  let startCheckpoint: number | undefined
  if (opts.startBlock != null) startCheckpoint = Number(opts.startBlock)
  if (opts.startTime != null) {
    const startCheckpoint_ = await getCheckpointAtOrAfter(
      ctx.client,
      Number(opts.startTime),
      ctx.logger,
    )
    if (startCheckpoint != null) startCheckpoint = Math.max(startCheckpoint, startCheckpoint_)
    else startCheckpoint = startCheckpoint_
  }
  if (startCheckpoint == null) throw new CCIPLogsRequiresStartError()

  // Latest checkpoint is cached for a poll interval, so watch iterations and
  // negative endBlock resolutions don't hammer the endpoint
  const getLatest = memoize(() => getLatestCheckpoint(ctx.client), {
    async: true,
    maxArgs: 0,
    expires: opts.pollInterval || DEFAULT_POLL_INTERVAL,
  })

  // Determine ending checkpoint
  let endCheckpoint: number | undefined
  if (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') {
    if (Number(opts.endBlock) < 0) {
      // Negative means relative to latest
      endCheckpoint = (await getLatest()) + Number(opts.endBlock)
    } else {
      endCheckpoint = Number(opts.endBlock)
    }
  }

  const filters: SuiEventFilter[] = types.map((type) => ({ MoveEventType: type }))
  const txMetas = new Map<string, TxMeta>()
  // ExecutionStateChanged streams also scan failed executions from the offramp
  // execute transactions themselves (see fetchSuiFailureScanRound); the event
  // path needs each matched tx's execution status to suppress the stale success
  // markers a failed PTB can leave behind, so metas carry it for such streams.
  const hasExecutionStateTopic = types.some((type) => isExecutionStateEvent(type))
  let failureScanWarned = false
  let currentCheckpoint = startCheckpoint
  let catchedUp = false
  let softRounds = 0 // consecutive rounds lost to transient backend lag
  let walkMode = false // queryEvents is unusable; walk checkpoints instead

  while (
    (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) ||
    !catchedUp
  ) {
    const lastReq = performance.now()

    // Determine the range for this batch
    let batchEndCheckpoint: number
    if (endCheckpoint !== undefined && !opts.watch) {
      batchEndCheckpoint = endCheckpoint
    } else {
      batchEndCheckpoint = await getLatest()
      if (endCheckpoint !== undefined) {
        batchEndCheckpoint = Math.min(batchEndCheckpoint, endCheckpoint)
      }
    }

    // Fetch events for this checkpoint range
    if (currentCheckpoint <= batchEndCheckpoint) {
      const collected: EventNode<T>[] = []
      let roundTransientErr: unknown

      if (walkMode) {
        // The node's queryEvents is unusable: walk checkpoints and read each
        // tx's events, which serves whatever the node still retains
        collected.push(
          ...(await collectByCheckpointWalk<T>(
            ctx.client,
            types,
            currentCheckpoint,
            batchEndCheckpoint,
            txMetas,
            hasExecutionStateTopic,
          )),
        )
      } else {
        // Each type runs its own descending-paginated query with its own cursor
        // and early-exit (`done`) — a quiet type walking past the window must
        // not affect a busier type's pagination — but every type accumulates
        // into the SAME collected array so the whole round merges into one
        // ascending stream below.
        for (const filter of filters) {
          let cursor: EventId | null | undefined = undefined
          let cursorResets = 0
          let done = false

          while (!done) {
            let page
            try {
              page = await withLookupRetry(() =>
                ctx.client.queryEvents({
                  query: filter,
                  cursor,
                  limit,
                  order: 'descending',
                }),
              )
            } catch (err) {
              if (err instanceof Error && REFERENCED_TX_EVENTS_ERROR.test(err.message)) {
                // The retention-boundary failure is permanent for queryEvents
                // on current nodes: switch the whole stream to the checkpoint
                // walk and redo this round with it
                walkMode = true
                collected.length = 0
                break
              }
              // Load-balanced proxy backends whose store hasn't caught up to
              // the tip yet answer -32603 "Could not find the referenced
              // transaction events": the range isn't gone, just not visible
              // from this backend yet. A cursorless retry often lands on a
              // synced backend, so give the first page two fresh shots before
              // treating the round as lost (then don't advance the cursor:
              // watch mode keeps polling).
              if (err instanceof Error && TRANSIENT_LOOKUP_ERROR.test(err.message)) {
                if (cursor != null && cursorResets < 2) {
                  cursor = undefined
                  cursorResets++
                  continue
                }
                roundTransientErr = err
                break
              }
              throw err
            }
            if (!page.data.length) break

            await resolveTxMetas(ctx.client, page.data, txMetas, hasExecutionStateTopic)

            for (const event of page.data) {
              const meta = txMetas.get(event.id.txDigest)!
              // descending order: once we pass the start of the range, so does everything after
              if (meta.checkpoint < currentCheckpoint) {
                done = true
                break
              }
              if (meta.checkpoint > batchEndCheckpoint) continue
              // Filter by startTime if provided
              if (opts.startTime != null && meta.timestampMs / 1000 < Number(opts.startTime))
                continue
              // A failed PTB's partial events can carry a stale success
              // ExecutionStateChanged (the event fires before the final steps);
              // the failure scan yields the state=3 log for it instead.
              if (
                hasExecutionStateTopic &&
                meta.status === 'failure' &&
                isExecutionStateEvent(event.type)
              )
                continue
              collected.push(toEventNode<T>(event, meta))
            }

            if (!page.hasNextPage) break
            cursor = page.nextCursor
          }
          if (walkMode) break
        }

        if (walkMode) {
          collected.push(
            ...(await collectByCheckpointWalk<T>(
              ctx.client,
              types,
              currentCheckpoint,
              batchEndCheckpoint,
              txMetas,
              hasExecutionStateTopic,
            )),
          )
        }
      }

      // Failed executions never emit ExecutionStateChanged (and a failed PTB
      // can leave a stale success event behind), so execution failures are
      // scanned for separately — per-contract via the MoveFunction filter —
      // and merged into the same ascending round. This runs in walkMode too:
      // the checkpoint walk only sees events, and failed executions have none.
      // Unavailable scans degrade to successes-only streaming with a one-time
      // warning, like the Aptos indexer's absence. Skipped when the event side
      // transient-failed with nothing collected: the round then retries whole
      // (cursor not advanced), rather than yielding failures alone and
      // advancing past a window whose successes were never read.
      if (
        hasExecutionStateTopic &&
        opts.address != null &&
        !(roundTransientErr && !collected.length)
      ) {
        try {
          await fetchSuiFailureScanRound(
            ctx.client,
            opts.address,
            currentCheckpoint,
            batchEndCheckpoint,
            collected as unknown as EventNode<unknown>[],
            opts.startTime != null ? Number(opts.startTime) : undefined,
          )
        } catch (err) {
          if (!failureScanWarned) {
            failureScanWarned = true
            ctx.logger?.warn(
              `Sui execution-failure scan is unavailable; successful executions keep ` +
                `streaming, failed ones will not be reported (${(err as Error).message})`,
            )
          }
        }
      }

      if (roundTransientErr && !collected.length) {
        // nothing readable this round: keep the checkpoint cursor where it is
        // and retry the round; bounded callers give up eventually, watchers
        // ride it out across polls
        softRounds++
        if (!opts.watch && softRounds >= 6) {
          // Bounded scans end gracefully: the lagging backend just misses the
          // tail of the range (callers refetch receipts on their own cadence);
          // throwing would break show/wait flows with proxy lag
          ctx.logger?.warn(
            `Sui event lookups kept failing on this RPC after ${softRounds} rounds; ` +
              `stopping the scan early (${(roundTransientErr as Error).message})`,
          )
          return
        }
      } else {
        softRounds = 0

        // collected now interleaves every type, each internally descending —
        // sort ascending by (checkpoint, txDigest, eventSeq) so the merged
        // output stays globally ascending instead of one-type-then-the-next
        // (the caller advances a per-address block watermark and assumes a
        // block is never split across returns).
        collected.sort(
          (a, b) =>
            a.transaction!.effects.checkpoint.sequenceNumber -
              b.transaction!.effects.checkpoint.sequenceNumber ||
            a.transaction!.digest.localeCompare(b.transaction!.digest) ||
            Number(a.sequenceNumber) - Number(b.sequenceNumber),
        )
        for (const node of collected) yield node

        currentCheckpoint = batchEndCheckpoint + 1
      }
    }

    catchedUp ||= currentCheckpoint > batchEndCheckpoint

    // soft rounds (backend store lag) also need a poll pause when watching,
    // otherwise the loop would hot-spin a lagging proxy backend
    if (opts.watch && (catchedUp || softRounds > 0)) {
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
 * Streams logs from the Sui blockchain based on filter options.
 * @param ctx - Context containing the Sui JSON-RPC client.
 * @param opts - Log filter options.
 * @returns Async generator of log entries.
 */
export async function* streamSuiLogs<T>(
  ctx: { client: SuiJsonRpcClient },
  opts: SuiLogStreamOpts,
): AsyncGenerator<EventNode<T>> {
  if (!opts.topics?.length) throw new CCIPTopicsInvalidError(opts.topics!)

  // Construct one full Sui event type filter per topic: package_id::module_name::EventName
  // opts.address is in format: package_id::module_name
  // each topic is an EventName
  const types = opts.topics.map((topic) => {
    if (typeof topic !== 'string') throw new CCIPTopicsInvalidError(opts.topics!)
    return `${opts.address}::${topic}`
  })

  // `since.blockNumber`/`blockTimestamp` stand in for (or raise) startBlock/startTime.
  opts = withSinceStart(opts)

  const hasStart = opts.startBlock != null || opts.startTime != null
  if (!hasStart) throw new CCIPLogsRequiresStartError()

  yield* fetchEventsForward<T>(ctx, opts, types)
}
