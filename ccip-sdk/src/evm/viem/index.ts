/**
 * Viem adapters for CCIP SDK.
 *
 * @example
 * ```typescript
 * import { createPublicClient, createWalletClient, http } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { fromViemClient, viemWallet } from '@chainlink/ccip-sdk/viem'
 *
 * // Create chain from viem client
 * const publicClient = createPublicClient({ chain: mainnet, transport: http() })
 * const chain = await fromViemClient(publicClient)
 *
 * // Read operations work immediately
 * const messages = await chain.getMessagesInTx(tx)
 *
 * // For write operations, wrap your WalletClient
 * const walletClient = createWalletClient({ chain: mainnet, transport: http(), account })
 * const request = await chain.sendMessage(router, destSelector, message, {
 *   wallet: viemWallet(walletClient)
 * })
 * ```
 *
 * @packageDocumentation
 */

export { fromViemClient } from './client-adapter.ts'
export { viemWallet } from './wallet-adapter.ts'
export type { ViemPublicClient, ViemWalletClient } from './types.ts'
