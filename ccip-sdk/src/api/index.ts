import type { APIErrorResponse, LaneLatencyResponse, RawLaneLatencyResponse } from './types.ts'
import { CCIPHttpError, CCIPLaneNotFoundError } from '../errors/index.ts'
import { HttpStatus } from '../http-status.ts'
import type { Logger, WithLogger } from '../types.ts'

export type { APIErrorResponse, LaneLatencyResponse } from './types.ts'

/** Default CCIP API base URL */
export const DEFAULT_API_BASE_URL = 'https://api.ccip.chain.link'

/**
 * Context for CCIPAPIClient initialization.
 */
export type CCIPAPIClientContext = WithLogger & {
  /** Custom fetch function (defaults to globalThis.fetch) */
  fetch?: typeof fetch
}

/**
 * Client for interacting with the CCIP REST API.
 *
 * Can be used standalone or injected into Chain classes.
 *
 * @example Standalone usage
 * ```typescript
 * const api = new CCIPAPIClient()
 * const latency = await api.getLaneLatency(sourceSelector, destSelector)
 * console.log(`Latency: ${latency.totalMs}ms`)
 * ```
 *
 * @example With custom options
 * ```typescript
 * const api = new CCIPAPIClient('https://custom.api.url', {
 *   logger: myLogger,
 *   fetch: myCustomFetch,
 * })
 * ```
 *
 * @example Error handling
 * ```typescript
 * try {
 *   const latency = await api.getLaneLatency(sourceSelector, destSelector)
 * } catch (err) {
 *   if (err instanceof CCIPHttpError) {
 *     console.error(`API error ${err.context.status}: ${err.context.apiErrorMessage}`)
 *     if (err.isTransient) {
 *       // Retry after delay
 *     }
 *   }
 * }
 * ```
 */
export class CCIPAPIClient {
  /** Base URL for API requests */
  readonly baseUrl: string
  /** Logger instance */
  readonly logger: Logger
  /** Fetch function used for HTTP requests */
  private readonly _fetch: typeof fetch

  /**
   * Creates a new CCIPAPIClient instance.
   * @param baseUrl - Base URL for the CCIP API (defaults to https://api.ccip.chain.link)
   * @param ctx - Optional context with logger and custom fetch
   */
  constructor(baseUrl?: string, ctx?: CCIPAPIClientContext) {
    this.baseUrl = baseUrl ?? DEFAULT_API_BASE_URL
    this.logger = ctx?.logger ?? console
    this._fetch = ctx?.fetch ?? globalThis.fetch
  }

  /**
   * Factory method for creating CCIPAPIClient.
   * Currently equivalent to constructor; reserved for future preflight checks.
   * @param baseUrl - Base URL for the CCIP API
   * @param ctx - Optional context
   * @returns New CCIPAPIClient instance
   */
  static fromUrl(baseUrl?: string, ctx?: CCIPAPIClientContext): CCIPAPIClient {
    return new CCIPAPIClient(baseUrl, ctx)
  }

  /**
   * Fetches estimated lane latency between source and destination chains.
   *
   * @param sourceChainSelector - Source chain selector (bigint)
   * @param destChainSelector - Destination chain selector (bigint)
   * @returns Promise resolving to {@link LaneLatencyResponse} with totalMs
   *
   * @throws {@link CCIPHttpError} on HTTP errors with context:
   *   - `status` - HTTP status code (e.g., 404, 500)
   *   - `statusText` - HTTP status message
   *   - `apiErrorCode` - API error code (e.g., "LANE_NOT_FOUND", "INVALID_PARAMETERS")
   *   - `apiErrorMessage` - Human-readable error message from API
   *
   * @example Basic usage
   * ```typescript
   * const latency = await api.getLaneLatency(
   *   5009297550715157269n,  // Ethereum mainnet
   *   4949039107694359620n,  // Arbitrum mainnet
   * )
   * console.log(`Estimated delivery: ${Math.round(latency.totalMs / 60000)} minutes`)
   * ```
   *
   * @example Handling specific API errors
   * ```typescript
   * try {
   *   const latency = await api.getLaneLatency(sourceSelector, destSelector)
   * } catch (err) {
   *   if (err instanceof CCIPHttpError && err.context.apiErrorCode === 'LANE_NOT_FOUND') {
   *     console.error('This lane does not exist')
   *   }
   * }
   * ```
   */
  async getLaneLatency(
    sourceChainSelector: bigint,
    destChainSelector: bigint,
  ): Promise<LaneLatencyResponse> {
    const url = new URL(`${this.baseUrl}/v1/lanes/latency`)
    url.searchParams.set('sourceChainSelector', sourceChainSelector.toString())
    url.searchParams.set('destChainSelector', destChainSelector.toString())

    this.logger.debug?.(`CCIPAPIClient: GET ${url.toString()}`)

    const response = await this._fetch(url.toString())

    if (!response.ok) {
      // Try to parse structured error response from API
      let apiError: APIErrorResponse | undefined
      try {
        apiError = (await response.json()) as APIErrorResponse
      } catch {
        // Response body not JSON, use HTTP status only
      }

      // Throw specific error for lane not found
      if (response.status === HttpStatus.NOT_FOUND) {
        throw new CCIPLaneNotFoundError(sourceChainSelector, destChainSelector, {
          context: apiError
            ? {
                apiErrorCode: apiError.error,
                apiErrorMessage: apiError.message,
              }
            : undefined,
        })
      }

      // Generic HTTP error for other cases
      throw new CCIPHttpError(response.status, response.statusText, {
        context: apiError
          ? {
              apiErrorCode: apiError.error,
              apiErrorMessage: apiError.message,
            }
          : undefined,
      })
    }

    const raw = (await response.json()) as RawLaneLatencyResponse

    // Log full raw response for debugging
    this.logger.debug?.('getLaneLatency raw response:', raw)

    return { totalMs: raw.totalMs }
  }
}
