import createClient from 'openapi-fetch'

import type { components, paths } from './generated/ledger-api.ts'
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
  /** Optional bearer token for authentication */
  token?: string
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * Create a typed Canton Ledger API client
 */
export function createCantonClient(config: CantonClientConfig) {
  const client = createClient<paths>({
    baseUrl: config.baseUrl,
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
  })

  return {
    /**
     * Raw openapi-fetch client for advanced usage
     */
    raw: client,

    /**
     * Submit a command and wait for completion
     * @returns The update ID and completion offset
     */
    async submitAndWait(commands: JsCommands): Promise<SubmitAndWaitResponse> {
      const { data, error } = await client.POST('/v2/commands/submit-and-wait', {
        body: commands,
      })

      if (error || !data) {
        throw new CantonApiError('submitAndWait failed', error)
      }

      return data
    },

    /**
     * Submit a command and wait for the full transaction response
     * @returns The transaction with all created/archived events
     */
    async submitAndWaitForTransaction(
      commands: JsCommands,
      eventFormat?: EventFormat,
    ): Promise<JsSubmitAndWaitForTransactionResponse> {
      const { data, error } = await client.POST('/v2/commands/submit-and-wait-for-transaction', {
        body: {
          commands,
          eventFormat,
        },
      })

      if (error || !data) {
        throw new CantonApiError('submitAndWaitForTransaction failed', error)
      }

      return data
    },

    /**
     * Query active contracts on the ledger
     * @returns Array of active contracts matching the filter
     */
    async getActiveContracts(
      request: GetActiveContractsRequest,
      options?: { limit?: number },
    ): Promise<JsGetActiveContractsResponse[]> {
      const { data, error } = await client.POST('/v2/state/active-contracts', {
        body: request,
        params: {
          query: options?.limit ? { limit: options.limit } : undefined,
        },
      })

      if (error || !data) {
        throw new CantonApiError('getActiveContracts failed', error)
      }

      return data
    },

    /**
     * Get the current ledger end offset
     */
    async getLedgerEnd(): Promise<{ offset: number }> {
      const { data, error } = await client.GET('/v2/state/ledger-end')

      if (error || !data) {
        throw new CantonApiError('getLedgerEnd failed', error)
      }

      return { offset: data.offset ?? 0 }
    },

    /**
     * List known parties on the participant
     */
    async listParties(options?: { filterParty?: string }) {
      const { data, error } = await client.GET('/v2/parties', {
        params: {
          query: options?.filterParty ? { 'filter-party': options.filterParty } : undefined,
        },
      })

      if (error || !data) {
        throw new CantonApiError('listParties failed', error)
      }

      return data.partyDetails
    },

    /**
     * Get the participant ID
     */
    async getParticipantId(): Promise<string> {
      const { data, error } = await client.GET('/v2/parties/participant-id')

      if (error || !data) {
        throw new CantonApiError('getParticipantId failed', error)
      }

      return data.participantId ?? ''
    },

    /**
     * Get the list of synchronizers the participant is currently connected to
     */
    async getConnectedSynchronizers(): Promise<ConnectedSynchronizer[]> {
      const { data, error } = await client.GET('/v2/state/connected-synchronizers')

      if (error || !data) {
        throw new CantonApiError('getConnectedSynchronizers failed', error)
      }

      return data.connectedSynchronizers ?? []
    },

    /**
     * Check if the ledger API is alive
     */
    async isAlive(): Promise<boolean> {
      try {
        const { error } = await client.GET('/livez')
        return !error
      } catch {
        return false
      }
    },

    /**
     * Check if the ledger API is ready
     */
    async isReady(): Promise<boolean> {
      try {
        const { data, error } = await client.GET('/readyz')
        return !error && data !== undefined
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
      const { data, error } = await client.POST('/v2/updates/update-by-id', {
        body: {
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
      })

      if (error || !data) {
        throw new CantonApiError('getUpdateById failed', error)
      }

      return data
    },
  }
}

/**
 * Custom error class for Canton API errors
 */
export class CantonApiError extends CCIPError {
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

/**
 * Type alias for the Canton client instance
 */
export type CantonClient = ReturnType<typeof createCantonClient>
