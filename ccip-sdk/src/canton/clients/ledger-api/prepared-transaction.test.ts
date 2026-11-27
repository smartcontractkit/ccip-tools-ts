/**
 * Unit tests for {@link findExerciseResult}: navigation of interactive
 * submission `PreparedTransaction` protobuf blobs and Daml value decoding.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { encodeBase64 } from 'ethers'

import { findExerciseResult } from './prepared-transaction.ts'

function encodeVarint(value: number): number[] {
  const bytes: number[] = []
  let v = value
  do {
    let byte = v & 0x7f
    v = Math.floor(v / 128)
    if (v > 0) byte |= 0x80
    bytes.push(byte)
  } while (v > 0)
  return bytes
}

/** Length-delimited protobuf field: tag (field, wire type 2) + length + payload. */
function field(fieldNumber: number, payload: number[]): number[] {
  if (fieldNumber > 15) {
    // multi-byte tag: low 7 bits first, then continuation
    const tagValue = (fieldNumber << 3) | 2
    return [...encodeVarint(tagValue), ...encodeVarint(payload.length), ...payload]
  }
  return [((fieldNumber << 3) | 2) & 0xff, ...encodeVarint(payload.length), ...payload]
}

function stringField(fieldNumber: number, text: string): number[] {
  return field(fieldNumber, [...new TextEncoder().encode(text)])
}

/** Daml Value holding a Numeric (field 6). */
function numericValue(text: string): number[] {
  return stringField(6, text)
}

/** Daml RecordField: label (1) + Value (2). */
function recordField(label: string, value: number[]): number[] {
  return [...stringField(1, label), ...field(2, value)]
}

/** Daml Record body: repeated RecordField (2). */
function record(...fields: number[][]): number[] {
  return fields.flatMap((f) => field(2, f))
}

/** Daml Value holding a Record (field 14). */
function recordValue(body: number[]): number[] {
  return field(14, body)
}

/** transaction.v1.Exercise: contract_id (2), choice_id (9), chosen_value (10), exercise_result (13). */
function exerciseNode(choice: string, resultValue: number[]): number[] {
  return [
    ...stringField(2, '#sender-cid'),
    ...stringField(9, choice),
    ...field(10, recordValue(record())),
    ...field(13, resultValue),
  ]
}

/** DamlTransaction.Node: node_id (1), transaction.v1.Node (1000) wrapping Exercise (3). */
function transactionNode(choice: string, resultValue: number[]): number[] {
  return [...stringField(1, 'root'), ...field(1000, field(3, exerciseNode(choice, resultValue)))]
}

/** PreparedTransaction: DamlTransaction (1) wrapping repeated Node (3). */
function preparedTransaction(...nodes: number[][]): Uint8Array {
  return new Uint8Array(
    field(
      1,
      nodes.flatMap((n) => field(3, n)),
    ),
  )
}

const GET_FEE_RESULT = recordValue(
  record(
    recordField('feeTokenAmount', numericValue('1.5000000000')),
    recordField('poolFeeTokenAmount', numericValue('0.2500000000')),
  ),
)

describe('findExerciseResult', () => {
  it('decodes the GetFee exercise result among several exercise nodes', () => {
    const blob = encodeBase64(
      preparedTransaction(
        transactionNode('Send', numericValue('999')),
        transactionNode('GetFee', GET_FEE_RESULT),
      ),
    )
    assert.deepEqual(findExerciseResult(blob, 'GetFee'), {
      fields: [
        { label: 'feeTokenAmount', value: '1.5000000000' },
        { label: 'poolFeeTokenAmount', value: '0.2500000000' },
      ],
    })
  })

  it('returns undefined when the choice is not exercised', () => {
    const blob = encodeBase64(preparedTransaction(transactionNode('Send', numericValue('999'))))
    assert.equal(findExerciseResult(blob, 'GetFee'), undefined)
  })

  it('filters by contract id when given', () => {
    const blob = encodeBase64(preparedTransaction(transactionNode('Send', numericValue('999'))))
    assert.equal(findExerciseResult(blob, 'Send', '#other-cid'), undefined)
    assert.deepEqual(findExerciseResult(blob, 'Send', '#sender-cid'), '999')
  })

  it('decodes unlabeled record fields (labels are optional on the wire)', () => {
    // RecordField without a label (field 1 omitted): Value { 6: numeric }
    const unlabeledResult = field(14, [
      ...field(2, field(2, numericValue('1.5000000000'))),
      ...field(2, field(2, numericValue('0.2500000000'))),
    ])
    const blob = encodeBase64(preparedTransaction(transactionNode('GetFee', unlabeledResult)))
    const result = findExerciseResult(blob, 'GetFee') as {
      fields: Array<{ label?: string; value?: unknown }>
    }
    assert.equal(result.fields.length, 2)
    assert.equal(result.fields[0]!.label, undefined)
    assert.equal(result.fields[0]!.value, '1.5000000000')
    assert.equal(result.fields[1]!.value, '0.2500000000')
  })

  it('returns undefined for an empty transaction', () => {
    const blob = encodeBase64(preparedTransaction())
    assert.equal(findExerciseResult(blob, 'GetFee'), undefined)
  })

  it('returns undefined when the exercise node has no result', () => {
    const noResult = [...stringField(2, '#sender-cid'), ...stringField(9, 'GetFee')]
    const node = [...stringField(1, 'root'), ...field(1000, field(3, noResult))]
    const tx = new Uint8Array(field(1, field(3, node)))
    assert.equal(findExerciseResult(encodeBase64(tx), 'GetFee'), undefined)
  })

  it('rejects malformed blobs', () => {
    const blob = encodeBase64(new Uint8Array([0x0f])) // field 1, wire type 7 — unsupported
    assert.throws(() => findExerciseResult(blob, 'GetFee'), /unsupported protobuf wire type/)
  })
})
