import {
  CCIPHttpError,
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
} from '../errors/index.ts'
import type { EVMExtraArgsV2, SVMExtraArgsV1 } from '../extra-args.ts'
import { HttpStatus } from '../http-status.ts'
import { type Logger, type MessageStatus, type WithLogger, CCIPVersion } from '../types.ts'
import type {
  APICCIPRequest,
  APIErrorResponse,
  LaneLatencyResponse,
  RawEVMExtraArgs,
  RawLaneLatencyResponse,
  RawMessageResponse,
  RawSVMExtraArgs,
  RawTokenAmount,
} from './types.ts'

export type { APICCIPRequest, APIErrorResponse, LaneLatencyResponse } from './types.ts'

/**
 * Parses API version string to CCIPVersion enum.
 * @param version - Version string like "1.5.0", "1.6.0"
 * @returns CCIPVersion if recognized, undefined otherwise
 */
function parseVersion(version: string | null | undefined): CCIPVersion | undefined {
  if (!version) return undefined
  switch (version) {
    case '1.2.0':
      return CCIPVersion.V1_2
    case '1.5.0':
      return CCIPVersion.V1_5
    case '1.6.0':
      return CCIPVersion.V1_6
    default:
      return undefined
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
 * @returns Array of token amounts with bigint amounts
 */
function transformTokenAmounts(raw: RawTokenAmount[]): { token: string; amount: bigint }[] {
  return raw.map((ta) => ({
    token: ta.tokenAddress,
    amount: BigInt(ta.amount),
  }))
}

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
  static fromUrl(baseUrl?: string, ctx?: CCIPAPIClientContext): Promise<CCIPAPIClient> {
    return Promise.resolve(new CCIPAPIClient(baseUrl, ctx))
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

    this.logger.debug(`CCIPAPIClient: GET ${url.toString()}`)

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
    this.logger.debug('getLaneLatency raw response:', raw)

    return { totalMs: raw.totalMs }
  }

  /**
   * Fetches a CCIP message by its unique message ID.
   *
   * @param messageId - The message ID (64-character hex string with 0x prefix)
   * @returns Promise resolving to {@link APICCIPRequest} with message details
   *
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
    const url = `${this.baseUrl}/v1/messages/${encodeURIComponent(messageId)}`

    this.logger.debug(`CCIPAPIClient: GET ${url}`)

    const response = await this._fetch(url)

    if (!response.ok) {
      // Try to parse structured error response from API
      let apiError: APIErrorResponse | undefined
      try {
        apiError = (await response.json()) as APIErrorResponse
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

    const raw = (await response.json()) as RawMessageResponse

    this.logger.debug('getMessageById raw response:', raw)

    return this._transformMessageResponse(raw)
  }

  /**
   * Transforms raw API response to APICCIPRequest.
   * Populates all derivable CCIPRequest fields from API data.
   * @internal
   */
  private _transformMessageResponse(raw: RawMessageResponse): APICCIPRequest {
    const sendTimestamp = Math.floor(new Date(raw.sendTimestamp).getTime() / 1000)
    const receiptTimestamp = raw.receiptTimestamp
      ? Math.floor(new Date(raw.receiptTimestamp).getTime() / 1000)
      : undefined

    // Build lane - all fields available from API 
    const lane = {
      sourceChainSelector: BigInt(raw.sourceNetworkInfo.chainSelector),
      destChainSelector: BigInt(raw.destNetworkInfo.chainSelector),
      onRamp: raw.onramp ?? '',
      version: parseVersion(raw.version) ?? CCIPVersion.V1_6,
    }

    // Build message with extraArgs spread and tokenAmounts included
    const message = {
      messageId: raw.messageId,
      sender: raw.sender,
      receiver: raw.receiver,
      data: raw.data ?? '0x',
      sequenceNumber: raw.sequenceNumber ? BigInt(raw.sequenceNumber) : 0n,
      nonce: raw.nonce ? BigInt(raw.nonce) : 0n,
      feeToken: raw.fees?.tokenAddress ?? '',
      feeTokenAmount: raw.fees?.totalAmount ? BigInt(raw.fees.totalAmount) : 0n,
      tokenAmounts: transformTokenAmounts(raw.tokenAmounts),
      ...transformExtraArgs(raw.extraArgs),
    }

    // Build log and address - only transactionHash and address are available from API
    // (topics, index, blockNumber, data not available)
    const log = {
      transactionHash: raw.sendTransactionHash,
      address: raw.onramp ?? '',
    }

    // Build partial tx - only hash, timestamp, from are available from API
    // (blockNumber, logs not available)
    const tx = {
      hash: raw.sendTransactionHash,
      timestamp: sendTimestamp,
      from: raw.origin ?? '',
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
      sourceNetworkInfo: {
        name: raw.sourceNetworkInfo.name,
        chainSelector: BigInt(raw.sourceNetworkInfo.chainSelector),
        chainId: raw.sourceNetworkInfo.chainId,
        chainFamily: raw.sourceNetworkInfo.chainFamily,
      },
      destNetworkInfo: {
        name: raw.destNetworkInfo.name,
        chainSelector: BigInt(raw.destNetworkInfo.chainSelector),
        chainId: raw.destNetworkInfo.chainId,
        chainFamily: raw.destNetworkInfo.chainFamily,
      },
    }
  }
}
