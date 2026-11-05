/**
 * Canton Cross-Chain Token (CCT) admin operations.
 *
 * `CantonTokenManager` is the Canton family entry point for CCT admin writes +
 * reads, the analogue of `SolanaTokenManager` / `EVMTokenManager`. It holds a
 * {@link CantonChain} and delegates to {@link CantonOperation} / {@link CantonQuery}
 * instances — one per CCT operation.
 *
 * Operations:
 *   - Writes: `deployTokenPool` (atomic create + Initialize), `applyChainUpdates`,
 *     plus one-off pool config ops (`setRateLimitConfig`, `setObservers`)
 *   - Reads: `getTokenPoolState`, `getRateLimiterState`, `getTokenAdminRegistry`
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../canton/index.ts'
import { getCantonNetworkConfig } from '../../canton/networks.ts'
import type { ChainContext } from '../../chain.ts'
import type { ChainFamily } from '../../networks.ts'
import { TokenManager } from '../token-manager.ts'
import {
  type GetTokenAdminRegistryParams,
  type GetTokenAdminRegistryResult,
  GetTokenAdminRegistry,
} from './token-admin-registry/operations/index.ts'
import { deriveTokenConfigInstanceAddress } from './token-admin-registry/shared.ts'
import {
  type ApplyChainUpdatesParams,
  type DeployTokenPoolParams,
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type ExecuteSetObserversParams,
  type ExecuteSetObserversResult,
  type ExecuteSetRateLimitConfigParams,
  type ExecuteSetRateLimitConfigResult,
  type GenerateApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesResult,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  type GenerateSetObserversParams,
  type GenerateSetObserversResult,
  type GenerateSetRateLimitConfigParams,
  type GenerateSetRateLimitConfigResult,
  type GetRateLimiterStateParams,
  type GetRateLimiterStateResult,
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  type PoolType,
  type SetObserversParams,
  type SetRateLimitConfigParams,
  ApplyChainUpdates,
  DeployTokenPool,
  GetRateLimiterState,
  GetTokenPoolState,
  SetObservers,
  SetRateLimitConfig,
} from './token-pool/operations/index.ts'
export {
  TRANSFER_PREAPPROVAL_CONTEXT_KEY,
  TRANSFER_PREAPPROVAL_TEMPLATE_ID,
  resolveTransferPreapprovalCid,
} from './token-pool/preapproval.ts'
export { CCIP_PUBLIC_LABEL, CIP112_RECEIVER_ID_META_KEY } from './token-pool/shared.ts'
export { decodeDamlRecord, extractRecordField, extractFieldValue } from '../../canton/events.ts'
export type { CantonActiveContract } from '../../canton/types.ts'
import { normalizeRemoteAddress } from './token-pool/shared.ts'
export { POOL_TEMPLATE_IDS } from './token-pool/shared.ts'

/**
 * Canton CCT manager. Holds a {@link CantonChain} and exposes the CCT admin
 * operations as methods. Each write op has a `generateUnsigned<Op>` (build
 * unsigned `JsCommands`, no signing) and an `<op>` (sign + submit) variant; each
 * read op has a single `<op>` method (no wallet).
 */
export class CantonTokenManager extends TokenManager<typeof ChainFamily.Canton> {
  readonly chain: CantonChain

  // Write operations (one instance each, reused across calls).
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #setRateLimitConfig = new SetRateLimitConfig()
  readonly #setObservers = new SetObservers()

  // Read operations.
  readonly #getTokenAdminRegistry = new GetTokenAdminRegistry()
  readonly #getTokenPoolState = new GetTokenPoolState()
  readonly #getRateLimiterState = new GetRateLimiterState()

  /** Creates a Canton CCT manager for an existing chain. */
  constructor(chain: CantonChain) {
    super()
    this.chain = chain
  }

  /** Wraps an existing {@link CantonChain}. */
  static fromChain(chain: CantonChain): CantonTokenManager {
    return new CantonTokenManager(chain)
  }

  /** Creates from a Canton JSON Ledger API URL. */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<CantonTokenManager> {
    const { CantonChain } = await import('../../canton/index.ts')
    return new CantonTokenManager(await CantonChain.fromUrl(url, ctx))
  }

  // ─── Pool: deployTokenPool ──────────────────────────────────────────────

  /**
   * Builds unsigned `deployTokenPool` commands — a single `CreateAndExercise`
   * that creates the registry-pools `BurnMintTokenPool`/`LockReleaseTokenPool`
   * and atomically calls `Initialize` on it (TAR registration + lane rate
   * limiters).
   *
   * @remarks The pool owner is `instrumentId.admin` and `admin` defaults to it;
   * the TAR (and so `ccipOwner`) is `deps.tokenAdminRegistry`.
   */
  async generateUnsignedDeployTokenPool(
    opts: GenerateDeployTokenPoolParams,
  ): Promise<GenerateDeployTokenPoolResult> {
    return this.#deployTokenPool.generate(this.chain, opts)
  }

  /** Atomically deploys and initializes a `BurnMintTokenPool`/`LockReleaseTokenPool` (registry-pools family). */
  async deployTokenPool(opts: ExecuteDeployTokenPoolParams): Promise<ExecuteDeployTokenPoolResult> {
    return this.#deployTokenPool.execute(this.chain, opts)
  }

  // ─── Pool: applyChainUpdates ────────────────────────────────────────────

  /**
   * Builds unsigned `applyChainUpdates` commands.
   *
   * @remarks Remote addresses are in the remote chain's own format; its chain
   * family must be registered (e.g. `import '@chainlink/ccip-sdk/all'`).
   */
  async generateUnsignedApplyChainUpdates(
    opts: GenerateApplyChainUpdatesParams,
  ): Promise<GenerateApplyChainUpdatesResult> {
    return this.#applyChainUpdates.generate(this.chain, opts)
  }

  /** Adds and/or removes remote-chain configs on a token pool. */
  async applyChainUpdates(
    opts: ExecuteApplyChainUpdatesParams,
  ): Promise<ExecuteApplyChainUpdatesResult> {
    return this.#applyChainUpdates.execute(this.chain, opts)
  }

  // ─── Pool: one-off config ops ───────────────────────────────────────────
  // Each `generateUnsigned<Op>` builds the unsigned exercise command; `<op>`
  // signs and submits. All return the new contract ID (the pool's, or the
  // rate limiter's for `setRateLimitConfig`).

  /** Builds unsigned `setRateLimitConfig` commands. */
  async generateUnsignedSetRateLimitConfig(
    opts: GenerateSetRateLimitConfigParams,
  ): Promise<GenerateSetRateLimitConfigResult> {
    return this.#setRateLimitConfig.generate(this.chain, opts)
  }

  /**
   * Sets one lane rate limiter's `isEnabled`/`capacity`/`rate`. Callable by the
   * pool owner or the pool's `rateLimitAdmin`. Note: `isEnabled: false` means
   * unlimited throughput (and requires zero capacity/rate); to block a
   * direction, set `isEnabled: true, capacity: 0n, rate: 0n`.
   */
  async setRateLimitConfig(
    opts: ExecuteSetRateLimitConfigParams,
  ): Promise<ExecuteSetRateLimitConfigResult> {
    return this.#setRateLimitConfig.execute(this.chain, opts)
  }

  /** Builds unsigned `setObservers` commands. */
  async generateUnsignedSetObservers(
    opts: GenerateSetObserversParams,
  ): Promise<GenerateSetObserversResult> {
    return this.#setObservers.generate(this.chain, opts)
  }

  /** Updates a pool's EDS observer parties. */
  async setObservers(opts: ExecuteSetObserversParams): Promise<ExecuteSetObserversResult> {
    return this.#setObservers.execute(this.chain, opts)
  }

  // ─── TAR: reads ─────────────────────────────────────────────────────────

  /** Reads the TAR state for an instrument (admin, pendingAdmin, pool, factory wiring). */
  async getTokenAdminRegistry(
    opts: GetTokenAdminRegistryParams,
  ): Promise<GetTokenAdminRegistryResult> {
    return this.#getTokenAdminRegistry.query(this.chain, opts)
  }

  // ─── Pool: reads ────────────────────────────────────────────────────────

  /** Reads a token pool's config (including its `poolType`) from the ACS. */
  async getTokenPoolState(opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult> {
    return this.#getTokenPoolState.query(this.chain, opts)
  }

  /** Reads a `RateLimiter` contract's config (capacity/rate/enabled/observers) from the ACS. */
  async getRateLimiterState(opts: GetRateLimiterStateParams): Promise<GetRateLimiterStateResult> {
    return this.#getRateLimiterState.query(this.chain, opts)
  }
}

// Re-export the operation classes + param/result types for direct use.
export {
  ApplyChainUpdates,
  DeployTokenPool,
  GetRateLimiterState,
  GetTokenAdminRegistry,
  GetTokenPoolState,
  SetObservers,
  SetRateLimitConfig,
}
export type {
  ApplyChainUpdatesParams,
  DeployTokenPoolParams,
  PoolType,
  GetRateLimiterStateParams,
  GetRateLimiterStateResult,
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
  SetObserversParams,
  SetRateLimitConfigParams,
}

// Network constants + address helpers used to compose deploy/lane params.
export { getCantonNetworkConfig, deriveTokenConfigInstanceAddress, normalizeRemoteAddress }
export type { CantonNetworkConfig } from '../../canton/networks.ts'
