import type { AbiParameterToPrimitiveType, SolidityTuple } from 'abitype'
import { type AbiParametersToPrimitiveTypes, type ExtractAbiEvent, parseAbi } from 'abitype'
import type { Log } from 'ethers'

import CommitStore_1_2_ABI from '../abi/CommitStore_1_2.js'
import CommitStore_1_5_ABI from '../abi/CommitStore_1_5.js'
import EVM2EVMOffRamp_1_2_ABI from '../abi/OffRamp_1_2.js'
import EVM2EVMOffRamp_1_5_ABI from '../abi/OffRamp_1_5.js'
import EVM2EVMOnRamp_1_2_ABI from '../abi/OnRamp_1_2.js'
import EVM2EVMOnRamp_1_5_ABI from '../abi/OnRamp_1_5.js'

export interface LeafHasherArgs {
  sourceChainSelector: bigint
  destChainSelector: bigint
  onRamp: string
}

export const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])

export type CCIPMessage = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<typeof EVM2EVMOnRamp_1_2_ABI, 'CCIPSendRequested'>['inputs']
>[0]

export const CCIPVersion_1_2 = '1.2.0'
export type CCIPVersion_1_2 = typeof CCIPVersion_1_2
export const CCIPVersion_1_5 = '1.5.0'
export type CCIPVersion_1_5 = typeof CCIPVersion_1_5
export type CCIPVersion = CCIPVersion_1_2 | CCIPVersion_1_5

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
    [CCIPVersion_1_2]: EVM2EVMOnRamp_1_2_ABI,
    [CCIPVersion_1_5]: EVM2EVMOnRamp_1_5_ABI,
  },
  [CCIPContractTypeOffRamp]: {
    [CCIPVersion_1_2]: EVM2EVMOffRamp_1_2_ABI,
    [CCIPVersion_1_5]: EVM2EVMOffRamp_1_5_ABI,
  },
  [CCIPContractTypeCommitStore]: {
    [CCIPVersion_1_2]: CommitStore_1_2_ABI,
    [CCIPVersion_1_5]: CommitStore_1_5_ABI,
  },
} as const

const _: Record<CCIPContractType, Record<CCIPVersion, readonly unknown[]>> = CCIP_ABIs

export interface NetworkInfo {
  chainId: number
  chainSelector: bigint
  name: string
  isTestnet: boolean
}

export interface LaneInfo {
  source: NetworkInfo
  dest: NetworkInfo
  onRamp: string
}

export interface CCIPRequest {
  message: CCIPMessage
  log: Pick<Log, 'topics' | 'index' | 'address' | 'blockNumber'>
  tx: { logs: readonly Pick<Log, 'topics' | 'index' | 'data' | 'address' | 'transactionHash'>[] }
  timestamp: number
  version: CCIPVersion
}

export interface CCIPRequestWithLane extends CCIPRequest {
  lane: LaneInfo
}

export type CommitReport = AbiParametersToPrimitiveTypes<
  ExtractAbiEvent<
    (typeof CCIP_ABIs)[CCIPContractTypeCommitStore][CCIPVersion_1_2],
    'ReportAccepted'
  >['inputs']
>[0]

export interface CCIPCommit {
  report: CommitReport
  log: Pick<Log, 'blockNumber' | 'transactionHash'>
  timestamp: number
}

export type ExecutionReceipt = AbiParameterToPrimitiveType<{
  // hack: trick abitypes into giving us the struct equivalent types, to cast from Result
  type: SolidityTuple
  components: ExtractAbiEvent<
    (typeof CCIP_ABIs)[CCIPContractTypeOffRamp][CCIPVersion_1_2],
    'ExecutionStateChanged'
  >['inputs']
}>

export interface CCIPExecution {
  receipt: ExecutionReceipt
  log: Pick<Log, 'address' | 'blockNumber' | 'transactionHash'>
  timestamp: number
}
