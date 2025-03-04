import {
  type AbiParameterToPrimitiveType,
  type AbiParametersToPrimitiveTypes,
  type ExtractAbiEvent,
  type SolidityTuple,
  parseAbi,
} from 'abitype'
import { type Addressable, type Log, type Result, AbiCoder, concat, dataSlice, id } from 'ethers'

import { type TypedContract } from 'ethers-abitype'
import CommitStore_1_2_ABI from '../abi/CommitStore_1_2.js'
import CommitStore_1_5_ABI from '../abi/CommitStore_1_5.js'
import EVM2EVMOffRamp_1_2_ABI from '../abi/OffRamp_1_2.js'
import EVM2EVMOffRamp_1_5_ABI from '../abi/OffRamp_1_5.js'
import OffRamp_1_6_ABI from '../abi/OffRamp_1_6.js'
import EVM2EVMOnRamp_1_2_ABI from '../abi/OnRamp_1_2.js'
import EVM2EVMOnRamp_1_5_ABI from '../abi/OnRamp_1_5.js'
import OnRamp_1_6_ABI from '../abi/OnRamp_1_6.js'

export const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])
export const defaultAbiCoder = AbiCoder.defaultAbiCoder()

export enum CCIPVersion {
  V1_2 = '1.2.0',
  V1_5 = '1.5.0',
  V1_6 = '1.6.0',
}

export enum CCIPContractType {
  OnRamp = 'OnRamp',
  OffRamp = 'OffRamp',
  CommitStore = 'CommitStore',
}

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
} as const

export type CCIPContract<T extends CCIPContractType, V extends CCIPVersion> = TypedContract<
  (typeof CCIP_ABIs)[T][V]
>

export interface NetworkInfo {
  chainId: number
  chainSelector: bigint
  name: string
  isTestnet: boolean
}

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
type EVM2AnyMessageSent = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof OnRamp_1_6_ABI, 'CCIPMessageSent'>['inputs']
  >[2]
>

// v1.2-v1.5 | v1.6 Message, with decoded gasLimit, sourceTokenData and tokenAmounts.destGasAmount
export type CCIPMessage<V extends CCIPVersion = CCIPVersion> = V extends
  | CCIPVersion.V1_2
  | CCIPVersion.V1_5
  ? Omit<EVM2AnyMessageRequested, 'tokenAmounts'> & {
      header: {
        messageId: string
        sequenceNumber: bigint
        nonce: bigint
      }
      tokenAmounts: readonly (EVM2AnyMessageRequested['tokenAmounts'][number] & SourceTokenData)[]
    }
  : Omit<EVM2AnyMessageSent, 'tokenAmounts'> & {
      gasLimit: bigint
      tokenAmounts: readonly (EVM2AnyMessageSent['tokenAmounts'][number] & SourceTokenData)[]
    }

// type Bla = CCIPMessage<CCIPVersion.V1_6> //['tokenAmounts'][number]

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

export enum ExecutionState {
  Success = 2,
  Failed,
}

export type ExecutionReceipt = (Omit<
  AbiParameterToPrimitiveType<{
    // hack: trick abitypes into giving us the struct equivalent types, to cast from Result
    type: SolidityTuple
    components: ExtractAbiEvent<
      (typeof CCIP_ABIs)[CCIPContractType.OffRamp][CCIPVersion.V1_5],
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
          (typeof CCIP_ABIs)[CCIPContractType.OffRamp][CCIPVersion.V1_6],
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

const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
const EVMExtraArgsV1 = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2 = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
export interface EVMExtraArgsV1 {
  gasLimit?: bigint
}
export interface EVMExtraArgsV2 extends EVMExtraArgsV1 {
  allowOutOfOrderExecution: boolean
}

const DEFAULT_GAS_LIMIT = 200_000n

/**
 * Encodes extra arguments for CCIP messages.
 * args.allowOutOfOrderExecution enforces ExtraArgsV2 (v1.5+)
 **/
export function encodeExtraArgs(args: EVMExtraArgsV1 | EVMExtraArgsV2): string {
  if ('allowOutOfOrderExecution' in args) {
    if (args.gasLimit == null) args.gasLimit = DEFAULT_GAS_LIMIT
    return concat([EVMExtraArgsV2Tag, defaultAbiCoder.encode([EVMExtraArgsV2], [args])])
  } else if (args.gasLimit != null) {
    return concat([EVMExtraArgsV1Tag, defaultAbiCoder.encode([EVMExtraArgsV1], [args])])
  }
  return '0x'
}

/**
 * Parses extra arguments from CCIP messages
 * @param data - extra arguments bytearray data
 * @returns extra arguments object if found
 **/
export function parseExtraArgs(data: string):
  | ((EVMExtraArgsV1 | EVMExtraArgsV2) & {
      _tag: 'EVMExtraArgsV1' | 'EVMExtraArgsV2'
    })
  | undefined {
  if (data === '0x') return { _tag: 'EVMExtraArgsV1' }
  if (data.startsWith(EVMExtraArgsV1Tag)) {
    const args = defaultAbiCoder.decode([EVMExtraArgsV1], dataSlice(data, 4))
    return { ...(args[0] as Result).toObject(), _tag: 'EVMExtraArgsV1' }
  }
  if (data.startsWith(EVMExtraArgsV2Tag)) {
    const args = defaultAbiCoder.decode([EVMExtraArgsV2], dataSlice(data, 4))
    return { ...(args[0] as Result).toObject(), _tag: 'EVMExtraArgsV2' }
  }
}

const SourceTokenData =
  'tuple(bytes sourcePoolAddress, bytes destTokenAddress, bytes extraData, uint64 destGasAmount)'
export interface SourceTokenData {
  sourcePoolAddress: string
  destTokenAddress: string
  extraData: string
  destGasAmount: bigint
}

export function encodeSourceTokenData(data: SourceTokenData): string {
  return defaultAbiCoder.encode([SourceTokenData], [data])
}

export function parseSourceTokenData(data: string): SourceTokenData {
  const decoded = defaultAbiCoder.decode([SourceTokenData], data)
  return (decoded[0] as Result).toObject() as SourceTokenData
}
