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
 *     plus one-off pool config ops (`setRateLimitConfig`, `setRateLimiterReferences`,
 *     `setTransferTimeout`, `setObservers`, `setDynamicConfig`,
 *     `applyTokenTransferFeeConfigUpdates`, and the pool receive-context ops)
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
  type AddPoolReceiveContextContractValueParams,
  type AddPoolReceiveContextValueParams,
  type ApplyChainUpdatesParams,
  type ApplyTokenTransferFeeConfigUpdatesParams,
  type ClearPoolReceiveContextParams,
  type DeployTokenPoolParams,
  type ExecuteAddPoolReceiveContextContractValueParams,
  type ExecuteAddPoolReceiveContextContractValueResult,
  type ExecuteAddPoolReceiveContextValueParams,
  type ExecuteAddPoolReceiveContextValueResult,
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type ExecuteApplyTokenTransferFeeConfigUpdatesParams,
  type ExecuteApplyTokenTransferFeeConfigUpdatesResult,
  type ExecuteClearPoolReceiveContextParams,
  type ExecuteClearPoolReceiveContextResult,
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type ExecuteRemovePoolReceiveContextValueParams,
  type ExecuteRemovePoolReceiveContextValueResult,
  type ExecuteSetDynamicConfigParams,
  type ExecuteSetDynamicConfigResult,
  type ExecuteSetObserversParams,
  type ExecuteSetObserversResult,
  type ExecuteSetRateLimitConfigParams,
  type ExecuteSetRateLimitConfigResult,
  type ExecuteSetRateLimiterReferencesParams,
  type ExecuteSetRateLimiterReferencesResult,
  type ExecuteSetPoolReceiveMetadataParams,
  type ExecuteSetPoolReceiveMetadataResult,
  type ExecuteSetRateLimiterObserversParams,
  type ExecuteSetRateLimiterObserversResult,
  type ExecuteSetTransferTimeoutParams,
  type ExecuteSetTransferTimeoutResult,
  type GenerateAddPoolReceiveContextContractValueParams,
  type GenerateAddPoolReceiveContextContractValueResult,
  type GenerateAddPoolReceiveContextValueParams,
  type GenerateAddPoolReceiveContextValueResult,
  type GenerateApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesResult,
  type GenerateApplyTokenTransferFeeConfigUpdatesParams,
  type GenerateApplyTokenTransferFeeConfigUpdatesResult,
  type GenerateClearPoolReceiveContextParams,
  type GenerateClearPoolReceiveContextResult,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  type GenerateRemovePoolReceiveContextValueParams,
  type GenerateRemovePoolReceiveContextValueResult,
  type GenerateSetDynamicConfigParams,
  type GenerateSetDynamicConfigResult,
  type GenerateSetObserversParams,
  type GenerateSetObserversResult,
  type GenerateSetRateLimitConfigParams,
  type GenerateSetRateLimitConfigResult,
  type GenerateSetRateLimiterReferencesParams,
  type GenerateSetRateLimiterReferencesResult,
  type GenerateSetPoolReceiveMetadataParams,
  type GenerateSetPoolReceiveMetadataResult,
  type GenerateSetRateLimiterObserversParams,
  type GenerateSetRateLimiterObserversResult,
  type GenerateSetTransferTimeoutParams,
  type GenerateSetTransferTimeoutResult,
  type GetRateLimiterStateParams,
  type GetRateLimiterStateResult,
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  type PoolType,
  type PoolReceiveContextValue,
  type RateLimiterReferenceUpdate,
  type RemovePoolReceiveContextValueParams,
  type SetDynamicConfigParams,
  type SetObserversParams,
  type SetRateLimitConfigParams,
  type SetRateLimiterReferencesParams,
  type SetPoolReceiveMetadataParams,
  type SetRateLimiterObserversParams,
  type SetTransferTimeoutParams,
  type TokenTransferFeeConfigUpdate,
  AddPoolReceiveContextContractValue,
  AddPoolReceiveContextValue,
  ApplyChainUpdates,
  ApplyTokenTransferFeeConfigUpdates,
  ClearPoolReceiveContext,
  DeployTokenPool,
  GetRateLimiterState,
  GetTokenPoolState,
  RemovePoolReceiveContextValue,
  SetDynamicConfig,
  SetPoolReceiveMetadata,
  SetObservers,
  SetRateLimitConfig,
  SetRateLimiterReferences,
  SetRateLimiterObservers,
  SetTransferTimeout,
} from './token-pool/operations/index.ts'
import { normalizeRemoteAddress } from './token-pool/shared.ts'

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
  readonly #setRateLimiterReferences = new SetRateLimiterReferences()
  readonly #setRateLimiterObservers = new SetRateLimiterObservers()
  readonly #setPoolReceiveMetadata = new SetPoolReceiveMetadata()
  readonly #setTransferTimeout = new SetTransferTimeout()
  readonly #setObservers = new SetObservers()
  readonly #setDynamicConfig = new SetDynamicConfig()
  readonly #applyTokenTransferFeeConfigUpdates = new ApplyTokenTransferFeeConfigUpdates()
  readonly #addPoolReceiveContextValue = new AddPoolReceiveContextValue()
  readonly #addPoolReceiveContextContractValue = new AddPoolReceiveContextContractValue()
  readonly #removePoolReceiveContextValue = new RemovePoolReceiveContextValue()
  readonly #clearPoolReceiveContext = new ClearPoolReceiveContext()

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

  /** Builds unsigned `setRateLimiterReferences` commands. */
  async generateUnsignedSetRateLimiterReferences(
    opts: GenerateSetRateLimiterReferencesParams,
  ): Promise<GenerateSetRateLimiterReferencesResult> {
    return this.#setRateLimiterReferences.generate(this.chain, opts)
  }

  /** Swaps which `RateLimiter` contracts a pool's lanes reference. */
  async setRateLimiterReferences(
    opts: ExecuteSetRateLimiterReferencesParams,
  ): Promise<ExecuteSetRateLimiterReferencesResult> {
    return this.#setRateLimiterReferences.execute(this.chain, opts)
  }

  /** Builds unsigned `setRateLimiterObservers` commands. */
  async generateUnsignedSetRateLimiterObservers(
    opts: GenerateSetRateLimiterObserversParams,
  ): Promise<GenerateSetRateLimiterObserversResult> {
    return this.#setRateLimiterObservers.generate(this.chain, opts)
  }

  /** Updates a RateLimiter contract's own EDS observer parties. */
  async setRateLimiterObservers(
    opts: ExecuteSetRateLimiterObserversParams,
  ): Promise<ExecuteSetRateLimiterObserversResult> {
    return this.#setRateLimiterObservers.execute(this.chain, opts)
  }

  /** Builds unsigned `setPoolReceiveMetadata` commands. */
  async generateUnsignedSetPoolReceiveMetadata(
    opts: GenerateSetPoolReceiveMetadataParams,
  ): Promise<GenerateSetPoolReceiveMetadataResult> {
    return this.#setPoolReceiveMetadata.generate(this.chain, opts)
  }

  /**
   * Sets a lock-release pool's holdings-disclosure labels (e.g.
   * `{ "cip-112/receiver.id": "ccip-public" }` to publicly disclose the lockbox
   * via DA's holdings API). Lock-release pools only.
   */
  async setPoolReceiveMetadata(
    opts: ExecuteSetPoolReceiveMetadataParams,
  ): Promise<ExecuteSetPoolReceiveMetadataResult> {
    return this.#setPoolReceiveMetadata.execute(this.chain, opts)
  }

  /** Builds unsigned `setTransferTimeout` commands. */
  async generateUnsignedSetTransferTimeout(
    opts: GenerateSetTransferTimeoutParams,
  ): Promise<GenerateSetTransferTimeoutResult> {
    return this.#setTransferTimeout.generate(this.chain, opts)
  }

  /** Updates a pool's transfer timeout. */
  async setTransferTimeout(
    opts: ExecuteSetTransferTimeoutParams,
  ): Promise<ExecuteSetTransferTimeoutResult> {
    return this.#setTransferTimeout.execute(this.chain, opts)
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

  /** Builds unsigned `setDynamicConfig` commands. */
  async generateUnsignedSetDynamicConfig(
    opts: GenerateSetDynamicConfigParams,
  ): Promise<GenerateSetDynamicConfigResult> {
    return this.#setDynamicConfig.generate(this.chain, opts)
  }

  /** Updates a pool's dynamic config (currently the `rateLimitAdmin`; `null` clears it). */
  async setDynamicConfig(
    opts: ExecuteSetDynamicConfigParams,
  ): Promise<ExecuteSetDynamicConfigResult> {
    return this.#setDynamicConfig.execute(this.chain, opts)
  }

  /** Builds unsigned `applyTokenTransferFeeConfigUpdates` commands. */
  async generateUnsignedApplyTokenTransferFeeConfigUpdates(
    opts: GenerateApplyTokenTransferFeeConfigUpdatesParams,
  ): Promise<GenerateApplyTokenTransferFeeConfigUpdatesResult> {
    return this.#applyTokenTransferFeeConfigUpdates.generate(this.chain, opts)
  }

  /** Sets/disables per-destination token transfer fee configs. */
  async applyTokenTransferFeeConfigUpdates(
    opts: ExecuteApplyTokenTransferFeeConfigUpdatesParams,
  ): Promise<ExecuteApplyTokenTransferFeeConfigUpdatesResult> {
    return this.#applyTokenTransferFeeConfigUpdates.execute(this.chain, opts)
  }

  // ─── Pool: receive context ──────────────────────────────────────────────

  /** Builds unsigned `addPoolReceiveContextValue` commands. */
  async generateUnsignedAddPoolReceiveContextValue(
    opts: GenerateAddPoolReceiveContextValueParams,
  ): Promise<GenerateAddPoolReceiveContextValueResult> {
    return this.#addPoolReceiveContextValue.generate(this.chain, opts)
  }

  /** Adds/replaces a scalar pool receive-context entry (merged into `extraArgs` for inbound transfers). */
  async addPoolReceiveContextValue(
    opts: ExecuteAddPoolReceiveContextValueParams,
  ): Promise<ExecuteAddPoolReceiveContextValueResult> {
    return this.#addPoolReceiveContextValue.execute(this.chain, opts)
  }

  /** Builds unsigned `addPoolReceiveContextContractValue` commands. */
  async generateUnsignedAddPoolReceiveContextContractValue(
    opts: GenerateAddPoolReceiveContextContractValueParams,
  ): Promise<GenerateAddPoolReceiveContextContractValueResult> {
    return this.#addPoolReceiveContextContractValue.generate(this.chain, opts)
  }

  /** Adds/replaces a pool receive-context entry holding an already-resolved contract ID. */
  async addPoolReceiveContextContractValue(
    opts: ExecuteAddPoolReceiveContextContractValueParams,
  ): Promise<ExecuteAddPoolReceiveContextContractValueResult> {
    return this.#addPoolReceiveContextContractValue.execute(this.chain, opts)
  }

  /** Builds unsigned `removePoolReceiveContextValue` commands. */
  async generateUnsignedRemovePoolReceiveContextValue(
    opts: GenerateRemovePoolReceiveContextValueParams,
  ): Promise<GenerateRemovePoolReceiveContextValueResult> {
    return this.#removePoolReceiveContextValue.generate(this.chain, opts)
  }

  /** Removes one pool receive-context entry. */
  async removePoolReceiveContextValue(
    opts: ExecuteRemovePoolReceiveContextValueParams,
  ): Promise<ExecuteRemovePoolReceiveContextValueResult> {
    return this.#removePoolReceiveContextValue.execute(this.chain, opts)
  }

  /** Builds unsigned `clearPoolReceiveContext` commands. */
  async generateUnsignedClearPoolReceiveContext(
    opts: GenerateClearPoolReceiveContextParams,
  ): Promise<GenerateClearPoolReceiveContextResult> {
    return this.#clearPoolReceiveContext.generate(this.chain, opts)
  }

  /** Clears all pool receive-context entries. */
  async clearPoolReceiveContext(
    opts: ExecuteClearPoolReceiveContextParams,
  ): Promise<ExecuteClearPoolReceiveContextResult> {
    return this.#clearPoolReceiveContext.execute(this.chain, opts)
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
  AddPoolReceiveContextContractValue,
  AddPoolReceiveContextValue,
  ApplyChainUpdates,
  ApplyTokenTransferFeeConfigUpdates,
  ClearPoolReceiveContext,
  DeployTokenPool,
  GetRateLimiterState,
  GetTokenAdminRegistry,
  GetTokenPoolState,
  RemovePoolReceiveContextValue,
  SetDynamicConfig,
  SetPoolReceiveMetadata,
  SetObservers,
  SetRateLimitConfig,
  SetRateLimiterReferences,
  SetRateLimiterObservers,
  SetTransferTimeout,
}
export type {
  AddPoolReceiveContextContractValueParams,
  AddPoolReceiveContextValueParams,
  ApplyChainUpdatesParams,
  ApplyTokenTransferFeeConfigUpdatesParams,
  ClearPoolReceiveContextParams,
  DeployTokenPoolParams,
  PoolType,
  GetRateLimiterStateParams,
  GetRateLimiterStateResult,
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
  PoolReceiveContextValue,
  RateLimiterReferenceUpdate,
  RemovePoolReceiveContextValueParams,
  SetDynamicConfigParams,
  SetPoolReceiveMetadataParams,
  SetObserversParams,
  SetRateLimitConfigParams,
  SetRateLimiterReferencesParams,
  SetRateLimiterObserversParams,
  SetTransferTimeoutParams,
  TokenTransferFeeConfigUpdate,
}

// Network constants + address helpers used to compose deploy/lane params.
export { getCantonNetworkConfig, deriveTokenConfigInstanceAddress, normalizeRemoteAddress }
export type { CantonNetworkConfig } from '../../canton/networks.ts'
