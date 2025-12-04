import { type BytesLike, id } from 'ethers'

import { supportedChains } from './supported-chains.ts'
import { ChainFamily } from './types.ts'

export const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
export const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
export const SVMExtraArgsV1Tag = id('CCIP SVMExtraArgsV1').substring(0, 10) as '0x1f3b3aba'
export const SuiExtraArgsV1Tag = id('CCIP SuiExtraArgsV1').substring(0, 10) as '0x21ea4ca9'
export const GenericExtraArgsV2 = EVMExtraArgsV2Tag

export type EVMExtraArgsV1 = {
  gasLimit: bigint
}
// aka GenericExtraArgsV2
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
export type SuiExtraArgsV1 = EVMExtraArgsV2 & {
  tokenReceiver: string
  receiverObjectIds: string[]
}

// Same structure as EVMExtraArgsV2. TON calls it GenericExtraArgsV2
export type GenericExtraArgsV2 = EVMExtraArgsV2

export type ExtraArgs = EVMExtraArgsV1 | EVMExtraArgsV2 | SVMExtraArgsV1 | SuiExtraArgsV1

/**
 * Encodes extra arguments for CCIP messages.
 * The args are *to* a dest network, but are encoded as a message *from* this source chain
 * e.g. Solana uses Borsh to encode extraArgs in its produced requests, even those targetting EVM
 **/
export function encodeExtraArgs(args: ExtraArgs, from: ChainFamily = ChainFamily.EVM): string {
  const chain = supportedChains[from]
  if (!chain) throw new Error(`Unsupported chain family: ${from}`)
  return chain.encodeExtraArgs(args)
}

/**
 * Parses extra arguments from CCIP messages
 * @param data - extra arguments bytearray data
 * @returns extra arguments object if found
 **/
export function decodeExtraArgs(
  data: BytesLike,
  from?: ChainFamily,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
  | (GenericExtraArgsV2 & { _tag: 'GenericExtraArgsV2' })
  | undefined {
  if (!data || data === '') return
  let chains
  if (from) {
    const chain = supportedChains[from]
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
