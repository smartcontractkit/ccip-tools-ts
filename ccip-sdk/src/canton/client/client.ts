import axios from 'axios'

import type { components } from './generated/ledger-api.ts'
import { CCIPError } from '../../errors/CCIPError.ts'
import { CCIPErrorCode } from '../../errors/codes.ts'

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
}

/**
 * Create a typed Canton Ledger API client
 */
export function createCantonClient(config: CantonClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const headers = buildHeaders(config.jwt)
  const timeoutMs = config.timeout ?? 30_000
  const signal = config.signal

  return {
    /**
     * Submit a command and wait for completion
     * @returns The update ID and completion offset
     */
    async submitAndWait(commands: JsCommands): Promise<SubmitAndWaitResponse> {
      return post<SubmitAndWaitResponse>(
        baseUrl,
        '/v2/commands/submit-and-wait',
        headers,
        timeoutMs,
        commands,
        undefined,
        undefined,
        signal,
      )
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
      return post<JsSubmitAndWaitForTransactionResponse>(
        baseUrl,
        '/v2/commands/submit-and-wait-for-transaction',
        headers,
        SUBMIT_TIMEOUT_MS,
        { commands, eventFormat },
        undefined,
        1, // no HTTP-level retry
        signal,
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
      return post<JsGetActiveContractsResponse[]>(
        baseUrl,
        '/v2/state/active-contracts',
        headers,
        timeoutMs,
        request,
        queryParams,
        undefined,
        signal,
      )
    },

    /**
     * Get the current ledger end offset
     */
    async getLedgerEnd(): Promise<{ offset: number }> {
      const data = await get<{ offset?: number }>(
        baseUrl,
        '/v2/state/ledger-end',
        headers,
        timeoutMs,
        undefined,
        undefined,
        signal,
      )
      return { offset: data.offset ?? 0 }
    },

    /**
     * List known parties on the participant
     */
    async listParties(options?: { filterParty?: string }) {
      const queryParams = options?.filterParty ? { 'filter-party': options.filterParty } : undefined
      const data = await get<{ partyDetails?: unknown[] }>(
        baseUrl,
        '/v2/parties',
        headers,
        timeoutMs,
        queryParams,
        undefined,
        signal,
      )
      return data.partyDetails
    },

    /**
     * Get the participant ID
     */
    async getParticipantId(): Promise<string> {
      const data = await get<{ participantId?: string }>(
        baseUrl,
        '/v2/parties/participant-id',
        headers,
        timeoutMs,
        undefined,
        undefined,
        signal,
      )
      return data.participantId ?? ''
    },

    /**
     * Get the list of synchronizers the participant is currently connected to
     */
    async getConnectedSynchronizers(): Promise<ConnectedSynchronizer[]> {
      const data = await get<{ connectedSynchronizers?: ConnectedSynchronizer[] }>(
        baseUrl,
        '/v2/state/connected-synchronizers',
        headers,
        timeoutMs,
        undefined,
        undefined,
        signal,
      )
      return data.connectedSynchronizers ?? []
    },

    /**
     * Check if the ledger API is alive
     */
    async isAlive(): Promise<boolean> {
      try {
        await request(
          'GET',
          baseUrl,
          '/livez',
          headers,
          timeoutMs,
          undefined,
          undefined,
          undefined,
          signal,
        )
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
        await request(
          'GET',
          baseUrl,
          '/readyz',
          headers,
          timeoutMs,
          undefined,
          undefined,
          undefined,
          signal,
        )
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
      const response = await post<{ transaction: JsTransaction }>(
        baseUrl,
        '/v2/updates/transaction-by-id',
        headers,
        timeoutMs,
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
        undefined,
        undefined,
        signal,
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
      return post<unknown>(
        baseUrl,
        '/v2/updates/update-by-id',
        headers,
        timeoutMs,
        {
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
        },
        undefined,
        undefined,
        signal,
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

    super(CCIPErrorCode.CANTON_API_ERROR, fullMessage, {
      cause: error instanceof Error ? error : undefined,
      context,
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
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let response: { status: number; data: unknown; headers: Record<string, unknown> }
    try {
      response = await cantonHttp.request({
        method,
        url: baseUrl + path,
        headers,
        params: options?.queryParams,
        data: options?.body,
        timeout: timeoutMs,
        signal,
        // Prevent axios from throwing on non-2xx so we can handle retries ourselves
        validateStatus: () => true,
      })
    } catch (err) {
      if (attempt < retries) {
        console.log(
          `[canton/client] ${method} ${path} failed (attempt ${attempt}/${retries}), retrying in ${retryDelayMs}ms:`,
          err,
        )
        await new Promise((r) => setTimeout(r, retryDelayMs))
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
