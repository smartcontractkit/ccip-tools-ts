import type { AbiParametersToPrimitiveTypes, ExtractAbiEvent } from 'abitype'
import type { BytesLike, Log } from 'ethers'

import type OffRamp_1_6_ABI from './evm/abi/OffRamp_1_6.ts'
import type { CCIPMessage_EVM, CCIPMessage_V1_6_EVM } from './evm/messages.ts'
import type { ExtraArgs } from './extra-args.ts'
import type { CCIPMessage_V1_6_Solana } from './solana/types.ts'
import type { CCIPMessage_V1_6_Sui } from './sui/types.ts'
import type { CCIPMessage_V1_6_TON } from './ton/types.ts'
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
 * Enumeration of supported CCIP protocol versions.
 */
export const CCIPVersion = {
  V1_2: '1.2.0',
  V1_5: '1.5.0',
  V1_6: '1.6.0',
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
 */
export type NetworkInfo<F extends ChainFamily = ChainFamily> = {
  /** Unique chain selector used by CCIP. */
  readonly chainSelector: bigint
  /** Human-readable network name. */
  readonly name: string
  /** Whether this is a testnet. */
  readonly isTestnet: boolean
} & ChainFamilyWithId<F>

/**
 * CCIP lane configuration connecting source and destination chains.
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
export type CCIPMessage<V extends CCIPVersion = CCIPVersion> = V extends
  | typeof CCIPVersion.V1_2
  | typeof CCIPVersion.V1_5
  ? CCIPMessage_EVM<V>
  : CCIPMessage_V1_6_EVM | CCIPMessage_V1_6_Solana | CCIPMessage_V1_6_Sui | CCIPMessage_V1_6_TON

/**
 * Generic log structure compatible across chain families.
 */
export type Log_ = Pick<Log, 'topics' | 'index' | 'address' | 'blockNumber' | 'transactionHash'> & {
  /** Log data as bytes or parsed object. */
  data: BytesLike | Record<string, unknown>
  /** Optional reference to the containing transaction. */
  tx?: ChainTransaction
}

/**
 * Generic transaction structure compatible across chain families.
 */
export type ChainTransaction = {
  /** Transaction hash. */
  hash: string
  /** Logs emitted by this transaction. */
  logs: readonly Log_[]
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
  /** The CCIP message being sent. */
  message: CCIPMessage<V>
  /** Log event from the OnRamp. */
  log: Log_
  /** Transaction that emitted the request. */
  tx: Pick<ChainTransaction, 'hash' | 'logs' | 'blockNumber' | 'timestamp' | 'from' | 'error'>
}

/**
 * Commit report structure from the OffRamp CommitReportAccepted event.
 */
export type CommitReport = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<typeof OffRamp_1_6_ABI, 'CommitReportAccepted'>['inputs']
>[0][number]

/**
 * CCIP commit information containing the report and its log.
 */
export interface CCIPCommit {
  /** The commit report data. */
  report: CommitReport
  /** Log event from the commit. */
  log: Log_
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
  /** Unknown status returned by API */
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
  log: Log_
  /** Unix timestamp of the execution. */
  timestamp: number
}

/**
 * Offchain token data for CCTP or other bridge attestations.
 */
export type OffchainTokenData = { _tag: string; [k: string]: BytesLike } | undefined

/**
 * Execution report containing message, proofs, and offchain token data.
 */
export type ExecutionReport<M extends CCIPMessage = CCIPMessage> = {
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
 */
export type AnyMessage = {
  /** Receiver address on the destination chain. */
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
 * Partial [[AnyMessage]], which populates default fields like `extraArgs` if needed
 */
export type MessageInput = Partial<AnyMessage> & {
  receiver: AnyMessage['receiver']
  extraArgs?: Partial<ExtraArgs>
  fee?: bigint
}
