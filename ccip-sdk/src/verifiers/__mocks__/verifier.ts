/**
 * Test-only reference codec: protobufjs loading the real `proto/verifier.proto`, used to cross-check
 * the hand-written codec and to build verifier responses for tests. Never shipped (`__mocks__` is
 * excluded from the build), so its runtime `.proto` load doesn't affect browser-safety.
 */
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import protobuf from 'protobufjs'

import type { VerifierTransport } from '../transport.ts'

const PROTO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'proto')

const root = new protobuf.Root()
const resolvePath = root.resolvePath.bind(root)
// protobufjs bundles the google/protobuf/* well-known types; our imports resolve from PROTO_DIR
root.resolvePath = (_origin, target) =>
  target.startsWith('google/protobuf/')
    ? null
    : resolvePath('', isAbsolute(target) ? target : join(PROTO_DIR, target))
root.loadSync(join(PROTO_DIR, 'verifier.proto'), { keepCase: true })

export const RequestType = root.lookupType(
  'chainlink_ccv.verifier.v1.GetVerifierResultsForMessageRequest',
)
export const ResponseType = root.lookupType(
  'chainlink_ccv.verifier.v1.GetVerifierResultsForMessageResponse',
)

export const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'))

/** A verifier result as it goes on the wire, with the fields tests care about. */
export type WireResult = {
  ccvData?: string
  destAddress?: string
  sourceAddress?: string
  timestampMs?: number
}

/** Encode a `GetVerifierResultsForMessageResponse` with the reference implementation. */
export function encodeResponse(
  results: WireResult[],
  errors: { code: number; message: string }[] = [],
): Uint8Array {
  return ResponseType.encode(
    ResponseType.create({
      results: results.map((r) => ({
        ...(r.ccvData && { ccv_data: hexBytes(r.ccvData) }),
        metadata: {
          ...(r.timestampMs && { timestamp: r.timestampMs }),
          ...(r.sourceAddress && { verifier_source_address: hexBytes(r.sourceAddress) }),
          ...(r.destAddress && { verifier_dest_address: hexBytes(r.destAddress) }),
        },
      })),
      errors,
    }),
  ).finish()
}

/** A transport serving a fixed response per URL, recording the URLs it was called with. */
export function fakeTransport(byUrl: Record<string, WireResult[] | Error>): VerifierTransport & {
  calls: string[]
} {
  const calls: string[] = []
  const transport = ({ url }: { url: string }) => {
    calls.push(url)
    const served = byUrl[url]
    if (!served) return Promise.reject(new Error(`unexpected verifier call to ${url}`))
    if (served instanceof Error) return Promise.reject(served)
    return Promise.resolve(encodeResponse(served))
  }
  return Object.assign(transport, { calls })
}
