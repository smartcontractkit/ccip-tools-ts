import { type BytesLike, id } from 'ethers'

import { CCIPChainFamilyUnsupportedError, CCIPExtraArgsParseError } from './errors/index.ts'
import { supportedChains } from './supported-chains.ts'
import { ChainFamily } from './types.ts'

/** Tag identifier for EVMExtraArgsV1 encoding. */
export const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
/** Tag identifier for EVMExtraArgsV2 encoding. */
export const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
/** Tag identifier for EVMExtraArgsV3 encoding (tightly packed binary format). */
export const EVMExtraArgsV3Tag = '0x302326cb' as const
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
 * EVM extra arguments version 3 with cross-chain verifiers and executor support.
 * Also known as GenericExtraArgsV3. Uses tightly packed binary encoding (NOT ABI-encoded).
 *
 * @example
 * ```typescript
 * const args: EVMExtraArgsV3 = {
 *   gasLimit: 200_000n,
 *   blockConfirmations: 5,
 *   ccvs: ['0x1234...'],
 *   ccvArgs: [new Uint8Array([1, 2, 3])],
 *   executor: '0x5678...',
 *   executorArgs: new Uint8Array([]),
 *   tokenReceiver: new Uint8Array([...]),
 *   tokenArgs: new Uint8Array([]),
 * }
 * ```
 */
export type EVMExtraArgsV3 = {
  /** Gas limit for execution on the destination chain (uint32). */
  gasLimit: bigint
  /** Number of block confirmations required. */
  blockConfirmations: number
  /** Cross-chain verifier addresses (EVM addresses). */
  ccvs: string[]
  /** Per-CCV arguments. */
  ccvArgs: Uint8Array[]
  /** Executor address (EVM address or empty string for none). */
  executor: string
  /** Executor-specific arguments. */
  executorArgs: Uint8Array
  /** Token receiver in bytes (destination chain format). */
  tokenReceiver: Uint8Array
  /** Token pool-specific arguments. */
  tokenArgs: Uint8Array
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
 * Union type of all supported extra arguments formats.
 */
export type ExtraArgs =
  | EVMExtraArgsV1
  | EVMExtraArgsV2
  | EVMExtraArgsV3
  | SVMExtraArgsV1
  | SuiExtraArgsV1

/**
 * Encodes extra arguments for CCIP messages.
 * The args are *to* a dest network, but are encoded as a message *from* this source chain.
 * E.g. Solana uses Borsh to encode extraArgs in its produced requests, even those targeting EVM.
 * @param args - Extra arguments to encode
 * @param from - Source chain family for encoding format (defaults to EVM)
 * @returns Encoded extra arguments as hex string
 * @throws {@link CCIPChainFamilyUnsupportedError} if chain family not supported
 *
 * @example
 * ```typescript
 * const encoded = encodeExtraArgs({
 *   gasLimit: 200_000n,
 *   allowOutOfOrderExecution: true,
 * })
 * // Returns: '0x181dcf10...'
 * ```
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
 * @throws {@link CCIPChainFamilyUnsupportedError} if specified chain family not supported
 * @throws {@link CCIPExtraArgsParseError} if data cannot be parsed as valid extra args
 *
 * @example
 * ```typescript
 * const decoded = decodeExtraArgs('0x181dcf10...')
 * if (decoded?._tag === 'EVMExtraArgsV2') {
 *   console.log(decoded.gasLimit, decoded.allowOutOfOrderExecution)
 * }
 * ```
 */
export function decodeExtraArgs(
  data: BytesLike,
  from?: ChainFamily,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (EVMExtraArgsV3 & { _tag: 'EVMExtraArgsV3' })
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
