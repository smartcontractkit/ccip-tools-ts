/**
 * EVM Cross-Chain Token (CCT) admin operations.
 * {@link EVMTokenManager} wraps an {@link EVMChain}: build with
 * `generateUnsigned<Op>` (sender in opts), then `<op>` with `wallet` in opts.
 *
 * @packageDocumentation
 */

import type { JsonRpcApiProvider } from 'ethers'

import type { ChainContext } from '../../chain.ts'
import { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import type { ChainFamily } from '../../networks.ts'
import type { TransactionResult } from '../operation.ts'
import { TokenManager } from '../token-manager.ts'
import {
  type AuthorizeLockboxCallersParams,
  AuthorizeLockboxCallers,
} from './lockbox/operations/authorize-callers.ts'
import { type DeployLockboxParams, DeployLockbox } from './lockbox/operations/deploy-lockbox.ts'
import type { DeployResult, EVMExecuteParams } from './operation.ts'
import { type DeployTokenParams, DeployToken } from './token/operations/deploy-token.ts'
import {
  type RegisterAdminParams,
  RegisterAdmin,
} from './token-admin-registry/operations/register-admin.ts'
import { type SetPoolParams, SetPool } from './token-admin-registry/operations/set-pool.ts'
import {
  type DeployTokenPoolParams,
  DeployTokenPool,
} from './token-pool/operations/deploy-token-pool.ts'
import {
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  GetTokenPoolState,
} from './token-pool/operations/get-token-pool-state.ts'
import {
  type TransferOwnershipParams,
  TransferOwnership,
} from './token-pool/operations/transfer-ownership.ts'

/** CCT admin operations for EVM chains, delegating each op to an operation class. */
export class EVMTokenManager extends TokenManager<typeof ChainFamily.EVM> {
  readonly chain: EVMChain
  // Token operations
  readonly #deployToken = new DeployToken()

  // Token admin registry operations
  readonly #registerAdmin = new RegisterAdmin()
  readonly #setPool = new SetPool()

  // Token pool operations
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #transferOwnership = new TransferOwnership()
  readonly #getTokenPoolState = new GetTokenPoolState()

  // Lockbox operations
  readonly #deployLockbox = new DeployLockbox()
  readonly #authorizeLockboxCallers = new AuthorizeLockboxCallers()

  /** Wraps an {@link EVMChain}; prefer the static factory methods. */
  constructor(chain: EVMChain) {
    super()
    this.chain = chain
  }

  /** Wraps an existing {@link EVMChain}. */
  static fromChain(chain: EVMChain): EVMTokenManager {
    return new EVMTokenManager(chain)
  }

  /** Creates from an ethers provider. */
  static async fromProvider(
    provider: JsonRpcApiProvider,
    ctx?: ChainContext,
  ): Promise<EVMTokenManager> {
    return new EVMTokenManager(await EVMChain.fromProvider(provider, ctx))
  }

  /** Creates from an RPC URL. */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<EVMTokenManager> {
    return new EVMTokenManager(await EVMChain.fromUrl(url, ctx))
  }

  /** Provider of the underlying chain. */
  get provider(): JsonRpcApiProvider {
    return this.chain.provider
  }

  /**
   * Builds an unsigned `registerAdmin` tx (for multisig / offline signing): proposes a token's
   * administrator in the TokenAdminRegistry via a RegistryModuleOwnerCustom. Two-step by design —
   * the proposed administrator must then call {@link acceptAdmin}.
   * @remarks The administrator is not a parameter — the module derives it on-chain. `owner`/`ccip-admin` read the token's own `owner()`/`getCCIPAdmin()`, so
   * the result is independent of who signs; a wrong signer simply reverts (`CanOnlySelfRegister`).
   *
   * `access-control-default-admin` behaves differently and warrants care on this offline path: the
   * module registers **`msg.sender`** after checking it holds the token's `DEFAULT_ADMIN_ROLE`.
   * `sender` here only drives the local pre-flight probe, so if the built tx is ultimately signed
   * by a *different* address that also holds that role, the **signer** becomes the token's
   * administrator — silently, with no revert to catch it. Confirm the signing key before relaying
   * an `access-control-default-admin` registration. {@link registerAdmin} is not exposed to this,
   * since it rejects a `sender` that differs from its wallet.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `registryModule` is not a
   * registered TAR module, `registrationMethod` needs a v1.6+ module, `sender` doesn't match the
   * token's authority for the chosen method, or the token is already registered (or pending
   * acceptance)
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the token's owner (or
   * // CCIP admin / default admin, matching `registrationMethod`).
   * const unsigned = await cct.generateUnsignedRegisterAdmin({
   *   tokenAddress: '0xToken...',
   *   registryModule: '0xRegistryModuleOwnerCustom...', // not discoverable on-chain
   *   address: '0xTokenAdminRegistry...', // the TAR, or a Router/OnRamp/OffRamp/pool to resolve it from
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedRegisterAdmin(opts: RegisterAdminParams): Promise<UnsignedEVMTx> {
    return this.#registerAdmin.generate(this.chain, opts)
  }

  /**
   * Proposes a token's administrator in the TokenAdminRegistry via a RegistryModuleOwnerCustom,
   * signing + submitting with `opts.wallet`. Two-step by design — the proposed administrator
   * must then call {@link acceptAdmin}.
   * @remarks The administrator is not a parameter — see {@link generateUnsignedRegisterAdmin}. `sender` also defaults to `opts.wallet`'s address here
   * (unlike the unsigned builder, where it's optional for offline/multisig flows), so the
   * token-authority check always runs before this signs and submits.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `registryModule` is not a
   * registered TAR module, `registrationMethod` needs a v1.6+ module, `sender` doesn't match the
   * token's authority for the chosen method, or the token is already registered (or pending
   * acceptance)
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * // `wallet` must be the token's owner (or CCIP admin / hold DEFAULT_ADMIN_ROLE, matching
   * // `registrationMethod`) — enforced automatically since `sender` defaults to its address.
   * const { hash } = await cct.registerAdmin({
   *   tokenAddress: '0xToken...',
   *   registryModule: '0xRegistryModuleOwnerCustom...',
   *   address: '0xTokenAdminRegistry...',
   *   wallet,
   * })
   * ```
   */
  registerAdmin(opts: EVMExecuteParams<RegisterAdminParams>): Promise<TransactionResult> {
    return this.#registerAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `setPool` tx (for multisig / offline signing).
   * A zero/empty `poolAddress` delists the token from the registry.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the token's current admin.
   * const unsigned = await cct.generateUnsignedSetPool({
   *   tokenAddress: '0xToken...',
   *   poolAddress: '0xPool...', // pass the zero address to delist the token
   *   address: '0xTokenAdminRegistry...', // the TAR, or a Router/pool to resolve it from
   *   sender: '0xTokenAdmin...',
   * })
   * ```
   */
  generateUnsignedSetPool(opts: SetPoolParams): Promise<UnsignedEVMTx> {
    return this.#setPool.generate(this.chain, opts)
  }

  /**
   * Registers a pool, signing + submitting with `opts.wallet` (the token admin).
   * A zero/empty `poolAddress` delists the token from the registry.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * // `wallet` must sign as the token's current administrator
   * const { hash } = await cct.setPool({
   *   tokenAddress: '0xToken...',
   *   poolAddress: '0xPool...', // pass the zero address to delist the token
   *   address: '0xTokenAdminRegistry...',
   *   wallet,
   * })
   * ```
   */
  setPool(opts: EVMExecuteParams<SetPoolParams>): Promise<TransactionResult> {
    return this.#setPool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `transferOwnership` tx (for multisig / offline signing). Probes the
   * pool's on-chain `typeAndVersion` to resolve its interface + encoder; the `transferOwnership`
   * calldata is stable across pool versions, so the resolved encoding is version/type-independent.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   */
  generateUnsignedTransferOwnership(opts: TransferOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#transferOwnership.generate(this.chain, opts)
  }

  /**
   * Proposes a new pool owner (two-step), signing + submitting with `opts.wallet`.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   */
  transferOwnership(opts: EVMExecuteParams<TransferOwnershipParams>): Promise<TransactionResult> {
    return this.#transferOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `CrossChainToken` (v2.0.0) deployment tx (for multisig / offline
   * signing). The deployed address is only known once mined, so it is NOT returned here —
   * use {@link deployToken} to deploy and receive `{ hash, contractAddress, verification }`.
   * @remarks Same post-deploy roles caveat as {@link deployToken} — the pool needs
   * `grantMintAndBurnRoles` before it can bridge.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedDeployToken({
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 18,
   *   maxSupply: 0n, // 0 = unlimited
   *   owner: '0xOwner...', // CrossChainToken v2.0.0; ccipAdmin/burnMintRoleAdmin default to owner
   *   sender: '0xDeployer...',
   * })
   * ```
   */
  generateUnsignedDeployToken(opts: DeployTokenParams): Promise<UnsignedEVMTx> {
    return this.#deployToken.generate(this.chain, opts)
  }

  /**
   * Deploys a `CrossChainToken` (v2.0.0), signing + submitting with `opts.wallet`; resolves
   * to the tx hash, the newly deployed token address, and a `verification`
   * ({@link ExplorerVerificationInput}) for verifying the source on a block explorer.
   * @remarks Mint/burn are role-gated (`MINTER_ROLE`/`BURNER_ROLE`); the token grants neither
   * to any pool at deploy. `preMint` mints initial supply to `preMintRecipient`, but before a
   * pool can bridge, `burnMintRoleAdmin` must `grantMintAndBurnRoles(pool)`.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines without an address
   * @example
   * ```typescript
   * const { hash, contractAddress, verification } = await cct.deployToken({
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 18,
   *   maxSupply: 0n,
   *   owner: '0xOwner...',
   *   wallet,
   * })
   * ```
   */
  deployToken(opts: EVMExecuteParams<DeployTokenParams>): Promise<DeployResult> {
    return this.#deployToken.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool deployment tx (for multisig / offline signing). `type` selects
   * the pool contract — a `DeployableTokenPoolType` (`BurnMintTokenPool`, `BurnFromMintTokenPool`,
   * `BurnWithFromMintTokenPool`, or `LockReleaseTokenPool`; all v2.0.0). The deployed address is
   * only known once mined, so it is NOT returned here — use {@link deployTokenPool} to receive
   * `{ hash, contractAddress, verification }`.
   * @remarks Same post-deploy setup caveat as {@link deployTokenPool} — a fresh pool must be
   * registered, role-granted, and lane-configured before it can bridge. `LockReleaseTokenPool`
   * additionally requires a pre-deployed `lockbox` ({@link DeployLockReleaseTokenPoolParams})
   * with the pool authorized on it. The full sequence: {@link deployToken} → {@link deployLockbox}
   * → {@link deployTokenPool} (passing the lockbox) → {@link authorizeLockboxCallers}
   * (`addedCallers: [pool]`) → {@link setPool} → configure lanes.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedDeployTokenPool({
   *   type: 'BurnMintTokenPool', // burn-* variant; LockReleaseTokenPool additionally requires `lockbox`
   *   token: '0xToken...',
   *   localTokenDecimals: 18,
   *   rmnProxy: '0xRmnProxy...',
   *   router: '0xRouter...',
   *   sender: '0xDeployer...',
   * })
   * ```
   */
  generateUnsignedDeployTokenPool(opts: DeployTokenPoolParams): Promise<UnsignedEVMTx> {
    return this.#deployTokenPool.generate(this.chain, opts)
  }

  /**
   * Deploys a token pool, signing + submitting with `opts.wallet`; resolves to the tx hash, the
   * newly deployed pool address, and a `verification` ({@link ExplorerVerificationInput}) for
   * verifying the source on a block explorer. `type` selects the pool contract (a
   * `DeployableTokenPoolType`, v2.0.0).
   * @remarks Deploying the pool alone doesn't make it usable: register it with {@link setPool},
   * grant it the token's mint/burn roles (`grantMintAndBurnRoles`), and configure its remote
   * pools + rate limits before it can bridge. `LockReleaseTokenPool` also needs a pre-deployed
   * `lockbox` and the pool authorized on it ({@link DeployLockReleaseTokenPoolParams}). The full
   * sequence: {@link deployToken} → {@link deployLockbox} → {@link deployTokenPool} (passing the
   * lockbox) → {@link authorizeLockboxCallers} (`addedCallers: [pool]`) → {@link setPool} →
   * configure lanes.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines without an address
   * @example
   * ```typescript
   * const { hash, contractAddress, verification } = await cct.deployTokenPool({
   *   type: 'LockReleaseTokenPool',
   *   token: '0xToken...',
   *   localTokenDecimals: 18,
   *   rmnProxy: '0xRmnProxy...',
   *   router: '0xRouter...',
   *   lockbox: '0xLockbox...', // required for LockReleaseTokenPool; must be a non-zero address
   *   wallet,
   * })
   * ```
   */
  deployTokenPool(opts: EVMExecuteParams<DeployTokenPoolParams>): Promise<DeployResult> {
    return this.#deployTokenPool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `ERC20LockBox` (v2.0.0) deployment tx (for multisig / offline signing).
   * A lockbox escrows a single `token` for `LockReleaseTokenPool`s. The deployed address is
   * only known once mined, so it is NOT returned here — use {@link deployLockbox} to receive
   * `{ hash, contractAddress, verification }`.
   * @remarks Deploy the lockbox before its pool, then authorize the pool on it with
   * {@link authorizeLockboxCallers} before the pool can lock/release.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedDeployLockbox({
   *   token: '0xToken...', // must be non-zero; the same token the LockReleaseTokenPool manages
   *   sender: '0xDeployer...',
   * })
   * ```
   */
  generateUnsignedDeployLockbox(opts: DeployLockboxParams): Promise<UnsignedEVMTx> {
    return this.#deployLockbox.generate(this.chain, opts)
  }

  /**
   * Deploys an `ERC20LockBox` (v2.0.0), signing + submitting with `opts.wallet`; resolves to the
   * tx hash, the newly deployed lockbox address, and a `verification`
   * ({@link ExplorerVerificationInput}) for verifying the source on a block explorer.
   * @remarks Step two of the lock/release flow: {@link deployToken} → {@link deployLockbox} →
   * {@link deployTokenPool} (passing this lockbox) → {@link authorizeLockboxCallers}
   * (`addedCallers: [pool]`) → {@link setPool} → configure lanes.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines without an address
   * @example
   * ```typescript
   * const { hash, contractAddress, verification } = await cct.deployLockbox({
   *   token: '0xToken...',
   *   wallet,
   * })
   * ```
   */
  deployLockbox(opts: EVMExecuteParams<DeployLockboxParams>): Promise<DeployResult> {
    return this.#deployLockbox.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `ERC20LockBox` `applyAuthorizedCallerUpdates` tx (for multisig / offline
   * signing) that adds/removes authorized callers. Authorize a `LockReleaseTokenPool` here so it
   * can lock/release against the lockbox.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or if no caller is supplied
   * @example
   * ```typescript
   * // `sender` must be the lockbox owner
   * const unsigned = await cct.generateUnsignedAuthorizeLockboxCallers({
   *   lockbox: '0xLockbox...',
   *   addedCallers: ['0xPool...'], // the LockReleaseTokenPool to authorize
   *   sender: '0xLockboxOwner...',
   * })
   * ```
   */
  generateUnsignedAuthorizeLockboxCallers(
    opts: AuthorizeLockboxCallersParams,
  ): Promise<UnsignedEVMTx> {
    return this.#authorizeLockboxCallers.generate(this.chain, opts)
  }

  /**
   * Adds/removes authorized callers on an `ERC20LockBox`, signing + submitting with `opts.wallet`
   * (the lockbox owner). Authorize the `LockReleaseTokenPool` before it can lock/release.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or if no caller is supplied
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * // `wallet` must sign as the lockbox owner
   * const { hash } = await cct.authorizeLockboxCallers({
   *   lockbox: '0xLockbox...',
   *   addedCallers: ['0xPool...'],
   *   wallet,
   * })
   * ```
   */
  authorizeLockboxCallers(
    opts: EVMExecuteParams<AuthorizeLockboxCallersParams>,
  ): Promise<TransactionResult> {
    return this.#authorizeLockboxCallers.execute(this.chain, opts)
  }

  /**
   * Reads a pool's admin state, v1.5.0 through v2.0.0: the `owner` every pool write is gated on,
   * the `rateLimitAdmin` role, its token/router and configured lanes — plus, on v2.0.0 pools, the
   * `feeAdmin` role, the allowed finality window, and a lock/release pool's `lockBox`.
   * @remarks The result is a union: `state.version === '2.0.0'` gates the roles and finality
   * window that version added, and `state.type === 'LockReleaseTokenPool'` gates its `lockBox`
   * (see the example). A v2.0.0 `SiloedLockReleaseTokenPool` is rejected — it escrows per remote
   * chain (`getLockBox(uint64)`). For a legacy pool's `allowList` / `rebalancer`, proxy/USDC
   * pools, or v1.5.0 `*AndProxy` pools, use `cct.chain.getTokenPoolConfig()`, the tolerant
   * transfer-flow read. No pool version exposes a pending-owner getter, so a proposed owner is
   * not readable here.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a supported CCT pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool's version is not a known one
   * @example
   * ```typescript
   * const state = await cct.getTokenPoolState({ poolAddress: '0xPool...' })
   * // state.owner must sign transferOwnership / lane config; state.rateLimitAdmin may set rate limits
   * if (state.version === '2.0.0') {
   *   console.log(state.feeAdmin, state.finalityDepth)
   *   if (state.type === 'LockReleaseTokenPool') console.log(state.lockBox)
   * }
   * ```
   */
  getTokenPoolState(opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult> {
    return this.#getTokenPoolState.query(this.chain, opts)
  }
}

export * from '../errors.ts'
export type {
  RegisterAdminMethod,
  RegisterAdminParams,
} from './token-admin-registry/operations/register-admin.ts'
export type { SetPoolParams } from './token-admin-registry/operations/set-pool.ts'
export type { DeployTokenParams } from './token/operations/deploy-token.ts'
export type {
  DeployTokenPoolParams,
  DeployableTokenPoolType,
} from './token-pool/operations/deploy-token-pool.ts'
export type {
  BurnMintTokenPoolStateV2_0_0,
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
  LegacyTokenPoolState,
  LockReleaseTokenPoolStateV2_0_0,
  TokenPoolStateV2_0_0,
} from './token-pool/operations/get-token-pool-state.ts'
export type { DeployLockboxParams } from './lockbox/operations/deploy-lockbox.ts'
export type { AuthorizeLockboxCallersParams } from './lockbox/operations/authorize-callers.ts'
export type {
  DeployArtifact,
  DeployResult,
  EVMExecuteParams,
  ExplorerVerificationInput,
} from './operation.ts'
export type { TransactionResult } from '../operation.ts'
