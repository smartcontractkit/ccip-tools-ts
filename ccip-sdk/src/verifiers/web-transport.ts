/**
 * Default, browser-safe {@link VerifierTransport} built on `fetch` and grpc-web framing.
 *
 * This is the env-agnostic default: it uses only `fetch`, `TextDecoder` and typed arrays, imports
 * no gRPC library, and therefore runs in a browser. It speaks the **grpc-web** wire protocol
 * (`application/grpc-web+proto`), so it targets a grpc-web endpoint (e.g. an aggregator fronted by
 * an Envoy `grpc_web` filter). A Node consumer talking to a native gRPC (HTTP/2) aggregator injects
 * the CLI's `@grpc/grpc-js` transport instead; this default keeps the SDK usable with zero setup.
 *
 * @packageDocumentation
 */
import { CCIPError, CCIPErrorCode, CCIPHttpError, CCIPTimeoutError } from '../errors/index.ts'
import type { VerifierRpc, VerifierTransport } from './transport.ts'

/** grpc-web frame flags: high bit set marks a trailer frame, clear marks a data frame. */
const TRAILER_FLAG = 0x80

/** Prefix an encoded message with the 5-byte grpc-web length-prefixed framing. */
function frame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length)
  const view = new DataView(out.buffer)
  out[0] = 0x00 // uncompressed data frame
  view.setUint32(1, message.length, false) // big-endian length
  out.set(message, 5)
  return out
}

/** One parsed grpc-web frame. */
type Frame = { readonly trailer: boolean; readonly data: Uint8Array }

/** Split a grpc-web response body into its length-prefixed frames. */
function unframe(body: Uint8Array): Frame[] {
  const frames: Frame[] = []
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  let offset = 0
  while (offset + 5 <= body.length) {
    const flag = body[offset]!
    const len = view.getUint32(offset + 1, false)
    const start = offset + 5
    if (start + len > body.length) break
    frames.push({ trailer: (flag & TRAILER_FLAG) !== 0, data: body.subarray(start, start + len) })
    offset = start + len
  }
  return frames
}

/** Parse a `grpc-status` code out of a grpc-web trailer frame (`grpc-status:0\r\n…`). */
function statusFromTrailer(data: Uint8Array): { code: number; message: string } | undefined {
  const text = new TextDecoder().decode(data)
  const code = /(?:^|\r?\n)grpc-status:\s*(\d+)/i.exec(text)
  if (!code) return undefined
  const msg = /(?:^|\r?\n)grpc-message:\s*(.*)/i.exec(text)
  return { code: Number(code[1]), message: msg ? decodeURIComponent(msg[1]!.trim()) : '' }
}

/**
 * Build the default grpc-web {@link VerifierTransport}.
 *
 * @param fetchImpl - `fetch` to use; defaults to the global `fetch` (browser or Node ≥18)
 * @returns A browser-safe transport that POSTs grpc-web frames per {@link VerifierRpc}
 * @throws CCIPError when `fetch` is unavailable, the HTTP call fails, or the gRPC status is non-OK
 * @example
 * ```ts
 * const results = await readAggregator(endpoints, messageId, {
 *   transport: webGrpcVerifierTransport(),
 * })
 * ```
 */
export function webGrpcVerifierTransport(fetchImpl?: typeof fetch): VerifierTransport {
  const doFetch = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  return {
    async unary(rpc: VerifierRpc): Promise<Uint8Array> {
      if (!doFetch) {
        throw new CCIPError(
          CCIPErrorCode.NETWORK_FAMILY_UNSUPPORTED,
          'no fetch implementation available for the grpc-web verifier transport',
        )
      }
      const scheme = rpc.endpoint.tls ? 'https' : 'http'
      const url = `${scheme}://${rpc.endpoint.target}${rpc.method}`
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), rpc.timeoutMs)
      let res: Response
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/grpc-web+proto',
            accept: 'application/grpc-web+proto',
            'x-grpc-web': '1',
          },
          body: frame(rpc.request),
          signal: ac.signal,
        })
      } catch (err) {
        if (ac.signal.aborted) {
          throw new CCIPTimeoutError(`grpc-web ${rpc.endpoint.raw}`, rpc.timeoutMs, {
            cause: err as Error,
          })
        }
        throw new CCIPError(
          CCIPErrorCode.HTTP_ERROR,
          `grpc-web request to ${rpc.endpoint.raw} failed: ${(err as Error).message}`,
          { cause: err as Error, isTransient: true },
        )
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) throw new CCIPHttpError(res.status, res.statusText)
      // A trailers-only response carries grpc-status in HTTP headers, with no body frames.
      const headerStatus = res.headers.get('grpc-status')
      if (headerStatus != null && Number(headerStatus) !== 0) {
        throw new CCIPError(
          CCIPErrorCode.HTTP_ERROR,
          `grpc-web ${rpc.endpoint.raw} status ${headerStatus}: ${res.headers.get('grpc-message') ?? ''}`,
        )
      }
      const body = new Uint8Array(await res.arrayBuffer())
      const frames = unframe(body)
      for (const f of frames.filter((x) => x.trailer)) {
        const status = statusFromTrailer(f.data)
        if (status && status.code !== 0) {
          throw new CCIPError(
            CCIPErrorCode.HTTP_ERROR,
            `grpc-web ${rpc.endpoint.raw} status ${status.code}: ${status.message}`,
          )
        }
      }
      const message = frames.find((f) => !f.trailer)
      return message?.data ?? new Uint8Array()
    },
  }
}
