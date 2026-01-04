import type { BytesLike } from 'ethers'

import type { ExtraArgs } from './extra-args.ts'

/**
 * Token transfer message - simplified format for single token transfers.
 * Use the `tokenTransfer()` factory function to create instances.
 *
 * The SDK automatically handles:
 * - `receiver`: Encoded to the correct format for the destination chain (32-byte padding)
 * - `data`: Empty (`0x`)
 * - `extraArgs`: Chain-appropriate defaults with `allowOutOfOrderExecution: true`
 *
 * @example
 * ```typescript
 * import { tokenTransfer } from '@chainlink/ccip-sdk'
 *
 * const msg = tokenTransfer({
 *   receiver: '0x...',
 *   token: usdcAddress,
 *   amount: 1_000_000n,
 * })
 * ```
 */
export type TokenTransferMessage = {
  /** Discriminant tag - set automatically by factory, do not modify */
  readonly kind: 'token'
  /**
   * Receiver address on destination chain.
   * Accepts multiple formats - the SDK encodes automatically:
   * - EVM hex address: `'0x1234...abcd'`
   * - Solana base58: `'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'`
   * - Raw bytes: `Uint8Array`
   */
  readonly receiver: BytesLike
  /** Token contract address to transfer */
  readonly token: string
  /** Amount to transfer (in token's smallest unit) */
  readonly amount: bigint
  /** Fee payment token (optional, defaults to native) */
  readonly feeToken?: string
}

/**
 * Full message - complete control over all CCIP message fields.
 * Use the `message()` factory function to create instances.
 *
 * Use this when you need:
 * - Custom calldata (`data`)
 * - Specific `extraArgs` (gas limit, out-of-order execution, etc.)
 * - Multiple token transfers
 *
 * @example
 * ```typescript
 * import { message } from '@chainlink/ccip-sdk'
 *
 * const msg = message({
 *   receiver: '0x...',
 *   data: '0x1234',
 *   extraArgs: { gasLimit: 500_000n, allowOutOfOrderExecution: true },
 *   tokenAmounts: [{ token: usdc, amount: 1_000_000n }],
 * })
 * ```
 */
export type FullMessage = {
  /** Discriminant tag - set automatically by factory, do not modify */
  readonly kind: 'full'
  /**
   * Receiver address on destination chain.
   * Accepts multiple formats - the SDK encodes automatically:
   * - EVM hex address: `'0x1234...abcd'`
   * - Solana base58: `'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'`
   * - Raw bytes: `Uint8Array`
   */
  readonly receiver: BytesLike
  /** Arbitrary data payload */
  readonly data: BytesLike
  /** Chain-specific execution arguments */
  readonly extraArgs: ExtraArgs
  /** Tokens to transfer (optional) */
  readonly tokenAmounts?: readonly { token: string; amount: bigint }[]
  /** Fee payment token (optional, defaults to native) */
  readonly feeToken?: string
}

/**
 * Union type for all message formats accepted by getFee/sendMessage.
 */
export type MessageInput = TokenTransferMessage | FullMessage

/**
 * Input parameters for tokenTransfer factory (excludes internal 'kind' tag).
 */
export type TokenTransferParams = Omit<TokenTransferMessage, 'kind'>

/**
 * Input parameters for message factory (excludes internal 'kind' tag).
 */
export type FullMessageParams = Omit<FullMessage, 'kind'>

/**
 * Factory function to create a token transfer message.
 * The discriminant tag is set automatically - users never need to specify it.
 *
 * Defaults applied during normalization:
 * - `data`: `0x` (empty)
 * - `extraArgs`: Chain-appropriate defaults based on destination
 * - `allowOutOfOrderExecution`: `true`
 *
 * @param params - Token transfer parameters
 * @returns Immutable TokenTransferMessage with 'kind' tag set
 *
 * @example
 * ```typescript
 * import { tokenTransfer } from '@chainlink/ccip-sdk'
 *
 * const fee = await chain.getFee(router, destSelector, tokenTransfer({
 *   receiver: recipientAddress,
 *   token: usdcAddress,
 *   amount: 1_000_000n,
 * }))
 * ```
 */
export function tokenTransfer(params: TokenTransferParams): TokenTransferMessage {
  return Object.freeze({
    kind: 'token' as const,
    receiver: params.receiver,
    token: params.token,
    amount: params.amount,
    ...(params.feeToken !== undefined && { feeToken: params.feeToken }),
  })
}

/**
 * Factory function to create a full CCIP message with complete control.
 * The discriminant tag is set automatically - users never need to specify it.
 *
 * @param params - Full message parameters
 * @returns Immutable FullMessage with 'kind' tag set
 *
 * @example
 * ```typescript
 * import { message } from '@chainlink/ccip-sdk'
 *
 * const fee = await chain.getFee(router, destSelector, message({
 *   receiver: recipientAddress,
 *   data: '0x1234abcd',
 *   extraArgs: { gasLimit: 500_000n, allowOutOfOrderExecution: true },
 *   tokenAmounts: [{ token: usdcAddress, amount: 1_000_000n }],
 * }))
 * ```
 */
export function message(params: FullMessageParams): FullMessage {
  return Object.freeze({
    kind: 'full' as const,
    receiver: params.receiver,
    data: params.data,
    extraArgs: params.extraArgs,
    ...(params.tokenAmounts !== undefined && { tokenAmounts: params.tokenAmounts }),
    ...(params.feeToken !== undefined && { feeToken: params.feeToken }),
  })
}

/**
 * Type guard to check if message is a token transfer.
 * Uses discriminant tag for O(1) type narrowing.
 *
 * @param msg - Message to check
 * @returns True if message is a TokenTransferMessage
 */
export function isTokenTransfer(msg: MessageInput): msg is TokenTransferMessage {
  return msg.kind === 'token'
}

/**
 * Type guard to check if message is a full message.
 * Uses discriminant tag for O(1) type narrowing.
 *
 * @param msg - Message to check
 * @returns True if message is a FullMessage
 */
export function isFullMessage(msg: MessageInput): msg is FullMessage {
  return msg.kind === 'full'
}
