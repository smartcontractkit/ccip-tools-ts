/**
 * Minimal structural interface for viem-compatible public clients.
 *
 * This interface uses structural typing to accept any client with the required
 * properties, including wagmi/RainbowKit's complex computed types that fail
 * with viem's strict generic types.
 *
 * ## Why `unknown` for methods?
 *
 * TypeScript function parameters are **contravariant**. When we define:
 * ```ts
 * request: (args: { method: string }) => Promise<unknown>
 * ```
 * And viem defines:
 * ```ts
 * request: (args: { method: "eth_blockNumber" } | { method: "eth_call"; params: [...] }) => Promise<...>
 * ```
 * Our broader `string` type is NOT assignable to their specific union, causing errors.
 *
 * By using `unknown`, we tell TypeScript: "don't check this function's signature".
 * Type safety is preserved at the **call site** (viem enforces it), not at the
 * SDK boundary (where we just need to pass the client through).
 *
 * ## Why this is needed
 *
 * OP Stack chains (Base, Optimism) have `type: "deposit"` transactions that
 * L1 chains don't have. When wagmi creates `PublicClient<Transport, sepolia | baseSepolia>`,
 * the return types of methods like `getBlock()` become incompatible unions.
 * This structural interface sidesteps that entirely.
 */
export interface ViemClientLike {
  /** Chain configuration - required for network identification */
  readonly chain: {
    readonly id: number
    readonly name: string
  } | null
  /**
   * EIP-1193 request function.
   * Typed as `unknown` to avoid contravariance issues with viem's strict method unions.
   * Runtime: this is viem's `client.request()` method.
   */
  request: unknown
}

/**
 * Minimal structural interface for viem-compatible wallet clients.
 * Extends ViemClientLike with account information for signing operations.
 */
export interface ViemWalletClientLike extends ViemClientLike {
  /**
   * Connected account - required for signing operations.
   * Address typed as `unknown` because viem uses `string | Addressable`.
   */
  readonly account:
    | {
        readonly address: unknown
        readonly type: string
      }
    | undefined
}
