import type { PickDeep } from 'type-fest'

import type { CCIPAPIClient } from './api/index.ts'
import type { Chain, ChainStatic, LogFilter } from './chain.ts'
import {
  CCIPCommitNotFoundError,
  CCIPHttpError,
  CCIPMessageNotVerifiedYetError,
} from './errors/index.ts'
import { NetworkType } from './networks.ts'
import {
  type CCIPRequest,
  type CCIPVerifications,
  type VerifierResult,
  CCIPVersion,
} from './types.ts'
import { signalToPromise } from './utils.ts'

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
}

/**
 * Fetch CCV verifications for a CCIP v2.0 message.
 *
 * Races the optional API client against all provided indexer URLs via
 * {@link Promise.any}, returning the first successful response.
 *
 * When `opts.watch` is supplied the function retries on
 * {@link CCIPMessageNotVerifiedYetError} at `opts.pollInterval` ms intervals
 * until the signal fires.
 *
 * @param messageId - The CCIP message ID (hex string)
 * @param opts - See {@link FetchVerificationsOpts}
 * @returns CCIPVerifications with verificationPolicy and verifier results
 * @throws {@link CCIPMessageNotVerifiedYetError} if all sources fail or signal fires
 */
export async function fetchVerifications(
  messageId: string,
  {
    indexer = [...MAINNET_INDEXER_URLS, ...TESTNET_INDEXER_URLS],
    apiClient,
    watch,
    pollInterval = 5_000,
  }: FetchVerificationsOpts = {},
): Promise<VerifierResult[]> {
  if (indexer === NetworkType.Mainnet) indexer = MAINNET_INDEXER_URLS
  else if (indexer === NetworkType.Testnet) indexer = TESTNET_INDEXER_URLS

  // Polling loop: retry on CCIPMessageNotVerifiedYetError until watch fires
  let lastErr
  do {
    try {
      return await Promise.any([
        ...(apiClient != null ? [apiClient.getVerifications(messageId, { signal: watch })] : []),
        ...indexer.map(async (baseUrl) => {
          const url = `${baseUrl.replace(/\/+$/, '')}/v1/verifierresults/${messageId}`
          const res = await fetch(url, { signal: watch })
          if (!res.ok) throw new CCIPHttpError(res.status, res.statusText, { context: { url } })
          const json = (await res.json()) as IndexerResponse
          if (!json.success) throw new CCIPMessageNotVerifiedYetError(messageId)
          const verifications: VerifierResult[] = json.results.map(({ verifierResult: vr }) => ({
            ccvData: vr.ccv_data,
            sourceAddress: vr.verifier_source_address,
            destAddress: vr.verifier_dest_address,
            timestamp: vr.timestamp
              ? Math.floor(new Date(vr.timestamp).getTime() / 1000)
              : undefined,
          }))
          return verifications
        }),
      ]).catch((err: AggregateError) => {
        if (watch?.aborted) throw err.errors[0] ?? err
        throw new CCIPMessageNotVerifiedYetError(messageId, { cause: err })
      })
    } catch (err) {
      lastErr = err
      if (!(err instanceof CCIPMessageNotVerifiedYetError)) throw err
      await signalToPromise(
        watch
          ? AbortSignal.any([watch, AbortSignal.timeout(pollInterval)])
          : AbortSignal.timeout(pollInterval),
      ).catch(() => {})
    }
  } while (!watch?.aborted)
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
