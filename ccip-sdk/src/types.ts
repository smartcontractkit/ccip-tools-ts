import type { AbiParametersToPrimitiveTypes, ExtractAbiEvent } from 'abitype'
import type { BytesLike, Log } from 'ethers'

import type OffRamp_1_6_ABI from './evm/abi/OffRamp_1_6.ts'
import type { CCIPMessage_EVM, CCIPMessage_V1_6_EVM } from './evm/messages.ts'
import type { ExtraArgs } from './extra-args.ts'
import type { CCIPMessage_V1_6_Solana } from './solana/types.ts'
import type { CCIPMessage_V1_6_Sui } from './sui/types.ts'
// v1.6 Base type from EVM contains the intersection of all other CCIPMessage v1.6 types
export type { CCIPMessage_V1_6 } from './evm/messages.ts'

/**
 * "Fix" for deeply intersecting types containing arrays: A[] & B[] => (A & B)[]
 * Usually, if you intersect { arr: A[] } & { arr: B[] }, arr will have type A[] & B[],
 * i.e. all/each *index* of A[] and B[] should be present in the intersection, with quite undefined
 * types of the elements themselves, oftentimes assigning only one of A or B to the element type;
 * This converts deeply to (A & B)[], i.e. each *element* should have all properties of A & B
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

export const ChainFamily = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
} as const
export type ChainFamily = (typeof ChainFamily)[keyof typeof ChainFamily]

export const CCIPVersion = {
  V1_2: '1.2.0',
  V1_5: '1.5.0',
  V1_6: '1.6.0',
} as const
export type CCIPVersion = (typeof CCIPVersion)[keyof typeof CCIPVersion]

type ChainFamilyWithId<F extends ChainFamily> = F extends typeof ChainFamily.EVM
  ? { readonly family: F; readonly chainId: number }
  : F extends typeof ChainFamily.Solana
    ? { readonly family: F; readonly chainId: string }
    : F extends typeof ChainFamily.Aptos | typeof ChainFamily.Sui
      ? { readonly family: F; readonly chainId: `${F}:${number}` }
      : never

export type NetworkInfo<F extends ChainFamily = ChainFamily> = {
  readonly chainSelector: bigint
  readonly name: string
  readonly isTestnet: boolean
} & ChainFamilyWithId<F>

export interface Lane<V extends CCIPVersion = CCIPVersion> {
  sourceChainSelector: bigint
  destChainSelector: bigint
  onRamp: string
  version: V
}

export type CCIPMessage<V extends CCIPVersion = CCIPVersion> = V extends
  | typeof CCIPVersion.V1_2
  | typeof CCIPVersion.V1_5
  ? CCIPMessage_EVM<V>
  : CCIPMessage_V1_6_EVM | CCIPMessage_V1_6_Solana | CCIPMessage_V1_6_Sui

export type Log_ = Pick<Log, 'topics' | 'index' | 'address' | 'blockNumber' | 'transactionHash'> & {
  data: BytesLike | Record<string, unknown>
  tx?: ChainTransaction
}

export type ChainTransaction = {
  hash: string
  logs: readonly Log_[]
  blockNumber: number
  timestamp: number
  from: string
  error?: unknown
}

export interface CCIPRequest<V extends CCIPVersion = CCIPVersion> {
  lane: Lane<V>
  message: CCIPMessage<V>
  log: Log_
  tx: Pick<ChainTransaction, 'hash' | 'logs' | 'blockNumber' | 'timestamp' | 'from' | 'error'>
}

export type CommitReport = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<typeof OffRamp_1_6_ABI, 'CommitReportAccepted'>['inputs']
>[0][number]

export interface CCIPCommit {
  report: CommitReport
  log: Log_
}

export const ExecutionState = {
  InProgress: 1,
  Success: 2,
  Failed: 3,
} as const
export type ExecutionState = (typeof ExecutionState)[keyof typeof ExecutionState]

export type ExecutionReceipt = {
  messageId: string
  sequenceNumber: bigint
  state: ExecutionState
  sourceChainSelector?: bigint
  messageHash?: string
  returnData?: BytesLike | Record<string, string>
  gasUsed?: bigint
}

export interface CCIPExecution {
  receipt: ExecutionReceipt
  log: Log_
  timestamp: number
}

export type OffchainTokenData = { _tag: string; [k: string]: BytesLike } | undefined

export type ExecutionReport<M extends CCIPMessage = CCIPMessage> = {
  message: M
  proofs: readonly BytesLike[]
  proofFlagBits: bigint
  merkleRoot: string
  offchainTokenData: readonly OffchainTokenData[]
}

/**
 * A message to be sent to another network
 */
export type AnyMessage = {
  receiver: BytesLike
  data: BytesLike
  extraArgs: ExtraArgs
  tokenAmounts?: readonly { token: string; amount: bigint }[]
  feeToken?: string
}
