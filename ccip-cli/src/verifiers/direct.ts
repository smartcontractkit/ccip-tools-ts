import type { Logger, VerifierResult } from '@chainlink/ccip-sdk/src/index.ts'

import { type EndpointFailure, readAggregator } from './aggregator.ts'
import {
  type VerifierEndpointMap,
  endpointsFor,
  parseCcvData,
  parseVerifierEndpoints,
} from './endpoints.ts'

/** The destination's CCV policy, as returned by `OffRamp.getCCVsForMessage`. */
export type VerificationPolicy = {
  requiredCCVs: readonly string[]
  optionalCCVs: readonly string[]
  optionalThreshold: number
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
 * @param opts - Optional logger and per-call deadline
 * @returns The collected verifications and a per-CCV outcome for diagnostics
 */
export async function fetchVerificationsDirect(
  policy: VerificationPolicy,
  map: VerifierEndpointMap,
  messageId: string,
  opts?: { logger?: Logger; timeoutMs?: number },
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
    const read = await readAggregator(endpoints, messageId, { timeoutMs: opts?.timeoutMs })
    // Keep only the result issued by THIS ccv; an aggregator may serve several.
    const mine = read.results.filter(
      (r) => r.destAddress.toLowerCase() === ccvAddress.toLowerCase(),
    )
    const chosen = mine.length > 0 ? mine : read.results
    if (chosen.length === 0) {
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
        ccvDataLength: (chosen[0]!.ccvData as string).length / 2 - 1,
        failures: read.failures,
      },
      results: chosen.slice(0, 1),
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
    throw new Error(
      `missing attestation for required CCV(s): ${missing.join(', ')}. ` +
        `OffRamp.execute would revert RequiredCCVMissing.`,
    )
  }
  if (policy.optionalThreshold > 0) {
    const got = policy.optionalCCVs.filter((c) => have.has(c.toLowerCase())).length
    if (got < policy.optionalThreshold) {
      throw new Error(
        `optional CCV quorum not reached: have ${got}, need ${policy.optionalThreshold} of ` +
          `${policy.optionalCCVs.length}. OffRamp.execute would revert OptionalCCVQuorumNotReached.`,
      )
    }
  }
}

/** A destination chain able to report the CCV policy for a message. */
export type PolicyReader = {
  getCCVsForEncodedMessage?(opts: { offRamp: string; encodedMessage: unknown }): Promise<{
    requiredCCVs: readonly string[]
    optionalCCVs: readonly string[]
    optionalThreshold: number | bigint
  }>
  constructor: { name: string }
}

/**
 * Collect the attestations a message needs, from supplied bytes and from the verifiers.
 *
 * The destination's CCV policy is read from its OffRamp, caller-supplied `--ccv-data` bytes are
 * taken as given, the remaining CCVs are fetched, and the result is checked against the policy
 * before any transaction is built.
 *
 * @param opts.dest - Destination chain, used to read the CCV policy
 * @param opts.offRamp - Destination OffRamp address
 * @param opts.encodedMessage - The encoded message, as emitted on the source chain
 * @param opts.messageId - 0x-prefixed 32-byte message id
 * @param opts.verifierEntries - Raw `--verifier` values
 * @param opts.ccvDataEntries - Raw `--ccv-data` values
 * @param opts.logger - Progress sink
 * @returns The policy and the collected verifications
 * @throws Error naming the CCVs whose attestations are missing
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
      throw new Error(`${dest.constructor.name} cannot read the CCV policy`)
    const ccvs = await dest.getCCVsForEncodedMessage({ offRamp, encodedMessage })
    policy = {
      requiredCCVs: ccvs.requiredCCVs,
      optionalCCVs: ccvs.optionalCCVs,
      optionalThreshold: Number(ccvs.optionalThreshold),
    }
  } catch (err) {
    throw new Error(
      `could not read the destination CCV policy via OffRamp.getCCVsForMessage: ${
        (err as Error).message
      }`,
      { cause: err },
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
    throw new Error(
      `${(err as Error).message}\n${formatCoverageFailure(fetched.outcomes, policy)}`,
      {
        cause: err,
      },
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
