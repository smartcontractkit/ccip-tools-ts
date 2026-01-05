import type { CCIPRequest, MessageStatus } from '../types.ts'

/**
 * Response from GET /v1/lanes/latency endpoint.
 * Returns only the latency value - caller already knows source/dest chains.
 */
export type LaneLatencyResponse = {
  /** Estimated delivery time in milliseconds */
  totalMs: number
}

/** Raw API response (string selectors, before conversion) */
export type RawLaneLatencyResponse = {
  lane: {
    sourceNetworkInfo: {
      name: string
      chainSelector: string
      chainId: string
      chainFamily: string
    }
    destNetworkInfo: {
      name: string
      chainSelector: string
      chainId: string
      chainFamily: string
    }
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
// GET /v1/messages/{messageId} types
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
  tokenAddress: string
  amount: string
}

/** EVM extra args from API (GenericExtraArgsV2) */
export type RawEVMExtraArgs = {
  gasLimit: string
  allowOutOfOrderExecution: boolean
}

/** SVM extra args from API (SVMExtraArgsV1) */
export type RawSVMExtraArgs = {
  computeUnits: number
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

/** Fees from API response */
export type RawFees = {
  tokenAddress?: string
  totalAmount?: string
  fixedFeesDetails?: RawFixedFee[]
}

/** Raw API response from GET /v1/messages/:messageId */
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
  finality: number
  fees: RawFees
  // Optional fields
  origin?: string | null
  nonce?: string | null
  sequenceNumber?: string
  onramp?: string
  routerAddress?: string | null
  version?: string | null
  receiptTransactionHash?: string | null
  receiptTimestamp?: string | null
  deliveryTime?: number | null
  data?: string | null
}

// ============================================================================
// APICCIPRequest type - derived from CCIPRequest
// ============================================================================

/**
 * CCIP request information retrieved from API.
 * Based on Partial<CCIPRequest> with additional API-specific fields.
 *
 * Fields populated from API:
 * - lane: sourceChainSelector, destChainSelector, onRamp, version (all available)
 * - message: messageId, sender, receiver, data, sequenceNumber, nonce, tokenAmounts,
 *   plus extraArgs fields (gasLimit, allowOutOfOrderExecution for EVM; SVM fields for Solana)
 * - log: transactionHash, address (partial - topics, index, blockNumber not available)
 * - tx: hash, timestamp, from (partial - logs, blockNumber not available)
 *
 * Additional API-specific fields not in CCIPRequest:
 * - status, readyForManualExecution, receiptTransactionHash, receiptTimestamp, etc.
 */
export type APICCIPRequest = Partial<CCIPRequest> & {
  /** Message lifecycle status from API */
  status: MessageStatus
  /** Whether message is ready for manual execution */
  readyForManualExecution: boolean
  /** Finality block confirmations */
  finality: number
  /** Receipt transaction hash if executed */
  receiptTransactionHash?: string
  /** Receipt timestamp (Unix) if executed */
  receiptTimestamp?: number
  /** End-to-end delivery time in ms if completed */
  deliveryTime?: number
  /** Source network info from API */
  sourceNetworkInfo: {
    name: string
    chainSelector: bigint
    chainId: string
    chainFamily: string
  }
  /** Destination network info from API */
  destNetworkInfo: {
    name: string
    chainSelector: bigint
    chainId: string
    chainFamily: string
  }
}
