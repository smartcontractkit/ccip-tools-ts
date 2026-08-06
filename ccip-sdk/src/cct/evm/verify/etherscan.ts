/**
 * Etherscan v2 verification transport: submit `verifysourcecode`, poll `checkverifystatus`.
 *
 * Module-private. Plain functions rather than a client class — the SDK has no analogue for one,
 * and `erasableSyntaxOnly` bans the parameter-property style such a class would want.
 *
 * Wire shape confirmed against `@nomicfoundation/hardhat-verify` (v2 and v3): form-urlencoded
 * body, module/action/chainid/apikey in the query, and classification on the `result` string —
 * errors come back inside an HTTP 200.
 *
 * @packageDocumentation
 */

import { CCTVerificationFailedError } from '../../errors.ts'
import type { StandardJsonInput } from './fixtures/types.ts'

/**
 * Envelope returned by every Etherscan action. `result` is a string for `verifysourcecode` and
 * `checkverifystatus`, but an ARRAY for `getsourcecode` — hence `unknown`. Typing it as `string`
 * and parsing it is a trap: `JSON.parse` on an array stringifies to `[object Object]` and throws.
 */
interface EtherscanResponse {
  status: string
  message: string
  result: unknown
}

/** `result` as a string, for the actions that return one. */
function resultString(parsed: EtherscanResponse): string {
  return typeof parsed.result === 'string' ? parsed.result : ''
}

/** Terminal and non-terminal markers, matched exactly as hardhat-verify matches them. */
const PENDING = 'Pending in queue'
const SUCCESS = 'Pass - Verified'
const FAILURE_PREFIX = 'Fail - Unable to verify'
const NOT_INDEXED_PREFIX = 'Unable to locate ContractCode at'
const ALREADY_VERIFIED_PREFIXES = ['Contract source code already verified', 'Already Verified']

/** Whether an explorer message means the contract is already verified. */
export function isAlreadyVerified(message: string): boolean {
  return ALREADY_VERIFIED_PREFIXES.some((prefix) => message.startsWith(prefix))
}

/** Whether an explorer message means the contract is not yet indexed (retry the submit). */
export function isNotIndexed(message: string): boolean {
  return message.startsWith(NOT_INDEXED_PREFIX)
}

/** Builds an action URL with the query params Etherscan v2 requires on every call. */
function actionUrl(apiUrl: string, chainId: number, apiKey: string, action: string): URL {
  const url = new URL(apiUrl)
  url.searchParams.set('module', 'contract')
  url.searchParams.set('action', action)
  url.searchParams.set('chainid', String(chainId))
  url.searchParams.set('apikey', apiKey)
  return url
}

/** Parses an Etherscan envelope, treating a non-2xx as a hard failure. */
async function envelope(response: Response, verifier: string): Promise<EtherscanResponse> {
  if (!response.ok)
    throw new CCTVerificationFailedError(verifier, `HTTP ${response.status} ${response.statusText}`)
  return (await response.json()) as EtherscanResponse
}

/** What a submission needs beyond the routing information. */
export interface EtherscanSubmission {
  input: StandardJsonInput
  fqn: string
  compilerVersion: string
  contractAddress: string
  /** ABI-encoded constructor args, `0x`-prefixed or `'0x'` for a no-arg constructor. */
  encodedConstructorArgs: string
}

/** The submission body size, so a size-related rejection is diagnosable from the error context. */
export interface EtherscanSubmitResult {
  guid: string
  bodySizeBytes: number
}

/**
 * Submits a standard-json verification, returning the guid to poll.
 *
 * @throws {@link CCTVerificationFailedError} on a definitive rejection. Callers handle the
 * already-verified and not-yet-indexed messages before treating a failure as terminal.
 */
export async function submit(
  submission: EtherscanSubmission,
  route: { apiUrl: string },
  chainId: number,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<EtherscanSubmitResult> {
  const form: Record<string, string> = {
    codeformat: 'solidity-standard-json-input',
    sourceCode: JSON.stringify(submission.input),
    contractaddress: submission.contractAddress,
    contractname: submission.fqn,
    compilerversion: submission.compilerVersion,
  }

  // Bare hex, no 0x — and omitted entirely for a no-arg constructor.
  const args = submission.encodedConstructorArgs.replace(/^0x/i, '')
  if (args) {
    // Both spellings: hardhat-verify v2 sends only the misspelled `constructorArguements`
    // (src/internal/etherscan.ts:190-191), v3 sends only the correct `constructorArguments`
    // (dist/src/internal/etherscan.js:165). Two production clients of the same endpoint disagree,
    // so send both — ~300 bytes on a ~280 KB body.
    form.constructorArguements = args
    form.constructorArguments = args
  }

  const body = new URLSearchParams(form).toString()
  const response = await fetchImpl(
    actionUrl(route.apiUrl, chainId, apiKey, 'verifysourcecode').toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  )

  const parsed = await envelope(response, 'etherscan-v2')
  if (parsed.status !== '1') {
    // On failure the real reason is in `result`; `message` is a generic "NOTOK".
    throw new CCTVerificationFailedError('etherscan-v2', resultString(parsed) || parsed.message, {
      context: { bodySizeBytes: body.length },
    })
  }
  return { guid: resultString(parsed), bodySizeBytes: body.length }
}

/** One poll of a submission's status. */
export type EtherscanStatus =
  | { state: 'pending' }
  | { state: 'verified' }
  | { state: 'already-verified' }
  | { state: 'failed'; reason: string }

/** Polls a submission guid and classifies the result string. */
export async function checkStatus(
  guid: string,
  route: { apiUrl: string },
  chainId: number,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<EtherscanStatus> {
  const url = actionUrl(route.apiUrl, chainId, apiKey, 'checkverifystatus')
  url.searchParams.set('guid', guid)
  const parsed = await envelope(await fetchImpl(url.toString()), 'etherscan-v2')
  const result = resultString(parsed)

  if (result === PENDING) return { state: 'pending' }
  if (result === SUCCESS) return { state: 'verified' }
  if (isAlreadyVerified(result)) return { state: 'already-verified' }
  if (result.startsWith(FAILURE_PREFIX)) return { state: 'failed', reason: result }
  // Anything else is unrecognised. It is NOT treated as success — the POC's "terminal
  // success-ish" fallback is a permanent false green.
  throw new CCTVerificationFailedError('etherscan-v2', result || parsed.message, {
    context: { guid, unrecognisedStatus: true },
  })
}

/**
 * Whether the address already has verified source. Used only as a post-timeout confirmation:
 * some Etherscan-family explorers (Snowtrace/Routescan, and this SDK routes two Avalanche chains
 * there) finish verifying but lag on `checkverifystatus` by minutes.
 */
export async function isVerified(
  address: string,
  route: { apiUrl: string },
  chainId: number,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const url = actionUrl(route.apiUrl, chainId, apiKey, 'getsourcecode')
  url.searchParams.set('address', address)
  try {
    const parsed = await envelope(await fetchImpl(url.toString()), 'etherscan-v2')
    if (parsed.status !== '1') return false
    // `result` is already an array here — index it, never JSON.parse it. hardhat-verify does the
    // same (`responseBody.result[0]?.SourceCode`).
    const entries = parsed.result as { SourceCode?: string }[] | undefined
    return Boolean(entries?.[0]?.SourceCode)
  } catch {
    return false
  }
}
