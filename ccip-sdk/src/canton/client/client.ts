import type { components } from './generated/ledger-api.ts'
import { CCIPError } from '../../errors/CCIPError.ts'
import { CCIPErrorCode } from '../../errors/codes.ts'

// Re-export useful types from the generated schema
export type JsCommands = components['schemas']['JsCommands']
export type Command = components['schemas']['Command']
export type SubmitAndWaitResponse = components['schemas']['SubmitAndWaitResponse']
export type JsSubmitAndWaitForTransactionResponse =
  components['schemas']['JsSubmitAndWaitForTransactionResponse']
export type GetActiveContractsRequest = components['schemas']['GetActiveContractsRequest']
export type JsGetActiveContractsResponse = components['schemas']['JsGetActiveContractsResponse']
export type JsActiveContract = components['schemas']['JsActiveContract']
export type CreatedEvent = components['schemas']['CreatedEvent']
export type JsCantonError = components['schemas']['JsCantonError']
export type TransactionFilter = components['schemas']['TransactionFilter']
export type EventFormat = components['schemas']['EventFormat']
export type TemplateFilter = components['schemas']['TemplateFilter']
export type WildcardFilter = components['schemas']['WildcardFilter']
export type ConnectedSynchronizer = components['schemas']['ConnectedSynchronizer']
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
      return ledgerPost<SubmitAndWaitResponse>(
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
      return ledgerPost<JsSubmitAndWaitForTransactionResponse>(
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
      return ledgerPost<JsGetActiveContractsResponse[]>(
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
      const data = await ledgerGet<{ offset?: number }>(
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
      const data = await ledgerGet<{ partyDetails?: unknown[] }>(
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
      const data = await ledgerGet<{ participantId?: string }>(
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
      const data = await ledgerGet<{ connectedSynchronizers?: ConnectedSynchronizer[] }>(
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
        await ledgerRequest('GET', baseUrl, '/livez', headers, timeoutMs)
        return true
      } catch {
        return false
      }
    },

    /**
     * Check if the ledger API is ready
     */
    async isReady(): Promise<boolean> {
      try {
        await ledgerRequest('GET', baseUrl, '/readyz', headers, timeoutMs)
        return true
      } catch {
        return false
      }
    },

    /**
     * Get update by ID
     * @param updateId - The update ID returned from submit-and-wait
     * @param party - The party ID to filter events for
     * @returns The full update with all events
     */
    async getUpdateById(updateId: string, party: string): Promise<unknown> {
      return ledgerPost<unknown>(baseUrl, '/v2/updates/update-by-id', headers, timeoutMs, {
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

async function ledgerRequest<T>(
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
  return response.json() as Promise<T>
}

async function ledgerGet<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  queryParams?: Record<string, string>,
): Promise<T> {
  return ledgerRequest<T>('GET', baseUrl, path, headers, timeoutMs, { queryParams })
}

async function ledgerPost<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  timeoutMs: number,
  body: unknown,
  queryParams?: Record<string, string>,
): Promise<T> {
  return ledgerRequest<T>('POST', baseUrl, path, headers, timeoutMs, { body, queryParams })
}
