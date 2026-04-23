import { type BytesLike, id, toNumber } from 'ethers'

import type { CantonExtraArgsV1 } from './canton/types.ts'
import { CCIPChainFamilyUnsupportedError, CCIPExtraArgsParseError } from './errors/index.ts'
import { supportedChains } from './supported-chains.ts'
import { ChainFamily } from './types.ts'

/** Tag identifier for EVMExtraArgsV1 encoding. */
export const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
/** Tag identifier for EVMExtraArgsV2 encoding. */
export const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
/** Tag identifier for GenericExtraArgsV3 encoding (tightly packed binary format). */
export const GenericExtraArgsV3Tag = id('CCIP GenericExtraArgsV3').substring(0, 10) as '0xa69dd4aa'
/** Tag identifier for SVMExtraArgsV1 encoding. */
export const SVMExtraArgsV1Tag = id('CCIP SVMExtraArgsV1').substring(0, 10) as '0x1f3b3aba'
/** Tag identifier for SuiExtraArgsV1 encoding. */
export const SuiExtraArgsV1Tag = id('CCIP SuiExtraArgsV1').substring(0, 10) as '0x21ea4ca9'

/**
 * EVM extra arguments version 1 with gas limit only.
 *
 * @example
 * ```typescript
 * const args: EVMExtraArgsV1 = {
 *   gasLimit: 200_000n,
 * }
 * ```
 */
export type EVMExtraArgsV1 = {
  /** Gas limit for execution on the destination chain. */
  gasLimit: bigint
}

/**
 * EVM extra arguments version 2 with out-of-order execution support.
 * Also known as GenericExtraArgsV2.
 *
 * @example
 * ```typescript
 * const args: EVMExtraArgsV2 = {
 *   gasLimit: 200_000n,
 *   allowOutOfOrderExecution: true,
 * }
 * ```
 */
export type EVMExtraArgsV2 = EVMExtraArgsV1 & {
  /** Whether to allow out-of-order message execution. */
  allowOutOfOrderExecution: boolean
}

/**
 * Requested finality configuration for cross-chain messages.
 *
 * Determines how long to wait on the source chain before relaying the message:
 * - `'finalized'` — wait for full finality (safest, default).
 * - `'safe'` — wait for the `safe` head tag.
 * - number — wait for this many block confirmations [1..65535].
 *
 * @example
 * ```typescript
 * // Wait for full finality (default)
 * const finality: FinalityRequested = 'finalized'
 *
 * // Wait for the safe tag
 * const safe: FinalityRequested = 'safe'
 *
 * // Wait for 5 block confirmations
 * const blocks: FinalityRequested = 5
 * ```
 */
export type FinalityRequested = 'finalized' | 'safe' | number

/**
 * Finality allowed by interested parties (e.g. TokenPools)
 * - finalitySafe: Whether messages can be executed under "safe" finality (FCR) rules.
 * - finalityDepth: Minimum block depth confirmations for Faster Than Finality (0 for Finalized).
 */
export type FinalityAllowed = {
  finalitySafe?: boolean
  finalityDepth: number
}

/**
 * Generic extra arguments version 3 with cross-chain verifiers and executor support.
 * Uses tightly packed binary encoding (NOT ABI-encoded).
 *
 * @example
 * ```typescript
 * const args: GenericExtraArgsV3 = {
 *   gasLimit: 200_000n,
 *   finality: 'safe',
 *   ccvs: ['0x1234...'],
 *   ccvArgs: ['0x010203'],
 *   executor: '0x5678...',
 *   executorArgs: '0x',
 *   tokenReceiver: '0xReceiverAddress...',
 *   tokenArgs: '0x',
 * }
 * ```
 */
export type GenericExtraArgsV3 = {
  /** Gas limit for execution on the destination chain (uint32). */
  gasLimit: bigint
  /** Finality config for the source chain before relaying. See {@link FinalityRequested}. */
  finality: FinalityRequested
  /** Cross-chain verifier addresses (EVM addresses). */
  ccvs: string[]
  /** Per-CCV arguments (BytesLike). */
  ccvArgs: BytesLike[]
  /** Executor address (EVM address or empty string for none). */
  executor: string
  /** Executor-specific arguments (BytesLike). */
  executorArgs: BytesLike
  /** Token receiver address (checksummed EVM address or hex string). */
  tokenReceiver: string
  /** Token pool-specific arguments (BytesLike). */
  tokenArgs: BytesLike
}

/**
 * Solana (SVM) extra arguments version 1.
 *
 * @example
 * ```typescript
 * const args: SVMExtraArgsV1 = {
 *   computeUnits: 200_000n,
 *   accountIsWritableBitmap: 0n,
 *   allowOutOfOrderExecution: true,
 *   tokenReceiver: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 *   accounts: [],
 * }
 * ```
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
 *
 * @example
 * ```typescript
 * const args: SuiExtraArgsV1 = {
 *   gasLimit: 200_000n,
 *   allowOutOfOrderExecution: true,
 *   tokenReceiver: '0x1234...abcd',
 *   receiverObjectIds: ['0xobject1...', '0xobject2...'],
 * }
 * ```
 */
export type SuiExtraArgsV1 = EVMExtraArgsV2 & {
  /** Token receiver address on Sui. */
  tokenReceiver: string
  /** Object IDs required for the receiver. */
  receiverObjectIds: string[]
}

/**
 * Union of all supported extra arguments formats for CCIP messages.
 *
 * The SDK auto-detects the correct variant based on the fields provided:
 * - {@link EVMExtraArgsV1} - EVM legacy (gasLimit only)
 * - {@link EVMExtraArgsV2} - EVM with out-of-order execution support
 * - {@link GenericExtraArgsV3} - Generic V3 with minimum block confirmations, cross-chain verifiers, custom executor, and per-token receiver/args
 * - {@link SVMExtraArgsV1} - Solana (compute units, accounts)
 * - {@link SuiExtraArgsV1} - Sui (gas limit, receiver object IDs)
 *
 * @see {@link encodeExtraArgs} - Encode extra arguments for on-chain use.
 * @see {@link decodeExtraArgs} - Decode extra arguments from bytes.
 */
export type ExtraArgs =
  | EVMExtraArgsV1
  | EVMExtraArgsV2
  | GenericExtraArgsV3
  | SVMExtraArgsV1
  | SuiExtraArgsV1
  | CantonExtraArgsV1

/**
 * Encodes extra arguments for CCIP messages.
 * The args are *to* a dest network, but are encoded as a message *from* this source chain.
 * E.g. Solana uses Borsh to encode extraArgs in its produced requests, even those targeting EVM.
 *
 * @param args - Extra arguments to encode.
 * @param from - Source chain family for encoding format (defaults to EVM).
 * @returns Encoded extra arguments as hex string.
 * @throws {@link CCIPChainFamilyUnsupportedError} if chain family not supported.
 *
 * @example
 * ```typescript
 * import { encodeExtraArgs } from '@chainlink/ccip-sdk'
 *
 * const encoded = encodeExtraArgs({
 *   gasLimit: 200_000n,
 *   allowOutOfOrderExecution: true,
 * })
 * console.log('Encoded:', encoded) // '0x181dcf10...'
 * ```
 *
 * @see {@link decodeExtraArgs} - Decode extra arguments from bytes
 */
export function encodeExtraArgs(args: ExtraArgs, from: ChainFamily = ChainFamily.EVM): string {
  const chain = supportedChains[from]
  if (!chain) throw new CCIPChainFamilyUnsupportedError(from)
  return chain.encodeExtraArgs(args)
}

/**
 * Parses extra arguments from CCIP messages.
 * @param data - Extra arguments bytearray data.
 * @param from - Optional chain family to narrow decoding attempts.
 * @returns Extra arguments object if found, undefined otherwise.
 * @throws {@link CCIPChainFamilyUnsupportedError} if specified chain family not supported.
 * @throws {@link CCIPExtraArgsParseError} if data cannot be parsed as valid extra args.
 *
 * @example
 * ```typescript
 * import { decodeExtraArgs } from '@chainlink/ccip-sdk'
 *
 * const decoded = decodeExtraArgs('0x181dcf10...')
 * if (decoded?._tag === 'EVMExtraArgsV2') {
 *   console.log('Gas limit:', decoded.gasLimit)
 *   console.log('Out of order:', decoded.allowOutOfOrderExecution)
 * }
 * ```
 *
 * @see {@link encodeExtraArgs} - Encode extra arguments to bytes
 */
export function decodeExtraArgs(
  data: BytesLike,
  from?: ChainFamily,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
  | undefined {
  if (!data || data === '') return
  let chains
  if (from) {
    const chain = supportedChains[from]
    if (!chain) throw new CCIPChainFamilyUnsupportedError(from)
    chains = [chain]
  } else {
    chains = Object.values(supportedChains)
  }
  for (const chain of chains) {
    const decoded = chain.decodeExtraArgs(data)
    if (decoded) return decoded
  }
  throw new CCIPExtraArgsParseError(String(from ?? data))
}

/**
 * Decodes finality allowed by interested parties from bytes.
 */
export function decodeFinalityAllowed(finality: number | BytesLike): FinalityAllowed {
  if (typeof finality !== 'number') finality = toNumber(finality)
  const finalityDepth = finality & 0xffff
  const finalityFlags = finality >>> 16
  const finalitySafe = !!(finalityFlags & 0x1)
  return {
    ...(finalitySafe && { finalitySafe }),
    finalityDepth,
  }
}

/**
 * Decodes requested finality from uint32, ensuring it is compatible with allowed finality.
 */
export function decodeFinalityRequested(finality: number | BytesLike): FinalityRequested {
  const { finalitySafe, finalityDepth } = decodeFinalityAllowed(finality)
  if (finalitySafe) {
    if (finalityDepth)
      throw new CCIPExtraArgsParseError('Invalid finality config: cannot have both safe and depth')
    return 'safe'
  } else if (!finalityDepth) return 'finalized'
  return finalityDepth
}

/**
 * Encodes finality allowed or requested into a uint32 format for on-chain use.
 */
export function encodeFinality(finality: FinalityAllowed | FinalityRequested | bigint): number {
  if (typeof finality === 'number' || typeof finality === 'bigint' || !isNaN(Number(finality)))
    return encodeFinality({ finalityDepth: Number(finality) })
  else if (finality === 'finalized') return encodeFinality({ finalityDepth: 0 })
  else if (finality === 'safe') return encodeFinality({ finalitySafe: true, finalityDepth: 0 })
  if (finality.finalityDepth < 0 || finality.finalityDepth > 65535)
    throw new CCIPExtraArgsParseError('Finality depth must be between 0 and 65535')
  let finalityFlags = 0
  if (finality.finalitySafe) finalityFlags |= 0x1
  return (finalityFlags << 16) | finality.finalityDepth
}
