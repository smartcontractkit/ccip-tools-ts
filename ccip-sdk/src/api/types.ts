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

/** Raw API response from GET /v2/messages/:messageId/execution-inputs */
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
