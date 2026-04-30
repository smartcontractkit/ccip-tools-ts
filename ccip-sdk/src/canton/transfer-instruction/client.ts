import { post } from '../client/client.ts'
import type { DisclosedContract } from '../explicit-disclosures/index.ts'

/**
 * Context required to exercise a choice on a contract via an interface.
 */
export interface ChoiceContext {
  /** Additional data to use when exercising the choice. */
  choiceContextData: Record<string, unknown>
  /** Contracts that must be disclosed to the participant node. */
  disclosedContracts: DisclosedContract[]
}

/**
 * The transfer factory contract together with its choice context.
 *
 * Clients SHOULD avoid reusing the same response for exercising multiple
 * choices, as the choice context MAY be specific to a single exercise.
 */
export interface TransferFactoryWithChoiceContext {
  /** Contract ID of the factory contract. */
  factoryId: string
  /**
   * The kind of transfer workflow:
   * - `offer`  – offer a transfer; only completes if the receiver accepts
   * - `direct` – transfer directly (receiver pre-approved)
   * - `self`   – sender and receiver are the same party
   */
  transferKind: 'self' | 'direct' | 'offer'
  /** Choice context for exercising the factory choice. */
  choiceContext: ChoiceContext
}

/**
 * Request body for `getTransferFactory`.
 */
export interface GetFactoryRequest {
  /**
   * Arguments intended to be passed to the factory choice, encoded as a
   * Daml JSON API object (with `extraArgs.context` and `extraArgs.meta` set
   * to the empty object).
   */
  choiceArguments: Record<string, unknown>
  /** When `true` the response omits debug fields. Defaults to `false`. */
  excludeDebugFields?: boolean
}

/**
 * Request body for the accept / reject / withdraw choice-context endpoints.
 */
export interface GetChoiceContextRequest {
  /**
   * Metadata passed to the choice and incorporated into the choice context.
   * Provided for extensibility.
   */
  meta?: Record<string, string>
}

/**
 * Standard error envelope returned by the transfer-instruction API.
 */
export interface TransferInstructionErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Transfer Instruction API client.
 */
export interface TransferInstructionClientConfig {
  /** Base URL of the token registry (e.g. http://localhost:9000) */
  baseUrl: string
  /** Optional JWT for authentication */
  jwt?: string
  /** Request timeout in milliseconds (default: 30 000) */
  timeout?: number
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Create a typed Transfer Instruction API client.
 *
 * The client mirrors the endpoints defined in `transfer-instruction-v1.yaml`.
 */
export function createTransferInstructionClient(config: TransferInstructionClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const headers = buildHeaders(config.jwt)
  const timeoutMs = config.timeout ?? 30_000

  const appendScanProxyPath = (path: string) => `/v0/scan-proxy${path}`
  return {
    /**
     * Get the factory and choice context for executing a direct transfer.
     *
     * `POST /registry/transfer-instruction/v1/transfer-factory`
     */
    async getTransferFactory(
      request: GetFactoryRequest,
    ): Promise<TransferFactoryWithChoiceContext> {
      return post<TransferFactoryWithChoiceContext>(
        baseUrl,
        appendScanProxyPath('/registry/transfer-instruction/v1/transfer-factory'),
        headers,
        timeoutMs,
        request,
      )
    },

    /**
     * Get the choice context to **accept** a transfer instruction.
     *
     * `POST /registry/transfer-instruction/v1/{transferInstructionId}/choice-contexts/accept`
     */
    async getAcceptContext(
      transferInstructionId: string,
      request?: GetChoiceContextRequest,
    ): Promise<ChoiceContext> {
      return post<ChoiceContext>(
        baseUrl,
        appendScanProxyPath(
          `/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionId)}/choice-contexts/accept`,
        ),
        headers,
        timeoutMs,
        request ?? {},
      )
    },

    /**
     * Get the choice context to **reject** a transfer instruction.
     *
     * `POST /registry/transfer-instruction/v1/{transferInstructionId}/choice-contexts/reject`
     */
    async getRejectContext(
      transferInstructionId: string,
      request?: GetChoiceContextRequest,
    ): Promise<ChoiceContext> {
      return post<ChoiceContext>(
        baseUrl,
        appendScanProxyPath(
          `/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionId)}/choice-contexts/reject`,
        ),
        headers,
        timeoutMs,
        request ?? {},
      )
    },

    /**
     * Get the choice context to **withdraw** a transfer instruction.
     *
     * `POST /registry/transfer-instruction/v1/{transferInstructionId}/choice-contexts/withdraw`
     */
    async getWithdrawContext(
      transferInstructionId: string,
      request?: GetChoiceContextRequest,
    ): Promise<ChoiceContext> {
      return post<ChoiceContext>(
        baseUrl,
        appendScanProxyPath(
          `/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionId)}/choice-contexts/withdraw`,
        ),
        headers,
        timeoutMs,
        request ?? {},
      )
    },
  }
}

/**
 * Type alias for the Transfer Instruction client instance.
 */
export type TransferInstructionClient = ReturnType<typeof createTransferInstructionClient>

function buildHeaders(jwt?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`
  return headers
}
