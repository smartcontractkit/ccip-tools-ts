import {
  type Aptos,
  type Event as AptosEvent,
  type UserTransactionResponse,
  AptosApiError,
  Network,
  TransactionResponseType,
  getAptosFullNode,
} from '@aptos-labs/ts-sdk'
import { getBytes, hexlify, isHexString } from 'ethers'
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
import { type ChainLog, type LeanNumbers, type WithLogger, ExecutionState } from '../types.ts'
import { passesTypeAndVersion, signalToPromise } from '../utils.ts'
import { ExecutionReportCodec } from './types.ts'

const DEFAULT_POLL_INTERVAL = 5e3

/** Options of the Aptos log streams: LogFilter with lean numbers, plus Aptos-local extensions. */
export type AptosLogStreamOpts = LeanNumbers<LogFilter> & {
  /** Emit `String(version)` as transactionHash instead of fetching the tx hash. */
  versionAsHash?: boolean
  /** Delay in ms between watch-mode poll rounds. Default: 5000 */
  pollInterval?: number
}

const eventToHandler = {
  CCIPMessageSent: 'OnRampState/ccip_message_sent_events',
  CommitReportAccepted: 'OffRampState/commit_report_accepted_events',
  ExecutionStateChanged: 'OffRampState/execution_state_changed_events',
} as const

/** OffRamp entry functions that execute CCIP messages (see the Move contract's execute/manually_execute). */
const APTOS_OFFRAMP_EXECUTE_FUNCTIONS = ['execute', 'manually_execute']

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

type AptosEntryFunction = {
  function: string
  arguments: unknown[]
}

type AptosExecutionReport = {
  sourceChainSelector: bigint | number | string
  messageId: unknown
  destChainSelector: bigint | number | string
  sequenceNumber: bigint | number | string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

/**
 * Converts the forms used by Aptos REST payload arguments into bytes.
 *
 * Vector<u8> arguments are normally returned as hex strings, but keeping the
 * other forms here makes this work with SDK mocks and alternate fullnodes too.
 */
function toAptosBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') {
    if (!isHexString(value)) return undefined
    try {
      return getBytes(value)
    } catch {
      return undefined
    }
  }
  if (Array.isArray(value) && value.every(isByte)) return Uint8Array.from(value)
  if (isRecord(value) && Array.isArray(value.vec)) {
    if (value.vec.every(isByte)) return Uint8Array.from(value.vec)
    const parts = value.vec.map(toAptosBytes)
    if (parts.every((part) => part?.length === 1))
      return Uint8Array.from(parts.map((part) => part![0]!))
    if (parts.length === 1) return parts[0]
  }
  return undefined
}

function isExecutionReport(value: unknown): value is AptosExecutionReport {
  return (
    isRecord(value) &&
    'sourceChainSelector' in value &&
    'messageId' in value &&
    'destChainSelector' in value &&
    'sequenceNumber' in value
  )
}

function parseExecutionReport(value: unknown): AptosExecutionReport | undefined {
  const bytes = toAptosBytes(value)
  if (bytes) {
    try {
      const report = ExecutionReportCodec.parse(bytes)
      if (isExecutionReport(report)) return report
    } catch {
      // Try the next payload argument.
    }
  }
  // Aptos REST uses hex for byte vectors. Base64 is accepted as a small
  // compatibility fallback for providers that preserve the SDK's encoding.
  if (typeof value === 'string' && !isHexString(value)) {
    try {
      const report = ExecutionReportCodec.fromBase64(value)
      if (isExecutionReport(report)) return report
    } catch {
      // Not an execution report.
    }
  }
  return undefined
}

function getEntryFunctionPayload(payload: unknown): AptosEntryFunction | undefined {
  if (!isRecord(payload)) return undefined
  if (typeof payload.function === 'string' && Array.isArray(payload.arguments))
    return { function: payload.function, arguments: payload.arguments }
  // A multisig response can carry the actual entry function one level down.
  return getEntryFunctionPayload(payload.transaction_payload)
}

function getOffRampModule(functionName: string): string | undefined {
  const parts = functionName.split('::')
  const functionPart = parts.pop()?.toLowerCase()
  const module = parts.pop()
  if (!module || !functionPart || !APTOS_OFFRAMP_EXECUTE_FUNCTIONS.includes(functionPart))
    return undefined
  if (!parts.length || module.toLowerCase() !== 'offramp') return undefined
  return `${parts.join('::')}::${module}`
}

function sameAptosModule(left: string, right: string): boolean {
  const leftParts = left.split('::')
  const rightParts = right.split('::')
  if (leftParts.length < 2 || rightParts.length < 2)
    return left.toLowerCase() === right.toLowerCase()
  if (leftParts.slice(1).join('::').toLowerCase() !== rightParts.slice(1).join('::').toLowerCase())
    return false
  try {
    return BigInt(leftParts[0]!) === BigInt(rightParts[0]!)
  } catch {
    return leftParts[0]!.toLowerCase() === rightParts[0]!.toLowerCase()
  }
}

function getExecutionReport(payload: AptosEntryFunction): AptosExecutionReport | undefined {
  const module = getOffRampModule(payload.function)
  if (!module) return undefined
  const functionName = payload.function.slice(payload.function.lastIndexOf('::') + 2).toLowerCase()
  // Current execute takes the report after its proof arguments; the SDK's
  // manually_execute entrypoint takes the report as its first argument.
  const candidates =
    functionName === 'execute'
      ? [payload.arguments[1], ...payload.arguments]
      : [payload.arguments[0], ...payload.arguments]
  for (const candidate of candidates) {
    const report = parseExecutionReport(candidate)
    if (report) return report
  }
  return undefined
}

function aptosInteger(value: unknown): string | undefined {
  if (value == null) return undefined
  try {
    return BigInt(value as bigint | number | string).toString()
  } catch {
    return undefined
  }
}

/**
 * Turns Aptos's VM status into stable, useful return data. Move aborts expose
 * their module and numeric code in the status string; no ABI is required for
 * this decoding.
 */
function getAptosFailureData(
  tx: UserTransactionResponse,
  report: AptosExecutionReport,
  functionName: string,
): Record<string, string> {
  const vmStatus = tx.vm_status
  const data: Record<string, string> = {
    vm_status: vmStatus,
    function: functionName,
    gas_used: tx.gas_used,
  }
  const abort = vmStatus.match(/Move abort in (.+?): code (\d+)/i)
  if (abort) {
    data.location = abort[1]!
    data.abort_code = abort[2]!
  }
  const status = vmStatus.match(/Execution failed with status:\s*(.+)$/i)
  if (status) data.status = status[1]!.trim()
  const destChainSelector = aptosInteger(report.destChainSelector)
  if (destChainSelector != null) data.dest_chain_selector = destChainSelector
  return data
}

/**
 * Reconstructs the execution receipt omitted by Aptos when a Move execution
 * aborts. The transaction payload still contains the BCS ExecutionReport, and
 * the REST response retains the VM status.
 */
export function getAptosExecutionFailureLog(
  tx: UserTransactionResponse,
  address?: string,
  versionAsHash = false,
): ChainLog | undefined {
  if (tx.success) return undefined
  const payload = getEntryFunctionPayload(tx.payload)
  if (!payload) return undefined
  const offRampModule = getOffRampModule(payload.function)
  if (!offRampModule || (address && !sameAptosModule(offRampModule, address))) return undefined
  if (
    tx.events.some((event) => {
      if (typeof event.type !== 'string') return false
      const eventModule = event.type.slice(0, event.type.lastIndexOf('::'))
      const eventName = event.type.slice(event.type.lastIndexOf('::') + 2)
      return eventName === 'ExecutionStateChanged' && sameAptosModule(eventModule, offRampModule)
    })
  )
    return undefined
  const report = getExecutionReport(payload)
  if (!report) return undefined
  const messageId = toAptosBytes(report.messageId)
  const sequenceNumber = aptosInteger(report.sequenceNumber)
  const sourceChainSelector = aptosInteger(report.sourceChainSelector)
  if (!messageId || sequenceNumber == null || sourceChainSelector == null) return undefined

  return {
    // The OffRamp's bare address — the same form real event logs carry
    // (Move event types prefix with the bare account address, module-less), so
    // consumers filtering receipts-in-tx by the OffRamp address (e.g. the CLI's
    // API-metadata `offramp`, a bare address) match failures exactly like
    // successes.
    address: address ?? offRampModule.split('::')[0]!,
    topics: ['ExecutionStateChanged'],
    // Failed Aptos executions have no event sequence number, so the synthetic log
    // borrows index 0 — uint-friendly, like every other family's log indexes.
    // Resume hints carrying it must not be applied as event-handle sequence
    // cursors: parseResumeHint ignores index 0 for exactly that reason (see there).
    index: 0,
    blockNumber: Number(tx.version),
    transactionHash: versionAsHash ? String(tx.version) : tx.hash,
    blockTimestamp: Number(tx.timestamp) / 1e6,
    data: {
      message_id: hexlify(messageId),
      sequence_number: sequenceNumber,
      source_chain_selector: sourceChainSelector,
      state: ExecutionState.Failed,
      gas_used: tx.gas_used,
      return_data: getAptosFailureData(tx, report, payload.function),
    },
  }
}

/** Converts a user transaction's execution-state events and/or synthetic failure. */
function getAptosExecutionLogsInTransaction(
  tx: UserTransactionResponse,
  address: string,
  versionAsHash: boolean,
): ChainLog[] {
  const failure = getAptosExecutionFailureLog(tx, address, versionAsHash)
  // A failed Move execution discards its events, so a transaction never carries both —
  // but keep the synthetic failure ahead of any event regardless, so the failure-first
  // order holds under any input. Its index (0) never collides with an event's: a
  // version is one transaction, and a failed one has no events at all.
  const logs: ChainLog[] = failure ? [failure] : []
  for (const [index, event] of tx.events.entries()) {
    if (typeof event.type !== 'string') continue
    const eventModule = event.type.slice(0, event.type.lastIndexOf('::'))
    const eventName = event.type.slice(event.type.lastIndexOf('::') + 2)
    if (eventName !== 'ExecutionStateChanged' || !sameAptosModule(eventModule, address)) continue
    const seq = Number((event as { sequence_number?: unknown }).sequence_number)
    logs.push({
      address,
      topics: ['ExecutionStateChanged'],
      // The transaction response carries each event's handle sequence number — the
      // same value the event-handle stream emits as `index` — so resume hints stay
      // interchangeable between the two sources. Fall back to the event's position
      // for SDK-shaped fixtures that omit it.
      index: Number.isFinite(seq) && seq >= 0 ? seq : index,
      blockNumber: Number(tx.version),
      transactionHash: versionAsHash ? String(tx.version) : tx.hash,
      blockTimestamp: Number(tx.timestamp) / 1e6,
      data: event.data as Record<string, unknown>,
    })
  }
  return logs
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
type AptosResumeHint = { seq?: number; block?: number; timestamp?: number; topic?: string }

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
  // An index of 0 is not an exact cursor: a synthetic failure log carries it
  // without being an event at all, and it is indistinguishable from a handle's
  // own seq-0 event. Both resume correctly via the block floor instead — a
  // version's events are always emitted whole, so blockNumber + 1 skips nothing
  // that a seq-0 hint could have kept (a hint taken from a call's last log at
  // seq 0 means that version held exactly one event).
  if (Number.isSafeInteger(seq) && seq > 0) parsed.seq = seq
  const topic = hint.topics?.[0]
  if (typeof topic === 'string' && topic) parsed.topic = topic
  if (parsed.seq == null && parsed.block == null) return undefined
  return parsed
}

/**
 * Best-effort topic → event-handle mapping: raw `Struct/field` handle paths pass
 * through, known event names map via eventToHandler; anything else (notably a struct
 * name emitted into a log's topics[0] for a raw-path stream) is unresolvable offline.
 */
function handleForTopic(topic: unknown): string | undefined {
  if (typeof topic !== 'string' || !topic) return undefined
  if (topic.includes('/')) return topic
  return (eventToHandler as Record<string, string>)[topic]
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

  // Every event handle owns an INDEPENDENT sequence space: the hint's seq is an
  // exact cursor for THIS handle only when the hinted event is of this handle's own
  // type (a log's topics[0] is its event's struct name). A cursor captured from
  // another handle's topic would silently skip this handle's events — drop it; the
  // merged block/timestamp floors are global (ledger versions), not per-handle, and
  // still apply.
  let cursorHint = hint
  if (hint?.topic != null) {
    const eventType = initialBatch[0]!.type
    const structName = eventType.slice(eventType.lastIndexOf('::') + 2)
    if (hint.topic !== structName) cursorHint = undefined
  }

  // The hint covers the floor when it sits past every requested start bound —
  // resuming at seq+1 then IS the floor, so the floor computation (and its binary
  // search / timestamp lookups) is skipped entirely.
  const hintCoversFloor =
    cursorHint != null &&
    (opts.startBlock == null ||
      (cursorHint.block != null && cursorHint.block >= Number(opts.startBlock))) &&
    (opts.startTime == null ||
      (cursorHint.timestamp != null && cursorHint.timestamp >= Number(opts.startTime)))

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
  if (cursorHint != null) start = Math.max(cursorHint.seq + 1, start ?? 0)

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

/** One merged item of a forward stream: an event-handle event, or a synthetic execution-failure log. */
type ForwardItem =
  | { kind: 'event'; ev: ResEvent; handleIndex: number }
  | { kind: 'failure'; log: ChainLog }

async function* fetchEventsForward(
  ctx: { provider: Aptos; typeAndVersion?: Chain['typeAndVersion'] } & WithLogger,
  opts: AptosLogStreamOpts,
  eventHandlerFields: string[],
  stateAddr: string,
  limit = 100,
  /** When set (execution-state filters), a transaction-scan source is merged in that surfaces failed Move executions — see initFailureScanState. */
  failureScan?: { address: string },
): AsyncGenerator<ForwardItem> {
  if (
    opts.watch &&
    (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
    Number(opts.endBlock) > 0
  )
    throw new CCIPLogsWatchRequiresFinalityError(Number(opts.endBlock))
  opts.endBlock ??= 'latest'

  const hint = parseResumeHint(opts)
  if (opts.since && hint == null) ctx.logger?.warn('Invalid `since` hint: ', opts)

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
      // The seq is attributable to the one handle ONLY IF the hinted event is of this
      // handle's own type — verified against the handle's events in initHandleState
      // (handles at one address own independent sequence spaces; the address gate
      // alone can't tell them apart).
      seqHint = { seq: hint.seq, block: hint.block, timestamp: hint.timestamp, topic: hint.topic }
    } else if (hint.block != null) {
      const versionFloor = hint.block + 1
      if (opts.startBlock == null || versionFloor > Number(opts.startBlock))
        opts_ = { ...opts, startBlock: versionFloor }
    }
  }
  // The failure scan's init (its startTime positioning can binary-search ledger
  // versions) runs in parallel with the handle inits fetching their tip batches.
  const [handleStateResults, scanState] = await Promise.all([
    Promise.all(
      eventHandlerFields.map((field) =>
        initHandleState(ctx, opts_, field, stateAddr, limit, seqHint),
      ),
    ),
    failureScan ? initFailureScanState(ctx, opts, hint, failureScan.address) : undefined,
  ])
  const handleStates = handleStateResults.filter(
    (state): state is HandleState => state !== undefined,
  )

  // Mirrors the single-handle behaviour: if every handle has no events yet
  // (trivially true for a single topic whose lone handle is empty), end the
  // stream now instead of entering the loop below — unless a failure scan keeps
  // it alive: failed executions exist even when the handle has never emitted a
  // success, and a watch stream must keep polling for them.
  if (!handleStates.length && !scanState) return

  while (
    (opts.watch && (!(opts.watch instanceof AbortSignal) || !opts.watch.aborted)) ||
    !handleStates.every((state) => state.catchedUp) ||
    (scanState != null && !scanState.catchedUp)
  ) {
    const lastReq = performance.now()

    // Fetch this round's new events per handle (skipping handles that are
    // already fully drained when we're not watching), buffering them onto
    // each handle's own `pending` queue, and collect each source's ceiling
    // contribution for the round — the failure scan's pages join in as one
    // more source: its synthetic logs land on its own `pending` queue and its
    // ceiling bounds the round exactly like a handle's batch tail.
    const ceilings = await Promise.all([
      ...handleStates.map(async (state) => {
        if (state.catchedUp && !opts.watch) return Infinity
        const { events, ceiling } = await fetchHandleRound(ctx, opts_, state)
        state.pending.push(...events)
        return ceiling
      }),
      ...(scanState
        ? [
            fetchFailureScanRound(ctx, opts, scanState).then(({ logs, ceiling }) => {
              scanState.pending.push(...logs)
              return ceiling
            }),
          ]
        : []),
    ])

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

    const roundItems: ForwardItem[] = []
    for (const [handleIndex, state] of handleStates.entries()) {
      if (!state.pending.length) continue
      const releasable: ResEvent[] = []
      const held: ResEvent[] = []
      for (const ev of state.pending) (+ev.version < ceiling ? releasable : held).push(ev)
      state.pending = held
      for (const ev of releasable) roundItems.push({ kind: 'event', ev, handleIndex })
    }
    if (scanState?.pending.length) {
      const releasable: ChainLog[] = []
      const held: ChainLog[] = []
      for (const log of scanState.pending) (log.blockNumber < ceiling ? releasable : held).push(log)
      scanState.pending = held
      for (const log of releasable) roundItems.push({ kind: 'failure', log })
    }

    // Each source's own pending queue is already ascending, but sources
    // interleave by version — sort this round's combined items so the merged
    // output stays globally ascending, not one-source-then-the-next. A synthetic
    // failure never shares a version with an event (a failed Move transaction
    // discards its events), so the event-only tiebreaks below are never reached
    // against a failure.
    const itemVersion = (item: ForwardItem) =>
      item.kind === 'event' ? +item.ev.version : item.log.blockNumber
    roundItems.sort(
      (a, b) =>
        itemVersion(a) - itemVersion(b) ||
        (a.kind === 'event' && b.kind === 'event'
          ? a.handleIndex - b.handleIndex || +a.ev.sequence_number - +b.ev.sequence_number
          : 0),
    )
    yield* roundItems

    if (
      opts.watch &&
      handleStates.every((state) => state.catchedUp) &&
      (scanState == null || scanState.catchedUp)
    ) {
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

const APTOS_TRANSACTION_PAGE_SIZE = 100

function isExecutionStateTopic(topic: unknown): boolean {
  return topic === 'ExecutionStateChanged' || topic === eventToHandler.ExecutionStateChanged
}

async function getAptosLedgerVersion(provider: Aptos): Promise<number | undefined> {
  if (typeof provider.getLedgerInfo !== 'function') return undefined
  const version = Number((await provider.getLedgerInfo()).ledger_version)
  return Number.isFinite(version) ? version : undefined
}

/**
 * GraphQL documents against the Aptos Indexer v2 API (the public per-network
 * endpoint AptosConfig resolves, or a custom one). The fullnode REST has no
 * per-contract index of transactions — `/transactions` pages the WHOLE ledger —
 * while the indexer's `user_transactions` table indexes entry-function calls by
 * contract/module/function. It carries no success status, so it serves as a
 * CANDIDATE index: every `execute`/`manually_execute` call on the OffRamp module
 * in a version window, each hydrated (and failure-checked) against the fullnode
 * RPC. The `transactions` table (which does carry `success`/`vm_status`) is not
 * exposed by the public GraphQL API at all.
 */
const APTOS_INDEXER_USER_TXS_PROCESSOR = 'user_transaction_processor'

const APTOS_INDEXER_OFFRAMP_CALLS_QUERY = `
  query OffRampExecutions($where: user_transactions_bool_exp!, $limit: Int!) {
    user_transactions(where: $where, order_by: {version: asc}, limit: $limit) {
      version
    }
  }
`

const APTOS_INDEXER_PROCESSOR_TIP_QUERY = `
  query UserTransactionsProcessorTip($processor: String!) {
    processor_status(where: {processor: {_eq: $processor}}, limit: 1) {
      last_success_version
    }
  }
`

type AptosIndexerCallsPage = { user_transactions: Array<{ version: number | string }> }
type AptosIndexerProcessorTip = {
  processor_status: Array<{ last_success_version: number | string }>
}

/**
 * Whether the provider can answer indexer queries: the SDK's `queryIndexer`
 * method plus a resolvable endpoint. Known networks resolve the public indexer
 * automatically; a CUSTOM network needs `indexer` set in its AptosConfig —
 * without it there is no per-contract index, and failure detection is skipped
 * with a warning (see fetchFailureScanRound) rather than walking the whole chain.
 */
function canQueryAptosIndexer(provider: Aptos): boolean {
  if (typeof provider.queryIndexer !== 'function') return false
  const config = (provider as unknown as { config?: { network?: Network; indexer?: string } })
    .config
  if (!config) return false
  return config.network !== Network.CUSTOM || config.indexer != null
}

/**
 * The `user_transactions` processor's ingested tip: the indexer guarantees the
 * table is complete through this version (a processing gap panics the processor
 * rather than leaving holes). Undefined when the processor status row is absent.
 */
async function getAptosIndexerUserTxsTip(provider: Aptos): Promise<number | undefined> {
  const { processor_status } = await provider.queryIndexer<AptosIndexerProcessorTip>({
    query: {
      query: APTOS_INDEXER_PROCESSOR_TIP_QUERY,
      variables: { processor: APTOS_INDEXER_USER_TXS_PROCESSOR },
    },
  })
  const tip = Number(processor_status[0]?.last_success_version)
  return Number.isFinite(tip) && tip >= 0 ? tip : undefined
}

/**
 * Canonical long-form Aptos address (`0x` + 64 lowercase hex) — the form the
 * indexer's `standardize_address` writes, unlike `AccountAddress.fromString`,
 * which rejects short hex forms.
 */
function toAptosLongAddress(address: string): string {
  return `0x${address.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}`
}

/**
 * Versions of `execute`/`manually_execute` calls on the OffRamp module in
 * `[fromVersion, toVersionExclusive)`, ascending — the per-contract candidate
 * index. The indexer stores the contract address in canonical long form.
 */
async function getAptosIndexerOffRampCallVersions(
  provider: Aptos,
  address: string,
  fromVersion: number,
  toVersionExclusive: number,
  limit: number,
): Promise<number[]> {
  const [pkg, module = 'offramp'] = address.split('::')
  const contract = toAptosLongAddress(pkg!)
  const { user_transactions } = await provider.queryIndexer<AptosIndexerCallsPage>({
    query: {
      query: APTOS_INDEXER_OFFRAMP_CALLS_QUERY,
      variables: {
        where: {
          version: { _gte: fromVersion, _lt: toVersionExclusive },
          entry_function_contract_address: { _eq: contract },
          entry_function_module_name: { _eq: module },
          entry_function_function_name: { _in: APTOS_OFFRAMP_EXECUTE_FUNCTIONS },
        },
        limit,
      },
    },
  })
  return user_transactions
    .map((row) => Number(row.version))
    .filter(
      (version) =>
        Number.isFinite(version) && version >= fromVersion && version < toVersionExclusive,
    )
    .sort((left, right) => left - right)
}

/** Fetches a committed user transaction by version, tolerating non-user responses. */
async function hydrateAptosUserTxByVersion(
  provider: Aptos,
  version: number,
): Promise<UserTransactionResponse | undefined> {
  if (typeof provider.getTransactionByVersion !== 'function') return undefined
  const tx = await provider.getTransactionByVersion({ ledgerVersion: version })
  if (tx.type !== TransactionResponseType.User) return undefined
  return tx as UserTransactionResponse
}

/**
 * Fetches one ascending page of committed transactions starting at `startVersion`.
 *
 * The REST `/transactions` endpoint takes `start` as a LEDGER VERSION (not an
 * offset into a list) and returns up to `limit` transactions from it, ascending —
 * and rejects `start` above the current ledger version with a 400, so callers must
 * clamp their scan target to the tip (see resolveAptosEndVersion). The endpoint is
 * called directly (rather than via `Aptos.getTransactions()`), both to pin exactly
 * one page per call and because SDK-shaped test providers implement the method form.
 */
async function getAptosTransactionBatch(
  provider: Aptos,
  startVersion: number,
  limit: number,
): Promise<unknown[]> {
  const config = (provider as unknown as { config?: { client?: unknown } }).config
  const getTransactions = provider.getTransactions
  if (!config?.client && typeof getTransactions === 'function')
    return (await getTransactions.call(provider, {
      options: { offset: startVersion, limit },
    })) as unknown[]

  const { data }: { data: unknown[] } = await getAptosFullNode({
    aptosConfig: provider.config,
    originMethod: 'getTransactions',
    path: 'transactions',
    params: { start: startVersion, limit },
  })
  return data
}

/**
 * Resolves the endBlock filter into a ledger version bound for transaction scans.
 * Positive numeric ends are clamped to the current ledger version: the endpoint 400s
 * on any `start` above the tip, and a page that exactly fills to the tip would
 * otherwise make the next request step past it.
 */
async function resolveAptosEndVersion(
  provider: Aptos,
  endBlock: number | bigint | 'finalized' | 'latest',
): Promise<number> {
  if (typeof endBlock === 'number' || typeof endBlock === 'bigint') {
    const end = Number(endBlock)
    if (Number.isFinite(end) && end >= 0) {
      const latest = await getAptosLedgerVersion(provider)
      return latest == null ? end : Math.min(end, latest)
    }
    const latest = await getAptosLedgerVersion(provider)
    return latest == null ? Number.MAX_SAFE_INTEGER : Math.max(0, latest + end)
  }
  return (await getAptosLedgerVersion(provider)) ?? Number.MAX_SAFE_INTEGER
}

async function findAptosVersionAtOrAfter(
  provider: Aptos,
  timestamp: number,
  latestVersion: number,
): Promise<number> {
  if (!Number.isFinite(timestamp) || latestVersion < 0) return 0
  if (typeof provider.getTransactionByVersion !== 'function') return 0
  let low = 0
  let high = latestVersion
  let result = latestVersion + 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if ((await getVersionTimestamp(provider, mid)) < timestamp) low = mid + 1
    else {
      result = mid
      high = mid - 1
    }
  }
  return result
}

/**
 * Streams execution-state logs from committed transactions — successes AND
 * failures — without consulting event handles.
 *
 * Unlike event-handle queries, the transaction endpoint retains failed user
 * transactions, including their payload and `vm_status`, even when Move has
 * discarded all events from the aborted execution. Used as the sole source for
 * providers that cannot serve event handles (see streamAptosLogs); the handle-
 * backed stream instead adds a failure-only scan as one more source in
 * fetchEventsForward's round merge.
 */
async function* streamAptosExecutionLogs(
  ctx: { provider: Aptos; typeAndVersion?: Chain['typeAndVersion'] } & WithLogger,
  inputOpts: AptosLogStreamOpts,
): AsyncGenerator<ChainLog> {
  let opts = inputOpts
  if (
    opts.since?.address &&
    (!opts.address || opts.since.address.toLowerCase() !== opts.address.toLowerCase())
  )
    opts = { ...opts, since: undefined }
  if (opts.since?.topics?.[0] != null && !isExecutionStateTopic(opts.since.topics[0]))
    opts = { ...opts, since: undefined }
  opts = withSinceStart(opts)

  if (!opts.address || !opts.address.includes('::')) throw new CCIPAptosAddressModuleRequiredError()
  if (!opts.topics?.length || !isExecutionStateTopic(opts.topics[0]))
    throw new CCIPTopicsInvalidError(opts.topics ?? [])
  const hasStart = opts.startBlock != null || opts.startTime != null
  if (!hasStart) throw new CCIPLogsRequiresStartError()
  const address = opts.address
  opts.endBlock ??= 'latest'
  if (
    opts.watch &&
    (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
    Number(opts.endBlock) > 0
  )
    throw new CCIPLogsWatchRequiresFinalityError(Number(opts.endBlock))

  const logger = ctx.logger ?? console
  const typeAndVersionChain = ctx.typeAndVersion
    ? (ctx as SetRequired<typeof ctx, 'typeAndVersion'>)
    : {
        logger,
        typeAndVersion: () =>
          Promise.reject(new CCIPNotImplementedError('typeAndVersion in this getLogs context')),
      }
  const endBlock = opts.endBlock as number | bigint | 'finalized' | 'latest'
  const initialEnd = await resolveAptosEndVersion(ctx.provider, endBlock)
  let nextVersion = Math.max(0, Number(opts.startBlock ?? 0))
  const hintedVersion = Number(opts.since?.blockNumber)
  if (Number.isFinite(hintedVersion) && hintedVersion >= 0)
    nextVersion = Math.max(nextVersion, hintedVersion + 1)
  if (opts.startBlock == null && opts.startTime != null && initialEnd < Number.MAX_SAFE_INTEGER)
    nextVersion = Math.max(
      nextVersion,
      await findAptosVersionAtOrAfter(ctx.provider, Number(opts.startTime), initialEnd),
    )

  const scanTo = async function* (end: number): AsyncGenerator<ChainLog> {
    while (nextVersion <= end) {
      const pageStart = nextVersion
      const rawBatch = await getAptosTransactionBatch(
        ctx.provider,
        pageStart,
        APTOS_TRANSACTION_PAGE_SIZE,
      )
      const batch = rawBatch
        .filter((tx): tx is Record<string, unknown> => isRecord(tx) && tx.version != null)
        .sort((left, right) => Number(left.version) - Number(right.version))
      if (!batch.length) return

      let maxVersion = -1
      let reachedEnd = false
      for (const rawTx of batch) {
        const version = Number(rawTx.version)
        if (!Number.isFinite(version)) continue
        maxVersion = Math.max(maxVersion, version)
        if (version < nextVersion) continue
        if (version > end) {
          reachedEnd = true
          break
        }
        nextVersion = version + 1
        if (rawTx.type !== TransactionResponseType.User) continue
        const tx = rawTx as unknown as UserTransactionResponse
        if (opts.startTime != null && !(Number(tx.timestamp) / 1e6 >= Number(opts.startTime)))
          continue
        const logs = getAptosExecutionLogsInTransaction(tx, address, Boolean(opts.versionAsHash))
        if (!logs.length) continue
        if (!(await passesTypeAndVersion(typeAndVersionChain, address, opts.typeAndVersions)))
          continue
        yield* logs
      }

      if (
        reachedEnd ||
        maxVersion < pageStart ||
        rawBatch.length < APTOS_TRANSACTION_PAGE_SIZE ||
        maxVersion >= end ||
        nextVersion <= pageStart
      )
        return
    }
  }

  yield* scanTo(initialEnd)
  const watch = opts.watch
  if (!watch) return
  const pollInterval = Number(opts.pollInterval) || DEFAULT_POLL_INTERVAL
  while (!(watch instanceof AbortSignal) || !watch.aborted) {
    const lastReq = performance.now()
    yield* scanTo(await resolveAptosEndVersion(ctx.provider, endBlock))
    let delay$ = AbortSignal.timeout(
      Math.max(Math.ceil(pollInterval - (performance.now() - lastReq)), 1),
    )
    if (watch instanceof AbortSignal) {
      if (watch.aborted) break
      delay$ = AbortSignal.any([watch, delay$])
    }
    await signalToPromise(delay$).catch(() => false)
  }
}

/** Candidate/tail pages a failure-scan round walks before handing control back to the round merge (progressive catch-up). */
const FAILURE_SCAN_PAGES_PER_ROUND = 25

/** Page size for indexer candidate queries (the public API caps anonymous selects at 100). */
const FAILURE_SCAN_INDEXER_PAGE_SIZE = 100

/**
 * How far past the indexer's ingested tip a failure scan will walk the fullnode's
 * unindexed `/transactions` tail before declaring the index too stale: walking
 * the whole ledger is exactly what the indexer exists to avoid, so beyond this
 * (small, seconds-of-lag sized) window the scan truncates to the indexed prefix
 * with a warning — a watch stream picks the rest up as the index advances.
 */
const FAILURE_SCAN_INDEXER_TAIL_MAX_VERSIONS = 10_000

/**
 * Per-stream state of the failure-scan source merged into fetchEventsForward's rounds.
 *
 * Aptos event handles cannot see failed Move executions — an abort discards the
 * transaction's events — but a failed user transaction is retained by the
 * fullnode (payload with the BCS ExecutionReport, `vm_status`), so its receipt can
 * be reconstructed as a synthetic ExecutionStateChanged(state=Failed) log (see
 * getAptosExecutionFailureLog). FINDING the failures is the problem: the fullnode
 * has no per-contract index of transactions, so the scan's candidates come from
 * the Aptos Indexer v2 API — `user_transactions` filtered by the OffRamp's
 * contract/module/function (see getAptosIndexerOffRampCallVersions) — each
 * hydrated and failure-checked against the fullnode RPC. Only the indexer's
 * un-ingested tail (bounded by FAILURE_SCAN_INDEXER_TAIL_MAX_VERSIONS) is walked
 * via `/transactions`. Without an indexer there is no per-contract filter at all,
 * and failure detection is skipped with a warning instead of paging the whole
 * chain.
 */
type FailureScanState = {
  provider: Aptos
  /** OffRamp module (`<address>::offramp`) the failed execution must belong to. */
  address: string
  versionAsHash: boolean
  /** opts.startTime, applied per transaction just before producing its log. */
  startTime: number | undefined
  /** Next ledger version to scan. */
  nextVersion: number
  /**
   * Scan target as a ledger version, tip-clamped (see resolveAptosEndVersion).
   * Non-watch streams freeze it at the version known when the stream started —
   * mirroring the handles' own `end` cursor taken from their tip batch — so a
   * bounded scan ends instead of chasing the moving tip. Watch streams
   * re-resolve it every poll interval (memoized like the handles' `notAfter`)
   * so newly committed versions are picked up.
   */
  target: () => Promise<number>
  /**
   * The `user_transactions` processor's ingested tip (see
   * getAptosIndexerUserTxsTip), or undefined when no indexer is available —
   * frozen like `target` for non-watch, re-resolved per poll interval for watch.
   */
  indexerTip: () => Promise<number | undefined>
  /** Synthetic logs withheld until the round ceiling passes them (see fetchEventsForward). */
  pending: ChainLog[]
  /** True once this source is done for the stream's current target: its `catchedUp`. */
  catchedUp: boolean
  /** Degradation warnings (no indexer / stale index) fire once per stream, not per round. */
  warned: boolean
}

async function initFailureScanState(
  ctx: { provider: Aptos } & WithLogger,
  opts: AptosLogStreamOpts,
  hint: AptosResumeHint | undefined,
  address: string,
): Promise<FailureScanState> {
  const endBlock = (opts.endBlock ?? 'latest') as number | bigint | 'finalized' | 'latest'
  const pollInterval = Number(opts.pollInterval) || DEFAULT_POLL_INTERVAL
  const resolve = () => resolveAptosEndVersion(ctx.provider, endBlock)
  let target: () => Promise<number>
  if (opts.watch) {
    target = memoize(resolve, { async: true, maxArgs: 0, expires: pollInterval })
  } else {
    const end = await resolve()
    target = () => Promise.resolve(end)
  }
  // Same freezing policy for the indexer tip as for the target. Unavailable
  // indexers resolve to undefined every time: each round re-checks cheaply, so a
  // caller that adds an indexer (or a fresh stream) picks it up without restart.
  let indexerTip: () => Promise<number | undefined>
  if (!canQueryAptosIndexer(ctx.provider)) {
    indexerTip = () => Promise.resolve(undefined)
  } else if (opts.watch) {
    indexerTip = memoize(getAptosIndexerUserTxsTip.bind(null, ctx.provider), {
      async: true,
      maxArgs: 0,
      expires: pollInterval,
    })
  } else {
    const tip = await getAptosIndexerUserTxsTip(ctx.provider)
    indexerTip = () => Promise.resolve(tip)
  }

  // The hint's blockNumber is a global ledger version whose logs were delivered
  // whole (version-atomic rounds), so the scan resumes strictly past it — whatever
  // the hint's `index` addresses: a success event's index belongs to the handle's
  // sequence space (and the hinted version's transaction cannot have ALSO failed),
  // and a synthetic failure's index (0) is never a handle sequence cursor —
  // parseResumeHint drops index 0, leaving the block floor.
  let nextVersion = Math.max(0, Number(opts.startBlock ?? 0))
  if (hint?.block != null) nextVersion = Math.max(nextVersion, hint.block + 1)
  if (opts.startBlock == null && opts.startTime != null) {
    const tip = await getAptosLedgerVersion(ctx.provider)
    if (tip != null)
      nextVersion = Math.max(
        nextVersion,
        await findAptosVersionAtOrAfter(ctx.provider, Number(opts.startTime), tip),
      )
  }
  return {
    provider: ctx.provider,
    address,
    versionAsHash: Boolean(opts.versionAsHash),
    startTime: opts.startTime != null ? Number(opts.startTime) : undefined,
    nextVersion,
    target,
    indexerTip,
    pending: [],
    catchedUp: false,
    warned: false,
  }
}

/** Emits a degradation warning once per stream (per round would spam watch polls). */
function warnFailureScanOnce(state: FailureScanState, logger: unknown, message: string) {
  if (state.warned) return
  state.warned = true
  const warn = (logger as { warn?: (msg: string) => void } | undefined)?.warn ?? console.warn
  warn(message)
}

/**
 * One round's worth of the failure scan, returning newly found synthetic failure
 * logs plus this source's ceiling contribution — an EXCLUSIVE version bound:
 * every version strictly below it is fully scanned, and +Infinity once this
 * source is done with the round's target. Candidates below the indexer tip come
 * from the per-contract index (hydrated and failure-checked against the
 * fullnode); the un-indexed tail is walked via `/transactions` only as far as
 * FAILURE_SCAN_INDEXER_TAIL_MAX_VERSIONS past the tip, truncating with a warning
 * beyond that (a watch stream picks the rest up as the index advances).
 */
async function fetchFailureScanRound(
  ctx: { provider: Aptos; typeAndVersion?: Chain['typeAndVersion'] } & WithLogger,
  opts: LeanNumbers<LogFilter>,
  state: FailureScanState,
): Promise<{ logs: ChainLog[]; ceiling: number }> {
  const target = await state.target()
  if (state.nextVersion > target) {
    state.catchedUp = true
    return { logs: [], ceiling: Infinity }
  }
  const typeAndVersionChain = ctx.typeAndVersion
    ? (ctx as SetRequired<typeof ctx, 'typeAndVersion'>)
    : {
        logger: ctx.logger ?? console,
        typeAndVersion: () =>
          Promise.reject(new CCIPNotImplementedError('typeAndVersion in this getLogs context')),
      }
  const out: ChainLog[] = []
  // The cursor itself proves every version below it complete, so it is the
  // round's initial safe ceiling; everything scanned this round only raises it.
  let ceiling = state.nextVersion
  const emitFailure = async (tx: UserTransactionResponse) => {
    if (state.startTime != null && !(Number(tx.timestamp) / 1e6 >= state.startTime)) return
    const failure = getAptosExecutionFailureLog(tx, state.address, state.versionAsHash)
    if (!failure) return
    if (!(await passesTypeAndVersion(typeAndVersionChain, state.address, opts.typeAndVersions)))
      return
    out.push(failure)
  }

  const indexerTip = await state.indexerTip()
  if (indexerTip == null) {
    warnFailureScanOnce(
      state,
      ctx.logger,
      'Aptos failed-execution detection requires the Indexer v2 API (there is no per-contract index of transactions on the fullnode RPC). Configure `indexer` in AptosConfig to enable it; streaming successful executions only.',
    )
    // No index to scan against: this source is done rather than paging the whole
    // ledger — an unfiltered chain walk is exactly what the index exists to avoid.
    state.catchedUp = true
    return { logs: [], ceiling: Infinity }
  }

  // A. Indexed candidates: every OffRamp execution call in the remaining window
  // below the ingested tip, hydrated one by one against the authoritative RPC.
  const indexEnd = Math.min(target, indexerTip)
  if (state.nextVersion <= indexEnd) {
    for (
      let page = 0;
      page < FAILURE_SCAN_PAGES_PER_ROUND && state.nextVersion <= indexEnd;
      page++
    ) {
      const versions = await getAptosIndexerOffRampCallVersions(
        state.provider,
        state.address,
        state.nextVersion,
        indexEnd + 1,
        FAILURE_SCAN_INDEXER_PAGE_SIZE,
      )
      for (const version of versions) {
        state.nextVersion = version + 1
        ceiling = Math.max(ceiling, version + 1)
        const tx = await hydrateAptosUserTxByVersion(state.provider, version)
        if (tx) await emitFailure(tx)
      }
      // An empty or short page covers the whole requested window — the processor
      // tip guarantees the table is complete through indexEnd — so the window is
      // done regardless of how few calls it contained.
      if (versions.length < FAILURE_SCAN_INDEXER_PAGE_SIZE) {
        state.nextVersion = indexEnd + 1
        ceiling = Math.max(ceiling, indexEnd + 1)
        break
      }
    }
  }

  // B. Un-indexed tail: the indexer's ingestion lag, walked via /transactions
  // (requests range-clamped through the target — the endpoint 400s on any start
  // above the ledger tip, so a page that exactly fills to the tip must not make
  // the next request step past it).
  if (state.nextVersion <= target) {
    if (target - state.nextVersion + 1 > FAILURE_SCAN_INDEXER_TAIL_MAX_VERSIONS) {
      warnFailureScanOnce(
        state,
        ctx.logger,
        `Aptos indexer is more than ${FAILURE_SCAN_INDEXER_TAIL_MAX_VERSIONS} versions behind the ledger (ingested through ${indexerTip}); ` +
          `failed-execution detection is truncated to the indexed prefix — the remainder is picked up as the index catches up.`,
      )
      state.catchedUp = true
      return { logs: out, ceiling: Infinity }
    }
    for (let page = 0; page < FAILURE_SCAN_PAGES_PER_ROUND && state.nextVersion <= target; page++) {
      const limit = Math.min(APTOS_TRANSACTION_PAGE_SIZE, target - state.nextVersion + 1)
      const rawBatch = await getAptosTransactionBatch(state.provider, state.nextVersion, limit)
      const batch = rawBatch
        .filter((tx): tx is Record<string, unknown> => isRecord(tx) && tx.version != null)
        .sort((left, right) => Number(left.version) - Number(right.version))
      if (!batch.length) {
        // A range that exists returning nothing is a broken node — stop scanning
        // rather than spin on it forever (mirrors the handles' flaky-empty fallback).
        state.catchedUp = true
        break
      }
      for (const rawTx of batch) {
        const version = Number(rawTx.version)
        if (!Number.isFinite(version)) continue
        state.nextVersion = version + 1
        ceiling = Math.max(ceiling, version + 1)
        if (rawTx.type !== TransactionResponseType.User) continue
        await emitFailure(rawTx as unknown as UserTransactionResponse)
      }
    }
  }
  state.catchedUp ||= state.nextVersion > target
  return { logs: out, ceiling: state.catchedUp ? Infinity : ceiling }
}

function hasAptosConfiguredClient(provider: Aptos): boolean {
  return Boolean((provider as unknown as { config?: { client?: unknown } }).config?.client)
}

/**
 * Whether the provider can serve the event-handle stream: a configured client (a
 * real AptosConfig routes getAptosFullNode through it), a `view` function (the
 * state-address lookup) and `getLedgerInfo` (the failure scan's tip). SDK-shaped
 * test providers without them fall back to the pure transaction scan.
 */
function canServeAptosEventHandles(provider: Aptos): boolean {
  return (
    hasAptosConfiguredClient(provider) &&
    typeof provider.view === 'function' &&
    typeof provider.getLedgerInfo === 'function'
  )
}

/**
 * Streams logs from the Aptos blockchain based on filter options.
 * @param ctx - Context containing the Aptos provider, and optionally `typeAndVersion` and
 *   `logger` (only needed when `opts.typeAndVersions` is used).
 * @param opts - Log filter options.
 * @returns Async generator of log entries.
 */
async function* streamAptosEventLogs(
  ctx: { provider: Aptos; typeAndVersion?: Chain['typeAndVersion'] } & WithLogger,
  opts: AptosLogStreamOpts,
  /** When set (execution-state filters), a failure-scan source joins the round merge in fetchEventsForward. */
  failureScan = false,
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
  // A hint bearing a PROVABLY different handle's topic is foreign the same way:
  // every event handle at an address owns an independent sequence space, so a cursor
  // (or floor) captured from topic X must not resume a stream of topic Y. Only
  // offline-resolvable topics are checked here; a struct name emitted for a raw
  // handle path defers to initHandleState, which checks it against the handle's own
  // event type before applying the seq cursor.
  const hintHandle = handleForTopic(opts.since?.topics?.[0])
  if (
    hintHandle != null &&
    opts.topics?.length &&
    !opts.topics.some((topic) => handleForTopic(topic) === hintHandle)
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

  for await (const item of fetchEventsForward(
    ctx,
    opts,
    eventHandlerFields,
    stateAddr,
    limit,
    failureScan ? { address: opts.address } : undefined,
  )) {
    // The failure scan's synthetic logs are already fully formed (they carry the
    // failed transaction's own hash/timestamp) — only event-handle events need
    // the per-event hydration below.
    if (item.kind === 'failure') {
      yield item.log
      continue
    }
    const ev = item.ev
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

/**
 * Streams Aptos logs. Execution-state queries (the `ExecutionStateChanged` topic,
 * named or as its raw handle path) add a transaction-scan source to the event-handle
 * stream so failed Move executions — which Aptos leaves no events for — surface as
 * synthetic state=Failed logs, alongside the successes, in every mode (watch or not,
 * single- or multi-topic), without changing the shape or resume cursor of successful
 * event logs. Providers that cannot serve event handles at all fall back to a pure
 * transaction scan serving both successes and failures.
 */
export async function* streamAptosLogs(
  ctx: { provider: Aptos; typeAndVersion?: Chain['typeAndVersion'] } & WithLogger,
  opts: AptosLogStreamOpts,
): AsyncGenerator<ChainLog> {
  const hasExecutionTopic = Boolean(opts.topics?.some(isExecutionStateTopic))
  if (!hasExecutionTopic) {
    yield* streamAptosEventLogs(ctx, opts)
    return
  }

  if (canServeAptosEventHandles(ctx.provider)) {
    yield* streamAptosEventLogs(ctx, opts, true)
    return
  }

  if (opts.topics?.length === 1 && isExecutionStateTopic(opts.topics[0])) {
    yield* streamAptosExecutionLogs(ctx, opts)
    return
  }
  yield* streamAptosEventLogs(ctx, opts)
}
