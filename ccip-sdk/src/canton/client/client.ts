import type { components } from './generated/ledger-api.ts'
import { CCIPError } from '../../errors/CCIPError.ts'
import { CCIPErrorCode } from '../../errors/codes.ts'

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
}

/**
 * Create a typed Canton Ledger API client
 */
export function createCantonClient(config: CantonClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const headers = buildHeaders(config.jwt)
  const timeoutMs = config.timeout ?? 30_000

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
      return post<JsSubmitAndWaitForTransactionResponse>(
        baseUrl,
        '/v2/commands/submit-and-wait-for-transaction',
        headers,
        timeoutMs,
        { commands, eventFormat },
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
      )
      return data.connectedSynchronizers ?? []
    },

    /**
     * Check if the ledger API is alive
     */
    async isAlive(): Promise<boolean> {
      try {
        await request('GET', baseUrl, '/livez', headers, timeoutMs)
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
        await request('GET', baseUrl, '/readyz', headers, timeoutMs)
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
      return post<unknown>(baseUrl, '/v2/updates/update-by-id', headers, timeoutMs, {
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

async function parseErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return `HTTP ${response.status}`
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  options?: { body?: unknown; queryParams?: Record<string, string> },
): Promise<T> {
  const url = new URL(path, baseUrl)
  if (options?.queryParams) {
    for (const [key, value] of Object.entries(options.queryParams)) {
      url.searchParams.set(key, value)
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    throw new CantonApiError(`${method} ${path} failed`, err)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new CantonApiError(
      `${method} ${path} failed`,
      await parseErrorBody(response),
      response.status,
    )
  }
  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0') {
    return undefined as T
  }
  return response.json() as Promise<T>
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
 * @throws {CantonApiError} If the request fails or the response is not OK.
 */
export async function get<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  queryParams?: Record<string, string>,
): Promise<T> {
  return request<T>('GET', baseUrl, path, headers, timeoutMs, { queryParams })
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
 * @throws {CantonApiError} If the request fails or the response is not OK.
 */
export async function post<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  body: unknown,
  queryParams?: Record<string, string>,
): Promise<T> {
  return request<T>('POST', baseUrl, path, headers, timeoutMs, { body, queryParams })
}
