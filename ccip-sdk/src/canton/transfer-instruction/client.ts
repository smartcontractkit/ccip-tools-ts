import { type CantonHttpVersion, post } from '../client/client.ts'
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
  /**
   * Optional JWT for authentication.
   *
   * Pass a string for a static token, or a `() => Promise<string>` getter for
   * a refreshable token. When a getter is supplied, each request awaits it and
   * uses the returned JWT in the `Authorization` header (enabling automatic
   * refresh).
   */
  jwt?: string | (() => Promise<string>)
  /** Request timeout in milliseconds (default: 30 000) */
  timeout?: number
  /**
   * When true (default), prefix paths with `/v0/scan-proxy` (validator API).
   * CCIP LINK on EDS uses `false` — same OpenAPI paths without scan-proxy.
   */
  useScanProxy?: boolean
  /**
   * HTTP protocol selection (default: `'auto'`).
   *
   * The hosted validator front-end requires HTTP/2, but user-hosted
   * instances (and EDS-hosted transfer-instruction APIs) may serve
   * HTTP/1.1 only. `'auto'` tries HTTP/2 first and falls back to HTTP/1.1
   * on a protocol-level failure, memoized per origin. Pin `2` or `1` to
   * skip negotiation for a known endpoint.
   */
  httpVersion?: CantonHttpVersion
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
  const jwt = config.jwt
  const timeoutMs = config.timeout ?? 30_000
  const httpVersion: CantonHttpVersion = config.httpVersion ?? 'auto'

  /** Resolve request headers, awaiting `jwt` when it is a function. */
  async function resolveHeaders(): Promise<Record<string, string>> {
    const token = typeof jwt === 'function' ? await jwt() : jwt
    return buildHeaders(token)
  }

  const apiPath = (path: string) => (config.useScanProxy === false ? path : `/v0/scan-proxy${path}`)
  return {
    /**
     * Get the factory and choice context for executing a direct transfer.
     *
     * `POST /registry/transfer-instruction/v1/transfer-factory`
     */
    async getTransferFactory(
      request: GetFactoryRequest,
    ): Promise<TransferFactoryWithChoiceContext> {
      const headers = await resolveHeaders()
      return post<TransferFactoryWithChoiceContext>(
        baseUrl,
        apiPath('/registry/transfer-instruction/v1/transfer-factory'),
        headers,
        timeoutMs,
        request,
        undefined,
        undefined,
        undefined,
        httpVersion,
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
      const headers = await resolveHeaders()
      return post<ChoiceContext>(
        baseUrl,
        apiPath(
          `/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionId)}/choice-contexts/accept`,
        ),
        headers,
        timeoutMs,
        request ?? {},
        undefined,
        undefined,
        undefined,
        httpVersion,
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
      const headers = await resolveHeaders()
      return post<ChoiceContext>(
        baseUrl,
        apiPath(
          `/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionId)}/choice-contexts/reject`,
        ),
        headers,
        timeoutMs,
        request ?? {},
        undefined,
        undefined,
        undefined,
        httpVersion,
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
      const headers = await resolveHeaders()
      return post<ChoiceContext>(
        baseUrl,
        apiPath(
          `/registry/transfer-instruction/v1/${encodeURIComponent(transferInstructionId)}/choice-contexts/withdraw`,
        ),
        headers,
        timeoutMs,
        request ?? {},
        undefined,
        undefined,
        undefined,
        httpVersion,
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
