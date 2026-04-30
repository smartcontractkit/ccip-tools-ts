/**
 * Canton gRPC JSON API event parsing utilities.
 *
 * The Canton Ledger JSON API (gRPC-gateway) wraps each ledger event as:
 *   `{ Event: { Created: { template_id, create_arguments, ... } } }`
 *
 * Field values use a `{ Sum: { Text|Numeric|Int64|Party|ContractId|... } }`
 * envelope.  The helpers in this module decode that format into plain
 * JavaScript objects that the rest of the SDK can work with.
 */

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { type ExecutionReceipt, ExecutionState } from '../types.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured result extracted from a `CCIPMessageSent` Created event in a
 * Canton transaction response.
 */
export interface CantonSendResultFields {
  messageId: string
  encodedMessage: string
  sequenceNumber: bigint
  nonce?: bigint
  onRampAddress?: string
}

// ---------------------------------------------------------------------------
// Top-level parsers
// ---------------------------------------------------------------------------

/**
 * Walk a Canton transaction response and extract the `CCIPMessageSent` fields.
 *
 * The Canton gRPC JSON API returns Created events with the structure:
 * ```json
 * { "Event": { "Created": {
 *     "template_id": { "entity_name": "CCIPMessageSent" },
 *     "create_arguments": { "fields": [
 *       { "label": "event", "value": { "Sum": { "Record": { "fields": [...] } } } }
 *     ]}
 * }}}
 * ```
 * Field values use a `{ Sum: { Text|Numeric|... } }` envelope.
 *
 * @throws {@link CCIPError} if no `CCIPMessageSent` event is found.
 */
export function parseCantonSendResult(
  transaction: unknown,
  updateId: string,
): CantonSendResultFields {
  const events = extractEventsFromTransaction(transaction)

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>

    if (getTemplateEntityName(rec) !== 'CCIPMessageSent') continue

    // Handle both naming conventions for the create arguments object
    const createArgs = (rec.create_arguments ?? rec.createArgument) as
      | Record<string, unknown>
      | undefined

    // Try to locate the nested `event` record (CCIPMessageSentEvent)
    const sentEvent = extractCCIPMessageSentEvent(createArgs)

    if (sentEvent) {
      return {
        messageId: typeof sentEvent.messageId === 'string' ? sentEvent.messageId : updateId,
        encodedMessage:
          typeof sentEvent.encodedMessage === 'string' ? sentEvent.encodedMessage : '',
        sequenceNumber: toBigIntSafe(sentEvent.sequenceNumber),
        nonce: sentEvent.nonce != null ? toBigIntSafe(sentEvent.nonce) : undefined,
        onRampAddress:
          typeof sentEvent.onRampAddress === 'string' ? sentEvent.onRampAddress : undefined,
      }
    }

    // Flat fallback — fields directly on createArgument
    if (createArgs) {
      const flat = flattenCantonRecord(createArgs)
      return {
        messageId: typeof flat.messageId === 'string' ? flat.messageId : updateId,
        encodedMessage: typeof flat.encodedMessage === 'string' ? flat.encodedMessage : '',
        sequenceNumber: toBigIntSafe(flat.sequenceNumber),
        nonce: flat.nonce != null ? toBigIntSafe(flat.nonce) : undefined,
        onRampAddress: typeof flat.onRampAddress === 'string' ? flat.onRampAddress : undefined,
      }
    }
  }

  throw new CCIPError(
    CCIPErrorCode.CANTON_API_ERROR,
    `Canton send: no CCIPMessageSent event found in transaction ${updateId}`,
  )
}

/**
 * Walk a Canton transaction response and extract an {@link ExecutionReceipt}.
 *
 * Looks for an `ExecutionStateChanged` Created event and extracts the
 * relevant fields.  If no matching event is found, returns a minimal
 * receipt with {@link ExecutionState.Success} (the command succeeded if we
 * reached this point).
 */
export function parseCantonExecutionReceipt(
  transaction: unknown,
  updateId: string,
): ExecutionReceipt {
  const events = extractEventsFromTransaction(transaction)

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>

    if (!getTemplateEntityName(rec).includes('ExecutionStateChanged')) continue

    // Handle both naming conventions for the create arguments object, then flatten
    const rawArgs = (rec.create_arguments ?? rec.createArgument ?? rec) as Record<string, unknown>
    const payload = flattenCantonRecord(rawArgs)

    const msgId = payload['messageId']
    const seqNum = payload['sequenceNumber']
    const srcChain = payload['sourceChainSelector']
    const retData = payload['returnData']
    return {
      messageId: typeof msgId === 'string' ? msgId : updateId,
      sequenceNumber: toBigIntSafe(seqNum),
      state: mapExecutionState(payload['state']),
      sourceChainSelector: srcChain != null ? toBigIntSafe(srcChain) : undefined,
      returnData: typeof retData === 'string' ? retData : undefined,
    }
  }

  // Fallback — the command completed successfully but we couldn't locate the
  // specific ExecutionStateChanged event (e.g. different event format).
  return {
    messageId: updateId,
    sequenceNumber: 0n,
    state: ExecutionState.Success,
  }
}

/**
 * Resolve the record-time from a Canton transaction record.
 *
 * The gRPC API returns `{ record_time: { seconds: N, nanos: N } }` while
 * the legacy JSON API returns `{ recordTime: "ISO-string" }`.
 */
export function resolveTimestamp(txRecord: Record<string, unknown>): number {
  // gRPC: { record_time: { seconds: N } }
  const rt = txRecord.record_time
  if (rt && typeof rt === 'object') {
    const rtRec = rt as Record<string, unknown>
    if (typeof rtRec.seconds === 'number') return rtRec.seconds
    if (typeof rtRec.seconds === 'string') return parseInt(rtRec.seconds, 10)
  }
  // Legacy: { recordTime: "ISO-string" }
  const rts = typeof txRecord.recordTime === 'string' ? txRecord.recordTime : ''
  return rts ? Math.floor(new Date(rts).getTime() / 1000) : Math.floor(Date.now() / 1000)
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

/**
 * Recursively extract normalised event objects from a Canton transaction tree.
 *
 * The gRPC JSON API wraps each event as `{ Event: { Created: { ... } } }`.
 * This function unwraps those wrappers so callers always receive the inner
 * Created / Exercised record directly (which carries `template_id`,
 * `create_arguments`, etc.).
 */
export function extractEventsFromTransaction(obj: unknown): unknown[] {
  const results: unknown[] = []
  if (!obj || typeof obj !== 'object') return results

  const record = obj as Record<string, unknown>

  // gRPC-style wrapper: { Event: { Created: {...} } }
  if (record.Event && typeof record.Event === 'object') {
    const eventWrapper = record.Event as Record<string, unknown>
    for (const eventType of ['Created', 'Exercised', 'Archived']) {
      if (eventWrapper[eventType] && typeof eventWrapper[eventType] === 'object') {
        results.push(eventWrapper[eventType])
      }
    }
    return results
  }

  // Flat event-type wrapper: { CreatedEvent: {...} } / { ExercisedEvent: {...} } / { ArchivedEvent: {...} }
  for (const key of ['CreatedEvent', 'ExercisedEvent', 'ArchivedEvent']) {
    if (record[key] && typeof record[key] === 'object') {
      results.push(record[key])
      return results
    }
  }

  // Arrays of events — each element might itself be an Event wrapper
  for (const key of ['createdEvents', 'exercisedEvents', 'events']) {
    if (Array.isArray(record[key])) {
      for (const ev of record[key] as unknown[]) {
        results.push(...extractEventsFromTransaction(ev))
      }
    }
  }

  // eventsById map
  if (record.eventsById && typeof record.eventsById === 'object') {
    for (const ev of Object.values(record.eventsById as Record<string, unknown>)) {
      results.push(...extractEventsFromTransaction(ev))
    }
  }

  // Recurse into known wrapper keys that contain the event list
  for (const key of ['transaction', 'JsTransaction']) {
    if (record[key] && typeof record[key] === 'object' && !Array.isArray(record[key])) {
      results.push(...extractEventsFromTransaction(record[key]))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Low-level field helpers
// ---------------------------------------------------------------------------

/**
 * Dig into a `create_arguments` / `createArgument` object to find the nested
 * `CCIPMessageSentEvent` record and return it as a flat `label → value` map.
 *
 * The gRPC-style event format stores the nested `event` field as:
 * ```json
 * { "label": "event", "value": { "Sum": { "Record": { "fields": [...] } } } }
 * ```
 */
export function extractCCIPMessageSentEvent(
  arg: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!arg) return undefined

  // gRPC structured fields array: arg.fields = [{ label, value }]
  if (Array.isArray(arg.fields)) {
    for (const field of arg.fields as Array<Record<string, unknown>>) {
      if (field.label !== 'event') continue
      const resolved = resolveEventFieldValue(field.value)
      if (resolved) return resolved
    }
  }

  // Verbose/legacy JSON API mode: arg.event is already a named object
  if (arg.event && typeof arg.event === 'object') {
    return flattenCantonRecord(arg.event as Record<string, unknown>)
  }

  return undefined
}

/**
 * Resolve a Canton field `value` for the `event` label.
 *
 * Handles:
 * - `{ Sum: { Record: { fields: [...] } } }` — gRPC style
 * - `{ fields: [...] }` — already a Record, just flatten
 * - plain object — return as-is
 */
export function resolveEventFieldValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>

  // gRPC: { Sum: { Record: { fields: [...] } } }
  if (v.Sum && typeof v.Sum === 'object') {
    const sum = v.Sum as Record<string, unknown>
    if (sum.Record && typeof sum.Record === 'object') {
      return flattenCantonRecord(sum.Record as Record<string, unknown>)
    }
  }

  // Already a record with a fields array
  if (Array.isArray(v.fields)) {
    return flattenCantonRecord(v)
  }

  // Flat object (verbose API)
  return v
}

/**
 * Convert a Canton record `{ fields: [{ label, value }] }` into a plain
 * `{ [label]: extractedValue }` map.  When no `fields` array is present the
 * record is returned unchanged.
 */
export function flattenCantonRecord(record: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(record.fields)) return record
  const result: Record<string, unknown> = {}
  for (const f of record.fields as Array<Record<string, unknown>>) {
    if (typeof f.label === 'string') {
      result[f.label] = extractFieldValue(f.value)
    }
  }
  return result
}

/**
 * Extract the entity name from a Canton event, supporting both the gRPC format
 * (`template_id.entity_name`) and the legacy flat format (`templateId` string
 * with colon-separated parts).
 */
export function getTemplateEntityName(event: Record<string, unknown>): string {
  // gRPC format: { template_id: { entity_name: "..." } }
  if (event.template_id && typeof event.template_id === 'object') {
    const tid = event.template_id as Record<string, unknown>
    if (typeof tid.entity_name === 'string') return tid.entity_name
  }
  // Legacy flat format: "packageId:Module:Entity" or "Module:Entity"
  if (typeof event.templateId === 'string') {
    const parts = event.templateId.split(':')
    return parts[parts.length - 1] ?? ''
  }
  return ''
}

/**
 * Extract a primitive value from a Canton Daml field value, handling both the
 * gRPC `{ Sum: { Text|Numeric|Int64|Party|ContractId } }` envelope and the
 * legacy verbose JSON API `{ text|int64|numeric|... }` form.
 *
 * Numeric values returned by the gRPC API have a trailing `"."` (e.g. `"1."`)
 * which is stripped to yield a clean integer string.
 */
export function extractFieldValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const v = value as Record<string, unknown>

  // gRPC Sum envelope: { Sum: { Text: "..." } }
  if (v.Sum && typeof v.Sum === 'object') {
    const sum = v.Sum as Record<string, unknown>
    if ('Text' in sum) return sum.Text
    if ('Numeric' in sum) {
      const n = String(sum.Numeric)
      // Strip trailing "." produced by Daml numeric encoding (e.g. "1." → "1")
      return n.endsWith('.') ? n.slice(0, -1) : n
    }
    if ('Int64' in sum) return sum.Int64
    if ('Party' in sum) return sum.Party
    if ('ContractId' in sum) return sum.ContractId
    if ('Bool' in sum) return sum.Bool
    // For complex types (Record, List, GenMap) return the sum value as-is
    return sum
  }

  // Legacy verbose JSON API mode
  if ('text' in v) return v.text
  if ('int64' in v) return v.int64
  if ('numeric' in v) return v.numeric
  if ('contractId' in v) return v.contractId
  if ('party' in v) return v.party
  return value
}

/**
 * Safely convert an unknown value to bigint, defaulting to `0n`.
 */
export function toBigIntSafe(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string' && v.length > 0) {
    try {
      // Strip trailing "." produced by Daml numeric encoding (e.g. "1." → "1")
      const s = v.endsWith('.') ? v.slice(0, -1) : v
      return BigInt(s)
    } catch {
      return 0n
    }
  }
  return 0n
}

/**
 * Map a Canton execution state value to the SDK {@link ExecutionState}.
 */
export function mapExecutionState(state: unknown): ExecutionState {
  if (state === undefined || state === null) return ExecutionState.Success

  const s = typeof state === 'string' ? state.toLowerCase() : `${state as string | number}`

  if (s === 'success' || s === '2') return ExecutionState.Success
  if (s === 'failed' || s === '3') return ExecutionState.Failed
  if (s === 'inprogress' || s === 'in_progress' || s === '1') return ExecutionState.InProgress

  return ExecutionState.Success
}
