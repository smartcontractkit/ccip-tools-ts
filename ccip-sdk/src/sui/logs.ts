import { bcs } from '@mysten/sui/bcs'
import type { SuiArgument, SuiCallArg, SuiTransactionBlockResponse } from '@mysten/sui/jsonRpc'
import { getBytes, hexlify } from 'ethers'

import type { LogFilter } from '../chain.ts'
import { type ChainLog, type LeanNumbers, ExecutionState } from '../types.ts'
import { ExecutionReportBCS } from './manuallyExec/encoder.ts'

/** The OffRamp's Move module; its execution entry functions live there. */
export const SUI_OFFRAMP_MODULE = 'offramp'
/**
 * OffRamp Move entry functions that start an execution. A failed execution is
 * a failed call of one of these (the whole PTB aborts, including any later
 * `release_or_mint`/`ccip_receive`/`finish_execute` steps).
 */
export const SUI_OFFRAMP_EXECUTE_FUNCTIONS = ['init_execute', 'manually_init_execute'] as const

/**
 * Short-form Sui address (`0x` + hex, no left padding) — the form the SDK
 * surfaces addresses in, while the node renders package ids fully padded.
 */
export function toSuiShortAddress(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase().replace(/^0+/, '')
  return `0x${hex || '0'}`
}

/**
 * Canonical comparison/display form of a Sui log/contract address:
 * `<short-package>::<module>`, the shape real event logs carry (Move event types
 * are `<package>::<module>::<Struct>`) with the package left-trimmed. Callers
 * hand OffRamp addresses over in several forms — bare, short (unpadded) from the
 * API (`show <messageId>`) or a decoded message, `<package>::offramp` from SDK
 * discovery, fully padded from the node — so both sides of an address comparison
 * must be put through this before matching.
 */
export function canonicalSuiLogAddress(address: string, defaultModule = SUI_OFFRAMP_MODULE) {
  const [pkg, ...rest] = address.split('::')
  const module = rest.length ? rest.join('::') : defaultModule
  return `${toSuiShortAddress(pkg!)}::${module}`
}

/** {@inheritDoc Chain.getLogs} options accepted by {@link streamSuiLogs}. */
export type SuiLogStreamOpts = LeanNumbers<LogFilter> & {
  versionAsHash?: boolean
  pollInterval?: number
}

type SuiExecutionReportFields = {
  source_chain_selector: bigint
  header_source_chain_selector: bigint
  dest_chain_selector: bigint
  sequence_number: bigint
  message_id: Uint8Array
}

/** Report argument position per known OffRamp signature (MoveCall arguments, 0-based). */
const REPORT_ARG_POSITION: Record<string, number> = {
  // init_execute(ref, state, clock, report_context, report, ctx)
  init_execute: 4,
  // manually_init_execute(ref, state, clock, report_bytes)
  manually_init_execute: 3,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalizes a pure `vector<u8>` argument's JSON value to bytes: fullnodes
 * render it as a byte array or a `0x` hex string (some as raw BCS bytes).
 */
function toUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every((v) => typeof v === 'number'))
    return Uint8Array.from(value as number[])
  if (typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value)) return getBytes(value)
  return undefined
}

/**
 * Decodes an execution report from BCS bytes, accepting both the bare report
 * and a `vector<u8>`-wrapped form. The contract itself asserts
 * `source_chain_selector == header_source_chain_selector`, so a decoded
 * candidate failing that check is treated as a non-report argument.
 */
function tryDecodeReport(bytes: Uint8Array): SuiExecutionReportFields | undefined {
  const attempts: Uint8Array[] = [bytes]
  try {
    const unwrapped = bcs.vector(bcs.u8()).parse(bytes)
    // a vector-typed pure argument carries a length prefix; bare report bytes
    // (already de-wrapped by the node) just happen to parse with equal length
    if (unwrapped.length !== bytes.length) attempts.push(Uint8Array.from(unwrapped))
  } catch {
    // not a BCS vector-typed argument
  }
  for (const candidate of attempts) {
    let report: SuiExecutionReportFields
    try {
      report = ExecutionReportBCS.parse(candidate) as unknown as SuiExecutionReportFields
    } catch {
      continue
    }
    if (report.source_chain_selector !== report.header_source_chain_selector) continue
    // bcs.fixedArray(32, u8) parses to number[]; the rest of the SDK expects bytes
    return { ...report, message_id: Uint8Array.from(report.message_id) }
  }
  return undefined
}

function resolveMoveCallArg(inputs: readonly SuiCallArg[], arg: SuiArgument): unknown {
  if (typeof arg !== 'object' || !('Input' in arg)) return undefined
  const index = (arg as { Input: number }).Input
  if (typeof index !== 'number') return undefined
  const callArg = inputs[index]
  // only pure (non-object) arguments can hold the report bytes
  if (!isRecord(callArg) || callArg.type !== 'pure') return undefined
  return callArg.value
}

type OffRampCall = { package: string; function: string; args: unknown[] }

/** Extracts the OffRamp Move calls of a programmable transaction block. */
function getOffRampCalls(payload: unknown): OffRampCall[] {
  if (!isRecord(payload) || !Array.isArray(payload.transactions) || !Array.isArray(payload.inputs))
    return []
  const inputs = payload.inputs as readonly SuiCallArg[]
  const calls: OffRampCall[] = []
  for (const command of payload.transactions) {
    if (!isRecord(command) || !isRecord(command.MoveCall)) continue
    const moveCall = command.MoveCall
    if (moveCall.module !== SUI_OFFRAMP_MODULE || typeof moveCall.function !== 'string') continue
    const args = Array.isArray(moveCall.arguments)
      ? moveCall.arguments.map((arg) => resolveMoveCallArg(inputs, arg))
      : []
    calls.push({
      package: typeof moveCall.package === 'string' ? moveCall.package : '',
      function: moveCall.function,
      args,
    })
  }
  return calls
}

/**
 * Finds the execution report of a failed OffRamp transaction. Known signatures
 * are read at the report argument's position; unknown/older signatures probe
 * every pure argument of an OffRamp call.
 */
function getSuiExecutionReport(
  payload: unknown,
): { report: SuiExecutionReportFields; functionName: string; package: string } | undefined {
  const calls = getOffRampCalls(payload)
  for (const call of calls) {
    const position = REPORT_ARG_POSITION[call.function.toLowerCase()]
    if (position == null) continue
    const bytes = toUint8Array(call.args[position])
    const report = bytes ? tryDecodeReport(bytes) : undefined
    if (report) return { report, functionName: call.function, package: call.package }
  }
  for (const call of calls) {
    for (const arg of call.args) {
      const bytes = toUint8Array(arg)
      const report = bytes ? tryDecodeReport(bytes) : undefined
      if (report) return { report, functionName: call.function, package: call.package }
    }
  }
  return undefined
}

/** Net gas consumed by a Sui transaction (computation + storage, minus the rebate). */
function netGasUsed(
  gasUsed?: {
    computationCost?: string
    storageCost?: string
    storageRebate?: string
  } | null,
): bigint | undefined {
  if (!gasUsed) return undefined
  try {
    return (
      BigInt(gasUsed.computationCost ?? 0) +
      BigInt(gasUsed.storageCost ?? 0) -
      BigInt(gasUsed.storageRebate ?? 0)
    )
  } catch {
    return undefined
  }
}

/**
 * The OffRamp state helper's abort codes that can ONLY follow an intentionally
 * SKIPPED report — already executed (`SkippedAlreadyExecuted`) or RMN-cursed
 * (`SkippedReportExecution`): both emit the skip event and return an EMPTY
 * ReceiverParams hot potato, whose report-driven downstream commands then
 * abort unwrapping it. The message's true state was settled by the earlier
 * attempt (success is terminal), so no state=3 receipt may surface for these
 * failed DOUBLE-EXECUTION attempts (a real failure before a later success
 * stays reportable). The empty hot potato can only be consumed by the readers
 * below — a genuine (non-skipped) execution can never reach them, because
 * pre_execute_single_report fills the fields first (token_transfer for token
 * reports, message for receiver calls) — and finish_execute's
 * deconstruct_receiver_params passes on an empty potato (both options none):
 *   ETokenTransferDoesNotExist (7) — get_dest_token_transfer_data /
 *                                     get_token_param_data (token pool path)
 *   ENoMessageToExtract       (1) — extract_any2sui_message (receiver path)
 * A skip with no tokens and no receiver aborts nothing at all: the PTB
 * succeeds and never reaches the failure reconstruction.
 * See chainlink-sui offramp_state_helper.move + the receiver integration
 * guide's "Execution PTB" command order.
 */
const SKIPPED_REPORT_MODULE = 'offramp_state_helper'
// error::invalid_argument codes from offramp_state_helper, as above
const SKIPPED_REPORT_ABORT_CODES = new Set(['1', '7'])

/**
 * Whether a failed execution's decoded data is the OffRamp's skipped-report
 * guard (offramp_state_helper `ENoMessageToExtract` / `ETokenTransferDoesNotExist`)
 * rather than a real failed execution.
 */
export function isSuiSkippedReport(failureData: {
  location?: string
  abort_code?: string
}): boolean {
  return (
    failureData.location?.endsWith(`::${SKIPPED_REPORT_MODULE}`) === true &&
    SKIPPED_REPORT_ABORT_CODES.has(failureData.abort_code ?? '')
  )
}

export function getSuiFailureData(
  effectsStatus: string,
  functionName: string,
  destChainSelector?: bigint,
  gasUsed?: bigint,
): Record<string, string> {
  const data: Record<string, string> = {
    effects_status: effectsStatus,
    function: functionName,
  }
  if (gasUsed != null) data.gas_used = gasUsed.toString()
  // Sui renders Move aborts as
  //   MoveAbort(MoveLocation { module: ModuleId { address: 0x…, name: "offramp" },
  //             function: 12, instruction: 34 }, 7)
  // newer nodes omit the 0x prefix, wrap the module name as
  // `name: Identifier("…")`, and add `function_name: Some("…")`
  const abort = effectsStatus.match(
    /MoveAbort\(\s*MoveLocation \{ module: ModuleId \{ address: (?:0x)?([0-9a-f]+), name: (?:Identifier\()?"([^"]+)"\)? \}, function: (\d+)(?:, instruction: (\d+))?(?:, function_name: Some\("([^"]+)"\))? \}, (\d+)\)/i,
  )
  if (abort) {
    // the node renders the module's address padded; surface it short, like the
    // rest of the SDK's Sui addresses
    data.location = `${toSuiShortAddress(abort[1]!)}::${abort[2]!}`
    data.function_index = abort[3]!
    if (abort[4]) data.instruction = abort[4]!
    if (abort[5]) data.function_name = abort[5]!
    data.abort_code = abort[6]!
  }
  if (destChainSelector != null) data.dest_chain_selector = destChainSelector.toString()
  return data
}

/**
 * Reconstructs the execution receipt omitted by Sui when an OffRamp execution
 * aborts. `ExecutionStateChanged` is only emitted after the execution state is
 * finalized as success, so a failed transaction carries no state event (its
 * partial PTB events can even include a stale success marker) — the report in
 * the transaction input and the effects status stand in for it.
 *
 * Reports the OffRamp intentionally SKIPPED (already executed, or RMN-cursed)
 * are not failures: the PTB aborts unwrapping the empty ReceiverParams hot
 * potato and no state=3 receipt surfaces for them. Requires the transaction to
 * have been fetched with `showEffects` and `showInput`; returns undefined for
 * successful/non-execution transactions and for failed ones whose input no
 * longer carries a decodable report.
 */
export function getSuiExecutionFailureLog(
  block: Pick<
    SuiTransactionBlockResponse,
    'digest' | 'checkpoint' | 'timestampMs' | 'effects' | 'transaction'
  >,
  offRampAddress?: string,
): ChainLog | undefined {
  if (block.effects?.status.status !== 'failure') return undefined
  const effectsStatus = block.effects.status.error
  if (!effectsStatus) return undefined
  const execution = getSuiExecutionReport(block.transaction?.data.transaction)
  if (!execution) return undefined
  const { report, functionName, package: pkg } = execution
  const gas = netGasUsed(block.effects.gasUsed)
  const failureData = getSuiFailureData(
    effectsStatus,
    functionName,
    report.dest_chain_selector,
    gas,
  )
  // A report the OffRamp intentionally SKIPPED (already executed, or RMN-cursed
  // for non-manual executions) emits no state event and aborts the PTB
  // unwrapping the empty ReceiverParams hot potato — the failed
  // double-execution attempt must not surface as a state=3 receipt: the
  // message's true state is whatever a prior execution left (success settles it).
  if (isSuiSkippedReport(failureData)) return undefined
  const data: Record<string, unknown> = {
    // Same fields a real ExecutionStateChanged event carries, plus the failure
    // decoding in return_data (like every other family's failed receipts).
    message_id: hexlify(report.message_id),
    sequence_number: report.sequence_number.toString(),
    source_chain_selector: report.source_chain_selector.toString(),
    state: ExecutionState.Failed,
    return_data: failureData,
  }
  if (gas != null) data.gas_used = gas.toString()

  return {
    // The emitting `<package>::offramp` module form — the same form every real
    // event log carries in getTransaction (Move event types are
    // `<package>::<module>::<Struct>`, and getTransaction slices only the struct
    // off), so consumers filtering receipts-in-tx by the OffRamp address match
    // failures exactly like successes. Callers pass that address in looser forms
    // (bare, short, module-suffixed, e.g. the CLI's API-metadata `offramp`);
    // both sides are canonicalized before comparing — see canonicalSuiLogAddress.
    address: offRampAddress ?? canonicalSuiLogAddress(pkg),
    topics: ['ExecutionStateChanged'],
    // A failed Sui execution has no ExecutionStateChanged event sequence, so
    // the synthetic log borrows index 0 — uint-friendly, like every other
    // family's log indexes.
    index: 0,
    blockNumber: Number(block.checkpoint ?? 0),
    transactionHash: block.digest,
    blockTimestamp: Number(block.timestampMs ?? 0) / 1000,
    data,
  }
}
