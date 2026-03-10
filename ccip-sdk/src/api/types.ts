import type { MessageStatus, NetworkInfo } from '../types.ts'

/**
 * Response from GET /v2/lanes/latency endpoint.
 * Returns only the latency value - caller already knows source/dest chains.
 */
export type LaneLatencyResponse = {
  /** Estimated delivery time in milliseconds */
  totalMs: number
}

/** Raw API response (string selectors, before conversion) */
export type RawLaneLatencyResponse = {
  lane: {
    sourceNetworkInfo: RawNetworkInfo
    destNetworkInfo: RawNetworkInfo
    routerAddress: string
  }
  totalMs: number
}

/**
 * API error response structure from CCIP API.
 * Returned when API requests fail with 4xx/5xx status codes.
 */
export type APIErrorResponse = {
  /** Machine-readable error code (e.g., "LANE_NOT_FOUND", "INVALID_PARAMETERS") */
  error: string
  /** Human-readable error message with details */
  message: string
}

// ============================================================================
// GET /v2/messages/{messageId} types
// ============================================================================

/** Network info from API response */
export type RawNetworkInfo = {
  name: string
  chainSelector: string
  chainId: string
  chainFamily: string
}

/** Token amount from API response */
export type RawTokenAmount = {
  sourceTokenAddress: string
  destTokenAddress: string
  sourcePoolAddress: string
  amount: string
  extraData?: string | null
  destGasAmount?: string | null
}

/** EVM extra args from API (GenericExtraArgsV2) */
export type RawEVMExtraArgs = {
  gasLimit: string
  allowOutOfOrderExecution: boolean
}

/** SVM extra args from API (SVMExtraArgsV1) */
export type RawSVMExtraArgs = {
  computeUnits: bigint
  accountIsWritableBitmap: string
  allowOutOfOrderExecution: boolean
  tokenReceiver: string
  accounts: string[]
}

/** Fixed fee detail from API */
export type RawFixedFee = {
  contractAddress: string
  feeType: string
  amount: string
}

/** Fixed fees details wrapper from API response */
export type RawFixedFeesDetails = {
  tokenAddress: string
  totalAmount: string
  items?: RawFixedFee[]
}

/** Fees from API response */
export type RawFees = {
  fixedFeesDetails: RawFixedFeesDetails
}

/** Raw API response from GET /v2/messages/:messageId */
export type RawMessageResponse = {
  messageId: string
  sender: string
  receiver: string
  status: string
  sourceNetworkInfo: RawNetworkInfo
  destNetworkInfo: RawNetworkInfo
  sendTransactionHash: string
  sendTimestamp: string
  tokenAmounts: RawTokenAmount[]
  extraArgs: RawEVMExtraArgs | RawSVMExtraArgs
  readyForManualExecution: boolean
  finality: bigint
  fees: RawFees
  // Required fields (as of schema v2.0.0)
  origin: string
  sequenceNumber: string
  onramp: string
  sendBlockNumber: bigint
  sendLogIndex: bigint
  // Optional fields
  nonce?: string | null
  routerAddress?: string | null
  version?: string | null
  receiptTransactionHash?: string
  receiptTimestamp?: string
  deliveryTime?: bigint
  data?: string | null
}

// ============================================================================
// GET /v2/messages search endpoint types
// ============================================================================

/** Message search result from /v2/messages search endpoint */
export type RawMessageSearchResult = {
  messageId: string
  origin: string
  sender: string
  receiver: string
  status: string
  sourceNetworkInfo: RawNetworkInfo
  destNetworkInfo: RawNetworkInfo
  sendTransactionHash: string
  sendTimestamp: string
}

/** Paginated response from /v2/messages search endpoint */
export type RawMessagesResponse = {
  data: RawMessageSearchResult[]
  pagination: {
    limit: number
    hasNextPage: boolean
    cursor?: string | null
  }
}

// ============================================================================
// searchMessages public types
// ============================================================================

/**
 * Filters for searching CCIP messages via the API.
 *
 * All fields are optional — omit a field to leave it unfiltered.
 * Chain selectors are accepted as `bigint` and converted to strings for the API.
 *
 * @see {@link CCIPAPIClient.searchMessages}
 *
 * @example
 * ```typescript
 * const api = CCIPAPIClient.fromUrl()
 * // Find messages from a specific sender on a specific lane
 * const page = await api.searchMessages({
 *   sender: '0x9d087fC03ae39b088326b67fA3C788236645b717',
 *   sourceChainSelector: 16015286601757825753n,
 *   destChainSelector: 14767482510784806043n,
 * })
 * ```
 */
export type MessageSearchFilters = {
  /** Filter by sender address */
  sender?: string
  /** Filter by receiver address */
  receiver?: string
  /** Filter by source chain selector */
  sourceChainSelector?: bigint
  /** Filter by destination chain selector */
  destChainSelector?: bigint
  /** Filter by source transaction hash */
  sourceTransactionHash?: string
  /** When `true`, return only messages eligible for manual execution (stuck/failed messages) */
  readyForManualExecOnly?: boolean
}

/**
 * A single message search result from the CCIP API.
 *
 * @remarks
 * This is a lightweight summary — it does not include `extraArgs`, `tokenAmounts`,
 * `fees`, or other detailed fields available via {@link CCIPAPIClient.getMessageById}.
 *
 * @see {@link CCIPAPIClient.getMessageById} — to fetch full message details
 * @see {@link CCIPAPIClient.searchMessages}
 *
 * @example
 * ```typescript
 * const page = await api.searchMessages({ sender: '0x...' })
 * for (const msg of page.data) {
 *   console.log(`${msg.messageId}: ${msg.status} (${msg.sourceNetworkInfo.name} → ${msg.destNetworkInfo.name})`)
 * }
 * ```
 */
export type MessageSearchResult = {
  /** Unique CCIP message ID (0x-prefixed, 32-byte hex string) */
  messageId: string
  /** Transaction originator address (EOA that submitted the send transaction) */
  origin: string
  /** Message sender address */
  sender: string
  /** Message receiver address */
  receiver: string
  /** Message lifecycle status */
  status: MessageStatus
  /** Source network metadata */
  sourceNetworkInfo: NetworkInfo
  /** Destination network metadata */
  destNetworkInfo: NetworkInfo
  /** Source chain transaction hash */
  sendTransactionHash: string
  /** ISO 8601 timestamp of the send transaction */
  sendTimestamp: string
}

/**
 * A page of message search results with cursor-based pagination.
 *
 * @remarks
 * When `hasNextPage` is `true`, pass the `cursor` value to
 * {@link CCIPAPIClient.searchMessages} to fetch the next page.
 * The cursor encodes all original filters, so you do not need
 * to re-supply them when paginating.
 *
 * @see {@link MessageSearchFilters}
 * @see {@link CCIPAPIClient.searchMessages}
 * @see {@link CCIPAPIClient.searchAllMessages} — async generator alternative that handles
 *   pagination automatically
 *
 * @example Manual pagination
 * ```typescript
 * let page = await api.searchMessages({ sender: '0x...' }, { limit: 10 })
 * while (page.hasNextPage) {
 *   page = await api.searchMessages(undefined, { cursor: page.cursor! })
 * }
 * ```
 *
 * @example Automatic pagination (preferred for most use cases)
 * ```typescript
 * for await (const msg of api.searchAllMessages({ sender: '0x...' })) {
 *   console.log(msg.messageId)
 * }
 * ```
 */
export type MessageSearchPage = {
  /** Array of message search results */
  data: MessageSearchResult[]
  /** Whether more results are available */
  hasNextPage: boolean
  /** Opaque cursor for fetching the next page */
  cursor?: string
}

// ============================================================================
// APICCIPRequest type - derived from CCIPRequest
// ============================================================================

/**
 * API-specific metadata fields for CCIP requests.
 *
 * @remarks
 * These fields are only available when fetching via the CCIP API.
 * This type is the value of the `metadata` field on {@link CCIPRequest}.
 *
 * @example
 * ```typescript
 * const request = await chain.getMessageById(messageId)
 * if (request.metadata) {
 *   console.log(`Status: ${request.metadata.status}`)
 *   if (request.metadata.receiptTransactionHash) {
 *     console.log(`Executed in tx: ${request.metadata.receiptTransactionHash}`)
 *   }
 * }
 * ```
 */
export type APICCIPRequestMetadata = {
  /** Message lifecycle status from API. */
  status: MessageStatus
  /** Whether message is ready for manual execution. */
  readyForManualExecution: boolean
  /** Transaction hash of execution receipt (if executed). */
  receiptTransactionHash?: string
  /** Unix timestamp of execution receipt (if executed). */
  receiptTimestamp?: number
  /** End-to-end delivery time in milliseconds (if completed). */
  deliveryTime?: bigint
  /** Source network metadata. */
  sourceNetworkInfo: NetworkInfo
  /** Destination network metadata. */
  destNetworkInfo: NetworkInfo
}

// ============================================================================
// GET /v2/messages/${messageId}/execution-inputs search endpoint types
// ============================================================================

/**
 * Raw API response from GET /v2/messages/:messageId/execution-inputs.
 *
 * @remarks
 * The response has two union branches:
 * - **v2.0+**: contains `encodedMessage` (MessageV1Codec-serialized), optional `ccvData` array, and `verifierAddresses`
 * - **pre-v2**: contains `messageBatch` array with decoded messages, `merkleRoot`, and optional USDC/LBTC attestation data
 */
export type RawExecutionInputsResult = {
  offramp: string
} & (
  | {
      onramp: string
      sourceChainSelector: bigint
      destChainSelector: bigint
      version: string
    }
  | object
) &
  (
    | {
        merkleRoot?: string
        messageBatch: {
          [key: string]: unknown
          messageId: string
          tokenAmounts: { token: string; amount: string }[]
          usdcData?: {
            status: 'pending_confirmations' | 'complete'
            attestation?: string
            message_bytes_hex?: string
          }
          lbtcData?: {
            status: 'NOTARIZATION_STATUS_SESSION_APPROVED' | 'NOTARIZATION_STATUS_SESSION_PENDING'
            attestation?: string
            message_hash?: string
          }
        }[]
      }
    | {
        encodedMessage: string
        verificationComplete?: boolean
        ccvData?: string[]
        verifierAddresses: string[]
      }
  )
