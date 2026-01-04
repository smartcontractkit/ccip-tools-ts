import { type BytesLike, hexlify } from 'ethers'

import type { EVMExtraArgsV2, SVMExtraArgsV1, SuiExtraArgsV1 } from './extra-args.ts'
import { ChainFamily } from './types.ts'

/**
 * Union of all ExtraArgs types used for default values.
 *
 * Chain family to type mapping:
 * - EVM, Aptos, TON → {@link EVMExtraArgsV2} (gasLimit + allowOutOfOrderExecution)
 * - Solana → {@link SVMExtraArgsV1} (computeUnits + tokenReceiver + accounts)
 * - Sui → {@link SuiExtraArgsV1} (gasLimit + tokenReceiver + receiverObjectIds)
 */
export type DefaultExtraArgs = EVMExtraArgsV2 | SVMExtraArgsV1 | SuiExtraArgsV1

/**
 * Default extraArgs by destination chain family.
 * Used when normalizing {@link TokenTransferMessage} to internal {@link FullMessage} format.
 *
 * @remarks
 * Design decisions:
 * - `gasLimit`/`computeUnits`: 0 = use chain's default (sufficient for token-only transfers)
 * - `allowOutOfOrderExecution`: true = better UX, no ordering constraints for simple transfers
 * - `tokenReceiver`: populated dynamically from receiver address (Solana/Sui only)
 *
 * @internal
 */
const DEFAULT_EXTRA_ARGS: Readonly<Record<ChainFamily, DefaultExtraArgs>> = {
  [ChainFamily.EVM]: {
    gasLimit: 0n,
    allowOutOfOrderExecution: true,
  },
  [ChainFamily.Solana]: {
    computeUnits: 0n,
    accountIsWritableBitmap: 0n,
    allowOutOfOrderExecution: true,
    tokenReceiver: '', // Populated dynamically from receiver
    accounts: [],
  },
  [ChainFamily.Aptos]: {
    gasLimit: 0n,
    allowOutOfOrderExecution: true,
  },
  [ChainFamily.Sui]: {
    gasLimit: 0n,
    allowOutOfOrderExecution: true,
    tokenReceiver: '', // Populated dynamically from receiver
    receiverObjectIds: [],
  },
  [ChainFamily.TON]: {
    gasLimit: 0n,
    allowOutOfOrderExecution: true,
  },
} as const

/**
 * Get default extraArgs for a destination chain family.
 *
 * Handles chain-specific field population:
 * - Solana: Sets `tokenReceiver` to the destination receiver address
 * - Sui: Sets `tokenReceiver` to the destination receiver address
 * - EVM/Aptos/TON: Returns base defaults (no dynamic fields)
 *
 * @param destFamily - Destination chain family (determines extraArgs structure)
 * @param receiver - Destination receiver address. For Solana/Sui, this is used as
 *   the `tokenReceiver` field. Can be a hex string or bytes.
 * @returns ExtraArgs with sensible defaults for token-only transfers.
 *   The returned object is a shallow copy (safe to mutate).
 *
 * @example
 * ```typescript
 * const extraArgs = getDefaultExtraArgs(ChainFamily.Solana, '0x1234...')
 * // { computeUnits: 0n, tokenReceiver: '0x1234...', ... }
 * ```
 */
export function getDefaultExtraArgs(
  destFamily: ChainFamily,
  receiver: BytesLike,
): DefaultExtraArgs {
  const base = DEFAULT_EXTRA_ARGS[destFamily]
  const receiverStr = typeof receiver === 'string' ? receiver : hexlify(receiver)

  // Solana requires tokenReceiver - default to receiver address
  if (destFamily === ChainFamily.Solana) {
    return {
      ...base,
      tokenReceiver: receiverStr,
    } as SVMExtraArgsV1
  }

  // Sui requires tokenReceiver - default to receiver address
  if (destFamily === ChainFamily.Sui) {
    return {
      ...base,
      tokenReceiver: receiverStr,
    } as SuiExtraArgsV1
  }

  return { ...base }
}
