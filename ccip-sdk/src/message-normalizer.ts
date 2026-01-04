import { getDefaultExtraArgs } from './message-defaults.ts'
import { type FullMessage, type MessageInput, isTokenTransfer } from './message.ts'
import type { ChainFamily } from './types.ts'
import { networkInfo } from './utils.ts'

/**
 * Internal message format used by chain implementations.
 *
 * This is the canonical format that all chain methods (`getFee`, `sendMessage`, etc.)
 * work with internally. It's a {@link FullMessage} (with `kind: 'full'`) plus an
 * optional `fee` field for send operations.
 *
 * @remarks
 * This type should not be exposed to end users. It's an internal implementation
 * detail of the normalization layer.
 */
export type NormalizedMessage = FullMessage & { fee?: bigint }

/**
 * Normalizes any {@link MessageInput} to the internal {@link FullMessage} format.
 *
 * Transformation rules:
 * - **FullMessage**: Returned as-is (already has all required data)
 * - **TokenTransferMessage**: Converted to FullMessage with:
 *   - `kind`: `'full'`
 *   - `data`: `'0x'` (empty calldata)
 *   - `extraArgs`: Chain-specific defaults via {@link getDefaultExtraArgs}
 *   - `tokenAmounts`: Single-element array with `[{ token, amount }]`
 *   - `feeToken`: Preserved from input
 *
 * This is a **pure function** with no side effects.
 *
 * @param message - User-provided message (token transfer or full)
 * @param destChainSelector - CCIP destination chain selector. Used to determine
 *   the chain family for applying appropriate extraArgs defaults.
 * @returns Normalized message ready for chain implementation.
 *
 * @throws CCIPChainNotFoundError if `destChainSelector` is not a known CCIP chain selector.
 *
 * @example
 * ```typescript
 * // TokenTransferMessage gets converted
 * const normalized = normalizeMessage(
 *   tokenTransfer({ receiver: '0x...', token: usdc, amount: 100n }),
 *   ETHEREUM_SELECTOR
 * )
 * // Result: { kind: 'full', data: '0x', extraArgs: {...}, tokenAmounts: [...] }
 * ```
 */
export function normalizeMessage(
  message: MessageInput,
  destChainSelector: bigint,
): NormalizedMessage {
  if (!isTokenTransfer(message)) {
    return message
  }

  const destNetwork = networkInfo(destChainSelector)
  const destFamily = destNetwork.family as ChainFamily

  return {
    kind: 'full' as const,
    receiver: message.receiver,
    data: '0x', // Empty calldata for token transfers
    extraArgs: getDefaultExtraArgs(destFamily, message.receiver),
    tokenAmounts: [{ token: message.token, amount: message.amount }],
    feeToken: message.feeToken,
  }
}

/**
 * Normalizes message with fee attached (for sendMessage operations).
 *
 * This is a convenience wrapper around {@link normalizeMessage} that also
 * handles the optional `fee` field used in send operations.
 *
 * @param message - Message input with optional `fee` property
 * @param destChainSelector - CCIP destination chain selector
 * @returns Normalized message. If input has `fee` defined, it's preserved in output.
 *
 * @throws CCIPChainNotFoundError if `destChainSelector` is not a known CCIP chain selector.
 *
 * @example
 * ```typescript
 * const msg = normalizeMessageWithFee(
 *   { ...tokenTransfer({ receiver, token, amount }), fee: 50000n },
 *   destSelector
 * )
 * // msg.fee === 50000n
 * ```
 */
export function normalizeMessageWithFee(
  message: MessageInput & { fee?: bigint },
  destChainSelector: bigint,
): NormalizedMessage {
  const normalized = normalizeMessage(message, destChainSelector)
  if ('fee' in message && message.fee !== undefined) {
    return { ...normalized, fee: message.fee }
  }
  return normalized
}
