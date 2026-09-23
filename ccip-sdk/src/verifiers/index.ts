/**
 * Direct reads of CCV attestations from a verifier, for CCIP v2.0 messages.
 *
 * `fetchVerifications` uses {@link readVerifier} as its last source, after the CCIP API and the
 * indexers; consumers normally reach it through `Chain.getVerifications({ verifiers })`. It is
 * browser-safe: the schema is a hand-written codec and the I/O goes through an injectable
 * {@link VerifierTransport} (default: grpc-web over `fetch`).
 *
 * @packageDocumentation
 */
import { type BytesLike, hexlify } from 'ethers'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import type { VerifierResult } from '../types.ts'
import { decodeGetVerifierResultsResponse, encodeGetVerifierResultsRequest } from './codec.ts'
import type { VerifierTransport } from './transport.ts'

export { type VerifierCall, type VerifierTransport, grpcWebTransport } from './transport.ts'

/** Fully-qualified gRPC method path of the verifier's read RPC. */
export const VERIFIER_METHOD = '/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage'

/**
 * Read a message's CCV attestations from one verifier endpoint.
 *
 * Each result is attributed to the destination CCV named by its `verifier_dest_address` metadata;
 * a result without that hint, or without `ccv_data`, is dropped, since there is no telling which
 * destination CCV it would satisfy.
 *
 * @param url - Endpoint URL, passed verbatim to the transport
 * @param messageId - 32-byte message id
 * @param opts - `transport` to use; `getAddress` to render a raw dest CCV address in the
 *   destination family's format (default: hex); `signal` to cancel the call
 * @returns The attributable results, possibly empty (e.g. before the verifier reached quorum)
 * @throws {@link CCIPError} from the transport, or when the verifier answers only with errors
 */
export async function readVerifier(
  url: string,
  messageId: BytesLike,
  opts: {
    transport: VerifierTransport
    getAddress?: (address: BytesLike) => string
    signal?: AbortSignal
  },
): Promise<VerifierResult[]> {
  const { transport, getAddress = hexlify, signal } = opts
  const { results, errors } = decodeGetVerifierResultsResponse(
    await transport({
      url,
      method: VERIFIER_METHOD,
      body: encodeGetVerifierResultsRequest(messageId),
      signal,
    }),
  )
  const verifications: VerifierResult[] = []
  for (const r of results) {
    if (!r.ccvData?.length || !r.destAddress?.length) continue
    let destAddress
    try {
      destAddress = getAddress(r.destAddress)
    } catch {
      continue // not an address of the destination family
    }
    verifications.push({
      ccvData: hexlify(r.ccvData),
      destAddress,
      sourceAddress: r.sourceAddress?.length ? hexlify(r.sourceAddress) : '',
      // proto timestamp is milliseconds; VerifierResult.timestamp is seconds
      ...(r.timestamp ? { timestamp: Math.floor(r.timestamp / 1000) } : {}),
    })
  }
  if (!verifications.length && errors.length) {
    throw new CCIPError(
      CCIPErrorCode.HTTP_ERROR,
      errors.map((e) => `code ${e.code}: ${e.message}`).join('; '),
    )
  }
  return verifications
}
