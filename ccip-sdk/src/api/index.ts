import {
  CCIPArgumentInvalidError,
  CCIPHttpError,
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageIdValidationError,
  CCIPMessageNotFoundInTxError,
  CCIPTimeoutError,
  CCIPUnexpectedPaginationError,
} from '../errors/index.ts'
import type { EVMExtraArgsV2, SVMExtraArgsV1 } from '../extra-args.ts'
import { HttpStatus } from '../http-status.ts'
import { type Logger, type MessageStatus, type WithLogger, CCIPVersion } from '../types.ts'
import { networkInfo, parseJson } from '../utils.ts'
import type {
  APICCIPRequest,
  APIErrorResponse,
  LaneLatencyResponse,
  RawEVMExtraArgs,
  RawLaneLatencyResponse,
  RawMessageResponse,
  RawMessagesResponse,
  RawSVMExtraArgs,
  RawTokenAmount,
} from './types.ts'

export type {
  APICCIPRequest,
  APICCIPRequestMetadata,
  APIErrorResponse,
  LaneLatencyResponse,
} from './types.ts'

/** Default CCIP API base URL */
export const DEFAULT_API_BASE_URL = 'https://api.ccip.chain.link'

/** Default timeout for API requests in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30000

/**
 * Context for CCIPAPIClient initialization.
 */
export type CCIPAPIClientContext = WithLogger & {
  /** Custom fetch function (defaults to globalThis.fetch) */
  fetch?: typeof fetch
  /** Request timeout in milliseconds (defaults to 30000ms) */
  timeoutMs?: number
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
  /** Request timeout in milliseconds */
  readonly timeoutMs: number
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
    this.timeoutMs = ctx?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this._fetch = ctx?.fetch ?? globalThis.fetch
  }

  /**
   * Factory method for creating CCIPAPIClient.
   * Currently equivalent to constructor; reserved for future preflight checks.
   * @param baseUrl - Base URL for the CCIP API
   * @param ctx - Optional context
   * @returns New CCIPAPIClient instance
   */
  static fromUrl(baseUrl?: string, ctx?: CCIPAPIClientContext): Promise<CCIPAPIClient> {
    return Promise.resolve(new CCIPAPIClient(baseUrl, ctx))
  }

  /**
   * Performs a fetch request with timeout protection.
   * @param url - URL to fetch
   * @param operation - Operation name for error context
   * @returns Promise resolving to Response
   * @throws CCIPTimeoutError if request times out
   * @internal
   */
  private async _fetchWithTimeout(url: string, operation: string): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      return await this._fetch(url, { signal: controller.signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CCIPTimeoutError(operation, this.timeoutMs)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
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
    const url = new URL(`${this.baseUrl}/v2/lanes/latency`)
    url.searchParams.set('sourceChainSelector', sourceChainSelector.toString())
    url.searchParams.set('destChainSelector', destChainSelector.toString())

    this.logger.debug(`CCIPAPIClient: GET ${url.toString()}`)

    const response = await this._fetchWithTimeout(url.toString(), 'getLaneLatency')

    if (!response.ok) {
      // Try to parse structured error response from API
      let apiError: APIErrorResponse | undefined
      try {
        apiError = parseJson<APIErrorResponse>(await response.text())
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

    const raw = parseJson<RawLaneLatencyResponse>(await response.text())

    // Log full raw response for debugging
    this.logger.debug('getLaneLatency raw response:', raw)

    return { totalMs: raw.totalMs }
  }

  /**
   * Fetches a CCIP message by its unique message ID.
   *
   * @param messageId - The message ID (0x prefix + 64 hex characters, e.g., "0x1234...abcd")
   * @returns Promise resolving to {@link APICCIPRequest} with message details
   *
   * @throws {@link CCIPMessageIdValidationError} when messageId format is invalid
   * @throws {@link CCIPMessageIdNotFoundError} when message not found (404)
   * @throws {@link CCIPHttpError} on HTTP errors with context:
   *   - `status` - HTTP status code
   *   - `statusText` - HTTP status message
   *   - `apiErrorCode` - API error code (e.g., "INVALID_MESSAGE_ID")
   *   - `apiErrorMessage` - Human-readable error message
   *
   * @example Basic usage
   * ```typescript
   * const request = await api.getMessageById(
   *   '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
   * )
   * console.log(`Status: ${request.status}`)
   * console.log(`From: ${request.message?.sender}`)
   * ```
   *
   * @example Handling not found
   * ```typescript
   * try {
   *   const request = await api.getMessageById(messageId)
   * } catch (err) {
   *   if (err instanceof CCIPMessageIdNotFoundError) {
   *     console.error('Message not found, it may still be in transit')
   *   }
   * }
   * ```
   */
  async getMessageById(messageId: string): Promise<APICCIPRequest> {
    const url = `${this.baseUrl}/v2/messages/${encodeURIComponent(messageId)}`

    this.logger.debug(`CCIPAPIClient: GET ${url}`)

    const response = await this._fetchWithTimeout(url, 'getMessageById')

    if (!response.ok) {
      // Try to parse structured error response from API
      let apiError: APIErrorResponse | undefined
      try {
        apiError = parseJson<APIErrorResponse>(await response.text())
      } catch {
        // Response body not JSON, use HTTP status only
      }

      // 404 - Message not found
      if (response.status === HttpStatus.NOT_FOUND) {
        throw new CCIPMessageIdNotFoundError(messageId, {
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

    const raw = parseJson<RawMessageResponse>(await response.text())

    this.logger.debug('getMessageById raw response:', raw)

    return this._transformMessageResponse(raw)
  }

  /**
   * Fetches message IDs from a source transaction hash.
   *
   * @param txHash - Source transaction hash (EVM hex or Solana Base58)
   * @returns Promise resolving to array of message IDs
   *
   * @throws {@link CCIPArgumentInvalidError} when txHash format is invalid
   * @throws {@link CCIPMessageNotFoundInTxError} when no messages found (404 or empty)
   * @throws {@link CCIPUnexpectedPaginationError} when hasNextPage is true
   * @throws {@link CCIPHttpError} on HTTP errors
   *
   * @example Basic usage
   * ```typescript
   * const messageIds = await api.getMessageIdsInTx(
   *   '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
   * )
   * console.log(`Found ${messageIds.length} messages`)
   * ```
   */
  async getMessageIdsInTx(txHash: string): Promise<string[]> {
    const url = new URL(`${this.baseUrl}/v2/messages`)
    url.searchParams.set('sourceTransactionHash', txHash)
    url.searchParams.set('limit', '100')

    this.logger.debug(`CCIPAPIClient: GET ${url.toString()}`)

    const response = await this._fetchWithTimeout(url.toString(), 'getMessageIdsInTx')

    if (!response.ok) {
      // Try to parse structured error response from API
      let apiError: APIErrorResponse | undefined
      try {
        apiError = parseJson<APIErrorResponse>(await response.text())
      } catch {
        // Response body not JSON, use HTTP status only
      }

      // 404 - No messages found
      if (response.status === HttpStatus.NOT_FOUND) {
        throw new CCIPMessageNotFoundInTxError(txHash, {
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

    const raw = parseJson<RawMessagesResponse>(await response.text())

    this.logger.debug('getMessageIdsInTx raw response:', raw)

    // Handle empty results
    if (raw.data.length === 0) {
      throw new CCIPMessageNotFoundInTxError(txHash)
    }

    // Handle unexpected pagination (more than 100 messages)
    if (raw.pagination.hasNextPage) {
      throw new CCIPUnexpectedPaginationError(txHash, raw.data.length)
    }

    return raw.data.map((msg) => msg.messageId)
  }

  /**
   * Transforms raw API response to APICCIPRequest.
   * Populates all derivable CCIPRequest fields from API data.
   * @internal
   */
  private _transformMessageResponse(raw: RawMessageResponse): APICCIPRequest {
    const sendDate = new Date(raw.sendTimestamp)
    const sendTimestamp = isNaN(sendDate.getTime()) ? 0 : Math.floor(sendDate.getTime() / 1000)

    const receiptDate = raw.receiptTimestamp ? new Date(raw.receiptTimestamp) : undefined
    const receiptTimestamp =
      receiptDate && !isNaN(receiptDate.getTime())
        ? Math.floor(receiptDate.getTime() / 1000)
        : undefined

    // Build lane - all fields available from API
    const lane = {
      sourceChainSelector: BigInt(raw.sourceNetworkInfo.chainSelector),
      destChainSelector: BigInt(raw.destNetworkInfo.chainSelector),
      onRamp: raw.onramp,
      version: (raw.version?.replace(/-dev$/, '') ?? CCIPVersion.V1_6) as CCIPVersion,
    }

    // Build message with extraArgs spread and tokenAmounts included
    const message = {
      messageId: raw.messageId,
      sourceChainSelector: lane.sourceChainSelector,
      destChainSelector: lane.destChainSelector,
      sender: raw.sender,
      receiver: raw.receiver,
      data: raw.data ?? '0x',
      sequenceNumber: BigInt(raw.sequenceNumber),
      nonce: raw.nonce ? BigInt(raw.nonce) : 0n,
      feeToken: raw.fees.fixedFeesDetails.tokenAddress,
      feeTokenAmount: BigInt(raw.fees.fixedFeesDetails.totalAmount),
      tokenAmounts: transformTokenAmounts(raw.tokenAmounts),
      ...transformExtraArgs(raw.extraArgs),
    }

    // Build log and address - only transactionHash and address are available from API
    // (topics, index, blockNumber, data not available)
    const log = {
      transactionHash: raw.sendTransactionHash,
      address: raw.onramp,
    }

    // Build partial tx - only hash, timestamp, from are available from API
    // (blockNumber, logs not available)
    const tx = {
      hash: raw.sendTransactionHash,
      timestamp: sendTimestamp,
      from: raw.origin,
    }

    // Note: We use type assertions for partial nested objects since Partial<CCIPRequest>
    // requires complete types when provided. These are intentionally partial.
    return {
      // CCIPRequest fields (Partial) - cast partial objects
      lane,
      message: message as unknown as APICCIPRequest['message'],
      log: log as APICCIPRequest['log'],
      tx: tx as APICCIPRequest['tx'],
      // API-specific fields
      status: raw.status as MessageStatus,
      readyForManualExecution: raw.readyForManualExecution,
      finality: raw.finality,
      receiptTransactionHash: raw.receiptTransactionHash ?? undefined,
      receiptTimestamp,
      deliveryTime: raw.deliveryTime ?? undefined,
      sourceNetworkInfo: networkInfo(BigInt(raw.sourceNetworkInfo.chainSelector)),
      destNetworkInfo: networkInfo(BigInt(raw.destNetworkInfo.chainSelector)),
    }
  }
}

/**
 * Type guard to distinguish SVM extra args from EVM extra args.
 * @param args - Raw extra args from API response
 * @returns true if args is RawSVMExtraArgs
 */
function isRawSVMExtraArgs(args: RawEVMExtraArgs | RawSVMExtraArgs): args is RawSVMExtraArgs {
  return 'computeUnits' in args
}

/**
 * Transforms raw API extra args to SDK extra args types.
 * @param raw - Raw extra args from API response
 * @returns EVMExtraArgsV2 or SVMExtraArgsV1
 */
function transformExtraArgs(
  raw: RawEVMExtraArgs | RawSVMExtraArgs,
): EVMExtraArgsV2 | SVMExtraArgsV1 {
  if (isRawSVMExtraArgs(raw)) {
    return {
      computeUnits: BigInt(raw.computeUnits),
      accountIsWritableBitmap: BigInt(raw.accountIsWritableBitmap),
      allowOutOfOrderExecution: raw.allowOutOfOrderExecution,
      tokenReceiver: raw.tokenReceiver,
      accounts: raw.accounts,
    }
  }
  return {
    gasLimit: BigInt(raw.gasLimit),
    allowOutOfOrderExecution: raw.allowOutOfOrderExecution,
  }
}

/**
 * Transforms raw API token amounts to SDK token amounts format.
 * @param raw - Raw token amounts from API response
 * @returns Array of token amounts with bigint amounts and SourceTokenData fields
 */
function transformTokenAmounts(raw: RawTokenAmount[]): {
  token: string
  amount: bigint
  sourcePoolAddress: string
  destTokenAddress: string
  extraData: string
  destGasAmount: bigint
}[] {
  return raw.map((ta) => ({
    token: ta.sourceTokenAddress,
    amount: BigInt(ta.amount),
    sourcePoolAddress: ta.sourcePoolAddress,
    destTokenAddress: ta.destTokenAddress,
    extraData: ta.extraData ?? '0x',
    destGasAmount: ta.destGasAmount ? BigInt(ta.destGasAmount) : 0n,
  }))
}
