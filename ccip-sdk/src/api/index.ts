import { memoize } from 'micro-memoize'
import type { SetRequired } from 'type-fest'

import {
  CCIPApiClientNotAvailableError,
  CCIPHttpError,
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageNotFoundInTxError,
  CCIPUnexpectedPaginationError,
} from '../errors/index.ts'
import { HttpStatus } from '../http-status.ts'
import { decodeMessageV1 } from '../messages.ts'
import { decodeMessage } from '../requests.ts'
import {
  type CCIPMessage,
  type CCIPRequest,
  type ChainLog,
  type ExecutionInput,
  type Lane,
  type Logger,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  CCIPVersion,
  ChainFamily,
  MessageStatus,
  NetworkType,
} from '../types.ts'
import { bigIntReviver, decodeAddress, fetchWithTimeout, parseJson } from '../utils.ts'
import type {
  APIErrorResponse,
  LaneLatencyResponse,
  MessageSearchFilters,
  MessageSearchPage,
  MessageSearchResult,
  RawExecutionInputsResult,
  RawLaneLatencyResponse,
  RawMessageResponse,
  RawMessagesResponse,
  RawNetworkInfo,
} from './types.ts'
import { calculateManualExecProof } from '../execution.ts'

export type {
  APICCIPRequestMetadata,
  APIErrorResponse,
  LaneLatencyResponse,
  MessageSearchFilters,
  MessageSearchPage,
  MessageSearchResult,
} from './types.ts'

/** Default CCIP API base URL */
export const DEFAULT_API_BASE_URL = 'https://api.ccip.chain.link'

/** Default timeout for API requests in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30000

/** SDK version string for telemetry header */
// generate:nofail
// `export const SDK_VERSION = '${require('./package.json').version}-${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}'`
export const SDK_VERSION = '1.5.0-afb7d5f'
// generate:end

/** SDK telemetry header name */
export const SDK_VERSION_HEADER = 'X-SDK-Version'

/**
 * Context for CCIPAPIClient initialization.
 */
export type CCIPAPIClientContext = WithLogger & {
  /** Custom fetch function (defaults to globalThis.fetch) */
  fetch?: typeof fetch
  /** Request timeout in milliseconds (defaults to 30000ms) */
  timeoutMs?: number
}

const validateChainFamily = (value: string, logger: Logger): ChainFamily => {
  const validFamilies = Object.values(ChainFamily) as string[]
  if (validFamilies.includes(value)) {
    return value as ChainFamily
  }
  logger.warn(`Unexpected chainFamily value from API: "${value}", using UNKNOWN`)
  return ChainFamily.Unknown
}

const validateMessageStatus = (value: string, logger: Logger): MessageStatus => {
  const validStatuses = Object.values(MessageStatus) as string[]
  if (validStatuses.includes(value)) {
    return value as MessageStatus
  }
  logger.warn(`Unexpected message status from API: "${value}", using UNKNOWN`)
  return MessageStatus.Unknown
}

const ensureNetworkInfo = (o: RawNetworkInfo, logger: Logger): NetworkInfo => {
  return Object.assign(o, {
    chainSelector: BigInt(o.chainSelector),
    networkType: o.name.includes('-mainnet') ? NetworkType.Mainnet : NetworkType.Testnet,
    ...(!('family' in o) && { family: validateChainFamily(o.chainFamily, logger) }),
  }) as unknown as NetworkInfo
}

/**
 * Client for interacting with the CCIP REST API.
 *
 * Can be used standalone or injected into Chain classes.
 *
 * @example Standalone usage
 * ```typescript
 * const api = CCIPAPIClient.fromUrl()
 * const latency = await api.getLaneLatency(sourceSelector, destSelector)
 * console.log(`Latency: ${latency.totalMs}ms`)
 * ```
 *
 * @example With custom options
 * ```typescript
 * const api = CCIPAPIClient.fromUrl('https://custom.api.url', {
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

  static {
    CCIPAPIClient.fromUrl = memoize(
      (baseUrl?: string, ctx?: CCIPAPIClientContext) => new CCIPAPIClient(baseUrl, ctx),
      { maxArgs: 1, transformKey: ([baseUrl]) => [baseUrl ?? DEFAULT_API_BASE_URL] },
    )
  }

  /**
   * Creates a new CCIPAPIClient instance.
   * @param baseUrl - Base URL for the CCIP API (defaults to {@link DEFAULT_API_BASE_URL})
   * @param ctx - Optional context with logger and custom fetch
   */
  constructor(baseUrl?: string, ctx?: CCIPAPIClientContext) {
    if (typeof baseUrl === 'boolean' || (baseUrl as unknown) === null)
      throw new CCIPApiClientNotAvailableError({ context: { baseUrl } }) // shouldn't happen
    this.baseUrl = baseUrl ?? DEFAULT_API_BASE_URL
    this.logger = ctx?.logger ?? console
    this.timeoutMs = ctx?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this._fetch = ctx?.fetch ?? globalThis.fetch.bind(globalThis)

    this.getMessageById = memoize(this.getMessageById.bind(this), {
      async: true,
      expires: 4_000,
      maxArgs: 1,
      maxSize: 100,
    })

    this.getExecutionInput = memoize(this.getExecutionInput.bind(this), {
      async: true,
      expires: 4_000,
      maxArgs: 1,
      maxSize: 100,
    })
  }

  /**
   * Factory method for creating memoized CCIPAPIClient.
   * Should be preferred over constructor, to avoid multiple fetch/retry/rate-limits instances,
   * unless that's specifically required.
   * @param baseUrl - Base URL for the CCIP API
   * @param ctx - Optional context
   * @returns New CCIPAPIClient instance
   */
  static fromUrl(baseUrl?: string, ctx?: CCIPAPIClientContext): CCIPAPIClient {
    return new CCIPAPIClient(baseUrl, ctx)
  }

  /**
   * Performs a fetch request with timeout protection.
   * @param url - URL to fetch
   * @param operation - Operation name for error context
   * @returns Promise resolving to Response
   * @throws CCIPTimeoutError if request times out
   * @internal
   */
  private async _fetchWithTimeout(
    url: string,
    operation: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetchWithTimeout(url, operation, {
      timeoutMs: this.timeoutMs,
      signal,
      fetch: this._fetch,
      init: {
        headers: {
          'Content-Type': 'application/json',
          [SDK_VERSION_HEADER]: `CCIP SDK v${SDK_VERSION}`,
        },
      },
    })
  }

  /**
   * Fetches estimated lane latency between source and destination chains.
   *
   * @param sourceChainSelector - Source chain selector (bigint)
   * @param destChainSelector - Destination chain selector (bigint)
   * @param numberOfBlocks - Optional number of block confirmations for latency calculation.
   *   When omitted or 0, uses the lane's default finality. When provided as a positive
   *   integer, the API returns latency for that custom finality value (sent as `numOfBlocks`
   *   query parameter).
   * @param options - Optional request options.
   *   - `signal` — an `AbortSignal` to cancel the request.
   * @returns Promise resolving to {@link LaneLatencyResponse} with totalMs
   *
   * @throws {@link CCIPLaneNotFoundError} when lane not found (404)
   * @throws {@link CCIPTimeoutError} if request times out
   * @throws {@link CCIPAbortError} if request is aborted via signal
   * @throws {@link CCIPHttpError} on other HTTP errors with context:
   *   - `status` - HTTP status code (e.g., 500)
   *   - `statusText` - HTTP status message
   *   - `apiErrorCode` - API error code (e.g., "INVALID_PARAMETERS")
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
   * @example Custom block confirmations
   * ```typescript
   * const latency = await api.getLaneLatency(
   *   5009297550715157269n,  // Ethereum mainnet
   *   4949039107694359620n,  // Arbitrum mainnet
   *   10,                    // 10 block confirmations
   * )
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
    numberOfBlocks?: number,
    options?: { signal?: AbortSignal },
  ): Promise<LaneLatencyResponse> {
    const url = new URL(`${this.baseUrl}/v2/lanes/latency`)
    url.searchParams.set('sourceChainSelector', sourceChainSelector.toString())
    url.searchParams.set('destChainSelector', destChainSelector.toString())
    if (numberOfBlocks) {
      url.searchParams.set('numOfBlocks', numberOfBlocks.toString())
    }

    this.logger.debug(`CCIPAPIClient: GET ${url.toString()}`)

    const response = await this._fetchWithTimeout(url.toString(), 'getLaneLatency', options?.signal)

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

    const raw = JSON.parse(await response.text(), bigIntReviver) as RawLaneLatencyResponse

    // Log full raw response for debugging
    this.logger.debug('getLaneLatency raw response:', raw)

    return { totalMs: raw.totalMs }
  }

  /**
   * Fetches a CCIP message by its unique message ID.
   *
   * @param messageId - The message ID (0x prefix + 64 hex characters, e.g., "0x1234...abcd")
   * @param options - Optional request options.
   *   - `signal` — an `AbortSignal` to cancel the request.
   * @returns Promise resolving to {@link APICCIPRequest} with message details
   *
   * @throws {@link CCIPMessageIdNotFoundError} when message not found (404)
   * @throws {@link CCIPTimeoutError} if request times out
   * @throws {@link CCIPAbortError} if request is aborted via signal
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
   * console.log(`Status: ${request.metadata.status}`)
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
  async getMessageById(
    messageId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SetRequired<CCIPRequest, 'metadata'>> {
    const url = `${this.baseUrl}/v2/messages/${encodeURIComponent(messageId)}`

    this.logger.debug(`CCIPAPIClient: GET ${url}`)

    const response = await this._fetchWithTimeout(url, 'getMessageById', options?.signal)

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

    const raw = await response.text()
    this.logger.debug('getMessageById raw response:', raw)
    return this._transformMessageResponse(raw)
  }

  /**
   * Searches CCIP messages using filters with cursor-based pagination.
   *
   * @param filters - Optional search filters. Ignored when `options.cursor` is provided
   *   (the cursor already encodes the original filters).
   * @param options - Optional pagination and request options:
   *   - `limit` — max results per page.
   *   - `cursor` — opaque token from a previous {@link MessageSearchPage} for the next page.
   *   - `signal` — an `AbortSignal` to cancel the request.
   * @returns Promise resolving to a {@link MessageSearchPage} with results and pagination info.
   *
   * @remarks
   * A 404 response is treated as "no results found" and returns an empty page,
   * unlike {@link CCIPAPIClient.getMessageById} which throws on 404.
   * When paginating with a cursor, the `filters` parameter is ignored because
   * the cursor encodes the original filters.
   *
   * @throws {@link CCIPTimeoutError} if request times out.
   * @throws {@link CCIPAbortError} if request is aborted via signal.
   * @throws {@link CCIPHttpError} on HTTP errors (4xx/5xx, except 404 which returns empty).
   *
   * @see {@link MessageSearchFilters} — available filter fields
   * @see {@link MessageSearchPage} — return type with pagination
   * @see {@link CCIPAPIClient.searchAllMessages} — async generator that handles pagination automatically
   * @see {@link CCIPAPIClient.getMessageById} — fetch full message details for a search result
   * @see {@link CCIPAPIClient.getMessageIdsInTx} — convenience wrapper using `sourceTransactionHash`
   *
   * @example Search by sender
   * ```typescript
   * const page = await api.searchMessages({
   *   sender: '0x9d087fC03ae39b088326b67fA3C788236645b717',
   * })
   * for (const msg of page.data) {
   *   console.log(`${msg.messageId}: ${msg.status}`)
   * }
   * ```
   *
   * @example Paginate through all results
   * ```typescript
   * let page = await api.searchMessages({ sender: '0x...' }, { limit: 10 })
   * const all = [...page.data]
   * while (page.hasNextPage) {
   *   page = await api.searchMessages(undefined, { cursor: page.cursor! })
   *   all.push(...page.data)
   * }
   * ```
   *
   * @example Filter by lane and sender
   * ```typescript
   * const page = await api.searchMessages({
   *   sender: '0x9d087fC03ae39b088326b67fA3C788236645b717',
   *   sourceChainSelector: 16015286601757825753n,
   *   destChainSelector: 14767482510784806043n,
   * })
   * ```
   */
  async searchMessages(
    filters?: MessageSearchFilters,
    options?: { limit?: number; cursor?: string; signal?: AbortSignal },
  ): Promise<MessageSearchPage> {
    const url = new URL(`${this.baseUrl}/v2/messages`)

    if (options?.cursor) {
      // Cursor encodes all original filters — only send cursor (and optional limit)
      url.searchParams.set('cursor', options.cursor)
    } else if (filters) {
      if (filters.sender) url.searchParams.set('sender', filters.sender)
      if (filters.receiver) url.searchParams.set('receiver', filters.receiver)
      if (filters.sourceChainSelector != null)
        url.searchParams.set('sourceChainSelector', filters.sourceChainSelector.toString())
      if (filters.destChainSelector != null)
        url.searchParams.set('destChainSelector', filters.destChainSelector.toString())
      if (filters.sourceTransactionHash)
        url.searchParams.set('sourceTransactionHash', filters.sourceTransactionHash)
      if (filters.sourceTokenAddress)
        url.searchParams.set('sourceTokenAddress', filters.sourceTokenAddress)
      if (filters.readyForManualExecOnly != null)
        url.searchParams.set('readyForManualExecOnly', String(filters.readyForManualExecOnly))
    }

    if (options?.limit != null) url.searchParams.set('limit', options.limit.toString())

    this.logger.debug(`CCIPAPIClient: GET ${url.toString()}`)

    const response = await this._fetchWithTimeout(url.toString(), 'searchMessages', options?.signal)

    if (!response.ok) {
      // 404 → empty results (search found nothing)
      if (response.status === HttpStatus.NOT_FOUND) {
        return { data: [], hasNextPage: false }
      }

      let apiError: APIErrorResponse | undefined
      try {
        apiError = parseJson<APIErrorResponse>(await response.text())
      } catch {
        // Response body not JSON
      }

      throw new CCIPHttpError(response.status, response.statusText, {
        context: apiError
          ? { apiErrorCode: apiError.error, apiErrorMessage: apiError.message }
          : undefined,
      })
    }

    const raw = parseJson<RawMessagesResponse>(await response.text())

    this.logger.debug('searchMessages raw response:', raw)

    return {
      data: raw.data.map((msg) => {
        const sourceInfo = ensureNetworkInfo(msg.sourceNetworkInfo, this.logger)
        const destInfo = ensureNetworkInfo(msg.destNetworkInfo, this.logger)
        return {
          ...msg,
          status: validateMessageStatus(msg.status, this.logger),
          sourceNetworkInfo: sourceInfo,
          destNetworkInfo: destInfo,
          sender: decodeAddress(msg.sender, sourceInfo.family),
          receiver: decodeAddress(msg.receiver, destInfo.family),
          origin: decodeAddress(msg.origin, sourceInfo.family),
        }
      }),
      hasNextPage: raw.pagination.hasNextPage,
      cursor: raw.pagination.cursor ?? undefined,
    }
  }

  /**
   * Async generator that streams all messages matching the given filters,
   * handling cursor-based pagination automatically.
   *
   * @param filters - Optional search filters (same as {@link CCIPAPIClient.searchMessages}).
   * @param options - Optional request options:
   *   - `limit` — per-page fetch size (number of results fetched per API call). The total
   *     number of results is controlled by the consumer — break out of the loop to stop early.
   *   - `signal` — an `AbortSignal` that, when aborted, cancels the next page fetch.
   * @returns AsyncGenerator yielding {@link MessageSearchResult} one at a time, across all pages.
   *
   * @throws {@link CCIPTimeoutError} if a page request times out.
   * @throws {@link CCIPAbortError} if a page request is aborted via signal.
   * @throws {@link CCIPHttpError} on HTTP errors (4xx/5xx, except 404 which yields nothing).
   *
   * @see {@link CCIPAPIClient.searchMessages} — for page-level control and explicit cursor handling
   * @see {@link CCIPAPIClient.getMessageById} — fetch full message details for a search result
   *
   * @example Iterate all messages for a sender
   * ```typescript
   * for await (const msg of api.searchAllMessages({ sender: '0x...' })) {
   *   console.log(`${msg.messageId}: ${msg.status}`)
   * }
   * ```
   *
   * @example Stop after collecting 5 results
   * ```typescript
   * const results: MessageSearchResult[] = []
   * for await (const msg of api.searchAllMessages({ sender: '0x...' })) {
   *   results.push(msg)
   *   if (results.length >= 5) break
   * }
   * ```
   */
  async *searchAllMessages(
    filters?: MessageSearchFilters,
    options?: { limit?: number; signal?: AbortSignal },
  ): AsyncGenerator<MessageSearchResult> {
    let cursor: string | undefined
    do {
      const page = await this.searchMessages(filters, {
        limit: options?.limit,
        cursor,
        signal: options?.signal,
      })
      yield* page.data
      cursor = page.cursor
    } while (cursor)
  }

  /**
   * Fetches message IDs from a source transaction hash.
   *
   * @remarks
   * Uses {@link CCIPAPIClient.searchMessages} internally with `sourceTransactionHash` filter and `limit: 100`.
   *
   * @param txHash - Source transaction hash.
   * @param options - Optional request options.
   *   - `signal` — an `AbortSignal` to cancel the request.
   * @returns Promise resolving to array of message IDs.
   *
   * @throws {@link CCIPMessageNotFoundInTxError} when no messages found (404 or empty).
   * @throws {@link CCIPUnexpectedPaginationError} when hasNextPage is true.
   * @throws {@link CCIPTimeoutError} if request times out.
   * @throws {@link CCIPAbortError} if request is aborted via signal.
   * @throws {@link CCIPHttpError} on HTTP errors.
   *
   * @example Basic usage
   * ```typescript
   * const messageIds = await api.getMessageIdsInTx(
   *   '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
   * )
   * console.log(`Found ${messageIds.length} messages`)
   * ```
   *
   * @example Fetch full details for each message
   * ```typescript
   * const api = CCIPAPIClient.fromUrl()
   * const messageIds = await api.getMessageIdsInTx(txHash)
   * for (const id of messageIds) {
   *   const request = await api.getMessageById(id)
   *   console.log(`${id}: ${request.metadata.status}`)
   * }
   * ```
   */
  async getMessageIdsInTx(txHash: string, options?: { signal?: AbortSignal }): Promise<string[]> {
    const result = await this.searchMessages(
      { sourceTransactionHash: txHash },
      { limit: 100, signal: options?.signal },
    )

    if (result.data.length === 0) {
      throw new CCIPMessageNotFoundInTxError(txHash)
    }

    if (result.hasNextPage) {
      throw new CCIPUnexpectedPaginationError(txHash, result.data.length)
    }

    return result.data.map((msg) => msg.messageId)
  }

  /**
   * Fetches the execution input for a given message by id.
   * For v2.0 messages, returns `{ encodedMessage, verifications }`.
   * For pre-v2 messages, returns `{ message, offchainTokenData, proofs, ... }` with merkle proof.
   *
   * @param messageId - The CCIP message ID (32-byte hex string)
   * @param options - Optional request options.
   *   - `signal` — an `AbortSignal` to cancel the request.
   * @returns Execution input with offRamp address and lane info
   *
   * @throws {@link CCIPMessageIdNotFoundError} when message not found (404)
   * @throws {@link CCIPTimeoutError} if request times out
   * @throws {@link CCIPAbortError} if request is aborted via signal
   * @throws {@link CCIPHttpError} on other HTTP errors
   *
   * @example
   * ```typescript
   * const api = CCIPAPIClient.fromUrl()
   * const execInput = await api.getExecutionInput('0x1234...')
   * // Use with dest.execute():
   * const { offRamp, ...input } = execInput
   * await dest.execute({ offRamp, input, wallet })
   * ```
   */
  async getExecutionInput(
    messageId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ExecutionInput & Lane & { offRamp: string }> {
    const url = `${this.baseUrl}/v2/messages/${encodeURIComponent(messageId)}/execution-inputs`

    this.logger.debug(`CCIPAPIClient: GET ${url}`)

    const response = await this._fetchWithTimeout(url, 'getExecutionInput', options?.signal)
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

    const raw = JSON.parse(await response.text(), bigIntReviver) as RawExecutionInputsResult
    this.logger.debug('getExecutionInput raw response:', raw)

    const offRamp = raw.offramp
    let lane: Lane
    if ('encodedMessage' in raw) {
      // CCIP 2.0 messages use MessageV1Codec, which is chain-independent serialization
      const {
        sourceChainSelector,
        destChainSelector,
        onRampAddress: onRamp,
      } = decodeMessageV1(raw.encodedMessage)
      return {
        sourceChainSelector,
        destChainSelector,
        onRamp,
        offRamp,
        version: CCIPVersion.V2_0,
        encodedMessage: raw.encodedMessage,
        verifications: (raw.ccvData ?? []).map((ccvData, i) => ({
          ccvData,
          destAddress: raw.verifierAddresses[i]!,
        })),
      }
    }

    const messagesInBatch = raw.messageBatch.map(decodeMessage)
    const message = messagesInBatch.find((message) => message.messageId === messageId)!
    if ('onramp' in raw && raw.onramp && raw.version) {
      lane = {
        sourceChainSelector: raw.sourceChainSelector,
        destChainSelector: raw.destChainSelector,
        onRamp: raw.onramp,
        version: raw.version as CCIPVersion,
      }
    } else {
      ;({ lane } = await this.getMessageById(messageId))
    }

    const proof = calculateManualExecProof(messagesInBatch, lane, messageId, raw.merkleRoot, this)

    const rawMessage = raw.messageBatch.find((message) => message.messageId === messageId)!
    const offchainTokenData: OffchainTokenData[] = rawMessage.tokenAmounts.map(() => undefined)
    if (rawMessage.usdcData?.status === 'complete')
      offchainTokenData[0] = {
        _tag: 'usdc',
        message: rawMessage.usdcData.message_bytes_hex!,
        attestation: rawMessage.usdcData.attestation!,
      }
    else if (rawMessage.lbtcData?.status === 'NOTARIZATION_STATUS_SESSION_APPROVED')
      offchainTokenData[0] = {
        _tag: 'lbtc',
        message_hash: rawMessage.lbtcData.message_hash!,
        attestation: rawMessage.lbtcData.attestation!,
      }

    return {
      offRamp,
      ...lane,
      message,
      offchainTokenData,
      ...proof,
    } as ExecutionInput & Lane & { offRamp: string }
  }

  /**
   * Transforms raw API response to CCIPRequest with metadata.
   * Populates all derivable CCIPRequest fields from API data.
   * @internal
   */
  _transformMessageResponse(text: string): SetRequired<CCIPRequest, 'metadata'> {
    // Build message with extraArgs spread and tokenAmounts included
    const raw = decodeMessage(text) as CCIPMessage & Omit<RawMessageResponse, keyof CCIPMessage>

    const {
      sourceNetworkInfo,
      destNetworkInfo,
      status,
      origin,
      onramp,
      offramp,
      version,
      readyForManualExecution,
      sendTransactionHash,
      receiptTransactionHash,
      sendTimestamp,
      receiptTimestamp,
      deliveryTime,
      sendBlockNumber,
      sendLogIndex,
      ...message
    } = raw

    const sendDate = new Date(sendTimestamp)
    const sendTimestamp_ = isNaN(sendDate.getTime()) ? 0 : Math.floor(sendDate.getTime() / 1000)

    const receiptDate = receiptTimestamp && new Date(receiptTimestamp)
    const receiptTimestamp_ =
      receiptDate && !isNaN(receiptDate.getTime())
        ? Math.floor(receiptDate.getTime() / 1000)
        : undefined

    // Build lane - all fields available from API
    const source = ensureNetworkInfo(sourceNetworkInfo, this.logger)
    const dest = ensureNetworkInfo(destNetworkInfo, this.logger)
    const lane = {
      source,
      sourceChainSelector: source.chainSelector,
      dest,
      destChainSelector: dest.chainSelector,
      onRamp: onramp,
      version: (version?.replace(/-dev$/, '') ?? CCIPVersion.V1_6) as CCIPVersion,
    }

    // Build log from API data
    const log: ChainLog = {
      transactionHash: sendTransactionHash,
      address: raw.onramp,
      data: { message: parseJson(text) },
      topics: [lane.version < CCIPVersion.V1_6 ? 'CCIPSendRequested' : 'CCIPMessageSent'],
      index: Number(sendLogIndex),
      blockNumber: Number(sendBlockNumber),
    }

    // Build tx from API data
    const tx = {
      hash: log.transactionHash,
      timestamp: sendTimestamp_,
      from: origin,
      blockNumber: Number(sendBlockNumber),
    }
    log.tx = tx

    // Note: We use type assertions for partial nested objects since Partial<CCIPRequest>
    // requires complete types when provided. These are intentionally partial.
    return {
      // CCIPRequest fields (Partial) - cast partial objects
      lane,
      message,
      log,
      tx,
      // API-specific metadata
      metadata: {
        status: validateMessageStatus(status, this.logger),
        readyForManualExecution,
        receiptTransactionHash,
        receiptTimestamp: receiptTimestamp_,
        deliveryTime,
        sourceNetworkInfo: ensureNetworkInfo(sourceNetworkInfo, this.logger),
        destNetworkInfo: ensureNetworkInfo(destNetworkInfo, this.logger),
        offRamp: offramp,
      },
    }
  }
}
