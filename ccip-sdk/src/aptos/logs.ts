import {
  type Aptos,
  type Event as AptosEvent,
  type UserTransactionResponse,
  AptosApiError,
  TransactionResponseType,
  getAptosFullNode,
} from '@aptos-labs/ts-sdk'
import { memoize } from 'micro-memoize'
import type { SetRequired } from 'type-fest'

import { type Chain, type LogFilter, withSinceStart } from '../chain.ts'
import {
  CCIPAptosAddressModuleRequiredError,
  CCIPAptosTransactionTypeUnexpectedError,
  CCIPLogsRequiresStartError,
  CCIPLogsWatchRequiresFinalityError,
  CCIPNotImplementedError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import type { ChainLog, LeanNumbers, WithLogger } from '../types.ts'
import { passesTypeAndVersion, signalToPromise } from '../utils.ts'

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

/**
 * Sets up the per-handle fetch/cursor state for ONE Aptos event handle.
 *
 * Every Aptos event handle owns its OWN independent sequence-number space —
 * handle A's sequence 0 has nothing to do with handle B's sequence 0 — so each
 * handle needs its own memoized `fetchBatch`, its own `start`/`end` cursors and
 * its own `notAfter` resolution. They cannot share a single cursor the way a
 * single-topic stream did before multi-topic support.
 *
 * Returns undefined if the handle has never emitted anything: mirrors the
 * pre-multi-topic behaviour of ending the stream immediately for a handle with
 * no history (rather than polling a handle that may never emit, even in watch
 * mode) — now scoped to just that one handle instead of the whole stream.
 */
/**
 * `<address>::<Struct/field>` handles the node has answered 404 for, i.e. event
 * handles the resource at that address simply doesn't declare. Polling a mixed
 * topic set (say both ramp sides' handles) hits these on EVERY address that owns
 * only the other side's, so without this each poll would re-issue — and re-404 —
 * one request per absent handle, forever.
 *
 * Keyed by the Aptos provider, which scopes it per network and, since a `WeakMap`
 * holds the key weakly, lets the whole entry go when the chain object does. Callers
 * that periodically rebuild their chains (the CCIP-o11y worker reloads every 10
 * minutes) therefore get a natural TTL: a handle that only appears later — after a
 * contract upgrade — is rediscovered on the next rebuild rather than being written
 * off for the life of the process.
 */
const missingHandles = new WeakMap<Aptos, Set<string>>()

/**
 * The resume cursor derivable from a LogFilter.since hint. Two independently usable
 * coordinates: `seq` (the hint's `index` — the emitting handle's event
 * sequence_number) is an exact cursor, but each event handle owns an INDEPENDENT
 * sequence space, so it is only attributable on single-handle streams; `block` (the
 * hint's `blockNumber` — a ledger version) is global and can floor every handle of a
 * multi-handle stream (see fetchEventsForward).
 */
type AptosResumeHint = { seq?: number; block?: number; timestamp?: number }

/** Parses and validates opts.since; undefined when absent, malformed, or
 * foreign-addressed (the emitted log carries opts.address verbatim, so an equal-form
 * or absent address is expected — anything else is not this stream's hint). */
function parseResumeHint(opts: LeanNumbers<LogFilter>): AptosResumeHint | undefined {
  const hint = opts.since
  if (!hint) return undefined
  if (hint.address && hint.address.toLowerCase() !== opts.address!.toLowerCase()) return undefined
  const seq = Number(hint.index)
  const block = Number(hint.blockNumber)
  const timestamp = Number(hint.blockTimestamp)
  const parsed: AptosResumeHint = {
    block: Number.isFinite(block) && block > 0 ? block : undefined,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined,
  }
  if (Number.isSafeInteger(seq) && seq >= 0) parsed.seq = seq
  if (parsed.seq == null && parsed.block == null) return undefined
  return parsed
}

async function initHandleState(
  { provider }: { provider: Aptos },
  opts: LeanNumbers<LogFilter> & { pollInterval?: number },
  eventHandlerField: string,
  stateAddr: string,
  limit: number,
  hint?: AptosResumeHint & { seq: number },
) {
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

  // A caller may pass the handles for BOTH ramp sides and let each address answer
  // for the ones it actually owns — an on-ramp has no OffRampState/* handle and
  // vice-versa, and the node 404s for a handle the resource doesn't declare. Treat
  // that as "this address has no such handle", exactly like an existing-but-empty
  // one, so a mixed topic set doesn't fail the whole scan.
  //
  // The 404 is then remembered, so subsequent polls skip the request entirely
  // instead of re-404ing once per handle per poll forever (see missingHandles).
  //
  // Deliberately narrow: only a 404 is swallowed. Any other failure (a transient RPC
  // error above all) still propagates, because silently returning no logs there
  // would be indistinguishable from "nothing happened on chain" — and is NOT
  // remembered, so a recovered RPC is picked straight back up.
  const handleKey = `${opts.address}::${eventHandlerField}`
  if (missingHandles.get(provider)?.has(handleKey)) return undefined
  let initialBatch: ResEvent[]
  try {
    initialBatch = await fetchBatch()
  } catch (err) {
    if (err instanceof AptosApiError && err.status === 404) {
      let known = missingHandles.get(provider)
      if (!known) missingHandles.set(provider, (known = new Set()))
      known.add(handleKey)
      return undefined
    }
    throw err
  }
  if (!initialBatch.length) return undefined
  const end = +initialBatch[initialBatch.length - 1]!.sequence_number

  // The hint covers the floor when it sits past every requested start bound —
  // resuming at seq+1 then IS the floor, so the floor computation (and its binary
  // search / timestamp lookups) is skipped entirely.
  const hintCoversFloor =
    hint != null &&
    (opts.startBlock == null || (hint.block != null && hint.block >= Number(opts.startBlock))) &&
    (opts.startTime == null || (hint.timestamp != null && hint.timestamp >= Number(opts.startTime)))

  let start: number | undefined
  if (!hintCoversFloor) {
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
  }
  // Exclusive resume (matching the SVM `until` / TON lt cursors): the hinted event
  // itself is not re-emitted. The hint can only ever RAISE the computed floor.
  if (hint != null) start = Math.max(hint.seq + 1, start ?? 0)

  const notAfter =
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

  return {
    fetchBatch,
    end,
    start: start!,
    notAfter,
    first: true,
    hintCoversFloor,
    limit,
    catchedUp: false,
    // Events fetched but withheld from a previous round because they were
    // above that round's version ceiling (see fetchEventsForward). Released
    // once the ceiling catches up to them, rather than re-fetched.
    pending: [] as ResEvent[],
  }
}

type HandleState = NonNullable<Awaited<ReturnType<typeof initHandleState>>>

// fetchHandleRound reads state.hintCoversFloor: when the resume hint already satisfies
// the startTime floor, the first-batch timestamp check below is pure overhead.

/**
 * Fetches and processes ONE round's worth of events for a single handle,
 * mutating its cursor/catchedUp state and returning the events to merge into
 * this round's ascending output, plus this handle's "ceiling" contribution
 * for the round (see fetchEventsForward for why a ceiling is needed at all).
 * This is the same per-round body a single-topic stream ran inline in its
 * `while` loop, now scoped to one handle so several handles can each advance
 * independently per round.
 */
async function fetchHandleRound(
  { provider }: { provider: Aptos },
  opts: LeanNumbers<LogFilter> & { pollInterval?: number },
  state: HandleState,
): Promise<{ events: ResEvent[]; ceiling: number }> {
  const startBefore = state.start
  const data: ResEvent[] = await state.fetchBatch(state.start)

  if (
    state.first &&
    opts.startTime != null &&
    !state.hintCoversFloor && // the resume hint already satisfies the startTime floor
    data.length > 0 && // a hint past the tip can make the first batch empty
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
    !state.first &&
    state.catchedUp &&
    (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
    Number(opts.endBlock) < 0
  )
    state.notAfter = +(await provider.getLedgerInfo()).ledger_version + Number(opts.endBlock)

  state.first = false

  const out: ResEvent[] = []
  for (const ev of data) {
    if (opts.startBlock != null && +ev.version < Number(opts.startBlock)) continue
    // there may be an unknown interval between yields, so we support memoized negative finality
    if (
      state.notAfter != null &&
      +ev.version > (typeof state.notAfter === 'function' ? await state.notAfter() : state.notAfter)
    ) {
      state.catchedUp = true
      break
    }
    state.start = +ev.sequence_number + 1
    out.push(ev)
  }
  if (state.start === startBefore && data.length > 0) {
    // All events in this batch were skipped (e.g. all below opts.startBlock). Advance start
    // past the tail of the batch so catchedUp can become true and the loop exits cleanly.
    // Without this, the memoized fetchBatch(start) spins as pure microtasks, starving the
    // event loop and making the process unresponsive. Scoped per handle: each handle has its
    // own tail to skip past, independent of how far any other handle has advanced this round.
    state.start = +data[data.length - 1]!.sequence_number + 1
  }
  // `end` is the last EXISTING sequence number (from the tip fetch) and `start`
  // the next one to fetch, so drained means start > end — with `>=`, a handle
  // whose remaining events exactly fill the final batch would be declared caught
  // up while the event AT seq `end` is still unfetched, and it would never be
  // emitted (its version's logs would be delivered incomplete).
  state.catchedUp ||= state.start > state.end

  // This handle's safe ceiling contribution for the round, as an EXCLUSIVE
  // version bound: versions strictly below it are provably complete in this
  // handle's pending queue (a handle's sequence numbers, and hence versions,
  // only increase), while the batch's TAIL version may still be incomplete —
  // batches are sequence-number windows, and one version (one transaction) can
  // own enough events to straddle the boundary into the next batch. Releasing
  // only strictly-below-ceiling versions (see fetchEventsForward) is what makes
  // every version atomic in the output: a getLogs call never emits a version
  // partially, so a resume hint taken from any emitted log can floor at
  // blockNumber + 1 without skipping that version's stragglers.
  //
  // - Drained (catchedUp) and not mid-burst: nothing more can come from this
  //   handle right now, so it can't hold the merge back — contribute +Infinity.
  //   In watch mode a FULL last batch (== limit) means more events may exist
  //   immediately past it, so even a caught-up handle keeps contributing its
  //   tail version until a short/empty batch proves the burst over. (Non-watch
  //   must flush with Infinity instead: the loop exits once every handle is
  //   drained, and held events would never be released.)
  // - Otherwise, use the highest version in the RAW fetched batch (`data`),
  //   not just the events actually returned in `out`: a startBlock skip can
  //   filter every event out of a batch while the handle is still deep in
  //   history (more than `limit` events before the cutoff), leaving `out`
  //   empty for several rounds. Since a handle's sequence numbers (and their
  //   versions) only increase, `data`'s tail is still a valid lower bound on
  //   anything this handle could produce from here on.
  // - `data` should never be empty here while !catchedUp (start <= end means
  //   there's known history left to return), but if some flaky/pruned
  //   fullnode response ever violates that, fall back to +Infinity rather
  //   than pin the ceiling to a phantom low value and stall every other
  //   handle indefinitely.
  const ceiling =
    state.catchedUp && !(opts.watch && data.length === state.limit)
      ? Infinity
      : data.length
        ? +data[data.length - 1]!.version
        : Infinity
  return { events: out, ceiling }
}

async function* fetchEventsForward(
  ctx: { provider: Aptos },
  opts: LeanNumbers<LogFilter> & { pollInterval?: number },
  eventHandlerFields: string[],
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

  const hint = parseResumeHint(opts)
  // Single-handle: the hint's `index` is attributable to the one handle's sequence
  // space — an exact cursor. Multi-handle: a lone `index` can't be attributed (each
  // handle's sequence space is independent), but the hint's blockNumber is a global
  // ledger version — and a ledger version carries exactly ONE transaction, whose
  // events a getLogs call always emits COMPLETE (see the version-atomic ceiling
  // merge below). The hinted version was therefore fully delivered, and the floor
  // resumes strictly past it: blockNumber + 1, exclusive, no redelivery slack.
  let seqHint: (AptosResumeHint & { seq: number }) | undefined
  let opts_ = opts
  if (hint != null) {
    if (eventHandlerFields.length === 1 && hint.seq != null) {
      seqHint = { seq: hint.seq, block: hint.block, timestamp: hint.timestamp }
    } else if (hint.block != null) {
      const versionFloor = hint.block + 1
      if (opts.startBlock == null || versionFloor > Number(opts.startBlock))
        opts_ = { ...opts, startBlock: versionFloor }
    }
  }
  const handleStates = (
    await Promise.all(
      eventHandlerFields.map((field) =>
        initHandleState(ctx, opts_, field, stateAddr, limit, seqHint),
      ),
    )
  ).filter((state): state is HandleState => state !== undefined)

  // Mirrors the single-handle behaviour: if every handle has no events yet
  // (trivially true for a single topic whose lone handle is empty), end the
  // stream now instead of entering the loop below.
  if (!handleStates.length) return

  while (
    (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) ||
    !handleStates.every((state) => state.catchedUp)
  ) {
    const lastReq = performance.now()

    // Fetch this round's new events per handle (skipping handles that are
    // already fully drained when we're not watching), buffering them onto
    // each handle's own `pending` queue, and collect each handle's ceiling
    // contribution for the round.
    const ceilings = await Promise.all(
      handleStates.map(async (state) => {
        if (state.catchedUp && !opts.watch) return Infinity
        const { events, ceiling } = await fetchHandleRound(ctx, opts_, state)
        state.pending.push(...events)
        return ceiling
      }),
    )

    // Bound this round to the tightest (lowest) ceiling across handles.
    // Each handle's own batch is ascending by sequence_number, but batches
    // are windows of SEQUENCE NUMBERS, not versions — one handle's window can
    // span a wildly different (and much further ahead) version range than
    // another's. Naively merge-sorting only *this round's* events would let
    // a far-ahead handle's event get yielded now, while a still-behind
    // handle emits something with a LOWER version in a FUTURE round —
    // breaking global ascending order across rounds (the caller advances a
    // per-address block watermark and assumes a block is never split across,
    // or revisited after, a return). Bounding every round to the lowest
    // "safe" version any handle has confirmed prevents that: nothing above
    // the ceiling is released until some later round's ceiling rises past
    // it.
    //
    // The ceiling is EXCLUSIVE (`<`, not `<=`): a handle's ceiling is the
    // tail version of its current batch, which may still be cut mid-version
    // (a version is one transaction, but it can own more events than a batch
    // holds), so events AT the ceiling wait for a later round to prove the
    // version complete. Every version is therefore emitted in a single round
    // — atomically per getLogs call — which is exactly what the since
    // `blockNumber + 1` resume floor above relies on. Once every handle is
    // drained the ceiling is +Infinity, so the final round still flushes
    // everything and the generator terminates.
    const ceiling = Math.min(...ceilings)

    const roundEvents: { ev: ResEvent; handleIndex: number }[] = []
    for (const [handleIndex, state] of handleStates.entries()) {
      if (!state.pending.length) continue
      const releasable: ResEvent[] = []
      const held: ResEvent[] = []
      for (const ev of state.pending) (+ev.version < ceiling ? releasable : held).push(ev)
      state.pending = held
      for (const ev of releasable) roundEvents.push({ ev, handleIndex })
    }

    // Each handle's own pending queue is already ascending by sequence_number,
    // but handles interleave by version — sort this round's combined events so
    // the merged output stays globally ascending, not one-handle-then-the-next.
    roundEvents.sort(
      (a, b) =>
        +a.ev.version - +b.ev.version ||
        a.handleIndex - b.handleIndex ||
        +a.ev.sequence_number - +b.ev.sequence_number,
    )
    for (const { ev } of roundEvents) yield ev

    if (opts.watch && handleStates.every((state) => state.catchedUp)) {
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
 * @param ctx - Context containing the Aptos provider, and optionally `typeAndVersion` and
 *   `logger` (only needed when `opts.typeAndVersions` is used).
 * @param opts - Log filter options.
 * @returns Async generator of log entries.
 */
export async function* streamAptosLogs(
  ctx: { provider: Aptos; typeAndVersion?: Chain['typeAndVersion'] } & WithLogger,
  opts: LeanNumbers<LogFilter> & { versionAsHash?: boolean },
): AsyncGenerator<ChainLog> {
  const limit = 100
  const logger = ctx.logger ?? console
  // Narrow-typed stand-in so passesTypeAndVersion always has a callable typeAndVersion;
  // only reached when opts.typeAndVersions is set but ctx.typeAndVersion was not passed.
  const typeAndVersionChain = ctx.typeAndVersion
    ? (ctx as SetRequired<typeof ctx, 'typeAndVersion'>)
    : {
        logger,
        typeAndVersion: () =>
          Promise.reject(new CCIPNotImplementedError('typeAndVersion in this getLogs context')),
      }
  // A hint addressed to a different stream is ignored wholesale — no cursor, no
  // floors. Otherwise `since.blockNumber`/`blockTimestamp` stand in for (or raise)
  // startBlock/startTime; the event-seq cursor is resolved in fetchEventsForward.
  // (Merged before the validations below so their narrowing holds afterwards.)
  if (
    opts.since?.address &&
    (!opts.address || opts.since.address.toLowerCase() !== opts.address.toLowerCase())
  )
    opts = { ...opts, since: undefined }
  opts = withSinceStart(opts)

  if (!opts.address || !opts.address.includes('::')) throw new CCIPAptosAddressModuleRequiredError()
  if (!opts.topics?.length) throw new CCIPTopicsInvalidError(opts.topics!)
  const hasStart = opts.startBlock != null || opts.startTime != null
  if (!hasStart) throw new CCIPLogsRequiresStartError()

  // Resolve every requested topic to its own Aptos event-handle path. A topic
  // already containing '/' is a raw Struct/field handle path and passes
  // through untouched; otherwise it must be one of the few named events we
  // know how to map. eventToHandler is intentionally NOT extended for new
  // callers — they pass raw handle paths (e.g. `OnRampState/config_set_events`)
  // instead, so named lookup for the existing entries keeps working unchanged.
  const eventHandlerFields = opts.topics.map((topic) => {
    if (typeof topic !== 'string') throw new CCIPTopicsInvalidError(opts.topics!)
    if (topic.includes('/')) return topic
    const field = (eventToHandler as Record<string, string>)[topic]
    if (!field) throw new CCIPTopicsInvalidError(opts.topics!)
    return field
  })

  const [stateAddr] = await ctx.provider.view<[string]>({
    payload: {
      function: `${opts.address}::get_state_address` as `0x${string}::${string}::get_state_address`,
    },
  })

  for await (const ev of fetchEventsForward(ctx, opts, eventHandlerFields, stateAddr, limit)) {
    // Derive the topic from THIS event's own type. With multiple handles now
    // merged into one stream, hoisting the topic from the first event (as the
    // single-topic code used to do) would stamp every later event — even one
    // from a different handle — with the first handle's event name.
    const topics = [ev.type.slice(ev.type.lastIndexOf('::') + 2)]
    if (!(await passesTypeAndVersion(typeAndVersionChain, opts.address, opts.typeAndVersions)))
      continue
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
