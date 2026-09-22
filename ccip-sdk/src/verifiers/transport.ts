/**
 * Transport port for reading CCV attestations from a verifier's aggregator.
 *
 * The SDK owns the wire schema (protobuf encode/decode, see {@link ./schema.ts}) and the
 * cross-endpoint assembly algorithm (see {@link ./direct.ts}); a {@link VerifierTransport} only
 * moves opaque bytes to one endpoint and back. This keeps the generic logic browser-safe: the SDK
 * imports no gRPC library, and a consumer with a real gRPC stack (the CLI, via `@grpc/grpc-js`)
 * injects it as a transport. A browser consumer uses the default grpc-web transport
 * ({@link ./web-transport.ts}).
 *
 * @packageDocumentation
 */

/**
 * A parsed `--verifier` endpoint: where to read one CCV's attestations from.
 *
 * The scheme selects TLS, never the port: a bare `host:port` cannot say whether to use TLS, and
 * sniffing `:443` is a guess that breaks when an operator runs TLS on a non-standard port.
 */
export type VerifierEndpoint = {
  /** Transport the endpoint speaks. Only `aggregator` (gRPC / grpc-web) is supported today. */
  readonly type: 'aggregator'
  /** `host:port` of the aggregator's gRPC listener. */
  readonly target: string
  /** Whether to use TLS (grpc over TLS / https for grpc-web). Selected by the URL scheme. */
  readonly tls: boolean
  /** The endpoint as the user wrote it, for diagnostics. */
  readonly raw: string
}

/**
 * One unary call to a verifier aggregator, fully described so a transport needs no schema knowledge.
 *
 * The `request` bytes are the protobuf-encoded message body WITHOUT any gRPC length-prefix framing;
 * a transport adds whatever framing its wire protocol needs (HTTP/2 for grpc-js, the 5-byte
 * grpc-web prefix for the fetch transport). The returned bytes are the protobuf-encoded response
 * body, again without framing, which the SDK decodes.
 */
export type VerifierRpc = {
  /** Fully-qualified gRPC method path, e.g. `/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage`. */
  readonly method: string
  /** The endpoint to call. */
  readonly endpoint: VerifierEndpoint
  /** Protobuf-encoded request body (no gRPC framing). */
  readonly request: Uint8Array
  /** Per-call deadline in milliseconds. */
  readonly timeoutMs: number
}

/**
 * A narrow, one-method port that moves bytes to a verifier aggregator and back.
 *
 * Implementations must NOT interpret the payload: the SDK encodes the request and decodes the
 * response. A transport is responsible only for the wire (connection, TLS, framing, deadline) and
 * for surfacing a gRPC-level error as a thrown `Error`.
 *
 * @example
 * ```ts
 * // Node consumer (CLI) injecting a grpc-js transport:
 * const transport: VerifierTransport = grpcVerifierTransport()
 * const results = await readAggregator(endpoints, messageId, { transport })
 *
 * // Browser consumer using the built-in grpc-web transport (the default):
 * const results = await readAggregator(endpoints, messageId)
 * ```
 */
export type VerifierTransport = {
  /**
   * Perform one unary request against one endpoint.
   *
   * @param rpc - The method path, endpoint, encoded request bytes and deadline
   * @returns The encoded response bytes
   * @throws Error when the endpoint is unreachable, times out, or returns a non-OK gRPC status
   */
  unary(rpc: VerifierRpc): Promise<Uint8Array>
}
