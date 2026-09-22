/**
 * Node `@grpc/grpc-js` implementation of the SDK's {@link VerifierTransport} port.
 *
 * This is a PASSTHROUGH / byte transport: the SDK owns the protobuf schema (encode/decode), so this
 * transport uses `makeUnaryRequest` with identity serialize/deserialize functions and lets grpc-js
 * handle only the HTTP/2 connection, TLS and length-prefix framing. It is the only place in the CLI
 * that depends on `@grpc/grpc-js`; the generic fetch/assemble/coverage logic lives in the SDK. It
 * is deliberately kept out of the SDK so the SDK stays browser-safe (no gRPC dependency).
 *
 * @packageDocumentation
 */
import type { VerifierRpc, VerifierTransport } from '@chainlink/ccip-sdk/src/verifiers/index.ts'
import { Client, credentials } from '@grpc/grpc-js'

/** Identity codec: the SDK already produced/consumes the protobuf bytes. */
const passthroughSerialize = (value: Uint8Array): Buffer => Buffer.from(value)
const passthroughDeserialize = (value: Buffer): Uint8Array => new Uint8Array(value)

/**
 * Build a `@grpc/grpc-js` {@link VerifierTransport} for Node consumers.
 *
 * The read is anonymous: no HMAC, api-key or metadata is attached. The aggregator rejects partial
 * HMAC headers, so the public read sends none at all. A fresh {@link Client} is opened per call and
 * closed in `finally`, mirroring the previous CLI behaviour.
 *
 * @returns A transport that performs a unary gRPC call per {@link VerifierRpc}, moving bytes only
 * @example
 * ```ts
 * import { readAggregator } from '@chainlink/ccip-sdk/verifiers'
 * const results = await readAggregator(endpoints, messageId, { transport: grpcVerifierTransport() })
 * ```
 */
export function grpcVerifierTransport(): VerifierTransport {
  return {
    unary(rpc: VerifierRpc): Promise<Uint8Array> {
      const creds = rpc.endpoint.tls ? credentials.createSsl() : credentials.createInsecure()
      const client = new Client(rpc.endpoint.target, creds)
      return new Promise<Uint8Array>((resolve, reject) => {
        const deadline = Date.now() + rpc.timeoutMs
        client.makeUnaryRequest<Uint8Array, Uint8Array>(
          rpc.method,
          passthroughSerialize,
          passthroughDeserialize,
          rpc.request,
          { deadline },
          (err, res) => {
            client.close()
            if (err) reject(err)
            else if (res) resolve(res)
            else reject(new Error(`no response from ${rpc.endpoint.raw}`))
          },
        )
      })
    },
  }
}
