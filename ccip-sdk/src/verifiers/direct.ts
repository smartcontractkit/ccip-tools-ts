/**
 * Fetch CCV attestations directly from verifier aggregators and assemble them for execution.
 *
 * This is the generic, browser-safe algorithm. Given a destination CCV policy and a set of
 * endpoints, it encodes the request (see {@link ./schema.ts}), calls an injected
 * {@link VerifierTransport} per endpoint, decodes the response, and assembles the required set.
 *
 * Cross-endpoint behaviour is **failover + dedup**, not partial-quorum stitching: a committee
 * aggregator returns the AGGREGATED blob ONLY once quorum is met and never exposes sub-threshold
 * partials (verified live 2026-09-22), so the endpoints for one CCV are redundant replicas tried in
 * order until one serves the complete blob.
 *
 * @packageDocumentation
 */
import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import type { Logger, VerifierResult } from '../types.ts'
import {
  type VerifierEndpointMap,
  endpointsFor,
  parseCcvData,
  parseVerifierEndpoints,
} from './endpoints.ts'
import {
  VERIFIER_METHOD,
  decodeGetVerifierResultsResponse,
  encodeGetVerifierResultsRequest,
} from './schema.ts'
import type { VerifierEndpoint, VerifierTransport } from './transport.ts'
import { webGrpcVerifierTransport } from './web-transport.ts'

/** The destination's CCV policy, as returned by `OffRamp.getCCVsForMessage`. */
export type VerificationPolicy = {
  requiredCCVs: readonly string[]
  optionalCCVs: readonly string[]
  optionalThreshold: number
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

/** What was attempted for one CCV, so a failure can name the CCV and every endpoint tried. */
export type CcvFetchOutcome = {
  ccvAddress: string
  role: 'required' | 'optional'
  status: 'ok' | 'pending' | 'unreachable' | 'unmapped'
  servedBy: string | null
  endpointsTried: string[]
  ccvDataLength: number
  failures: EndpointFailure[]
}

/** Result of fetching every CCV a message needs, directly from the verifiers. */
export type DirectFetchResult = {
  verifications: VerifierResult[]
  outcomes: CcvFetchOutcome[]
}

/** Byte length of a 0x-prefixed hex string, or 0 for any non-hex-string value. */
function hexByteLength(data: VerifierResult['ccvData']): number {
  if (typeof data !== 'string') return 0
  return Math.max(0, data.replace(/^0x/, '').length / 2)
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
 * @param opts.transport - Byte transport to the aggregator; defaults to {@link webGrpcVerifierTransport} (browser-safe)
 * @param opts.timeoutMs - Per-call deadline (default 30s)
 * @returns The first successful read, plus every failure that preceded it
 * @example
 * ```ts
 * const read = await readAggregator(endpoints, messageId, { transport: grpcVerifierTransport() })
 * if (read.results.length) console.log('served by', read.servedBy)
 * ```
 */
export async function readAggregator(
  endpoints: readonly VerifierEndpoint[],
  messageId: string,
  opts?: { transport?: VerifierTransport; timeoutMs?: number },
): Promise<AggregatorReadResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000
  const transport = opts?.transport ?? webGrpcVerifierTransport()
  const request = encodeGetVerifierResultsRequest(messageId)
  const failures: EndpointFailure[] = []
  for (const endpoint of endpoints) {
    try {
      const bytes = await transport.unary({ method: VERIFIER_METHOD, endpoint, request, timeoutMs })
      const results = decodeGetVerifierResultsResponse(bytes)
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

/**
 * Format a per-CCV diagnostic naming which CCV could not be satisfied, and why.
 *
 * @param outcomes - Per-CCV outcomes from {@link fetchVerificationsDirect}
 * @param policy - The destination policy the outcomes were measured against
 * @returns Multi-line, human-readable explanation
 */
export function formatCoverageFailure(
  outcomes: readonly CcvFetchOutcome[],
  policy: VerificationPolicy,
): string {
  const lines: string[] = []
  const missing = outcomes.filter((o) => o.status !== 'ok')
  lines.push(
    `could not collect every attestation this message needs ` +
      `(${outcomes.filter((o) => o.status === 'ok').length}/${outcomes.length} obtained)`,
  )
  for (const o of missing) {
    if (o.status === 'unmapped') {
      lines.push(
        `  ${o.ccvAddress} (${o.role}): no endpoint supplied. ` +
          `Add --verifier ${o.ccvAddress}=<scheme>://<host>[:port]`,
      )
      continue
    }
    if (o.status === 'pending') {
      lines.push(
        `  ${o.ccvAddress} (${o.role}): verifier reachable but has not attested this message yet. ` +
          `Retry shortly; this is not an execution failure.`,
      )
      continue
    }
    lines.push(`  ${o.ccvAddress} (${o.role}): no endpoint served an attestation.`)
    for (const f of o.failures) lines.push(`      ${f.endpoint}: ${f.reason}`)
  }
  if (policy.optionalThreshold > 0) {
    lines.push(
      `  note: this message also needs ${policy.optionalThreshold} of ` +
        `${policy.optionalCCVs.length} optional CCV(s).`,
    )
  }
  lines.push(
    '  Every required CCV must be attested; a partial set cannot be executed and would revert onchain.',
  )
  return lines.join('\n')
}

/**
 * Fetch attestations for every CCV the destination requires, directly from the verifiers.
 *
 * Required CCVs are fetched concurrently, but the endpoints *within* one CCV are tried in order
 * (see {@link readAggregator}). Optional CCVs are fetched only up to `optionalThreshold`, since
 * supplying more than the quorum needs is wasted work and extra information disclosure.
 *
 * @param policy - Required/optional CCVs and the optional threshold, read from the destination
 * @param map - Parsed `--verifier` endpoints
 * @param messageId - 0x-prefixed 32-byte message id
 * @param opts.transport - Byte transport to the aggregators; defaults to {@link webGrpcVerifierTransport}
 * @param opts.logger - Optional progress sink
 * @param opts.timeoutMs - Optional per-call deadline
 * @returns The collected verifications and a per-CCV outcome for diagnostics
 */
export async function fetchVerificationsDirect(
  policy: VerificationPolicy,
  map: VerifierEndpointMap,
  messageId: string,
  opts?: { transport?: VerifierTransport; logger?: Logger; timeoutMs?: number },
): Promise<DirectFetchResult> {
  const logger = opts?.logger
  const fetchOne = async (
    ccvAddress: string,
    role: 'required' | 'optional',
  ): Promise<{ outcome: CcvFetchOutcome; results: VerifierResult[] }> => {
    const endpoints = endpointsFor(map, ccvAddress)
    const base = { ccvAddress, role, endpointsTried: endpoints.map((e) => e.raw) }
    if (endpoints.length === 0) {
      return {
        outcome: { ...base, status: 'unmapped', servedBy: null, ccvDataLength: 0, failures: [] },
        results: [],
      }
    }
    logger?.info(`fetching ${ccvAddress} from ${endpoints.map((e) => e.raw).join(', ')}`)
    const read = await readAggregator(endpoints, messageId, {
      transport: opts?.transport,
      timeoutMs: opts?.timeoutMs,
    })
    // Keep only the result issued by THIS ccv; an aggregator may serve several.
    const mine = read.results.filter(
      (r) => r.destAddress.toLowerCase() === ccvAddress.toLowerCase(),
    )
    const chosen = mine.length > 0 ? mine : read.results
    const first = chosen[0]
    if (first === undefined) {
      // Distinguish "reachable but nothing yet" from "nothing answered": the first is worth a
      // retry, the second points at a wrong endpoint or a verifier that is down.
      const reachable = read.failures.some((f) => f.reason.includes('holds no attestation'))
      return {
        outcome: {
          ...base,
          status: reachable ? 'pending' : 'unreachable',
          servedBy: null,
          ccvDataLength: 0,
          failures: read.failures,
        },
        results: [],
      }
    }
    return {
      outcome: {
        ...base,
        status: 'ok',
        servedBy: read.servedBy,
        ccvDataLength: hexByteLength(first.ccvData),
        failures: read.failures,
      },
      results: [first],
    }
  }

  const required = await Promise.all(policy.requiredCCVs.map((ccv) => fetchOne(ccv, 'required')))
  const optional: Awaited<ReturnType<typeof fetchOne>>[] = []
  if (policy.optionalThreshold > 0) {
    for (const ccv of policy.optionalCCVs) {
      if (optional.filter((o) => o.outcome.status === 'ok').length >= policy.optionalThreshold)
        break
      optional.push(await fetchOne(ccv, 'optional'))
    }
  }

  const all = [...required, ...optional]
  return {
    verifications: all.flatMap((a) => a.results),
    outcomes: all.map((a) => a.outcome),
  }
}

/**
 * Assert the collected verifications satisfy the destination's policy, before signing anything.
 *
 * `OffRamp.execute` reverts `RequiredCCVMissing` when a required CCV has no result, and
 * `OptionalCCVQuorumNotReached` when fewer than `optionalThreshold` optional CCVs are supplied.
 * Checking here turns a paid onchain revert into a local error naming the offending CCV.
 *
 * @param verifications - The collected attestations
 * @param policy - Required/optional CCVs and the optional threshold
 * @returns Nothing; throws when coverage is insufficient
 * @throws Error naming the uncovered CCVs
 */
export function assertCoverage(
  verifications: readonly VerifierResult[],
  policy: VerificationPolicy,
): void {
  const have = new Set(verifications.map((v) => v.destAddress.toLowerCase()))
  const missing = policy.requiredCCVs.filter((c) => !have.has(c.toLowerCase()))
  if (missing.length > 0) {
    throw new CCIPError(
      CCIPErrorCode.EXECUTION_STATE_INVALID,
      `missing attestation for required CCV(s): ${missing.join(', ')}. ` +
        `OffRamp.execute would revert RequiredCCVMissing.`,
    )
  }
  if (policy.optionalThreshold > 0) {
    const got = policy.optionalCCVs.filter((c) => have.has(c.toLowerCase())).length
    if (got < policy.optionalThreshold) {
      throw new CCIPError(
        CCIPErrorCode.EXECUTION_STATE_INVALID,
        `optional CCV quorum not reached: have ${got}, need ${policy.optionalThreshold} of ` +
          `${policy.optionalCCVs.length}. OffRamp.execute would revert OptionalCCVQuorumNotReached.`,
      )
    }
  }
}

/** A destination chain able to report the CCV policy for a message, and carrying a transport. */
export type PolicyReader = {
  getCCVsForEncodedMessage?(opts: { offRamp: string; encodedMessage: unknown }): Promise<{
    requiredCCVs: readonly string[]
    optionalCCVs: readonly string[]
    optionalThreshold: number | bigint
  }>
  /** Injected byte transport to the verifier aggregators (ChainContext override). */
  verifierTransport?: VerifierTransport
  constructor: { name: string }
}

/**
 * Collect the attestations a message needs, from supplied bytes and from the verifiers.
 *
 * The destination's CCV policy is read from its OffRamp, caller-supplied `--ccv-data` bytes are
 * taken as given, the remaining CCVs are fetched via the destination's injected transport (or the
 * browser-safe default), and the result is checked against the policy before any transaction is
 * built.
 *
 * @param opts.dest - Destination chain, used to read the CCV policy and supply the transport
 * @param opts.offRamp - Destination OffRamp address
 * @param opts.encodedMessage - The encoded message, as emitted on the source chain
 * @param opts.messageId - 0x-prefixed 32-byte message id
 * @param opts.verifierEntries - Raw `--verifier` values
 * @param opts.ccvDataEntries - Raw `--ccv-data` values
 * @param opts.logger - Progress sink
 * @returns The policy and the collected verifications
 * @throws Error naming the CCVs whose attestations are missing
 * @example
 * ```ts
 * const { verifications } = await collectDirectVerifications({
 *   dest, offRamp, encodedMessage, messageId,
 *   verifierEntries: ['0xccv=grpc+plaintext://localhost:15051'],
 *   ccvDataEntries: [], logger,
 * })
 * ```
 */
export async function collectDirectVerifications(opts: {
  dest: PolicyReader
  offRamp: string
  encodedMessage: unknown
  messageId: string
  verifierEntries: readonly string[]
  ccvDataEntries: readonly string[]
  logger: Logger
}): Promise<{ verificationPolicy: VerificationPolicy; verifications: VerifierResult[] }> {
  const { dest, offRamp, encodedMessage, messageId, verifierEntries, ccvDataEntries, logger } = opts
  let policy: VerificationPolicy
  try {
    // Read the policy from the encoded message. Reconstructing it from decoded fields drops the
    // token transfer when the message carries no dest token amounts, yielding the lane default
    // instead of the pool-mandated CCV.
    if (!dest.getCCVsForEncodedMessage)
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `${dest.constructor.name} cannot read the CCV policy`,
      )
    const ccvs = await dest.getCCVsForEncodedMessage({ offRamp, encodedMessage })
    policy = {
      requiredCCVs: ccvs.requiredCCVs,
      optionalCCVs: ccvs.optionalCCVs,
      optionalThreshold: Number(ccvs.optionalThreshold),
    }
  } catch (err) {
    throw new CCIPError(
      CCIPErrorCode.MESSAGE_RETRIEVAL_FAILED,
      `could not read the destination CCV policy via OffRamp.getCCVsForMessage: ${
        (err as Error).message
      }`,
      { cause: err as Error },
    )
  }

  logger.info(
    `direct verifier fetch: ${policy.requiredCCVs.length} required CCV(s)`,
    policy.optionalThreshold > 0
      ? `+ ${policy.optionalThreshold} of ${policy.optionalCCVs.length} optional`
      : '',
  )

  // Caller-supplied bytes win over anything fetched: the operator has stated these are the
  // attestations to use. Only the CCVs left unsupplied are fetched.
  const supplied = parseCcvData(ccvDataEntries)
  const suppliedFor = new Set(supplied.map((s) => s.ccvAddress.toLowerCase()))
  for (const s of supplied) {
    logger.info(`  ${s.ccvAddress} (supplied): ${s.ccvData.length / 2 - 1} bytes via --ccv-data`)
  }
  const toFetch: VerificationPolicy = {
    requiredCCVs: policy.requiredCCVs.filter((c) => !suppliedFor.has(c.toLowerCase())),
    optionalCCVs: policy.optionalCCVs.filter((c) => !suppliedFor.has(c.toLowerCase())),
    optionalThreshold: Math.max(
      0,
      policy.optionalThreshold -
        policy.optionalCCVs.filter((c) => suppliedFor.has(c.toLowerCase())).length,
    ),
  }
  const fetched =
    toFetch.requiredCCVs.length > 0 || toFetch.optionalThreshold > 0
      ? await fetchVerificationsDirect(
          toFetch,
          parseVerifierEndpoints(verifierEntries),
          messageId,
          {
            transport: dest.verifierTransport,
            logger,
          },
        )
      : { verifications: [], outcomes: [] }

  const verifications: VerifierResult[] = [
    ...supplied.map((s) => ({
      ccvData: s.ccvData,
      destAddress: s.ccvAddress,
      sourceAddress: s.ccvAddress,
    })),
    ...fetched.verifications,
  ]
  try {
    assertCoverage(verifications, policy)
  } catch (err) {
    throw new CCIPError(
      CCIPErrorCode.EXECUTION_STATE_INVALID,
      `${(err as Error).message}\n${formatCoverageFailure(fetched.outcomes, policy)}`,
      { cause: err as Error },
    )
  }
  for (const o of fetched.outcomes) {
    logger.info(
      `  ${o.ccvAddress} (${o.role}): ${o.status}` +
        (o.servedBy ? ` via ${o.servedBy} (${o.ccvDataLength} bytes)` : ''),
    )
  }
  return { verificationPolicy: policy, verifications }
}
