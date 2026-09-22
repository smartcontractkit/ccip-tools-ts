/**
 * CCV verifier wire schema: encode the request and decode the response, browser-safe.
 *
 * Uses `protobufjs` loaded from a committed JSON descriptor ({@link ./descriptor.ts}), so there is
 * NO filesystem or `.proto` load at runtime (unlike `@grpc/proto-loader`). This module is the only
 * place that knows the verifier protobuf shape; a {@link VerifierTransport} moves the resulting
 * bytes and never touches the schema.
 *
 * @packageDocumentation
 */
import protobuf from 'protobufjs'

import type { VerifierResult } from '../types.ts'
import { verifierProtoDescriptor } from './descriptor.ts'

/** Fully-qualified gRPC method path for the verifier's read RPC. */
export const VERIFIER_METHOD =
  '/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage' as const

const root = protobuf.Root.fromJSON(verifierProtoDescriptor)
const RequestType = root.lookupType('chainlink_ccv.verifier.v1.GetVerifierResultsForMessageRequest')
const ResponseType = root.lookupType(
  'chainlink_ccv.verifier.v1.GetVerifierResultsForMessageResponse',
)

/** Shape of the decoded `VerifierResultMetadata`, kept snake_case as on the wire. */
type RawMetadata = {
  timestamp?: string | number | bigint
  verifier_source_address?: Uint8Array
  verifier_dest_address?: Uint8Array
}

/** Shape of one decoded `VerifierResult`, kept snake_case as on the wire. */
type RawVerifierResult = {
  ccv_data?: Uint8Array
  message_ccv_addresses?: Uint8Array[]
  metadata?: RawMetadata
}

/** Shape of the decoded `GetVerifierResultsForMessageResponse`. */
type RawResponse = { results?: RawVerifierResult[] }

/**
 * Convert a protobuf `bytes` field to a 0x-prefixed hex string.
 *
 * @param b - Raw bytes from the decoded response
 * @returns Hex string, or undefined when the field is absent or empty
 */
function toHex(b: Uint8Array | undefined): string | undefined {
  if (!b || b.length === 0) return undefined
  let hex = '0x'
  for (const byte of b) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/**
 * Convert a protobuf `bytes` field to a 20-byte EVM address.
 *
 * @param b - Raw bytes from the decoded response
 * @returns 0x-prefixed lowercase hex address, or undefined when not exactly 20 bytes
 */
function toAddress(b: Uint8Array | undefined): string | undefined {
  if (!b || b.length !== 20) return undefined
  return toHex(b)
}

/**
 * Encode a `GetVerifierResultsForMessage` request for one message id.
 *
 * @param messageId - 0x-prefixed 32-byte message id
 * @returns Protobuf-encoded request body (no gRPC length-prefix framing), browser-safe
 * @example
 * ```ts
 * const body = encodeGetVerifierResultsRequest('0xabc…')
 * const responseBytes = await transport.unary({ method: VERIFIER_METHOD, endpoint, request: body, timeoutMs: 30_000 })
 * const results = decodeGetVerifierResultsResponse(responseBytes)
 * ```
 */
export function encodeGetVerifierResultsRequest(messageId: string): Uint8Array {
  const hex = messageId.replace(/^0x/, '')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return RequestType.encode(RequestType.create({ message_ids: [bytes] })).finish()
}

/**
 * Decode a `GetVerifierResultsForMessage` response into SDK {@link VerifierResult}s.
 *
 * Each result is keyed on the metadata dest-address hint, which is what the executor matches against
 * the destination's required set. `message_ccv_addresses` is the whole SOURCE-side CCV list, so
 * indexing into it is only correct when the message has exactly one CCV. A result with no `ccv_data`
 * or no resolvable dest address is dropped (the aggregator has nothing usable for it yet).
 *
 * @param bytes - Protobuf-encoded response body (no gRPC framing), browser-safe
 * @returns The decoded verifications, possibly empty before quorum
 * @example
 * ```ts
 * const results = decodeGetVerifierResultsResponse(responseBytes)
 * // → [{ ccvData: '0x…', destAddress: '0x…', sourceAddress: '0x…', timestamp: 1690000000 }]
 * ```
 */
export function decodeGetVerifierResultsResponse(bytes: Uint8Array): VerifierResult[] {
  const decoded = ResponseType.toObject(ResponseType.decode(bytes), {
    longs: String,
    bytes: Uint8Array,
    defaults: true,
  }) as RawResponse
  const out: VerifierResult[] = []
  for (const r of decoded.results ?? []) {
    const ccvData = toHex(r.ccv_data)
    const destAddress =
      toAddress(r.metadata?.verifier_dest_address) ?? toAddress(r.message_ccv_addresses?.[0])
    if (ccvData === undefined || destAddress === undefined) continue
    const sourceAddress = toAddress(r.metadata?.verifier_source_address) ?? destAddress
    const ts = r.metadata?.timestamp
    out.push({
      ccvData,
      destAddress,
      sourceAddress,
      // proto timestamp is milliseconds; VerifierResult.timestamp is seconds
      ...(ts != null ? { timestamp: Math.floor(Number(ts) / 1000) } : {}),
    })
  }
  return out
}
