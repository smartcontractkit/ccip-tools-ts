import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { CCIPErrorCode, CCIPHttpError } from '../errors/index.ts'
import { grpcWebTransport } from './transport.ts'

const METHOD = '/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage'

/** A grpc-web length-prefixed frame. */
function frame(flag: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + data.length)
  out[0] = flag
  new DataView(out.buffer).setUint32(1, data.length)
  out.set(data, 5)
  return out
}
const trailer = (text: string) => frame(0x80, new TextEncoder().encode(text))

function grpcWebResponse(parts: Uint8Array[], init?: ResponseInit): Response {
  return new Response(Buffer.concat(parts), {
    status: 200,
    headers: { 'content-type': 'application/grpc-web+proto' },
    ...init,
  })
}

type FetchArgs = [input: string, init?: RequestInit]

describe('grpcWebTransport', () => {
  it('POSTs one framed message to <url><method> and returns the data frame', async () => {
    const reply = new Uint8Array([1, 2, 3])
    const fetchFn = mock.fn((..._args: FetchArgs) =>
      Promise.resolve(grpcWebResponse([frame(0, reply), trailer('grpc-status: 0\r\n')])),
    )
    const out = await grpcWebTransport(fetchFn as unknown as typeof fetch)({
      url: 'https://proxy.example/verifier/', // path prefix kept, trailing slash dropped
      method: METHOD,
      body: new Uint8Array([9, 9]),
    })
    assert.deepEqual(out, reply)
    const [url, init] = fetchFn.mock.calls[0]!.arguments
    assert.equal(url, `https://proxy.example/verifier${METHOD}`)
    assert.equal(init!.method, 'POST')
    assert.equal(new Headers(init!.headers).get('content-type'), 'application/grpc-web+proto')
    assert.deepEqual(new Uint8Array(init!.body as ArrayBuffer), frame(0, new Uint8Array([9, 9])))
  })

  it('returns an empty message when the reply has no data frame', async () => {
    const fetchFn = () => Promise.resolve(grpcWebResponse([trailer('grpc-status: 0\r\n')]))
    const out = await grpcWebTransport(fetchFn as unknown as typeof fetch)({
      url: 'http://localhost:8080',
      method: METHOD,
      body: new Uint8Array(),
    })
    assert.equal(out.length, 0)
  })

  it('throws on a non-OK status in a trailer frame, with the decoded message', async () => {
    const fetchFn = () =>
      Promise.resolve(
        grpcWebResponse([trailer('grpc-status: 14\r\ngrpc-message: no%20quorum\r\n')]),
      )
    await assert.rejects(
      grpcWebTransport(fetchFn as unknown as typeof fetch)({
        url: 'https://proxy.example',
        method: METHOD,
        body: new Uint8Array(),
      }),
      /gRPC status 14: no quorum/,
    )
  })

  it('throws on a non-OK trailers-only status in the HTTP headers', async () => {
    const fetchFn = () =>
      Promise.resolve(
        grpcWebResponse([], { headers: { 'grpc-status': '5', 'grpc-message': 'not found' } }),
      )
    await assert.rejects(
      grpcWebTransport(fetchFn as unknown as typeof fetch)({
        url: 'https://proxy.example',
        method: METHOD,
        body: new Uint8Array(),
      }),
      /gRPC status 5: not found/,
    )
  })

  it('throws CCIPHttpError on an HTTP error', async () => {
    const fetchFn = () => Promise.resolve(new Response('bad gateway', { status: 502 }))
    await assert.rejects(
      grpcWebTransport(fetchFn as unknown as typeof fetch)({
        url: 'https://proxy.example',
        method: METHOD,
        body: new Uint8Array(),
      }),
      CCIPHttpError,
    )
  })

  it('rejects a non-http(s) URL without fetching, pointing at ChainContext.verifierTransport', async () => {
    const fetchFn = mock.fn(() => Promise.resolve(new Response()))
    await assert.rejects(
      grpcWebTransport(fetchFn as unknown as typeof fetch)({
        url: 'grpc://aggregator.example:443',
        method: METHOD,
        body: new Uint8Array(),
      }),
      (err: Error & { code?: string }) =>
        err.code === CCIPErrorCode.ARGUMENT_INVALID && /verifierTransport/.test(err.message),
    )
    assert.equal(fetchFn.mock.callCount(), 0)
  })
})
