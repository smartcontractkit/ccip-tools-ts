/**
 * Canton Daml wire-format parsing helpers.
 *
 * The Canton JSON Ledger API (and its gRPC gateway) serialize Daml values in
 * several envelope shapes. These helpers normalize them into plain
 * `label → value` maps so operations can read contract/choice arguments
 * without depending on the SDK's typed bindings decoders.
 *
 * Ported from the pre-dapp-SDK `canton/events.ts` — the chain's ACS instance
 * matching and the CCT operations are their consumers.
 *
 * @packageDocumentation
 */

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

function flattenCantonRecord(record: Record<string, unknown>): Record<string, unknown> {
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
 * Decode a Canton Daml `createArgument` / choice-argument value into a flat
 * `label → value` map, handling both the gRPC `{ Sum: { Record: { fields } } }`
 * envelope and the bare `{ fields: [...] }` form. Nested record fields are kept
 * as their extracted (possibly object) values; use {@link extractRecordField}
 * to descend one level further.
 */
export function decodeDamlRecord(argument: unknown): Record<string, unknown> {
  if (!argument || typeof argument !== 'object') return {}
  let record = argument as Record<string, unknown>
  // Unwrap a gRPC Sum→Record envelope: { Sum: { Record: { fields: [...] } } }
  if (record.Sum && typeof record.Sum === 'object') {
    const sum = record.Sum as Record<string, unknown>
    if (sum.Record && typeof sum.Record === 'object') {
      record = sum.Record as Record<string, unknown>
    } else {
      record = sum
    }
  }
  return flattenCantonRecord(record)
}

/**
 * Extract a named field from a decoded Daml record and, if it is itself a
 * record, flatten it into a `label → value` map. Returns `undefined` when the
 * field is absent. Use for nested fields like `instrumentId` (a `{ admin, id }`
 * record inside a `TokenConfig` create argument).
 */
export function extractRecordField(
  record: Record<string, unknown>,
  fieldName: string,
): Record<string, unknown> | undefined {
  const value = record[fieldName]
  if (!value || typeof value !== 'object') return undefined
  return decodeDamlRecord(value)
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
  // JSON API object format: { templateId: { entityName: "..." } }
  if (event.templateId && typeof event.templateId === 'object') {
    const tid = event.templateId as Record<string, unknown>
    if (typeof tid.entityName === 'string') return tid.entityName
    if (typeof tid.entity_name === 'string') return tid.entity_name
  }
  // Legacy flat format: "packageId:Module:Entity" or "Module:Entity"
  if (typeof event.templateId === 'string') {
    const parts = event.templateId.split(':')
    return parts[parts.length - 1] ?? ''
  }
  return ''
}
