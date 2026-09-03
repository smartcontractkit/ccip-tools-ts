import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { VerifierResult } from '@chainlink/ccip-sdk/src/index.ts'
import { type ServiceError, credentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'

/** A parsed `--verifier` endpoint: where to read one CCV's attestations from. */
export type VerifierEndpoint = {
  /** Transport the endpoint speaks. Only `aggregator` (gRPC) is supported today. */
  type: 'aggregator'
  /** `host:port` of the aggregator's gRPC listener. */
  target: string
  /** Whether to use TLS. Selected by the URL scheme, never sniffed from the port. */
  tls: boolean
  /** The endpoint as the user wrote it, for diagnostics. */
  raw: string
}

/** Why a single endpoint failed, kept per-endpoint so diagnostics can name each one. */
export type EndpointFailure = { endpoint: string; reason: string }

/** Outcome of reading one CCV's attestations across its endpoints, in order. */
export type AggregatorReadResult = {
  /** Results from the first endpoint that answered with at least one attestation. */
  results: VerifierResult[]
  /** The endpoint that served them, or `null` when every endpoint failed. */
  servedBy: string | null
  /** Every endpoint tried before success, with the reason each failed. */
  failures: EndpointFailure[]
}

type RawVerifierResult = {
  ccv_data?: Buffer | Uint8Array
  message_ccv_addresses?: (Buffer | Uint8Array)[]
  metadata?: {
    verifier_source_address?: Buffer | Uint8Array
    verifier_dest_address?: Buffer | Uint8Array
    timestamp?: string | number
  }
}

type RawResponse = { results?: RawVerifierResult[] }

type VerifierClient = {
  GetVerifierResultsForMessage(
    req: { message_ids: Buffer[] },
    cb: (err: ServiceError | null, res: RawResponse) => void,
  ): void
  close(): void
}

type VerifierClientCtor = new (
  address: string,
  creds: ReturnType<typeof credentials.createInsecure>,
) => VerifierClient

const PROTO_PATH = join(dirname(fileURLToPath(import.meta.url)), 'proto', 'verifier.proto')

let cachedCtor: VerifierClientCtor | undefined

/**
 * Load the generated `chainlink_ccv.verifier.v1.Verifier` client constructor.
 *
 * `keepCase` preserves the proto's snake_case field names, and `longs: String` keeps uint64 fields
 * as strings so no CCIP integer is ever narrowed through a JS number.
 *
 * @returns The gRPC client constructor for the Verifier service
 */
function loadClientCtor(): VerifierClientCtor {
  if (cachedCtor) return cachedCtor
  const def = loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [dirname(PROTO_PATH)],
  })
  const pkg = loadPackageDefinition(def) as unknown as {
    chainlink_ccv: { verifier: { v1: { Verifier: VerifierClientCtor } } }
  }
  cachedCtor = pkg.chainlink_ccv.verifier.v1.Verifier
  return cachedCtor
}

/**
 * Convert a protobuf `bytes` field to a 0x-prefixed hex string.
 *
 * @param b - Raw bytes from the decoded response
 * @returns Hex string, or undefined when the field is absent or empty
 */
function toHex(b: Buffer | Uint8Array | undefined): string | undefined {
  if (!b || b.length === 0) return undefined
  return `0x${Buffer.from(b).toString('hex')}`
}

/**
 * Convert a protobuf `bytes` field to a 20-byte EVM address.
 *
 * @param b - Raw bytes from the decoded response
 * @returns 0x-prefixed lowercase hex address, or undefined when not exactly 20 bytes
 */
function toAddress(b: Buffer | Uint8Array | undefined): string | undefined {
  if (!b || b.length !== 20) return undefined
  return `0x${Buffer.from(b).toString('hex')}`
}

/**
 * Call `GetVerifierResultsForMessage` on one aggregator.
 *
 * The read is anonymous: no HMAC, api-key or metadata is attached. The aggregator rejects partial
 * HMAC headers, so the public read sends none at all.
 *
 * @param endpoint - The endpoint to query
 * @param messageId - 0x-prefixed 32-byte message id
 * @param timeoutMs - Deadline for the call
 * @returns The attestations the aggregator holds, possibly empty before quorum
 */
async function readOne(
  endpoint: VerifierEndpoint,
  messageId: string,
  timeoutMs: number,
): Promise<VerifierResult[]> {
  const Ctor = loadClientCtor()
  const creds = endpoint.tls ? credentials.createSsl() : credentials.createInsecure()
  const client = new Ctor(endpoint.target, creds)
  try {
    const res = await new Promise<RawResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      client.GetVerifierResultsForMessage(
        { message_ids: [Buffer.from(messageId.replace(/^0x/, ''), 'hex')] },
        (err, r) => {
          clearTimeout(timer)
          if (err) reject(err)
          else resolve(r)
        },
      )
    })
    const out: VerifierResult[] = []
    for (const r of res.results ?? []) {
      const ccvData = toHex(r.ccv_data)
      // Key on the metadata dest-address hint, which is what the executor matches against the
      // destination's required set. `message_ccv_addresses` is the whole SOURCE-side CCV list, so
      // indexing into it is only correct when the message has exactly one CCV.
      const destAddress =
        toAddress(r.metadata?.verifier_dest_address) ?? toAddress(r.message_ccv_addresses?.[0])
      const sourceAddress = toAddress(r.metadata?.verifier_source_address)
      if (ccvData === undefined || destAddress === undefined) continue
      const ts = r.metadata?.timestamp
      out.push({
        ccvData,
        destAddress,
        sourceAddress: sourceAddress ?? destAddress,
        // proto timestamp is milliseconds; VerifierResult.timestamp is seconds
        ...(ts != null ? { timestamp: Math.floor(Number(ts) / 1000) } : {}),
      })
    }
    return out
  } finally {
    client.close()
  }
}

/**
 * Read one CCV's attestations, trying its endpoints in the order supplied.
 *
 * Endpoints are tried sequentially, stopping at the first that serves an attestation. They are
 * redundant replicas of one committee, so their order encodes primary/backup intent. Racing them
 * would defeat that ordering, tell every operator in the list which message is about to be
 * executed, and load partner infrastructure for a result only one of them needs to supply.
 *
 * @param endpoints - Endpoints for a single CCV, in preference order
 * @param messageId - 0x-prefixed 32-byte message id
 * @param opts - Optional per-call deadline
 * @returns The first successful read, plus every failure that preceded it
 */
export async function readAggregator(
  endpoints: readonly VerifierEndpoint[],
  messageId: string,
  opts?: { timeoutMs?: number },
): Promise<AggregatorReadResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000
  const failures: EndpointFailure[] = []
  for (const endpoint of endpoints) {
    try {
      const results = await readOne(endpoint, messageId, timeoutMs)
      if (results.length > 0) return { results, servedBy: endpoint.raw, failures }
      failures.push({
        endpoint: endpoint.raw,
        reason: 'reachable, but holds no attestation for this message yet',
      })
    } catch (err) {
      // grpc-js appends a trailing "Resolution note: " that is usually empty; drop it so the
      // per-endpoint diagnostic ends on the actual cause.
      const reason = (err as Error).message.replace(/\s*Resolution note:\s*$/, '')
      failures.push({ endpoint: endpoint.raw, reason })
    }
  }
  return { results: [], servedBy: null, failures }
}
