/**
 * Sourcify v2 verification transport — keyless, JSON, and a different protocol from Etherscan:
 * Sourcify recompiles the standard-json and matches it against on-chain bytecode, so no
 * constructor arguments are sent. Supplying the creation tx hash lets it attempt a
 * *creation*-match rather than only a runtime match.
 *
 * Wire shape confirmed against `@nomicfoundation/hardhat-verify@3.0.22`, whose Sourcify v2 client
 * was contributed by a Sourcify maintainer.
 *
 * @packageDocumentation
 */

import { CCTVerificationFailedError } from '../../errors.ts'
import type { StandardJsonInput } from './fixtures/types.ts'

/** The match grades Sourcify reports. Both count as verified. */
const MATCHED = new Set(['match', 'exact_match'])

/** Sourcify's verified-contract object, shared by the job-status and lookup endpoints. */
interface SourcifyContract {
  match?: string | null
  creationMatch?: string | null
  runtimeMatch?: string | null
}

/** What a Sourcify submission needs. */
export interface SourcifySubmission {
  input: StandardJsonInput
  fqn: string
  compilerVersion: string
  contractAddress: string
  /** Creation tx hash; when present Sourcify attempts a creation-match. */
  hash?: string
}

/** Submission outcome: a job id to poll, or an immediate already-verified. */
export type SourcifySubmitResult =
  { state: 'queued'; verificationId: string; bodySizeBytes: number } | { state: 'already-verified' }

/**
 * Submits a verification job.
 *
 * @throws {@link CCTVerificationFailedError} if Sourcify rejects the submission outright.
 */
export async function submit(
  submission: SourcifySubmission,
  route: { apiUrl: string },
  chainId: number,
  fetchImpl: typeof fetch,
): Promise<SourcifySubmitResult> {
  const payload: Record<string, unknown> = {
    // The object itself, not a JSON string — unlike Etherscan.
    stdJsonInput: submission.input,
    contractIdentifier: submission.fqn,
    // hardhat sends the `v`-prefixed form; the POC's comment claimed otherwise. Following the
    // working implementation. A compiler-version rejection here is the signal to try bare.
    compilerVersion: submission.compilerVersion,
  }
  if (submission.hash) payload.creationTransactionHash = submission.hash

  const body = JSON.stringify(payload)
  const response = await fetchImpl(
    `${base(route.apiUrl)}/v2/verify/${chainId}/${submission.contractAddress}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
  )

  if (response.ok || response.status === 202) {
    const parsed = (await response.json()) as { verificationId?: string }
    if (!parsed.verificationId)
      throw new CCTVerificationFailedError('sourcify', 'submission returned no verificationId', {
        context: { bodySizeBytes: body.length },
      })
    return { state: 'queued', verificationId: parsed.verificationId, bodySizeBytes: body.length }
  }

  // Prefer the documented customCode over a bare status check — the POC guessed 409.
  const detail = await response.text().catch(() => '')
  if (/already_verified/.test(detail)) return { state: 'already-verified' }
  throw new CCTVerificationFailedError(
    'sourcify',
    `HTTP ${response.status} ${detail.slice(0, 300)}`,
    {
      context: { bodySizeBytes: body.length },
    },
  )
}

/** One poll of a Sourcify job. */
export type SourcifyStatus =
  | { state: 'pending' }
  | { state: 'verified' }
  | { state: 'already-verified' }
  | { state: 'failed'; reason: string; contract?: SourcifyContract }

/** Polls a verification job id. */
export async function checkStatus(
  verificationId: string,
  route: { apiUrl: string },
  fetchImpl: typeof fetch,
): Promise<SourcifyStatus> {
  const response = await fetchImpl(`${base(route.apiUrl)}/v2/verify/${verificationId}`)
  if (!response.ok)
    throw new CCTVerificationFailedError('sourcify', `status HTTP ${response.status}`, {
      context: { verificationId },
    })

  const parsed = (await response.json()) as {
    isJobCompleted?: boolean
    contract?: SourcifyContract
    error?: { customCode?: string; message?: string }
  }
  if (!parsed.isJobCompleted) return { state: 'pending' }
  if (parsed.error?.customCode === 'already_verified') return { state: 'already-verified' }

  // hardhat keys success off `contract.match` alone. All three fields live on this same object,
  // so accepting any of them is deliberate belt-and-braces: with `bytecodeHash: 'none'` it only
  // ever fires if `match` were null while a sub-match was set.
  const contract = parsed.contract
  const matched = [contract?.match, contract?.creationMatch, contract?.runtimeMatch].some(
    (grade) => typeof grade === 'string' && MATCHED.has(grade),
  )
  if (matched) return { state: 'verified' }

  return {
    state: 'failed',
    reason: parsed.error?.customCode ?? parsed.error?.message ?? 'no bytecode match',
    ...(contract ? { contract } : {}),
  }
}

/** Trims a trailing slash so URL building stays predictable. */
function base(apiUrl: string): string {
  return apiUrl.replace(/\/$/, '')
}
