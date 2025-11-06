import type { Program } from '@coral-xyz/anchor'
import {
  type Abi,
  type AbiParameterToPrimitiveType,
  type AbiParametersToPrimitiveTypes,
  type ExtractAbiEvent,
  type SolidityTuple,
  parseAbi,
} from 'abitype'
import { type Addressable, type Log, AbiCoder } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import CommitStore_1_2_ABI from '../abi/CommitStore_1_2.ts'
import CommitStore_1_5_ABI from '../abi/CommitStore_1_5.ts'
import EVM2EVMOffRamp_1_2_ABI from '../abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from '../abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from '../abi/OffRamp_1_6.ts'
import EVM2EVMOnRamp_1_2_ABI from '../abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from '../abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from '../abi/OnRamp_1_6.ts'
import type { SourceTokenData, parseExtraArgs } from './extra-args.ts'
import type {
  CCIP_SOLANA_VERSION_MAP,
  SolanaCCIPIdl,
  SupportedSolanaCCIPVersion,
} from './solana/programs/versioning.ts'

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

export type CCIPContractEVM<T extends CCIPContractType, V extends CCIPVersion> = TypedContract<
  (typeof CCIP_ABIs)[T][V]
>

export type CCIPContractSolana<
  T extends SolanaCCIPIdl,
  V extends SupportedSolanaCCIPVersion,
> = Program<(typeof CCIP_SOLANA_VERSION_MAP)[V][T]>

export type CCIPContract =
  | {
      family: typeof ChainFamily.EVM
      type: CCIPContractType
      contract: CCIPContractEVM<CCIPContractType, CCIPVersion>
    }
  | {
      family: typeof ChainFamily.Solana
      type: SolanaCCIPIdl
      program: CCIPContractSolana<SolanaCCIPIdl, SupportedSolanaCCIPVersion>
    }

export const ChainFamily = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
  Test: 'test',
} as const
export type ChainFamily = (typeof ChainFamily)[keyof typeof ChainFamily]

export type NetworkInfo = {
  chainSelector: bigint
  name: string
  isTestnet: boolean
} & (
  | { family: typeof ChainFamily.EVM; chainId: number }
  | { family: typeof ChainFamily.Solana; chainId: string }
  | { family: typeof ChainFamily.Aptos; chainId: `aptos:${number}` }
  | { family: typeof ChainFamily.Sui; chainId: string }
)

export interface Lane<V extends CCIPVersion = CCIPVersion> {
  sourceChainSelector: bigint
  destChainSelector: bigint
  onRamp: string
  version: V
}

// addresses often come as `string | Addressable`, this type cleans them up to just `string`
type CleanAddressable<T> = T extends string | Addressable
  ? string
  : T extends Record<string, unknown>
    ? { [K in keyof T]: CleanAddressable<T[K]> }
    : T extends readonly unknown[]
      ? readonly CleanAddressable<T[number]>[]
      : T

// v1.2-v1.5 Message ()
type EVM2AnyMessageRequested = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof EVM2EVMOnRamp_1_5_ABI, 'CCIPSendRequested'>['inputs']
  >[0]
>

// v1.6+ Message
export type EVM2AnyMessageSent = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof OnRamp_1_6_ABI, 'CCIPMessageSent'>['inputs']
  >[2]
>

export type CCIPMessage<V extends CCIPVersion = CCIPVersion> = V extends
  | typeof CCIPVersion.V1_2
  | typeof CCIPVersion.V1_5
  ? Omit<EVM2AnyMessageRequested, 'tokenAmounts'> & {
      header: {
        messageId: string
        sequenceNumber: bigint
        nonce: bigint
        sourceChainSelector: bigint
      }
      tokenAmounts: readonly (EVM2AnyMessageRequested['tokenAmounts'][number] &
        Partial<SourceTokenData>)[]
    }
  : Omit<EVM2AnyMessageSent, 'tokenAmounts'> & {
      tokenAmounts: readonly (EVM2AnyMessageSent['tokenAmounts'][number] & SourceTokenData)[]
    } & Omit<NonNullable<ReturnType<typeof parseExtraArgs>>, '_tag'>

type Log_ = Pick<Log, 'topics' | 'index' | 'address' | 'data' | 'blockNumber' | 'transactionHash'>

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

export type ExecutionReport = {
  message: CCIPMessage<typeof CCIPVersion.V1_6>
  offchainTokenData: string[]
  proofs: string[]
  sourceChainSelector: bigint
}
