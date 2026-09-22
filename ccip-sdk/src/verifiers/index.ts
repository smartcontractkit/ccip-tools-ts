/**
 * Direct CCV verifier-fetch capability, browser-safe.
 *
 * Import from `@chainlink/ccip-sdk/verifiers`. The SDK owns the wire schema and the
 * failover/dedup assembly algorithm; a consumer injects a {@link VerifierTransport} (the CLI a
 * `@grpc/grpc-js` one, a browser the built-in {@link webGrpcVerifierTransport}). No `@grpc/*`
 * dependency and no filesystem/`.proto` load lives behind this entry point.
 *
 * @packageDocumentation
 */
export type { VerifierEndpoint, VerifierRpc, VerifierTransport } from './transport.ts'
export {
  type SuppliedCcvData,
  type VerifierEndpointMap,
  endpointsFor,
  parseCcvData,
  parseVerifierEndpoints,
  parseVerifierEntry,
} from './endpoints.ts'
export {
  type AggregatorReadResult,
  type CcvFetchOutcome,
  type DirectFetchResult,
  type EndpointFailure,
  type PolicyReader,
  type VerificationPolicy,
  assertCoverage,
  collectDirectVerifications,
  fetchVerificationsDirect,
  formatCoverageFailure,
  readAggregator,
} from './direct.ts'
export {
  VERIFIER_METHOD,
  decodeGetVerifierResultsResponse,
  encodeGetVerifierResultsRequest,
} from './schema.ts'
export { webGrpcVerifierTransport } from './web-transport.ts'
