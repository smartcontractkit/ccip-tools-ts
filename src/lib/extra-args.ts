import { type BytesLike, type Result, id } from 'ethers'

import { type ChainStatic, ChainFamily } from './chain.ts'
import { supportedChains } from './supported-chains.ts'
import { defaultAbiCoder } from './types.ts'

export const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
export const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
export const SVMExtraArgsTag = id('CCIP SVMExtraArgsV1').substring(0, 10) as '0x1f3b3aba'

const EVMExtraArgsV1 = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2 = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
const SVMExtraArgsV1 =
  'tuple(uint32 computeUnits, uint64 accountIsWritableBitmap, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] accounts)'

export type EVMExtraArgsV1 = {
  gasLimit: bigint
}
export type EVMExtraArgsV2 = EVMExtraArgsV1 & {
  allowOutOfOrderExecution: boolean
}
export type SVMExtraArgsV1 = {
  computeUnits: bigint
  accountIsWritableBitmap: bigint
  allowOutOfOrderExecution: boolean
  tokenReceiver: string
  accounts: string[]
}

export type ExtraArgs = EVMExtraArgsV1 | EVMExtraArgsV2 | SVMExtraArgsV1

/**
 * Encodes extra arguments for CCIP messages.
 * The args are *to* a dest network, but are encoded as a message *from* some source chain
 **/
export function encodeExtraArgs(
  args: EVMExtraArgsV1 | EVMExtraArgsV2 | SVMExtraArgsV1,
  from: ChainFamily = ChainFamily.EVM,
): string {
  const chain = (supportedChains as Partial<Record<ChainFamily, ChainStatic>>)[from]
  if (!chain) throw new Error(`Unsupported chain family: ${from}`)
  return chain.encodeExtraArgs(args)
}

/**
 * Parses extra arguments from CCIP messages
 * @param data - extra arguments bytearray data
 * @returns extra arguments object if found
 **/
export function parseExtraArgs(
  data: BytesLike,
  from?: ChainFamily,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | undefined {
  if (!data || data === '') return
  let chains
  if (from) {
    const chain = (supportedChains as Partial<Record<ChainFamily, ChainStatic>>)[from]
    if (!chain) throw new Error(`Unsupported chain family: ${from}`)
    chains = [chain]
  } else {
    chains = Object.values(supportedChains)
  }
  for (const chain of chains) {
    const decoded = chain.decodeExtraArgs(data)
    if (decoded) return decoded
  }
  throw new Error(`Could not parse extraArgs from "${from}"`)
}

const SourceTokenData =
  'tuple(bytes sourcePoolAddress, bytes destTokenAddress, bytes extraData, uint64 destGasAmount)'
export type SourceTokenData = {
  sourcePoolAddress: string
  destTokenAddress: string
  extraData: string
  destGasAmount: bigint
}

/**
 * parse <=v1.5 `message.sourceTokenData`;
 * v1.6+ already contains this in `message.tokenAmounts`
 */
export function parseSourceTokenData(data: string): SourceTokenData {
  const decoded = defaultAbiCoder.decode([SourceTokenData], data)
  return (decoded[0] as Result).toObject() as SourceTokenData
}
