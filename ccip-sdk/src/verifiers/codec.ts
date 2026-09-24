/**
 * Minimal protobuf codec for the CCV verifier's `GetVerifierResultsForMessage` RPC.
 *
 * Hand-written over the protobuf wire format instead of generated: the SDK reads only a handful of
 * fields, so this keeps it free of a protobuf runtime (browser bundle size) and of any `.proto`
 * load. The schema it implements is `proto/verifier.proto`, which `codec.test.ts` cross-checks
 * against a reference implementation. Unknown fields are skipped, so additive changes to the
 * schema are tolerated.
 *
 * @packageDocumentation
 */
import type { BytesLike } from 'ethers'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { getDataBytes } from '../utils.ts'

/** A decoded `VerifierResult`, reduced to the fields the SDK uses. */
export type RawVerifierResult = {
  /** `ccv_data`: the attestation blob passed to the destination CCV. */
  ccvData?: Uint8Array
  /** `metadata.verifier_source_address`. */
  sourceAddress?: Uint8Array
  /** `metadata.verifier_dest_address`: the destination CCV this attestation is for. */
  destAddress?: Uint8Array
  /** `metadata.timestamp`, in milliseconds. */
  timestamp?: number
}

/** A decoded `GetVerifierResultsForMessageResponse`. */
export type RawVerifierResponse = {
  results: RawVerifierResult[]
  /** Per-message `google.rpc.Status` errors. */
  errors: { code: number; message: string }[]
}

const WIRE_VARINT = 0
const WIRE_I64 = 1
const WIRE_LEN = 2
const WIRE_I32 = 5

function malformed(reason: string): CCIPError {
  return new CCIPError(
    CCIPErrorCode.MESSAGE_DECODE_FAILED,
    `malformed verifier response: ${reason}`,
  )
}

/** Append `n` (a non-negative safe integer) as a protobuf varint. */
function writeVarint(out: number[], n: number): void {
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80)
    n = Math.floor(n / 0x80)
  }
  out.push(n)
}

/**
 * Iterate the fields of one protobuf message: varints as numbers, length-delimited fields as byte
 * views into `buf`. Fixed-width fields are skipped; no field this codec reads uses them.
 */
function* readFields(buf: Uint8Array): Generator<[field: number, value: number | Uint8Array]> {
  let pos = 0
  const varint = (): number => {
    let result = 0
    for (let i = 0, mul = 1; i < 10 && pos < buf.length; i++, mul *= 0x80) {
      const b = buf[pos++]!
      result += (b & 0x7f) * mul
      if (b < 0x80) return result
    }
    throw malformed('truncated varint')
  }
  const skip = (n: number) => {
    if (pos + n > buf.length) throw malformed('truncated field')
    pos += n
  }
  while (pos < buf.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    switch (key % 8) {
      case WIRE_VARINT:
        yield [field, varint()]
        break
      case WIRE_LEN: {
        const len = varint()
        const start = pos
        skip(len)
        yield [field, buf.subarray(start, pos)]
        break
      }
      case WIRE_I64:
        skip(8)
        break
      case WIRE_I32:
        skip(4)
        break
      default:
        throw malformed(`unsupported wire type ${key % 8}`)
    }
  }
}

/**
 * Encode a `GetVerifierResultsForMessageRequest` for one message.
 *
 * @param messageId - 32-byte message id
 * @returns Protobuf-encoded request, without gRPC framing
 */
export function encodeGetVerifierResultsRequest(messageId: BytesLike): Uint8Array {
  const id = getDataBytes(messageId)
  const head: number[] = []
  writeVarint(head, (1 << 3) | WIRE_LEN) // repeated bytes message_ids = 1
  writeVarint(head, id.length)
  const out = new Uint8Array(head.length + id.length)
  out.set(head)
  out.set(id, head.length)
  return out
}

function decodeResult(buf: Uint8Array): RawVerifierResult {
  const result: RawVerifierResult = {}
  for (const [field, value] of readFields(buf)) {
    if (!(value instanceof Uint8Array)) continue
    if (field === 4) result.ccvData = value
    else if (field === 5) {
      for (const [f, v] of readFields(value)) {
        if (f === 1 && typeof v === 'number') result.timestamp = v
        else if (f === 2 && v instanceof Uint8Array) result.sourceAddress = v
        else if (f === 3 && v instanceof Uint8Array) result.destAddress = v
      }
    }
  }
  return result
}

function decodeStatus(buf: Uint8Array): { code: number; message: string } {
  const status = { code: 0, message: '' }
  for (const [field, value] of readFields(buf)) {
    if (field === 1 && typeof value === 'number') status.code = value
    else if (field === 2 && value instanceof Uint8Array)
      status.message = new TextDecoder().decode(value)
  }
  return status
}

/**
 * Decode a `GetVerifierResultsForMessageResponse`.
 *
 * @param bytes - Protobuf-encoded response, without gRPC framing
 * @returns The results and per-message errors, both possibly empty (e.g. before quorum)
 * @throws {@link CCIPError} with `MESSAGE_DECODE_FAILED` on malformed input
 */
export function decodeGetVerifierResultsResponse(bytes: Uint8Array): RawVerifierResponse {
  const response: RawVerifierResponse = { results: [], errors: [] }
  for (const [field, value] of readFields(bytes)) {
    if (!(value instanceof Uint8Array)) continue
    if (field === 1) response.results.push(decodeResult(value))
    else if (field === 2) response.errors.push(decodeStatus(value))
  }
  return response
}
