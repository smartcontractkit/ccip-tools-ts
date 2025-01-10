import {
  type AbiParameterToPrimitiveType,
  type AbiParametersToPrimitiveTypes,
  type ExtractAbiEvent,
  type SolidityTuple,
  parseAbi,
} from 'abitype'
import { type Log, type Result, AbiCoder, concat, dataSlice, id } from 'ethers'

import CommitStore_1_2_ABI from '../abi/CommitStore_1_2.js'
import CommitStore_1_5_ABI from '../abi/CommitStore_1_5.js'
import EVM2EVMOffRamp_1_2_ABI from '../abi/OffRamp_1_2.js'
import EVM2EVMOffRamp_1_5_ABI from '../abi/OffRamp_1_5.js'
import EVM2EVMOnRamp_1_2_ABI from '../abi/OnRamp_1_2.js'
import EVM2EVMOnRamp_1_5_ABI from '../abi/OnRamp_1_5.js'

export const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])
export const defaultAbiCoder = AbiCoder.defaultAbiCoder()

export type CCIPMessage = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<typeof EVM2EVMOnRamp_1_5_ABI, 'CCIPSendRequested'>['inputs']
>[0]

export const CCIPVersion_1_5 = '1.5.0'
export type CCIPVersion_1_5 = typeof CCIPVersion_1_5
export const CCIPVersion_1_2 = '1.2.0'
export type CCIPVersion_1_2 = typeof CCIPVersion_1_2
export type CCIPVersion = CCIPVersion_1_5 | CCIPVersion_1_2

export const CCIPContractTypeOnRamp = 'EVM2EVMOnRamp'
export type CCIPContractTypeOnRamp = typeof CCIPContractTypeOnRamp
export const CCIPContractTypeOffRamp = 'EVM2EVMOffRamp'
export type CCIPContractTypeOffRamp = typeof CCIPContractTypeOffRamp
export const CCIPContractTypeCommitStore = 'EVM2EVMCommitStore'
export type CCIPContractTypeCommitStore = typeof CCIPContractTypeCommitStore
export type CCIPContractType =
  | CCIPContractTypeOnRamp
  | CCIPContractTypeOffRamp
  | CCIPContractTypeCommitStore

export const CCIP_ABIs = {
  [CCIPContractTypeOnRamp]: {
    [CCIPVersion_1_5]: EVM2EVMOnRamp_1_5_ABI,
    [CCIPVersion_1_2]: EVM2EVMOnRamp_1_2_ABI,
  },
  [CCIPContractTypeOffRamp]: {
    [CCIPVersion_1_5]: EVM2EVMOffRamp_1_5_ABI,
    [CCIPVersion_1_2]: EVM2EVMOffRamp_1_2_ABI,
  },
  [CCIPContractTypeCommitStore]: {
    [CCIPVersion_1_5]: CommitStore_1_5_ABI,
    [CCIPVersion_1_2]: CommitStore_1_2_ABI,
  },
} as const

const _: Record<CCIPContractType, Record<CCIPVersion, readonly unknown[]>> = CCIP_ABIs

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

type Log_ = Pick<Log, 'topics' | 'index' | 'address' | 'data' | 'blockNumber' | 'transactionHash'>
export interface CCIPRequest<V extends CCIPVersion = CCIPVersion> {
  message: CCIPMessage
  log: Log_
  tx: { logs: readonly Log_[] }
  timestamp: number
  lane: Lane<V>
}

export type CommitReport = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<
    (typeof CCIP_ABIs)[CCIPContractTypeCommitStore][CCIPVersion_1_2],
    'ReportAccepted'
  >['inputs']
>[0]

export interface CCIPCommit {
  report: CommitReport
  log: Log_
}

export enum ExecutionState {
  Success = 2,
  Failed,
}

export type ExecutionReceipt = Omit<
  AbiParameterToPrimitiveType<{
    // hack: trick abitypes into giving us the struct equivalent types, to cast from Result
    type: SolidityTuple
    components: ExtractAbiEvent<
      (typeof CCIP_ABIs)[CCIPContractTypeOffRamp][CCIPVersion_1_2],
      'ExecutionStateChanged'
    >['inputs']
  }>,
  'state'
> & { state: ExecutionState }

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
