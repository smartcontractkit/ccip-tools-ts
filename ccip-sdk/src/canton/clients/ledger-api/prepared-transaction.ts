/**
 * Reader for Canton interactive-submission `PreparedTransaction` blobs.
 *
 * `POST /v2/interactive-submission/prepare` (JSON API) / `PrepareSubmission`
 * (gRPC Ledger API) interprets commands *without executing or signing them* —
 * the response's `preparedTransaction` is the base64-encoded, interpreted
 * transaction the submitting party would sign, and its Exercise nodes already
 * carry the computed choice results. That makes a prepare-only submission a way
 * to read a choice's return value (e.g. `CCIPSender.GetFee`) without prompting
 * for a signature or committing anything to the ledger.
 *
 * Only the shapes needed to navigate to choice results are decoded, following
 * Canton's `com.daml.ledger.api.v2.interactive` (interactive_submission_service.proto)
 * and `com.daml.ledger.api.v2.interactive.transaction.v1`
 * (interactive_submission_data.proto) messages:
 *
 * ```
 * PreparedTransaction
 *  ├─ 1: DamlTransaction transaction
 *  │    └─ 3: repeated Node nodes
 *  │         └─ 1000: transaction.v1.Node
 *  │              └─ 3: Exercise
 *  │                   ├─ 9:  string choice_id
 *  │                   └─ 13: Value exercise_result
 *  └─ 2: Metadata
 * ```
 *
 * Decoded Daml values use the JSON Ledger API verbose shapes understood by the
 * shared `daml-parse.ts` helpers (records as `{ fields: [{ label, value }] }`,
 * numerics as decimal strings).
 *
 * @packageDocumentation
 */

import { decodeBase64 } from 'ethers'

import { CCIPError, CCIPErrorCode } from '../../../errors/index.ts'

/** A single protobuf wire-format field. */
interface ProtoField {
  number: number
  wireType: number
  /** Wire type 0. */
  varint?: bigint
  /** Wire type 2 (length-delimited message, string or bytes). */
  bytes?: Uint8Array
}

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LEN = 2
const WIRE_FIXED32 = 5

/** Read a base-128 varint at `pos`; returns the value and the next position. */
function readVarint(data: Uint8Array, pos: number): { value: bigint; pos: number } {
  let result = 0n
  let shift = 0n
  let current = pos
  for (;;) {
    if (current >= data.length) {
      throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'truncated protobuf varint')
    }
    const byte = data[current]!
    result |= BigInt(byte & 0x7f) << shift
    current++
    if ((byte & 0x80) === 0) return { value: result, pos: current }
    shift += 7n
    if (shift >= 64n) {
      throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'protobuf varint too long')
    }
  }
}

/** Parse a protobuf message body into its top-level fields. */
function parseProtoFields(data: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = []
  let pos = 0
  while (pos < data.length) {
    const tag = readVarint(data, pos)
    pos = tag.pos
    const number = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 7n)
    if (number === 0) {
      throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'invalid protobuf field number 0')
    }
    const field: ProtoField = { number, wireType }
    switch (wireType) {
      case WIRE_VARINT: {
        const value = readVarint(data, pos)
        field.varint = value.value
        pos = value.pos
        break
      }
      case WIRE_LEN: {
        const length = readVarint(data, pos)
        pos = length.pos
        if (pos + Number(length.value) > data.length) {
          throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'truncated protobuf field')
        }
        field.bytes = data.slice(pos, pos + Number(length.value))
        pos += Number(length.value)
        break
      }
      case WIRE_FIXED64:
        if (pos + 8 > data.length) {
          throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'truncated protobuf fixed64')
        }
        field.varint = data
          .slice(pos, pos + 8)
          .reduce((acc, b, i) => acc | (BigInt(b) << BigInt(8 * i)), 0n)
        pos += 8
        break
      case WIRE_FIXED32:
        if (pos + 4 > data.length) {
          throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'truncated protobuf fixed32')
        }
        field.varint = data
          .slice(pos, pos + 4)
          .reduce((acc, b, i) => acc | (BigInt(b) << BigInt(8 * i)), 0n)
        pos += 4
        break
      default:
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `unsupported protobuf wire type ${wireType}`,
        )
    }
    fields.push(field)
  }
  return fields
}

function stringField(field: ProtoField | undefined): string | undefined {
  if (field?.bytes == undefined) return undefined
  return new TextDecoder().decode(field.bytes)
}

function subMessage(field: ProtoField | undefined): ProtoField[] | undefined {
  return field?.bytes != undefined ? parseProtoFields(field.bytes) : undefined
}

/**
 * Decode a Daml `Value` (the `com.daml.ledger.api.v2` proto) into the JSON
 * Ledger API verbose shape: records as `{ fields: [{ label, value }] }`,
 * variants as `{ constructor, value }`, numerics/parties/texts as strings.
 */
function decodeDamlProtoValue(valueFields: ProtoField[]): unknown {
  for (const field of valueFields) {
    switch (field.number) {
      case 1: // unit
        return null
      case 2: // bool
        return field.varint !== 0n
      case 3: {
        // sint64 — zigzag encoded
        const zigzag = field.varint!
        const value = (zigzag >> 1n) ^ -(zigzag & 1n)
        return Number.isSafeInteger(Number(value)) ? Number(value) : value
      }
      case 4: // date — days since epoch
        return Number(field.varint)
      case 5: // timestamp — sfixed64 microseconds
        return field.varint!
      case 6: // numeric
      case 7: // party
      case 8: // text
      case 9: // contractId
        return stringField(field)
      case 10: {
        // Optional { Value value = 1 }
        const inner = subMessage(field)
        return inner && inner.length > 0 ? decodeDamlProtoValue(inner) : null
      }
      case 11: {
        // List { repeated Value elements = 1 }
        const list: unknown[] = []
        for (const element of parseProtoFields(field.bytes!)) {
          if (element.number === 1 && element.bytes) {
            list.push(decodeDamlProtoValue(parseProtoFields(element.bytes)))
          }
        }
        return list
      }
      case 12: {
        // TextMap { repeated Entry entries = 1 { key = 1, value = 2 } }
        const map: Record<string, unknown> = {}
        for (const entry of parseProtoFields(field.bytes!)) {
          if (entry.number !== 1 || !entry.bytes) continue
          const entryFields = parseProtoFields(entry.bytes)
          const key = stringField(entryFields.find((f) => f.number === 1))
          const value = subMessage(entryFields.find((f) => f.number === 2))
          if (key != undefined && value) map[key] = decodeDamlProtoValue(value)
        }
        return map
      }
      case 13: {
        // GenMap { repeated Entry entries = 1 { key = 1, value = 2 } }
        const entries: Array<{ key: unknown; value: unknown }> = []
        for (const entry of parseProtoFields(field.bytes!)) {
          if (entry.number !== 1 || !entry.bytes) continue
          const entryFields = parseProtoFields(entry.bytes)
          const keyField = subMessage(entryFields.find((f) => f.number === 1))
          const valueField = subMessage(entryFields.find((f) => f.number === 2))
          entries.push({
            key: keyField ? decodeDamlProtoValue(keyField) : undefined,
            value: valueField ? decodeDamlProtoValue(valueField) : undefined,
          })
        }
        return entries
      }
      case 14: {
        // Record { Identifier record_id = 1, repeated RecordField fields = 2 }
        const fields: Array<{ label?: string; value: unknown }> = []
        for (const recordField of parseProtoFields(field.bytes!)) {
          if (recordField.number !== 2 || !recordField.bytes) continue
          const fieldFields = parseProtoFields(recordField.bytes)
          fields.push({
            label: stringField(fieldFields.find((f) => f.number === 1)),
            value: decodeDamlProtoValue(subMessage(fieldFields.find((f) => f.number === 2)) ?? []),
          })
        }
        return { fields }
      }
      case 15: {
        // Variant { Identifier variant_id = 1, string constructor = 2, Value value = 3 }
        const variantFields = parseProtoFields(field.bytes!)
        const constructor = stringField(variantFields.find((f) => f.number === 2))
        const value = subMessage(variantFields.find((f) => f.number === 3))
        return {
          constructor,
          value: value ? decodeDamlProtoValue(value) : null,
        }
      }
      case 16: {
        // Enum { Identifier enum_id = 1, string constructor = 2 }
        const enumFields = parseProtoFields(field.bytes!)
        return { constructor: stringField(enumFields.find((f) => f.number === 2)) }
      }
    }
  }
  return undefined
}

/**
 * Find the result of exercising `choiceId` inside a base64-encoded interactive
 * submission `PreparedTransaction`, decoded via {@link decodeDamlProtoValue}.
 *
 * @param preparedTransactionB64 - `preparedTransaction` from a
 *   `PrepareSubmissionResponse`.
 * @param choiceId - Choice name to look for (e.g. `GetFee`).
 * @param contractId - When given, only Exercise nodes on this contract match.
 *   Nested exercises may reuse the same choice name on other contracts, and
 *   they appear earlier in the node list than the root exercise.
 * @returns The decoded exercise result, or `undefined` when the transaction
 *   contains no matching Exercise node (or no result).
 */
export function findExerciseResult(
  preparedTransactionB64: string,
  choiceId: string,
  contractId?: string,
): unknown {
  const preparedTransaction = parseProtoFields(decodeBase64(preparedTransactionB64))

  const transaction = subMessage(
    preparedTransaction.find((f) => f.number === 1), // PreparedTransaction.transaction
  )
  if (!transaction) return undefined

  for (const node of transaction.filter((f) => f.number === 3)) {
    // DamlTransaction.Node { node_id = 1, transaction.v1.Node v1 = 1000 }
    const nodeV1 = subMessage(subMessage(node)?.find((f) => f.number === 1000))
    // transaction.v1.Node { oneof node_type { Exercise exercise = 3 } }
    const exercise = nodeV1 ? subMessage(nodeV1.find((f) => f.number === 3)) : undefined
    if (!exercise) continue
    if (stringField(exercise.find((f) => f.number === 9)) !== choiceId) continue
    if (
      contractId != undefined &&
      stringField(exercise.find((f) => f.number === 2)) !== contractId
    ) {
      continue
    }
    const result = subMessage(exercise.find((f) => f.number === 13))
    return result ? decodeDamlProtoValue(result) : undefined
  }
  return undefined
}
