import { type BytesLike, hexlify } from 'ethers'
import type { PickDeep } from 'type-fest'

import type { CCIPAPIClient } from './api/index.ts'
import type { Chain, ChainStatic, LogFilter } from './chain.ts'
import {
  CCIPArgumentInvalidError,
  CCIPCommitNotFoundError,
  CCIPHttpError,
  CCIPMessageNotVerifiedYetError,
} from './errors/index.ts'
import { fetchWithTimeout, redactEndpointUrl } from './fetch.ts'
import { NetworkType } from './networks.ts'
import {
  type CCIPRequest,
  type CCIPVerifications,
  type VerificationPolicy,
  type VerifierResult,
  CCIPVersion,
} from './types.ts'
import { linkAbortSignals, signalToPromise } from './utils.ts'
import { type VerifierTransport, grpcWebTransport, readVerifier } from './verifiers/index.ts'

/** Default CCIP v2 indexer base URLs for mainnet. */
export const MAINNET_INDEXER_URLS: readonly string[] = [
  'https://indexer-1.ccip.chain.link',
  'https://indexer-2.ccip.chain.link',
]

/** Default CCIP v2 indexer base URLs for testnet. */
export const TESTNET_INDEXER_URLS: readonly string[] = [
  'https://indexer-1.testnet.ccip.chain.link',
  'https://indexer-2.testnet.ccip.chain.link',
]

/** Shape of the indexer `/v1/verifierresults/:messageId` JSON response. */
type IndexerResponse = {
  success: boolean
  results: Array<{
    verifierResult: {
      message_id: string
      message_ccv_addresses: string[]
      ccv_data: string
      timestamp: string
      verifier_source_address: string
      verifier_dest_address: string
    }
  }>
  messageID: string
}

/** Options for {@link fetchVerifications}. */
export type FetchVerificationsOpts = {
  /** Indexer base URLs, or a {@link NetworkType} to use the built-in defaults. */
  indexer?: readonly string[] | NetworkType
  /** CCIP API client to race against the indexers; omit or pass `null` to skip. */
  apiClient?: CCIPAPIClient | null
  /** AbortSignal that cancels in-flight requests and terminates the poll loop. */
  watch?: AbortSignal
  /** Milliseconds between poll retries when `watch` is set (default: 5000). */
  pollInterval?: number
  /** Custom fetch used for indexer requests; defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
  /** Per-request timeout in milliseconds for indexer and verifier requests (default: 30000). */
  timeoutMs?: number
  /**
   * The destination's CCV policy. When given, results from every source are merged (one per
   * destination CCV) and the call resolves only once they cover it: every required CCV, plus
   * `optionalThreshold` of the optional ones. Without it, the first source to answer wins.
   */
  policy?: VerificationPolicy
  /** Results already at hand (e.g. attestations obtained out of band); they win over fetched ones. */
  known?: readonly VerifierResult[]
  /**
   * Verifier endpoint URLs to read attestations from directly (see {@link readVerifier}). They are
   * the last source: tried in order, and only while the API and indexers leave `policy` uncovered.
   */
  verifiers?: readonly string[]
  /** Transport for `verifiers` (default: {@link grpcWebTransport}). */
  verifierTransport?: VerifierTransport
  /**
   * Renders a destination CCV address, as a string or raw bytes, in the destination family's
   * canonical format, so results and policy match regardless of each source's encoding
   * (default: hex).
   */
  getAddress?: (address: BytesLike) => string
}

/**
 * Validate that every indexer entry is a base URL string.
 *
 * yargs applies boolean negation regardless of the declared option type, so `--no-indexer` on the
 * CLI's array-typed `--indexer` yields `[false]`. Rejecting it here keeps a non-string out of
 * `baseUrl.replace` below, where it would escape as a raw `TypeError` rather than a `CCIPError` and
 * render as a stack trace.
 *
 * @param indexer - Candidate indexer base URLs, unvalidated
 * @throws {@link CCIPArgumentInvalidError} if it is not an array, or any entry is not a string
 */
function assertIndexerUrls(indexer: unknown): asserts indexer is readonly string[] {
  // A bare string is iterable of strings, so a `for..of` type check alone would accept it and then
  // fail later on `.map`. Require an actual array first.
  if (!Array.isArray(indexer)) {
    throw new CCIPArgumentInvalidError(
      'indexer',
      `expected an array of base URLs, got ${typeof indexer}`,
      {
        context: { indexer },
      },
    )
  }
  for (const url of indexer) {
    if (typeof url !== 'string') {
      throw new CCIPArgumentInvalidError(
        'indexer',
        `expected base URL strings, got ${typeof url}`,
        {
          context: { indexer },
        },
      )
    }
  }
}

/**
 * Fetch CCV verifications for a CCIP v2.0 message.
 *
 * Sources, by precedence: `opts.known`; then the API client raced against every indexer URL via
 * {@link Promise.any}; then `opts.verifiers`, one at a time. Without `opts.policy` the first managed
 * source to answer wins. With it, partial answers are merged per destination CCV until the policy
 * is covered, and the verifiers are contacted only if the API and indexers leave it uncovered, so
 * routine reads stay on managed infrastructure.
 *
 * When `opts.watch` is supplied the function retries on
 * {@link CCIPMessageNotVerifiedYetError} at `opts.pollInterval` ms intervals
 * until the signal fires.
 *
 * @param messageId - The CCIP message ID (hex string)
 * @param opts - See {@link FetchVerificationsOpts}
 * @returns The verifier results, one per destination CCV
 * @throws {@link CCIPMessageNotVerifiedYetError} if the sources don't cover `opts.policy` (or,
 *   without one, all fail) and `opts.watch` is not live; its context names the missing CCVs and
 *   why each verifier endpoint failed
 * @throws {@link CCIPArgumentInvalidError} if `opts.indexer` contains a non-string entry
 */
export async function fetchVerifications(
  messageId: string,
  {
    indexer = [...MAINNET_INDEXER_URLS, ...TESTNET_INDEXER_URLS],
    apiClient,
    watch,
    pollInterval = 5_000,
    fetch: fetchFn,
    timeoutMs = 30_000,
    policy,
    known = [],
    verifiers = [],
    verifierTransport = grpcWebTransport(fetchFn),
    getAddress = (address) => (typeof address === 'string' ? address : hexlify(address)),
  }: FetchVerificationsOpts = {},
): Promise<VerifierResult[]> {
  if (indexer === NetworkType.Mainnet) indexer = MAINNET_INDEXER_URLS
  else if (indexer === NetworkType.Testnet) indexer = TESTNET_INDEXER_URLS

  assertIndexerUrls(indexer)
  const indexerUrls = indexer

  const fetchIndexer = async (baseUrl: string): Promise<VerifierResult[]> => {
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/verifierresults/${messageId}`
    const res = await fetchWithTimeout(url, 'fetchVerifications', {
      signal: watch,
      fetch: fetchFn,
      timeoutMs,
    })
    if (!res.ok) throw new CCIPHttpError(res.status, res.statusText, { context: { url } })
    const json = (await res.json()) as IndexerResponse
    if (!json.success) throw new CCIPMessageNotVerifiedYetError(messageId)
    return json.results.map(({ verifierResult: vr }) => ({
      ccvData: vr.ccv_data,
      sourceAddress: vr.verifier_source_address,
      destAddress: vr.verifier_dest_address,
      timestamp: vr.timestamp ? Math.floor(new Date(vr.timestamp).getTime() / 1000) : undefined,
    }))
  }

  // One result per destination CCV, the first source to supply it wins. Keys are canonical in the
  // destination family, and case-folded when hex, so sources and policy match whatever encoding
  // each one uses.
  const key = (address: string) => {
    try {
      address = getAddress(address)
    } catch {
      // not canonicalizable; match as given
    }
    return address.startsWith('0x') ? address.toLowerCase() : address
  }
  const collected = new Map<string, VerifierResult>()
  const collect = (results: readonly VerifierResult[]) => {
    for (const result of results) {
      const k = key(result.destAddress)
      if (!collected.has(k)) collected.set(k, result)
    }
  }
  const missingRequired = () => policy?.requiredCCVs.filter((c) => !collected.has(key(c))) ?? []
  const optionalCovered = () =>
    policy?.optionalCCVs.filter((c) => collected.has(key(c))).length ?? 0
  const covered = () =>
    policy
      ? !missingRequired().length && optionalCovered() >= policy.optionalThreshold
      : collected.size > 0
  // results outside the policy are kept, as sources serve them: a family's policy read may not
  // resolve every CCV the OffRamp enforces (e.g. Solana's token pool CCVs)
  const selected = () => [...collected.values()]

  collect(known)
  // Polling loop: retry on CCIPMessageNotVerifiedYetError only when watch is supplied.
  let lastErr
  do {
    if (policy && covered()) return selected()

    let managedErr
    try {
      await Promise.any(
        [
          ...(apiClient != null
            ? [() => apiClient.getVerifications(messageId, { signal: watch })]
            : []),
          ...indexerUrls.map((url) => () => fetchIndexer(url)),
        ].map(async (source) => {
          collect(await source())
          // a partial answer is kept, but doesn't settle the race
          if (policy && !covered()) throw new CCIPMessageNotVerifiedYetError(messageId)
        }),
      )
      return selected()
    } catch (err) {
      if (watch?.aborted) throw (err as AggregateError).errors[0] ?? err
      managedErr = err as Error
    }

    const verifierFailures: { url: string; reason: string }[] = []
    for (const url of verifiers) {
      if (covered()) break
      const link = linkAbortSignals([watch, AbortSignal.timeout(timeoutMs)])
      try {
        collect(
          await readVerifier(url, messageId, {
            transport: verifierTransport,
            getAddress,
            signal: link.signal,
          }),
        )
      } catch (err) {
        verifierFailures.push({
          url: redactEndpointUrl(url),
          reason: err instanceof Error ? err.message : String(err),
        })
      } finally {
        link.unlink()
      }
    }
    if (covered()) return selected()

    lastErr = new CCIPMessageNotVerifiedYetError(messageId, {
      cause: managedErr,
      context: {
        ...(policy && { missingCCVs: missingRequired() }),
        ...(policy?.optionalThreshold && {
          optionalCovered: `${optionalCovered()}/${policy.optionalThreshold}`,
        }),
        ...(verifierFailures.length && { verifierFailures }),
      },
    })
    if (!watch) throw lastErr
    await signalToPromise(AbortSignal.any([watch, AbortSignal.timeout(pollInterval)])).catch(
      () => {},
    )
  } while (!watch.aborted)
  throw lastErr
}

/**
 * Look for a CommitReport at dest for given CCIPRequest
 * Provides a basic/generic implementation, but subclasses of Chain may override with more specific
 * logic in Chain.getVerifications method
 *
 * @param dest - Destination network provider
 * @param offRamp - Commit store address
 * @param request - CCIP request info
 * @param hints - Additional filtering hints
 * @returns CCIP commit info
 **/
export async function getOnchainCommitReport(
  dest: Chain,
  offRamp: string,
  {
    lane,
    message,
    log: { blockTimestamp: requestTimestamp },
  }: PickDeep<
    CCIPRequest,
    'lane' | `message.${'sequenceNumber' | 'messageId'}` | 'log.blockTimestamp'
  >,
  hints?: Pick<LogFilter, 'page' | 'watch' | 'startBlock'>,
): Promise<CCIPVerifications> {
  for await (const log of dest.getLogs({
    ...hints,
    ...(hints?.startBlock == null
      ? { startTime: requestTimestamp }
      : { startBlock: hints.startBlock }),
    address: offRamp,
    topics: [lane.version < CCIPVersion.V1_6 ? 'ReportAccepted' : 'CommitReportAccepted'],
  })) {
    const reports = (dest.constructor as ChainStatic).decodeCommits(log, lane)
    if (!reports) continue
    const validReports = reports.filter((r) => {
      if (r.maxSeqNr < message.sequenceNumber) return
      // we could give up since we walk forward from some startBlock/startTime, but there might be some out-of-order logs
      if (r.minSeqNr > message.sequenceNumber) return
      return true
    })

    if (!validReports.length) continue

    return {
      log,
      report: validReports[0]!,
    }
  }

  throw new CCIPCommitNotFoundError(
    hints?.startBlock ?? String(requestTimestamp),
    message.sequenceNumber,
  )
}
