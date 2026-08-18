/**
 * Canton Cross-Chain Token (CCT) admin operations.
 *
 * `CantonTokenManager` is the Canton family entry point for CCT admin writes +
 * reads, the analogue of `SolanaTokenManager` / `EVMTokenManager`. It holds a
 * {@link CantonChain} and delegates to {@link CantonOperation} / {@link CantonQuery}
 * instances — one per CCT operation.
 *
 * Phase 1 (Registry use case) operations:
 *   - TAR: `setPool`, `registerAdmin`, `acceptAdmin`, `transferAdmin`,
 *          `getTokenAdminRegistry`, `getSupportedTokens`
 *   - Pool: `deployTokenPool`, `applyChainUpdates`, `setRateLimitConfig`,
 *            `setDynamicConfig`, `getRequiredCCVs`, `getTokenPoolState`
 *
 * Parked / excluded operations throw `CCTOperationUnsupportedError` (see Table 2).
 *
 * @packageDocumentation
 */

import type { ChainContext } from '../../chain.ts'
import { ChainFamily } from '../../networks.ts'
import type { CantonChain } from '../../canton/index.ts'
import { TokenManager } from '../token-manager.ts'
import {
  SetPool,
  RegisterAdmin,
  AcceptAdmin,
  TransferAdmin,
  GetTokenAdminRegistry,
  GetSupportedTokens,
  type SetPoolParams,
  type GenerateSetPoolParams,
  type GenerateSetPoolResult,
  type ExecuteSetPoolParams,
  type ExecuteSetPoolResult,
  type GenerateRegisterAdminParams,
  type GenerateRegisterAdminResult,
  type ExecuteRegisterAdminParams,
  type ExecuteRegisterAdminResult,
  type RegisterAdminParams,
  type GenerateAcceptAdminParams,
  type GenerateAcceptAdminResult,
  type ExecuteAcceptAdminParams,
  type ExecuteAcceptAdminResult,
  type AcceptAdminParams,
  type GenerateTransferAdminParams,
  type GenerateTransferAdminResult,
  type ExecuteTransferAdminParams,
  type ExecuteTransferAdminResult,
  type TransferAdminParams,
  type GetTokenAdminRegistryParams,
  type GetTokenAdminRegistryResult,
  type GetSupportedTokensParams,
  type GetSupportedTokensResult,
} from './token-admin-registry/operations/index.ts'
import {
  DeployTokenPool,
  ApplyChainUpdates,
  SetRateLimitConfig,
  SetDynamicConfig,
  GetRequiredCCVs,
  GetTokenPoolState,
  type DeployTokenPoolParams,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type ApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesResult,
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type SetRateLimitConfigParams,
  type GenerateSetRateLimitConfigParams,
  type GenerateSetRateLimitConfigResult,
  type ExecuteSetRateLimitConfigParams,
  type ExecuteSetRateLimitConfigResult,
  type SetDynamicConfigParams,
  type GenerateSetDynamicConfigParams,
  type GenerateSetDynamicConfigResult,
  type ExecuteSetDynamicConfigParams,
  type ExecuteSetDynamicConfigResult,
  type GetRequiredCCVsParams,
  type GetRequiredCCVsResult,
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
} from './token-pool/operations/index.ts'

/**
 * Canton CCT manager. Holds a {@link CantonChain} and exposes the Phase-1 CCT
 * admin operations as methods. Each write op has a `generateUnsigned<Op>` (build
 * unsigned `JsCommands`, no signing) and an `<op>` (sign + submit) variant; each
 * read op has a single `<op>` method (no wallet).
 */
export class CantonTokenManager extends TokenManager<typeof ChainFamily.Canton> {
  readonly chain: CantonChain

  // Write operations (one instance each, reused across calls).
  readonly #setPool = new SetPool()
  readonly #registerAdmin = new RegisterAdmin()
  readonly #acceptAdmin = new AcceptAdmin()
  readonly #transferAdmin = new TransferAdmin()
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #setRateLimitConfig = new SetRateLimitConfig()
  readonly #setDynamicConfig = new SetDynamicConfig()

  // Read operations.
  readonly #getTokenAdminRegistry = new GetTokenAdminRegistry()
  readonly #getSupportedTokens = new GetSupportedTokens()
  readonly #getRequiredCCVs = new GetRequiredCCVs()
  readonly #getTokenPoolState = new GetTokenPoolState()

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

  // ─── TAR: setPool ───────────────────────────────────────────────────────

  /** Builds unsigned TAR `setPool` commands (register or delist a pool). */
  async generateUnsignedSetPool(opts: GenerateSetPoolParams): Promise<GenerateSetPoolResult> {
    return this.#setPool.generate(this.chain, opts)
  }

  /** Registers (or delists) a pool for an instrument in the TAR. */
  async setPool(opts: ExecuteSetPoolParams): Promise<ExecuteSetPoolResult> {
    return this.#setPool.execute(this.chain, opts) as Promise<ExecuteSetPoolResult>
  }

  // ─── TAR: registerAdmin ─────────────────────────────────────────────────

  /** Builds unsigned TAR `registerAdmin` (ProposeAdministrator) commands. */
  async generateUnsignedRegisterAdmin(
    opts: GenerateRegisterAdminParams,
  ): Promise<GenerateRegisterAdminResult> {
    return this.#registerAdmin.generate(this.chain, opts)
  }

  /** Proposes a new administrator for an instrument in the TAR. */
  async registerAdmin(opts: ExecuteRegisterAdminParams): Promise<ExecuteRegisterAdminResult> {
    return this.#registerAdmin.execute(this.chain, opts) as Promise<ExecuteRegisterAdminResult>
  }

  // ─── TAR: acceptAdmin ───────────────────────────────────────────────────

  /** Builds unsigned TAR `acceptAdmin` (AcceptAdminRole) commands. */
  async generateUnsignedAcceptAdmin(
    opts: GenerateAcceptAdminParams,
  ): Promise<GenerateAcceptAdminResult> {
    return this.#acceptAdmin.generate(this.chain, opts)
  }

  /** Accepts the admin role for an instrument in the TAR. */
  async acceptAdmin(opts: ExecuteAcceptAdminParams): Promise<ExecuteAcceptAdminResult> {
    return this.#acceptAdmin.execute(this.chain, opts) as Promise<ExecuteAcceptAdminResult>
  }

  // ─── TAR: transferAdmin ─────────────────────────────────────────────────

  /** Builds unsigned TAR `transferAdmin` (TransferAdminRole) commands. */
  async generateUnsignedTransferAdmin(
    opts: GenerateTransferAdminParams,
  ): Promise<GenerateTransferAdminResult> {
    return this.#transferAdmin.generate(this.chain, opts)
  }

  /** Transfers the admin role for an instrument to a new party. */
  async transferAdmin(opts: ExecuteTransferAdminParams): Promise<ExecuteTransferAdminResult> {
    return this.#transferAdmin.execute(this.chain, opts) as Promise<ExecuteTransferAdminResult>
  }

  // ─── TAR: reads ─────────────────────────────────────────────────────────

  /** Reads the TAR state for an instrument (admin, pendingAdmin, pool, etc.). */
  async getTokenAdminRegistry(
    opts: GetTokenAdminRegistryParams,
  ): Promise<GetTokenAdminRegistryResult> {
    return this.#getTokenAdminRegistry.query(this.chain, opts)
  }

  /** Enumerates the instruments registered in the TAR (supported tokens). */
  async getSupportedTokens(opts: GetSupportedTokensParams): Promise<GetSupportedTokensResult> {
    return this.#getSupportedTokens.query(this.chain, opts)
  }

  // ─── Pool: deployTokenPool ──────────────────────────────────────────────

  /** Builds unsigned `deployTokenPool` (CCIPFactory.DeployBurnMint/LockRelease) commands. */
  async generateUnsignedDeployTokenPool(
    opts: GenerateDeployTokenPoolParams,
  ): Promise<GenerateDeployTokenPoolResult> {
    return this.#deployTokenPool.generate(this.chain, opts)
  }

  /** Deploys a `BurnMintTokenPool` or `LockReleaseTokenPool` via the CCIPFactory. */
  async deployTokenPool(opts: ExecuteDeployTokenPoolParams): Promise<ExecuteDeployTokenPoolResult> {
    return this.#deployTokenPool.execute(this.chain, opts) as Promise<ExecuteDeployTokenPoolResult>
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
    return this.#applyChainUpdates.execute(this.chain, opts) as Promise<ExecuteApplyChainUpdatesResult>
  }

  // ─── Pool: setRateLimitConfig ───────────────────────────────────────────

  /** Builds unsigned `setRateLimitConfig` commands. */
  async generateUnsignedSetRateLimitConfig(
    opts: GenerateSetRateLimitConfigParams,
  ): Promise<GenerateSetRateLimitConfigResult> {
    return this.#setRateLimitConfig.generate(this.chain, opts)
  }

  /** Sets the rate-limit config for a remote chain on a pool. */
  async setRateLimitConfig(
    opts: ExecuteSetRateLimitConfigParams,
  ): Promise<ExecuteSetRateLimitConfigResult> {
    return this.#setRateLimitConfig.execute(this.chain, opts) as Promise<ExecuteSetRateLimitConfigResult>
  }

  // ─── Pool: setDynamicConfig ─────────────────────────────────────────────

  /** Builds unsigned `setDynamicConfig` commands. */
  async generateUnsignedSetDynamicConfig(
    opts: GenerateSetDynamicConfigParams,
  ): Promise<GenerateSetDynamicConfigResult> {
    return this.#setDynamicConfig.generate(this.chain, opts)
  }

  /** Sets the pool's dynamic config (rate-limit admin). */
  async setDynamicConfig(
    opts: ExecuteSetDynamicConfigParams,
  ): Promise<ExecuteSetDynamicConfigResult> {
    return this.#setDynamicConfig.execute(this.chain, opts) as Promise<ExecuteSetDynamicConfigResult>
  }

  // ─── Pool: reads ────────────────────────────────────────────────────────

  /** Reads the required committee-verifier instance addresses for a pool. */
  async getRequiredCCVs(opts: GetRequiredCCVsParams): Promise<GetRequiredCCVsResult> {
    return this.#getRequiredCCVs.query(this.chain, opts)
  }

  /** Reads a token pool's config from the ACS. */
  async getTokenPoolState(opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult> {
    return this.#getTokenPoolState.query(this.chain, opts)
  }
}

// Re-export the operation classes + param/result types for direct use.
export {
  SetPool,
  RegisterAdmin,
  AcceptAdmin,
  TransferAdmin,
  GetTokenAdminRegistry,
  GetSupportedTokens,
  DeployTokenPool,
  ApplyChainUpdates,
  SetRateLimitConfig,
  SetDynamicConfig,
  GetRequiredCCVs,
  GetTokenPoolState,
}
export type {
  SetPoolParams,
  RegisterAdminParams,
  AcceptAdminParams,
  TransferAdminParams,
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  GetSupportedTokensParams,
  GetSupportedTokensResult,
  DeployTokenPoolParams,
  ApplyChainUpdatesParams,
  SetRateLimitConfigParams,
  SetDynamicConfigParams,
  GetRequiredCCVsParams,
  GetRequiredCCVsResult,
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
}
