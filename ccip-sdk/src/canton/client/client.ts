import axios, { type AxiosAdapter } from 'axios'

import type { components } from './generated/ledger-api.ts'
import { CCIPError } from '../../errors/CCIPError.ts'
import { CCIPErrorCode } from '../../errors/codes.ts'
import { createAxiosFetchAdapter } from '../../fetch.ts'

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
/** Filter for transactions */
export type TransactionFilter = components['schemas']['TransactionFilter']
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

/**
 * Configuration for the Canton Ledger API client
 */
export interface CantonClientConfig {
  /** Base URL of the Canton JSON Ledger API (e.g., http://localhost:7575) */
  baseUrl: string
  /** JWT for authentication */
  jwt: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Abort signal for cancelling in-flight requests (e.g., from Chain.abort) */
  signal?: AbortSignal
  /**
   * Custom fetch implementation. When provided, routes all HTTP traffic through
   * the fetch adapter instead of the default axios HTTP/2 transport.
   * Omit to preserve the default HTTP/2 behaviour.
   */
  fetch?: typeof fetch
}

/**
 * Create a typed Canton Ledger API client
 */
export function createCantonClient(config: CantonClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const headers = buildHeaders(config.jwt)
  const timeoutMs = config.timeout ?? 30_000
  const signal = config.signal
  // Build a fetch adapter only when the caller explicitly supplies a fetch function.
  // When absent, the default HTTP/2 transport (cantonHttp) is used unchanged.
  const fetchAdapter: AxiosAdapter | undefined = config.fetch
    ? createAxiosFetchAdapter(config.fetch, signal)
    : undefined

  // Internal helpers that capture baseUrl/headers/timeoutMs/signal for
  // cleaner call sites inside createCantonClient.
  const get2 = <T>(
    path: string,
    queryParams?: Record<string, string>,
    retries?: number,
  ): Promise<T> =>
    request<T>(
      'GET',
      baseUrl,
      path,
      headers,
      timeoutMs,
      { queryParams },
      retries,
      undefined,
      signal,
      fetchAdapter,
    )

  const post2 = <T>(
    path: string,
    body: unknown,
    queryParams?: Record<string, string>,
    retries?: number,
    overrideTimeoutMs?: number,
  ): Promise<T> =>
    request<T>(
      'POST',
      baseUrl,
      path,
      headers,
      overrideTimeoutMs ?? timeoutMs,
      { body, queryParams },
      retries,
      undefined,
      signal,
      fetchAdapter,
    )

  return {
    /**
     * Submit a command and wait for completion
     * @returns The update ID and completion offset
     */
    async submitAndWait(commands: JsCommands): Promise<SubmitAndWaitResponse> {
      return post2<SubmitAndWaitResponse>('/v2/commands/submit-and-wait', commands)
    },

    /**
     * Submit a command and wait for the full transaction response
     * @returns The transaction with all created/archived events
     */
    async submitAndWaitForTransaction(
      commands: JsCommands,
      eventFormat?: EventFormat,
    ): Promise<JsSubmitAndWaitForTransactionResponse> {
      // Use a long timeout and no HTTP-level retry: submit-and-wait is not idempotent
      // across retries when the contract data (e.g. fee holding CID) may be consumed
      // or swept between attempts. Application-level retry with fresh data is done in
      // CantonChain.sendMessage / execute instead.
      const SUBMIT_TIMEOUT_MS = 120_000
      return post2<JsSubmitAndWaitForTransactionResponse>(
        '/v2/commands/submit-and-wait-for-transaction',
        { commands, eventFormat },
        undefined,
        1, // no HTTP-level retry
        SUBMIT_TIMEOUT_MS,
      )
    },

    /**
     * Query active contracts on the ledger
     * @returns Array of active contracts matching the filter
     */
    async getActiveContracts(
      request: GetActiveContractsRequest,
      options?: { limit?: number },
    ): Promise<JsGetActiveContractsResponse[]> {
      const queryParams =
        options?.limit !== undefined ? { limit: String(options.limit) } : undefined
      return post2<JsGetActiveContractsResponse[]>(
        '/v2/state/active-contracts',
        request,
        queryParams,
      )
    },

    /**
     * Get the current ledger end offset
     */
    async getLedgerEnd(): Promise<{ offset: number }> {
      const data = await get2<{ offset?: number }>('/v2/state/ledger-end')
      return { offset: data.offset ?? 0 }
    },

    /**
     * List known parties on the participant
     */
    async listParties(options?: { filterParty?: string }) {
      const queryParams = options?.filterParty ? { 'filter-party': options.filterParty } : undefined
      const data = await get2<{ partyDetails?: unknown[] }>('/v2/parties', queryParams)
      return data.partyDetails
    },

    /**
     * Get the participant ID
     */
    async getParticipantId(): Promise<string> {
      const data = await get2<{ participantId?: string }>('/v2/parties/participant-id')
      return data.participantId ?? ''
    },

    /**
     * Get the list of synchronizers the participant is currently connected to
     */
    async getConnectedSynchronizers(): Promise<ConnectedSynchronizer[]> {
      const data = await get2<{ connectedSynchronizers?: ConnectedSynchronizer[] }>(
        '/v2/state/connected-synchronizers',
      )
      return data.connectedSynchronizers ?? []
    },

    /**
     * Check if the ledger API is alive
     */
    async isAlive(): Promise<boolean> {
      try {
        await get2<unknown>('/livez')
        return true
      } catch (e) {
        console.log(`Ledger API is not alive at ${baseUrl}/livez:`, e)
        throw new CantonApiError('Ledger API is not alive', e)
        // return false
      }
    },

    /**
     * Check if the ledger API is ready
     */
    async isReady(): Promise<boolean> {
      try {
        await get2<unknown>('/readyz')
        return true
      } catch {
        return false
      }
    },

    /**
     * Fetch a transaction by its update ID without requiring a known party.
     * Uses `filtersForAnyParty` with a wildcard so all visible events are returned.
     * @param updateId - The update ID (Canton transaction hash)
     * @returns The full `JsTransaction` including all events
     */
    async getTransactionById(updateId: string): Promise<JsTransaction> {
      const response = await post2<{ transaction: JsTransaction }>(
        '/v2/updates/transaction-by-id',
        {
          updateId,
          transactionFormat: {
            eventFormat: {
              filtersByParty: {},
              filtersForAnyParty: {
                cumulative: [
                  {
                    identifierFilter: {
                      WildcardFilter: {
                        value: { includeCreatedEventBlob: false },
                      },
                    },
                  },
                ],
              },
              verbose: true,
            },
            transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
          },
        },
      )
      return response.transaction
    },

    /**
     * Get update by ID
     * @param updateId - The update ID returned from submit-and-wait
     * @param party - The party ID to filter events for
     * @returns The full update with all events
     */
    async getUpdateById(updateId: string, party: string): Promise<unknown> {
      return post2<unknown>('/v2/updates/update-by-id', {
        updateId,
        updateFormat: {
          includeTransactions: {
            eventFormat: {
              filtersByParty: {
                [party]: {
                  cumulative: [
                    {
                      identifierFilter: {
                        WildcardFilter: {
                          value: {
                            includeCreatedEventBlob: false,
                          },
                        },
                      },
                    },
                  ],
                },
              },
              verbose: true,
            },
            transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
          },
        },
      })
    },

    // -----------------------------------------------------------------------
    // Interactive submission (external signing)
    // -----------------------------------------------------------------------

    /**
     * Prepare a transaction for external signing.
     *
     * Calls the Preparing Participant Node (PPN) to convert ledger commands
     * into a Daml transaction. The response contains the prepared transaction
     * blob and a hash that must be signed by the external party.
     *
     * @returns The prepared transaction, its hash, and the hashing scheme version.
     */
    async prepareSubmission(
      request: JsPrepareSubmissionRequest,
    ): Promise<JsPrepareSubmissionResponse> {
      const PREPARE_TIMEOUT_MS = 120_000
      return post2<JsPrepareSubmissionResponse>(
        '/v2/interactive-submission/prepare',
        request,
        undefined,
        1, // no HTTP-level retry — caller handles retry with fresh ACS data
        PREPARE_TIMEOUT_MS,
      )
    },

    /**
     * Execute a previously prepared and externally-signed transaction,
     * waiting for the full transaction response.
     *
     * Calls the Executing Participant Node (EPN) with the prepared transaction
     * and the party's signature(s), returning the committed transaction.
     *
     * @returns The committed transaction with all created/archived events.
     */
    async executeSubmissionAndWaitForTransaction(
      request: JsExecuteSubmissionAndWaitForTransactionRequest,
    ): Promise<JsExecuteSubmissionAndWaitForTransactionResponse> {
      const EXECUTE_TIMEOUT_MS = 120_000
      return post2<JsExecuteSubmissionAndWaitForTransactionResponse>(
        '/v2/interactive-submission/executeAndWaitForTransaction',
        request,
        undefined,
        1, // no HTTP-level retry
        EXECUTE_TIMEOUT_MS,
      )
    },
  }
}

/**
 * Type alias for the Canton client instance
 */
export type CantonClient = ReturnType<typeof createCantonClient>

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

function buildHeaders(jwt?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`
  return headers
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
      if (attempt < retries) {
        console.log(
          `[canton/client] ${method} ${path} failed with status ${response.status} (attempt ${attempt}/${retries}), retrying in ${retryDelayMs}ms:`,
          errorBody,
        )
        await new Promise((r) => setTimeout(r, retryDelayMs))
        continue
      }
      throw new CantonApiError(`${method} ${path} failed`, errorBody, response.status)
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
