import { type BytesLike, id } from 'ethers'

import { supportedChains } from './supported-chains.ts'
import { ChainFamily } from './types.ts'

/** Tag identifier for EVMExtraArgsV1 encoding. */
export const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
/** Tag identifier for EVMExtraArgsV2 encoding. */
export const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
/** Tag identifier for SVMExtraArgsV1 encoding. */
export const SVMExtraArgsV1Tag = id('CCIP SVMExtraArgsV1').substring(0, 10) as '0x1f3b3aba'
/** Tag identifier for SuiExtraArgsV1 encoding. */
export const SuiExtraArgsV1Tag = id('CCIP SuiExtraArgsV1').substring(0, 10) as '0x21ea4ca9'
export const GenericExtraArgsV2 = EVMExtraArgsV2Tag

/**
 * EVM extra arguments version 1 with gas limit only.
 */
export type EVMExtraArgsV1 = {
  /** Gas limit for execution on the destination chain. */
  gasLimit: bigint
}

/**
 * EVM extra arguments version 2 with out-of-order execution support.
 * Also known as GenericExtraArgsV2.
 */
export type EVMExtraArgsV2 = EVMExtraArgsV1 & {
  /** Whether to allow out-of-order message execution. */
  allowOutOfOrderExecution: boolean
}

/**
 * Solana (SVM) extra arguments version 1.
 */
export type SVMExtraArgsV1 = {
  /** Compute units for Solana execution. */
  computeUnits: bigint
  /** Bitmap indicating which accounts are writable. */
  accountIsWritableBitmap: bigint
  /** Whether to allow out-of-order message execution. */
  allowOutOfOrderExecution: boolean
  /** Token receiver address on Solana. */
  tokenReceiver: string
  /** Additional account addresses required for execution. */
  accounts: string[]
}

/**
 * Sui extra arguments version 1.
 */
export type SuiExtraArgsV1 = EVMExtraArgsV2 & {
  /** Token receiver address on Sui. */
  tokenReceiver: string
  /** Object IDs required for the receiver. */
  receiverObjectIds: string[]
}

// Same structure as EVMExtraArgsV2. TON calls it GenericExtraArgsV2
/**
 *
 */
export type GenericExtraArgsV2 = EVMExtraArgsV2

/**
 * Union type of all supported extra arguments formats.
 */
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
 * Parses extra arguments from CCIP messages.
 * @param data - Extra arguments bytearray data.
 * @param from - Optional chain family to narrow decoding attempts.
 * @returns Extra arguments object if found, undefined otherwise.
 */
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
