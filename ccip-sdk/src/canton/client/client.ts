import axios, { type AxiosAdapter } from 'axios'

import { CCIPError } from '../../errors/CCIPError.ts'
import { CCIPErrorCode } from '../../errors/codes.ts'
import type { components } from './generated/ledger-api.generated.ts'

// Canton JSON Ledger API requires HTTP/2.
// On Node.js, axios uses its http adapter with native http2.connect().
// In browsers, HTTP/2 is negotiated automatically by the runtime.
const cantonHttp = axios.create({ httpVersion: 2 })

/** Commands to submit to the ledger */
export type JsCommands = components['schemas']['JsCommands']
/** A single command */
export type Command = components['schemas']['Command']
/** Response from submit-and-wait operation */
export type SubmitAndWaitResponse = components['schemas']['SubmitAndWaitResponse']
/** Full transaction response including all events */
export type JsSubmitAndWaitForTransactionResponse =
  components['schemas']['JsSubmitAndWaitForTransactionResponse']
/** A single transaction from the ledger */
export type JsTransaction = components['schemas']['JsTransaction']
export type GetLedgerEndResponse = components['schemas']['GetLedgerEndResponse']
export type GetUpdateByIdRequest = components['schemas']['GetUpdateByIdRequest']
export type UpdateFormat = components['schemas']['UpdateFormat']
export type JsGetUpdateResponse = components['schemas']['JsGetUpdateResponse']
export type Update = components['schemas']['Update']
/** Request to get active contracts */
export type GetActiveContractsRequest = components['schemas']['GetActiveContractsRequest']
/** Response containing active contracts */
export type JsGetActiveContractsResponse = components['schemas']['JsGetActiveContractsResponse']
/** An active contract on the ledger */
export type JsActiveContract = components['schemas']['JsActiveContract']
/** An event created by a contract */
export type CreatedEvent = components['schemas']['CreatedEvent']
/** Error returned by Canton API */
export type JsCantonError = components['schemas']['JsCantonError']
/** Format for events in responses */
export type EventFormat = components['schemas']['EventFormat']
/** Filter for templates */
export type TemplateFilter = components['schemas']['TemplateFilter']
/** Wildcard filter for matching patterns */
export type WildcardFilter = components['schemas']['WildcardFilter']
/** Information about a connected synchronizer */
export type ConnectedSynchronizer = components['schemas']['ConnectedSynchronizer']
/** Response containing connected synchronizers */
export type GetConnectedSynchronizersResponse =
  components['schemas']['GetConnectedSynchronizersResponse']

// ---------------------------------------------------------------------------
// Interactive submission types (external signing)
// ---------------------------------------------------------------------------

/** Request to prepare a transaction for external signing */
export type JsPrepareSubmissionRequest = components['schemas']['JsPrepareSubmissionRequest']
/** Response containing the prepared transaction and hash to sign */
export type JsPrepareSubmissionResponse = components['schemas']['JsPrepareSubmissionResponse']
/** Request to execute a prepared, externally-signed transaction and wait for the full transaction */
export type JsExecuteSubmissionAndWaitForTransactionRequest =
  components['schemas']['JsExecuteSubmissionAndWaitForTransactionRequest']
/** Response containing the committed transaction after external signing submission */
export type JsExecuteSubmissionAndWaitForTransactionResponse =
  components['schemas']['JsExecuteSubmissionAndWaitForTransactionResponse']
/** Signatures from all submitting parties */
export type PartySignatures = components['schemas']['PartySignatures']
/** Signatures from a single party */
export type SinglePartySignatures = components['schemas']['SinglePartySignatures']
/** A single cryptographic signature */
export type Signature = components['schemas']['Signature']
/** Hashing scheme version for interactive submissions */
export type HashingSchemeVersion = NonNullable<JsPrepareSubmissionRequest['hashingSchemeVersion']>

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Custom error class for Canton API errors
 */
class CantonApiError extends CCIPError {
  override readonly name = 'CantonApiError'

  /**
   * Creates a new CantonApiError instance
   * @param message - The error message
   * @param error - The underlying error object or details
   * @param statusCode - Optional HTTP status code
   */
  constructor(message: string, error: unknown, statusCode?: number) {
    const context: Record<string, unknown> = {}
    let fullMessage = message

    if (statusCode !== undefined) {
      context['statusCode'] = statusCode
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      const cantonError = error as JsCantonError
      context['cantonCode'] = cantonError.code
      context['cantonCause'] = cantonError.cause
      fullMessage = `${message}: [${cantonError.code}] ${cantonError.cause}`
    } else if (typeof error === 'string') {
      fullMessage = `${message}: ${error}`
      context['errorDetail'] = error
    } else if (error != null) {
      context['error'] = error
    }

    const isTransient = typeof statusCode === 'number' && (statusCode === 429 || statusCode >= 500)

    super(CCIPErrorCode.CANTON_API_ERROR, fullMessage, {
      cause: error instanceof Error ? error : undefined,
      context,
      isTransient,
      retryAfterMs: isTransient ? DEFAULT_RETRY_DELAY_MS : undefined,
    })
  }
}

const DEFAULT_RETRY_COUNT = 10
const DEFAULT_RETRY_DELAY_MS = 3_000
const NETWORK_RETRY_DELAY_MS = 10_000

/** Error codes that indicate a transient network issue (DNS, connection, etc.). */
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ERR_HTTP2_ERROR',
])

/**
 * Recursively extract the `code` property from an error or its `cause` chain.
 * Axios wraps the original network error in a `cause` property, so we check both levels.
 */
function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const code = (err as { code?: string }).code
  if (code) return code
  return getErrorCode((err as { cause?: unknown }).cause)
}

/** Check whether an error is a transient network-level failure. */
function isNetworkError(err: unknown): boolean {
  const code = getErrorCode(err)
  return !!code && NETWORK_ERROR_CODES.has(code)
}

/**
 * Execute an axios request while suppressing orphaned HTTP/2 session errors.
 *
 * When DNS fails, `http2.connect()` may emit an `error` event on the
 * `ClientHttp2Session` *after* the axios promise has already rejected.
 * Without a listener that second emission crashes the process.  We
 * temporarily bump the uncaught-exception guard for the duration of each
 * request so those late-arriving errors are swallowed and surfaced through
 * the normal retry path instead.
 */
async function safeHttp2Request(
  config: Parameters<typeof cantonHttp.request>[0],
): Promise<{ status: number; data: unknown; headers: Record<string, unknown> }> {
  let captured: Error | undefined
  const guard = (err: Error) => {
    if (isNetworkError(err)) {
      captured = err // swallow — the retry loop will handle it
    } else {
      throw err // rethrow non-network errors normally
    }
  }
  process.on('uncaughtException', guard)
  try {
    return await cantonHttp.request(config)
  } catch (err) {
    throw captured ?? err
  } finally {
    // Give the event loop one tick so any late-firing HTTP/2 session errors
    // are still caught by this guard before we remove it.
    await new Promise((r) => setImmediate(r))
    process.removeListener('uncaughtException', guard)
  }
}

/**
 * Detect whether an error represents a request cancelled via AbortSignal.
 *
 * Axios can surface cancellation in three forms depending on version and
 * transport adapter:
 * - `code === 'ERR_CANCELED'` (axios \>=1.x)
 * - `'__CANCEL__' in err`     (axios \<1.x legacy)
 * - `name === 'CanceledError'` (axios CanceledError class)
 */
function isCancelledError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  return e.code === 'ERR_CANCELED' || '__CANCEL__' in e || e.name === 'CanceledError'
}

/**
 * Perform an HTTP/2 request with retry logic and orphaned-session error suppression.
 * All Canton services (Ledger API, validator scan-proxy, EDS) require HTTP/2.
 */
async function request<T>(
  method: 'GET' | 'POST',
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  options?: { body?: unknown; queryParams?: Record<string, string> },
  retries = DEFAULT_RETRY_COUNT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  signal?: AbortSignal,
  fetchAdapter?: AxiosAdapter,
): Promise<T> {
  // Check if signal is already aborted before attempting any requests
  if (signal?.aborted) {
    throw new CantonApiError(`${method} ${path} aborted before request`, {
      message: 'AbortSignal already aborted',
    })
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    let response: { status: number; data: unknown; headers: Record<string, unknown> }
    try {
      const requestConfig = {
        method,
        url: baseUrl + path,
        headers,
        params: options?.queryParams,
        data: options?.body,
        timeout: timeoutMs,
        signal,
        // Prevent axios from throwing on non-2xx so we can handle retries ourselves
        validateStatus: () => true,
        // Route through the caller-supplied fetch adapter when present; otherwise
        // cantonHttp's HTTP/2 transport is used (the safeHttp2Request path below).
        ...(fetchAdapter ? { adapter: fetchAdapter } : {}),
      } as Parameters<typeof cantonHttp.request>[0]
      response = await safeHttp2Request(requestConfig)
    } catch (err) {
      // Don't retry if the request was cancelled via AbortSignal
      if (isCancelledError(err)) {
        throw new CantonApiError(`${method} ${path} cancelled`, err)
      }

      if (attempt < retries) {
        const isNetwork = isNetworkError(err)
        const delay = isNetwork ? NETWORK_RETRY_DELAY_MS : retryDelayMs
        const hint = isNetwork ? ' (network unreachable — check VPN?)' : ''
        console.log(
          `[canton/client] ${method} ${path} failed${hint} (attempt ${attempt}/${retries}), retrying in ${delay / 1000}s…`,
          isNetwork ? (err as Error).message : err,
        )
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw new CantonApiError(`${method} ${path} failed`, err)
    }

    if (response.status < 200 || response.status >= 300) {
      const errorBody = response.data ?? `HTTP ${response.status}`
      const isClientError =
        response.status >= 400 && response.status < 500 && response.status !== 429
      if (isClientError || attempt >= retries) {
        throw new CantonApiError(`${method} ${path} failed`, errorBody, response.status)
      }
      console.log(
        `[canton/client] ${method} ${path} failed with status ${response.status} (attempt ${attempt}/${retries}), retrying in ${retryDelayMs}ms:`,
        errorBody,
      )
      await new Promise((r) => setTimeout(r, retryDelayMs))
      continue
    }

    const contentLength = response.headers['content-length']
    if (response.status === 204 || contentLength === '0') {
      return undefined as T
    }
    return response.data as T
  }

  throw new CantonApiError(`${method} ${path} failed after ${retries} attempts`, undefined)
}

/**
 * Send a GET request
 *
 * @param baseUrl - The base URL of the Canton API.
 * @param path - The endpoint path to send the request to.
 * @param headers - HTTP headers to include in the request.
 * @param timeoutMs - Timeout for the request in milliseconds.
 * @param queryParams - Optional query parameters to append to the URL.
 * @returns A promise resolving to the parsed response of type T.
 * @throws {@link CantonApiError} If the request fails or the response is not OK.
 */
export async function get<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  queryParams?: Record<string, string>,
  retries = DEFAULT_RETRY_COUNT,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>(
    'GET',
    baseUrl,
    path,
    headers,
    timeoutMs,
    { queryParams },
    retries,
    undefined,
    signal,
  )
}

/**
 * Send a POST request
 *
 * @param baseUrl - The base URL of the Canton API.
 * @param path - The endpoint path to send the request to.
 * @param headers - HTTP headers to include in the request.
 * @param timeoutMs - Timeout for the request in milliseconds.
 * @param body - The request payload to send as JSON.
 * @param queryParams - Optional query parameters to append to the URL.
 * @returns A promise resolving to the parsed response of type T.
 * @throws {@link CantonApiError} If the request fails or the response is not OK.
 */
export async function post<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  body: unknown,
  queryParams?: Record<string, string>,
  retries = DEFAULT_RETRY_COUNT,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>(
    'POST',
    baseUrl,
    path,
    headers,
    timeoutMs,
    { body, queryParams },
    retries,
    undefined,
    signal,
  )
}
