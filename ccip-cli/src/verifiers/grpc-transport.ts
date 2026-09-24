/**
 * The CLI's {@link VerifierTransport}: native gRPC via `@grpc/grpc-js` for `grpc://`-style
 * endpoints, the SDK's grpc-web default for `http(s)://` ones.
 *
 * It only moves bytes: the SDK owns the verifier schema and when to call it, so grpc-js runs with
 * identity (de)serializers. `@grpc/grpc-js` is loaded on first native call, keeping it off the
 * startup path of every command.
 *
 * @packageDocumentation
 */
import {
  type VerifierTransport,
  CCIPArgumentInvalidError,
  grpcWebTransport,
} from '@chainlink/ccip-sdk/src/index.ts'
import type * as Grpc from '@grpc/grpc-js'

/** Native gRPC schemes, and whether each uses TLS. */
const GRPC_SCHEMES: Record<string, boolean> = {
  'grpc:': true,
  'grpcs:': true,
  'grpc+plaintext:': false,
}

/**
 * Build the CLI's verifier transport.
 *
 * The read is anonymous: no credentials or metadata are attached. A client is opened per call and
 * closed when it settles.
 *
 * @param web - Transport for `http(s)://` endpoints (default: the SDK's grpc-web transport)
 * @returns The transport
 */
export function grpcVerifierTransport(web = grpcWebTransport()): VerifierTransport {
  let grpc$: Promise<typeof Grpc> | undefined
  return async (call) => {
    const { protocol, host } = new URL(call.url)
    const tls = GRPC_SCHEMES[protocol]
    if (tls === undefined) {
      if (protocol === 'http:' || protocol === 'https:') return web(call)
      throw new CCIPArgumentInvalidError(
        'verifier',
        `unsupported scheme "${protocol}//": use https:// or http:// (grpc-web), grpc:// or grpcs:// (gRPC over TLS), or grpc+plaintext://`,
      )
    }
    const { Client, credentials } = await (grpc$ ??= import('@grpc/grpc-js'))
    call.signal?.throwIfAborted()
    const client = new Client(host, tls ? credentials.createSsl() : credentials.createInsecure())
    let onAbort: (() => void) | undefined
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        const unary = client.makeUnaryRequest<Uint8Array, Buffer>(
          call.method,
          (message) => Buffer.from(message),
          (bytes) => bytes,
          call.body,
          (err, res) => (err ? reject(withoutEmptyNote(err)) : resolve(new Uint8Array(res ?? []))),
        )
        onAbort = () => unary.cancel() // settles the callback with CANCELLED
        call.signal?.addEventListener('abort', onAbort, { once: true })
      })
    } finally {
      if (onAbort) call.signal?.removeEventListener('abort', onAbort)
      client.close()
    }
  }
}

/** grpc-js ends some errors with a "Resolution note:" that is usually empty; drop it. */
function withoutEmptyNote(err: Error): Error {
  const note = err.message.lastIndexOf('Resolution note:')
  if (note >= 0 && !err.message.slice(note + 'Resolution note:'.length).trim())
    err.message = err.message.slice(0, note).trimEnd()
  return err
}
