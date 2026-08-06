/**
 * `verifyDeployedContract` — the one public entry point of this subpath.
 *
 * Takes a deploy result (or the same fields built by hand), looks up the vendored Standard-JSON
 * for the contract, routes to the right explorer, submits, polls to a budget, and returns a
 * discriminated {@link VerifyResult}.
 *
 * @packageDocumentation
 */

import { createRateLimitedFetch } from '../../../fetch.ts'
import type { Logger } from '../../../types.ts'
import {
  CCTParamsInvalidError,
  CCTVerificationFailedError,
  CCTVerificationNotConfirmedError,
} from '../../errors.ts'
import type { ExplorerVerificationInput } from '../operation.ts'
import * as etherscan from './etherscan.ts'
import { loadStandardJson } from './fixtures/index.ts'
import { type ExplorerRoute, type VerifierName, explorerUrlFor, resolveRoute } from './routes.ts'
import * as sourcify from './sourcify.ts'

export type { ExplorerRoute, VerifierName } from './routes.ts'

/**
 * What to verify. A `DeployResult` from `deployToken` / `deployTokenPool` / `deployLockbox`
 * satisfies this structurally, so it can be passed straight through.
 */
export interface VerifyTarget {
  /** The deployed contract address. */
  contractAddress: string
  /** The deploy-side verification handle: which contract, and its encoded constructor args. */
  verification: ExplorerVerificationInput
  /**
   * Creation transaction hash. Optional, and supplied for free by `DeployResult.hash` — when
   * present, Sourcify attempts a creation-match rather than only a runtime match.
   */
  hash?: string
}

/** How to verify. */
export interface VerifyOptions {
  /** EVM chain id the contract was deployed to. */
  chainId: number
  /** Explorer API key. Required on Etherscan-family routes, unused by Sourcify. */
  apiKey?: string
  /** `'sourcify'` selects the keyless verifier; an object routes a chain not in the table. */
  route?: 'sourcify' | ExplorerRoute
  /** Replaces the default rate-limited fetch — e.g. to proxy through a backend. */
  fetch?: typeof fetch
  /** Aborts polling and in-flight requests. */
  abort?: AbortSignal
  /** Total in-call poll budget. Defaults to 120s. */
  timeoutMs?: number
  /** Receives progress and retry diagnostics. API keys are redacted before logging. */
  logger?: Logger
}

/**
 * The outcome of a verification. A discriminated union with no optional fields: `explorerUrl` is
 * required on both success variants, so narrowing away `'failed'` always yields a usable link.
 */
export type VerifyResult =
  | { status: 'verified'; verifier: VerifierName; explorerUrl: string }
  | { status: 'already-verified'; verifier: VerifierName; explorerUrl: string }
  | { status: 'failed'; verifier: VerifierName; reason: string }

const DEFAULT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 3_000
const SUBMIT_RETRIES = 8
const SUBMIT_RETRY_MS = 8_000

/**
 * Verifies an already-deployed contract's source on a block explorer, resolving once the explorer
 * reaches a terminal state.
 *
 * `'failed'` is returned only when the explorer definitively rejected the submission; everything
 * else throws, so a caller can never mistake an unknown state for success.
 *
 * @throws {@link CCTParamsInvalidError} if the chain has no route, the contract has no fixture, or
 * an Etherscan-family route was resolved without an `apiKey` — all before any network call.
 * @throws {@link CCTVerificationFailedError} if the explorer returns an unrecognised terminal state.
 * @throws {@link CCTVerificationNotConfirmedError} if the poll budget expires while still pending.
 * @example
 * ```typescript
 * const deploy = await cct.deployTokenPool({ type: 'BurnMintTokenPool', ...params, wallet })
 * const result = await verifyDeployedContract(deploy, { chainId: 84532, apiKey })
 * if (result.status === 'failed') throw new Error(result.reason)
 * console.log(result.explorerUrl)
 * ```
 */
export async function verifyDeployedContract(
  target: VerifyTarget,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const route = resolveRoute(opts.chainId, opts.route)
  const apiKey = opts.apiKey ?? ''
  if (route.verifier === 'etherscan-v2' && !apiKey)
    throw new CCTParamsInvalidError(
      'verifyDeployedContract',
      'apiKey',
      `an API key is required to verify on ${route.explorerBase}; pass opts.apiKey, or opts.route: 'sourcify' to use the keyless verifier`,
    )

  const logger = redacting(opts.logger)
  // A caller-supplied fetch never sees opts.abort otherwise, so inject the signal here rather
  // than relying on each transport call to remember it.
  const fetchImpl = withSignal(
    opts.fetch ??
      createRateLimitedFetch({ maxRetries: SUBMIT_RETRIES }, { logger, abort: opts.abort }),
    opts.abort,
  )

  const artifact = await loadStandardJson(target.verification.contract)
  const explorerUrl = explorerUrlFor(route, opts.chainId, target.contractAddress)
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const flow = { target, opts, route, artifact, fetchImpl, explorerUrl, deadline, logger }
  return route.verifier === 'sourcify'
    ? verifyOnSourcify(flow)
    : verifyOnEtherscan({ ...flow, apiKey })
}

/** Shared per-call state, threaded to the two provider flows. */
interface Flow {
  target: VerifyTarget
  opts: VerifyOptions
  route: ExplorerRoute
  artifact: Awaited<ReturnType<typeof loadStandardJson>>
  fetchImpl: typeof fetch
  explorerUrl: string
  deadline: number
  logger: Logger
}

/** Etherscan v2: submit (retrying while unindexed), poll, then confirm once if the budget expires. */
async function verifyOnEtherscan(flow: Flow & { apiKey: string }): Promise<VerifyResult> {
  const { target, opts, route, artifact, apiKey, fetchImpl, explorerUrl, deadline, logger } = flow
  const submission = {
    input: artifact.input,
    fqn: artifact.fqn,
    compilerVersion: artifact.compilerVersion,
    contractAddress: target.contractAddress,
    encodedConstructorArgs: target.verification.encodedConstructorArgs,
  }

  let guid: string
  for (let attempt = 1; ; attempt++) {
    try {
      ;({ guid } = await etherscan.submit(submission, route, opts.chainId, apiKey, fetchImpl))
      break
    } catch (error) {
      // Classify on the explorer's raw `result`, not on the wrapped message — the prefix would
      // defeat the startsWith() matchers.
      const message =
        error instanceof CCTVerificationFailedError && typeof error.context.result === 'string'
          ? error.context.result
          : ''
      if (etherscan.isAlreadyVerified(message))
        return { status: 'already-verified', verifier: 'etherscan-v2', explorerUrl }
      // A freshly-deployed contract is not indexed for a few seconds. This belongs in the SDK,
      // not in a CLI wrapper: a backend needs it just as much.
      if (etherscan.isNotIndexed(message) && attempt <= SUBMIT_RETRIES) {
        // The submit phase shares the caller's budget: without this, a not-yet-indexed contract
        // burns SUBMIT_RETRIES x SUBMIT_RETRY_MS (~64s) regardless of timeoutMs, then throws a
        // *permanent* error for a condition guaranteed to clear on its own.
        const remaining = deadline - Date.now()
        if (remaining <= 0)
          throw new CCTVerificationNotConfirmedError(
            'etherscan-v2',
            'not-submitted',
            opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            { context: { contractAddress: target.contractAddress, reason: 'not indexed in time' } },
          )
        logger.info(`verify: not indexed yet, retrying (${attempt}/${SUBMIT_RETRIES})`)
        await pollSleep(Math.min(SUBMIT_RETRY_MS, remaining), opts.abort)
        continue
      }
      throw error
    }
  }

  for (;;) {
    const status = await etherscan.checkStatus(guid, route, opts.chainId, apiKey, fetchImpl)
    if (status.state === 'verified')
      return { status: 'verified', verifier: 'etherscan-v2', explorerUrl }
    if (status.state === 'already-verified')
      return { status: 'already-verified', verifier: 'etherscan-v2', explorerUrl }
    if (status.state === 'failed')
      return { status: 'failed', verifier: 'etherscan-v2', reason: status.reason }

    if (Date.now() >= deadline) {
      // Snowtrace/Routescan (this SDK routes both Avalanche chains there) finish verifying but
      // lag on checkverifystatus by minutes. One confirmation call before giving up is far
      // cheaper than resubmitting a ~280 KB body.
      if (
        await etherscan.isVerified(target.contractAddress, route, opts.chainId, apiKey, fetchImpl)
      )
        return { status: 'verified', verifier: 'etherscan-v2', explorerUrl }
      throw new CCTVerificationNotConfirmedError(
        'etherscan-v2',
        guid,
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        { context: { contractAddress: target.contractAddress, fqn: artifact.fqn } },
      )
    }
    await pollSleep(POLL_INTERVAL_MS, opts.abort)
  }
}

/** Sourcify: keyless submit, then poll the job id. */
async function verifyOnSourcify(flow: Flow): Promise<VerifyResult> {
  const { target, opts, route, artifact, fetchImpl, explorerUrl, deadline } = flow

  const submitted = await sourcify.submit(
    {
      input: artifact.input,
      fqn: artifact.fqn,
      compilerVersion: artifact.compilerVersion,
      contractAddress: target.contractAddress,
      ...(target.hash ? { hash: target.hash } : {}),
    },
    route,
    opts.chainId,
    fetchImpl,
  )
  if (submitted.state === 'already-verified')
    return { status: 'already-verified', verifier: 'sourcify', explorerUrl }

  for (;;) {
    const status = await sourcify.checkStatus(submitted.verificationId, route, fetchImpl)
    if (status.state === 'verified')
      return { status: 'verified', verifier: 'sourcify', explorerUrl }
    if (status.state === 'already-verified')
      return { status: 'already-verified', verifier: 'sourcify', explorerUrl }
    if (status.state === 'failed')
      return { status: 'failed', verifier: 'sourcify', reason: status.reason }

    if (Date.now() >= deadline)
      throw new CCTVerificationNotConfirmedError(
        'sourcify',
        submitted.verificationId,
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        { context: { contractAddress: target.contractAddress, fqn: artifact.fqn } },
      )
    await pollSleep(POLL_INTERVAL_MS, opts.abort)
  }
}

/** Passes `opts.abort` to every request made through `impl`. */
function withSignal(impl: typeof fetch, signal?: AbortSignal): typeof fetch {
  if (!signal) return impl
  return (input, init) => impl(input, { ...init, signal })
}

/**
 * Waits between polls, keeping the process alive and failing fast on abort.
 *
 * Deliberately not `sleep()` from `utils.ts`: that builds on `AbortSignal.timeout`, whose timer is
 * unref'd, so with no socket in flight between polls the event loop drains and Node exits
 * mid-verification — the promise never settles and the caller gets neither a result nor an error.
 * It also *resolves* on abort, which would turn an aborted poll loop into an unthrottled request
 * flood rather than stopping it.
 */
function pollSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason as Error)
      },
      { once: true },
    )
  })
}

/**
 * Wraps a logger so an API key can never reach a log sink. The default fetch logger is
 * `console`, and it logs full request URLs and untruncated bodies — the key travels in the query
 * string, and the body is ~280 KB of Solidity, so the default is the hazard.
 */
function redacting(logger: Logger | undefined): Logger {
  const scrub = (args: unknown[]): unknown[] =>
    args.map((arg) =>
      typeof arg === 'string'
        ? arg.replace(/([?&]apikey=)[^&\s]+/gi, '$1[redacted]').slice(0, 2_000)
        : arg,
    )
  const noop = () => {}
  return {
    debug: (...args) => (logger ? logger.debug(...scrub(args)) : noop()),
    info: (...args) => (logger ? logger.info(...scrub(args)) : noop()),
    warn: (...args) => (logger ? logger.warn(...scrub(args)) : noop()),
    error: (...args) => (logger ? logger.error(...scrub(args)) : noop()),
  }
}
