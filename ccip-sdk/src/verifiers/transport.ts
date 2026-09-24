/**
 * Transport port for reading CCV attestations from a verifier, and its browser-safe default.
 *
 * The SDK owns the verifier schema (see `codec.ts`) and the source-assembly algorithm (see
 * `fetchVerifications`); a {@link VerifierTransport} only moves one request's bytes to an endpoint
 * and back. The default, {@link grpcWebTransport}, speaks grpc-web over `fetch`, so it runs in any
 * JS environment against a grpc-web proxy in front of the verifier. A consumer with a native gRPC
 * stack (e.g. the CLI, via `@grpc/grpc-js`) injects its own through `ChainContext.verifierTransport`.
 *
 * @packageDocumentation
 */
import { CCIPError, CCIPErrorCode, CCIPHttpError } from '../errors/index.ts'
import { fetchWithTimeout, redactEndpointUrl } from '../fetch.ts'

/** One unary call to a verifier, fully described so a transport needs no schema knowledge. */
export type VerifierCall = {
  /**
   * Endpoint URL, verbatim as configured by the caller. Its scheme selects the wire protocol and
   * is the transport's to interpret: {@link grpcWebTransport} accepts `http(s)://`.
   */
  url: string
  /** Fully-qualified gRPC method path, e.g. `/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage`. */
  method: string
  /** Protobuf-encoded request message, without gRPC framing. */
  body: Uint8Array
  /** Cancels the call; carries both the caller's cancellation and the per-call timeout. */
  signal?: AbortSignal
}

/**
 * Performs one unary gRPC call and resolves to the protobuf-encoded response message (without
 * framing). Implementations add their protocol's framing, and throw on a transport failure or a
 * non-OK gRPC status; they must not interpret the payload.
 *
 * @example Delegate to the default for URLs a custom transport doesn't handle
 * ```ts
 * const web = grpcWebTransport()
 * const transport: VerifierTransport = (call) =>
 *   call.url.startsWith('grpc://') ? myGrpcClient.unary(call) : web(call)
 * const chain = await EVMChain.fromUrl(rpc, { verifierTransport: transport })
 * ```
 */
export type VerifierTransport = (call: VerifierCall) => Promise<Uint8Array>

/** grpc-web frame flag marking a trailer frame; a data frame has it clear. */
const TRAILER_FLAG = 0x80

function frame(message: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + message.length)
  new DataView(out.buffer).setUint32(1, message.length) // out[0] = 0: uncompressed data frame
  out.set(message, 5)
  return out
}

function unframe(body: Uint8Array): { trailer: boolean; data: Uint8Array }[] {
  const frames = []
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  for (let pos = 0; pos + 5 <= body.length;) {
    const end = pos + 5 + view.getUint32(pos + 1)
    if (end > body.length) break
    frames.push({ trailer: (body[pos]! & TRAILER_FLAG) !== 0, data: body.subarray(pos + 5, end) })
    pos = end
  }
  return frames
}

/** Parse a trailer frame's `name: value` lines, keyed by lower-cased name. */
function parseTrailers(data: Uint8Array): Map<string, string> {
  const trailers = new Map<string, string>()
  for (const line of new TextDecoder().decode(data).split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0) trailers.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim())
  }
  return trailers
}

/** Throw on a non-OK `grpc-status`, read from the HTTP headers or from a trailer frame. */
function assertGrpcOk(url: string, status: string | null | undefined, message?: string | null) {
  if (status == null || Number(status) === 0) return
  let detail = message ?? ''
  try {
    detail = decodeURIComponent(detail) // grpc-message is percent-encoded
  } catch {
    // keep it raw
  }
  throw new CCIPError(
    CCIPErrorCode.HTTP_ERROR,
    `verifier ${redactEndpointUrl(url)} returned gRPC status ${status}${detail ? `: ${detail}` : ''}`,
  )
}

/**
 * Build the default, browser-safe {@link VerifierTransport}: grpc-web (`application/grpc-web+proto`)
 * over `fetch`, for an `http(s)://` endpoint served by a grpc-web proxy (e.g. Envoy's `grpc_web`
 * filter) in front of the verifier. The URL may carry a path prefix; the method path is appended.
 *
 * @param fetchImpl - `fetch` to use (default: `globalThis.fetch`)
 * @returns The transport
 * @throws {@link CCIPError} from the transport, for a non-http(s) URL, an HTTP error or a non-OK gRPC status
 */
export function grpcWebTransport(fetchImpl?: typeof fetch): VerifierTransport {
  return async ({ url, method, body, signal }) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new CCIPError(
        CCIPErrorCode.ARGUMENT_INVALID,
        `verifier endpoint ${redactEndpointUrl(url)} is not http(s)://: the default grpc-web ` +
          'transport needs a grpc-web proxy URL; inject a native gRPC transport via ' +
          '`ChainContext.verifierTransport` for other schemes',
      )
    }
    let base = url
    while (base.endsWith('/')) base = base.slice(0, -1)
    const res = await fetchWithTimeout(`${base}${method}`, 'verifier', {
      signal,
      fetch: fetchImpl,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/grpc-web+proto',
          accept: 'application/grpc-web+proto',
          'x-grpc-web': '1',
        },
        body: frame(body),
      },
    })
    if (!res.ok) throw new CCIPHttpError(res.status, res.statusText)
    // trailers-only responses carry the status in the HTTP headers
    assertGrpcOk(url, res.headers.get('grpc-status'), res.headers.get('grpc-message'))
    const frames = unframe(new Uint8Array(await res.arrayBuffer()))
    for (const f of frames) {
      if (!f.trailer) continue
      const trailers = parseTrailers(f.data)
      assertGrpcOk(url, trailers.get('grpc-status'), trailers.get('grpc-message'))
    }
    return frames.find((f) => !f.trailer)?.data ?? new Uint8Array()
  }
}
