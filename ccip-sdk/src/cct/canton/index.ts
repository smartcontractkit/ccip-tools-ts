/**
 * Canton Cross-Chain Token (CCT) admin operations.
 *
 * `CantonTokenManager` is the Canton family entry point for CCT admin writes +
 * reads, the analogue of `SolanaTokenManager` / `EVMTokenManager`. It holds a
 * {@link CantonChain} and delegates to {@link CantonOperation} / {@link CantonQuery}
 * instances — one per CCT operation.
 *
 * Operations:
 *   - Writes: `deployTokenPool` (atomic create + Initialize), `applyChainUpdates`
 *   - Reads: `getTokenPoolState`, `getRateLimiterState`, `getTokenAdminRegistry`
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../canton/index.ts'
import type { ChainContext } from '../../chain.ts'
import type { ChainFamily } from '../../networks.ts'
import { TokenManager } from '../token-manager.ts'
import {
  type GetTokenAdminRegistryParams,
  type GetTokenAdminRegistryResult,
  GetTokenAdminRegistry,
} from './token-admin-registry/operations/index.ts'
import {
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type ApplyChainUpdatesParams,
  type DeployTokenPoolParams,
  type GenerateApplyChainUpdatesResult,
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type GenerateApplyChainUpdatesParams,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  type GetRateLimiterStateParams,
  type GetRateLimiterStateResult,
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  ApplyChainUpdates,
  DeployTokenPool,
  GetRateLimiterState,
  GetTokenPoolState,
} from './token-pool/operations/index.ts'

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

  /** Builds unsigned `applyChainUpdates` commands. */
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

  // ─── TAR: reads ─────────────────────────────────────────────────────────

  /** Reads the TAR state for an instrument (admin, pendingAdmin, pool, factory wiring). */
  async getTokenAdminRegistry(
    opts: GetTokenAdminRegistryParams,
  ): Promise<GetTokenAdminRegistryResult> {
    return this.#getTokenAdminRegistry.query(this.chain, opts)
  }

  // ─── Pool: reads ────────────────────────────────────────────────────────

  /** Reads a token pool's config from the ACS. */
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
}
export type {
  ApplyChainUpdatesParams,
  DeployTokenPoolParams,
  GetRateLimiterStateParams,
  GetRateLimiterStateResult,
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
}
