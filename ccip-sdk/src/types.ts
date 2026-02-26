import type { AbiParametersToPrimitiveTypes, ExtractAbiEvent } from 'abitype'
import type { BytesLike, Log as EVMLog } from 'ethers'
import type { SetOptional } from 'type-fest'

import type { APICCIPRequestMetadata } from './api/types.ts'
import type OffRamp_1_6_ABI from './evm/abi/OffRamp_1_6.ts'
import type { CCIPMessage_EVM, CCIPMessage_V1_6_EVM, CCIPMessage_V2_0 } from './evm/messages.ts'
import type { ExtraArgs } from './extra-args.ts'
import type { CCIPMessage_V1_6_Solana } from './solana/types.ts'
import type { CCIPMessage_V1_6_Sui } from './sui/types.ts'
// v1.6 Base type from EVM contains the intersection of all other CCIPMessage v1.6 types
export type { CCIPMessage_V1_6 } from './evm/messages.ts'

/**
 * Logger interface for logging messages (compatible with console)
 */
export type Logger = {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * An options object which may have a logger
 */
export type WithLogger = {
  logger?: Logger
}

/**
 * "Fix" for deeply intersecting types containing arrays: converts `A[] & B[]` to `(A & B)[]`.
 * Usually, if you intersect `\{ arr: A[] \} & \{ arr: B[] \}`, arr will have type `A[] & B[]`,
 * i.e. all/each *index* of A[] and B[] should be present in the intersection, with quite undefined
 * types of the elements themselves, oftentimes assigning only one of A or B to the element type.
 * This converts deeply to `(A & B)[]`, i.e. each *element* should have all properties of A & B.
 */
export type MergeArrayElements<T, U> = {
  [K in keyof (T & U)]: K extends keyof T & keyof U
    ? T[K] extends unknown[]
      ? U[K] extends unknown[]
        ? (T[K][number] & U[K][number])[] // Intersect element types, both rw: A[] & B[] => (A & B)[]
        : U[K] extends readonly unknown[]
          ? readonly (T[K][number] & U[K][number])[] // Intersect element types, 2nd ro
          : never
      : T[K] extends readonly unknown[]
        ? U[K] extends readonly unknown[]
          ? readonly (T[K][number] & U[K][number])[] // Intersect element types, 1st or both ro
          : never
        : U[K] extends readonly unknown[]
          ? never
          : MergeArrayElements<T[K], U[K]> // Recurse deeper
    : K extends keyof T
      ? T[K]
      : K extends keyof U
        ? U[K]
        : never
}

/**
 * Enumeration of supported blockchain families.
 */
export const ChainFamily = {
  EVM: 'EVM',
  Solana: 'SVM',
  Aptos: 'APTOS',
  Sui: 'SUI',
  TON: 'TON',
  Unknown: 'UNKNOWN',
} as const
/** Type representing one of the supported chain families. */
export type ChainFamily = (typeof ChainFamily)[keyof typeof ChainFamily]

/**
 * Enumeration of network types (mainnet vs testnet).
 */
export const NetworkType = {
  Mainnet: 'MAINNET',
  Testnet: 'TESTNET',
} as const
/** Type representing the network environment type. */
export type NetworkType = (typeof NetworkType)[keyof typeof NetworkType]

/**
 * Enumeration of supported CCIP protocol versions.
 */
export const CCIPVersion = {
  V1_2: '1.2.0',
  V1_5: '1.5.0',
  V1_6: '1.6.0',
  V2_0: '2.0.0',
} as const
/** Type representing one of the supported CCIP versions. */
export type CCIPVersion = (typeof CCIPVersion)[keyof typeof CCIPVersion]

/** Helper type that maps chain family to its chain ID format. */
type ChainFamilyWithId<F extends ChainFamily> = F extends
  | typeof ChainFamily.EVM
  | typeof ChainFamily.TON
  ? { readonly family: F; readonly chainId: number }
  : F extends typeof ChainFamily.Solana
    ? { readonly family: F; readonly chainId: string }
    : F extends typeof ChainFamily.Aptos | typeof ChainFamily.Sui
      ? { readonly family: F; readonly chainId: `${Lowercase<F>}:${number}` }
      : never

/**
 * Network information including chain selector and metadata.
 *
 * @example
 * ```typescript
 * const info: NetworkInfo = {
 *   chainSelector: 16015286601757825753n,
 *   name: 'ethereum-testnet-sepolia',
 *   networkType: 'TESTNET',
 *   family: 'EVM',
 *   chainId: 11155111,
 * }
 * ```
 */
export type NetworkInfo<F extends ChainFamily = ChainFamily> = {
  /** Unique chain selector used by CCIP. */
  readonly chainSelector: bigint
  /** Human-readable network name. */
  readonly name: string
  /** Network environment type. */
  readonly networkType: NetworkType
} & ChainFamilyWithId<F>

/**
 * CCIP lane configuration connecting source and destination chains.
 *
 * @example
 * ```typescript
 * const lane: Lane = {
 *   sourceChainSelector: 16015286601757825753n, // Ethereum Sepolia
 *   destChainSelector: 12532609583862916517n,   // Polygon Mumbai
 *   onRamp: '0x1234...abcd',
 *   version: '1.6.0',
 * }
 * ```
 */
export interface Lane<V extends CCIPVersion = CCIPVersion> {
  /** Source chain selector. */
  sourceChainSelector: bigint
  /** Destination chain selector. */
  destChainSelector: bigint
  /** OnRamp contract address on source chain. */
  onRamp: string
  /** CCIP protocol version for this lane. */
  version: V
}

/**
 * Union type representing a CCIP message across different versions and chain families.
 */
export type CCIPMessage<V extends CCIPVersion = CCIPVersion> = V extends typeof CCIPVersion.V2_0
  ? CCIPMessage_V2_0
  : V extends typeof CCIPVersion.V1_6
    ? CCIPMessage_V1_6_EVM | CCIPMessage_V1_6_Solana | CCIPMessage_V1_6_Sui
    : CCIPMessage_EVM<V>

/**
 * Generic log structure compatible across chain families.
 */
export type ChainLog = Pick<
  EVMLog,
  'topics' | 'index' | 'address' | 'blockNumber' | 'transactionHash'
> & {
  /** Log data as bytes or parsed object. */
  data: BytesLike | Record<string, unknown>
  /** Optional reference to the containing transaction. */
  tx?: SetOptional<ChainTransaction, 'logs'>
}

/**
 * Generic transaction structure compatible across chain families.
 *
 * @example
 * ```typescript
 * const tx: ChainTransaction = {
 *   hash: '0xabc123...',
 *   logs: [],
 *   blockNumber: 12345678,
 *   timestamp: 1704067200,
 *   from: '0x1234...abcd',
 * }
 * ```
 */
export type ChainTransaction = {
  /** Transaction hash. */
  hash: string
  /** Logs emitted by this transaction. */
  logs: readonly ChainLog[]
  /** Block number containing this transaction. */
  blockNumber: number
  /** Unix timestamp of the block. */
  timestamp: number
  /** Sender address. */
  from: string
  /** Optional error if transaction failed. */
  error?: unknown
}

/**
 * Complete CCIP request containing lane, message, log, and transaction info.
 */
export interface CCIPRequest<V extends CCIPVersion = CCIPVersion> {
  /** Lane configuration for this request. */
  lane: Lane<V>
  message: CCIPMessage<V>
  log: ChainLog
  /** Transaction that emitted the request. */
  tx: Omit<ChainTransaction, 'logs'>

  /**
   * API-enriched metadata. Present only when fetched via CCIP API.
   *
   * @remarks
   * When a request is fetched using {@link Chain.getMessageById} or as a fallback
   * in {@link Chain.getMessagesInTx}, this field contains additional information
   * including message status, execution details, and network info.
   *
   * When constructed from on-chain data only, this field is `undefined`.
   *
   * @example
   * ```typescript
   * const request = await chain.getMessageById(messageId)
   * if (request.metadata) {
   *   console.log('Status:', request.metadata.status)
   *   console.log('Delivery time:', request.metadata.deliveryTime)
   * }
   * ```
   *
   * @see {@link APICCIPRequestMetadata}
   */
  metadata?: APICCIPRequestMetadata
}

/**
 * OnChain Commit report structure from the OffRamp CommitReportAccepted event.
 */
export type CommitReport = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<typeof OffRamp_1_6_ABI, 'CommitReportAccepted'>['inputs']
>[0][number]

/**
 * OffChain Verification result for a CCIP v2.0 message, returned by the indexer API.
 */
export type VerifierResult = {
  /** Verification data required for destination execution (e.g. signatures). */
  ccvData: BytesLike
  /** Source CCV contract address. */
  sourceAddress: string
  /** Destination CCV contract address. */
  destAddress: string
  /** Timestamp of the attestation (Unix seconds). */
  timestamp?: number
}

/**
 * Verification data for a ccip message (onchain CommitReport, or offchain Verifications)
 */
export type CCIPVerifications =
  | {
      /** The commit report data. */
      report: CommitReport
      /** Log event from the commit. */
      log: ChainLog
    }
  | {
      /** Policy for this request */
      verificationPolicy: {
        optionalCCVs: readonly string[]
        requiredCCVs: readonly string[]
        optionalThreshold: number
      }
      /** Verifications array; one for each requiredCCV is needed for exec */
      verifications: VerifierResult[]
    }

/**
 * Enumeration of possible execution states for a CCIP message.
 */
export const ExecutionState = {
  /** Execution is in progress. */
  InProgress: 1,
  /** Execution completed successfully. */
  Success: 2,
  /** Execution failed. */
  Failed: 3,
} as const
/** Type representing an execution state value. */
export type ExecutionState = (typeof ExecutionState)[keyof typeof ExecutionState]

/**
 * CCIP message lifecycle status.
 * Represents the current state of a cross-chain message.
 */
export const MessageStatus = {
  /** Message sent on source chain, pending finalization. */
  Sent: 'SENT',
  /** Source chain transaction finalized. */
  SourceFinalized: 'SOURCE_FINALIZED',
  /** Commit report accepted on destination chain. */
  Committed: 'COMMITTED',
  /** Commit blessed by Risk Management Network. */
  Blessed: 'BLESSED',
  /** Message executed successfully on destination. */
  Success: 'SUCCESS',
  /** Message execution failed on destination. */
  Failed: 'FAILED',
  /** Message is being verified by the CCIP network */
  Verifying: 'VERIFYING',
  /** Message has been verified by the CCIP network */
  Verified: 'VERIFIED',
  /**
   * API returned an unrecognized status value.
   * This typically means the CCIP API has new status values that this SDK version
   * doesn't recognize. Consider updating to the latest SDK version.
   */
  Unknown: 'UNKNOWN',
} as const
/** Type representing a CCIP message lifecycle status. */
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus]

/**
 * Intent operation status for cross-chain swaps/bridges.
 * Represents the current state of an intent.
 */
export const IntentStatus = {
  /** Intent created, awaiting fulfillment. */
  Pending: 'PENDING',
  /** Intent fulfilled successfully. */
  Completed: 'COMPLETED',
  /** Intent failed. */
  Failed: 'FAILED',
} as const
/** Type representing an intent operation status. */
export type IntentStatus = (typeof IntentStatus)[keyof typeof IntentStatus]

/**
 * Receipt of a CCIP message execution on the destination chain.
 *
 * @example
 * ```typescript
 * const receipt: ExecutionReceipt = {
 *   messageId: '0xabc123...',
 *   sequenceNumber: 42n,
 *   state: ExecutionState.Success,
 *   sourceChainSelector: 16015286601757825753n,
 * }
 * ```
 */
export type ExecutionReceipt = {
  /** Unique message identifier. */
  messageId: string
  /** Sequence number of the message. */
  sequenceNumber: bigint
  /** Current execution state. */
  state: ExecutionState
  /** Source chain selector (if available). */
  sourceChainSelector?: bigint
  /** Hash of the message (if available). */
  messageHash?: string
  /** Return data from the receiver contract (if any). */
  returnData?: BytesLike | Record<string, string>
  /** Gas consumed by execution (if available). */
  gasUsed?: bigint
}

/**
 * Complete CCIP execution event with receipt, log, and timestamp.
 */
export interface CCIPExecution {
  /** Execution receipt data. */
  receipt: ExecutionReceipt
  /** Log event from the execution. */
  log: ChainLog
  /** Unix timestamp of the execution. */
  timestamp: number
}

/**
 * Offchain token data for CCTP or other bridge attestations.
 */
export type OffchainTokenData = { _tag: string; [k: string]: BytesLike } | undefined

/**
 * Execution report containing message, proofs, and offchain token data.
 *
 * @example
 * ```typescript
 * const report: ExecutionReport = {
 *   message: { messageId: '0x...', ... },
 *   proofs: ['0xproof1...', '0xproof2...'],
 *   proofFlagBits: 0n,
 *   merkleRoot: '0xroot...',
 *   offchainTokenData: [],
 * }
 * ```
 */
export type ExecutionInput<M extends CCIPMessage = CCIPMessage> =
  M extends CCIPMessage<typeof CCIPVersion.V2_0>
    ? {
        /** encodedMessage as per CCIPv2 codec */
        encodedMessage: M['encodedMessage']
        /** Off-Chain verifications containing verifierResults' ccvData and ccvs addresses */
        verifications: Pick<VerifierResult, 'ccvData' | 'destAddress'>[]
      }
    : {
        /** The CCIP message to execute. */
        message: M
        /** Merkle proofs for the message. */
        proofs: readonly BytesLike[]
        /** Bit flags for proof verification. */
        proofFlagBits: bigint
        /** Merkle root for verification. */
        merkleRoot: string
        /** Offchain token data for each token transfer. */
        offchainTokenData: readonly OffchainTokenData[]
      }

/**
 * A message to be sent to another network.
 *
 * @example
 * ```typescript
 * const message: AnyMessage = {
 *   receiver: '0x1234...abcd',
 *   extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
 *   data: '0xdeadbeef',
 *   tokenAmounts: [{ token: '0xtoken...', amount: 1000000n }],
 * }
 * ```
 */
export type AnyMessage = {
  /**
   * Receiver address on the destination chain.
   * Must be a valid address for the destination chain family. For instance:
   * - EVM: 20-byte hex (e.g., `0x6d1af98d635d3121286ddda1a0c2d7078b1523ed`)
   * - Solana: Base58 public key (e.g., `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV`)
   */
  receiver: BytesLike
  /** Extra arguments for gas limits and other settings. */
  extraArgs: ExtraArgs
  /** Arbitrary data payload. */
  data?: BytesLike
  /** Optional token transfers. */
  tokenAmounts?: readonly { token: string; amount: bigint }[]
  /** Optional fee token address (native if omitted). */
  feeToken?: string
}

/**
 * Partial {@link AnyMessage}, which populates default fields like `extraArgs` if needed.
 *
 * @example
 * ```typescript
 * // Minimal input - only receiver required, defaults applied for extraArgs
 * const input: MessageInput = {
 *   receiver: '0x1234...abcd',
 * }
 *
 * // With custom gas limit
 * const inputWithGas: MessageInput = {
 *   receiver: '0x1234...abcd',
 *   extraArgs: { gasLimit: 500_000n },
 *   data: '0xdeadbeef',
 * }
 * ```
 */
export type MessageInput = Partial<AnyMessage> & {
  receiver: AnyMessage['receiver']
  extraArgs?: Partial<ExtraArgs>
  fee?: bigint
}
