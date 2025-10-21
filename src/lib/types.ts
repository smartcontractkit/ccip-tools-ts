import {
  type Abi,
  type AbiParameterToPrimitiveType,
  type AbiParametersToPrimitiveTypes,
  type ExtractAbiEvent,
  type SolidityTuple,
  parseAbi,
} from 'abitype'
import { type BytesLike, type Log, AbiCoder } from 'ethers'

import type { ChainFamily, ChainTransaction } from './chain.ts'
import CommitStore_1_2_ABI from '../abi/CommitStore_1_2.ts'
import CommitStore_1_5_ABI from '../abi/CommitStore_1_5.ts'
import EVM2EVMOffRamp_1_2_ABI from '../abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from '../abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from '../abi/OffRamp_1_6.ts'
import EVM2EVMOnRamp_1_2_ABI from '../abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from '../abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from '../abi/OnRamp_1_6.ts'
import type {
  CCIPMessage_EVM,
  CCIPMessage_V1_2_EVM,
  CCIPMessage_V1_5_EVM,
  CCIPMessage_V1_6_EVM,
} from './evm/messages.ts'
import type { ExtraArgs } from './extra-args.ts'
import type { CCIPMessage_V1_6_Solana } from './solana/types.ts'
// v1.6 Base type from EVM contains the intersection of all other CCIPMessage v1.6 types
export type { CCIPMessage_V1_6 } from './evm/messages.ts'

/**
 * DeepReadonly is a type that recursively makes all properties of an object readonly.
 */
export type DeepReadonly<T> = Readonly<{
  [K in keyof T]: T[K] extends number | string | symbol // Is it a primitive? Then make it readonly
    ? Readonly<T[K]>
    : // Is it an array of items? Then make the array readonly and the item as well
      T[K] extends Array<infer A>
      ? Readonly<Array<DeepReadonly<A>>>
      : // It is some other object, make it readonly as well
        DeepReadonly<T[K]>
}>

/**
 * "Fix" for intersecting types containing arrays: A[] & B[] => (A & B)[]
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

export const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])
export const defaultAbiCoder = AbiCoder.defaultAbiCoder()

export const CCIPVersion = {
  V1_2: '1.2.0',
  V1_5: '1.5.0',
  V1_6: '1.6.0',
} as const
export type CCIPVersion = (typeof CCIPVersion)[keyof typeof CCIPVersion]

export const CCIPContractType = {
  OnRamp: 'OnRamp',
  OffRamp: 'OffRamp',
  CommitStore: 'CommitStore',
} as const
export type CCIPContractType = (typeof CCIPContractType)[keyof typeof CCIPContractType]

export const CCIP_ABIs = {
  [CCIPContractType.OnRamp]: {
    [CCIPVersion.V1_6]: OnRamp_1_6_ABI,
    [CCIPVersion.V1_5]: EVM2EVMOnRamp_1_5_ABI,
    [CCIPVersion.V1_2]: EVM2EVMOnRamp_1_2_ABI,
  },
  [CCIPContractType.OffRamp]: {
    [CCIPVersion.V1_6]: OffRamp_1_6_ABI,
    [CCIPVersion.V1_5]: EVM2EVMOffRamp_1_5_ABI,
    [CCIPVersion.V1_2]: EVM2EVMOffRamp_1_2_ABI,
  },
  [CCIPContractType.CommitStore]: {
    [CCIPVersion.V1_6]: OffRamp_1_6_ABI,
    [CCIPVersion.V1_5]: CommitStore_1_5_ABI,
    [CCIPVersion.V1_2]: CommitStore_1_2_ABI,
  },
} as const satisfies Record<CCIPContractType, Record<CCIPVersion, Abi>>

type ChainFamilyWithId<F extends ChainFamily> = F extends typeof ChainFamily.EVM
  ? { family: typeof ChainFamily.EVM; chainId: number }
  : F extends typeof ChainFamily.Solana
    ? { family: typeof ChainFamily.Solana; chainId: string }
    : F extends typeof ChainFamily.Aptos
      ? { family: typeof ChainFamily.Aptos; chainId: `aptos:${number}` }
      : never

export type NetworkInfo<F extends ChainFamily = ChainFamily> = {
  chainSelector: bigint
  name: string
  isTestnet: boolean
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
  : CCIPMessage_V1_6_EVM | CCIPMessage_V1_6_Solana

export type Log_ = Pick<Log, 'topics' | 'index' | 'address' | 'blockNumber' | 'transactionHash'> & {
  data: unknown
  tx?: ChainTransaction
}

export interface CCIPRequest<V extends CCIPVersion = CCIPVersion> {
  lane: Lane<V>
  message: CCIPMessage<V>
  log: Log_
  tx: { logs: readonly Log_[]; from?: string }
  timestamp: number
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

export type ExecutionReceipt = (Omit<
  AbiParameterToPrimitiveType<{
    // hack: trick abitypes into giving us the struct equivalent types, to cast from Result
    type: SolidityTuple
    components: ExtractAbiEvent<
      (typeof CCIP_ABIs)[typeof CCIPContractType.OffRamp][typeof CCIPVersion.V1_5],
      'ExecutionStateChanged'
    >['inputs']
  }>,
  'state'
> & { state: ExecutionState }) &
  Partial<
    Pick<
      AbiParameterToPrimitiveType<{
        // hack: trick abitypes into giving us the struct equivalent types, to cast from Result
        type: SolidityTuple
        components: ExtractAbiEvent<
          (typeof CCIP_ABIs)[typeof CCIPContractType.OffRamp][typeof CCIPVersion.V1_6],
          'ExecutionStateChanged'
        >['inputs']
      }>,
      'gasUsed' | 'messageHash' | 'sourceChainSelector'
    >
  >

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
