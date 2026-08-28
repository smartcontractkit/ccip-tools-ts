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
  type AcceptAdminParams,
  AcceptAdmin,
} from './token-admin-registry/operations/accept-admin.ts'
import {
  type GetSupportedTokensParams,
  type GetSupportedTokensResult,
  GetSupportedTokens,
} from './token-admin-registry/operations/get-supported-tokens.ts'
import {
  type GetTokenAdminRegistryParams,
  type GetTokenAdminRegistryResult,
  GetTokenAdminRegistry,
} from './token-admin-registry/operations/get-token-admin-registry.ts'
import {
  type RegisterAdminParams,
  RegisterAdmin,
} from './token-admin-registry/operations/register-admin.ts'
import { type SetPoolParams, SetPool } from './token-admin-registry/operations/set-pool.ts'
import {
  type TransferAdminParams,
  TransferAdmin,
} from './token-admin-registry/operations/transfer-admin.ts'
import { type AddRemotePoolParams, AddRemotePool } from './token-pool/operations/add-remote-pool.ts'
import {
  type ApplyChainUpdatesParams,
  ApplyChainUpdates,
} from './token-pool/operations/apply-chain-updates.ts'
import {
  type DeployTokenPoolParams,
  DeployTokenPool,
} from './token-pool/operations/deploy-token-pool.ts'
import {
  type GetTokenPoolRemotesParams,
  type GetTokenPoolRemotesResult,
  GetTokenPoolRemotes,
} from './token-pool/operations/get-token-pool-remotes.ts'
import {
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  GetTokenPoolState,
} from './token-pool/operations/get-token-pool-state.ts'
import {
  type RemoveRemotePoolParams,
  RemoveRemotePool,
} from './token-pool/operations/remove-remote-pool.ts'
import { type SetRemotePoolParams, SetRemotePool } from './token-pool/operations/set-remote-pool.ts'
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
  readonly #transferAdmin = new TransferAdmin()
  readonly #acceptAdmin = new AcceptAdmin()
  readonly #getTokenAdminRegistry = new GetTokenAdminRegistry()
  readonly #getSupportedTokens = new GetSupportedTokens()

  // Token pool operations
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #transferOwnership = new TransferOwnership()
  readonly #getTokenPoolState = new GetTokenPoolState()
  readonly #getTokenPoolRemotes = new GetTokenPoolRemotes()
  readonly #setRemotePool = new SetRemotePool()
  readonly #addRemotePool = new AddRemotePool()
  readonly #removeRemotePool = new RemoveRemotePool()
  readonly #applyChainUpdates = new ApplyChainUpdates()

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
   * Builds an unsigned TokenAdminRegistry `transferAdmin` tx (for multisig / offline signing).
   * Two-step by design: `newAdmin` must separately call `acceptAdmin` to complete the
   * handoff. This is the registry's ADMIN role — distinct from a pool's Ownable2Step *owner*
   * (see {@link transferOwnership}); do not confuse the two.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or if `sender` is not the
   * token's current registry administrator (including a not-yet-accepted registration)
   * @example
   * ```typescript
   * // `sender` must be the token's current registry administrator
   * const unsigned = await cct.generateUnsignedTransferAdmin({
   *   tokenAddress: '0xToken...',
   *   newAdmin: '0xNewAdmin...', // must separately call acceptAdmin
   *   address: '0xTokenAdminRegistry...', // the TAR, or a Router/pool to resolve it from
   *   sender: '0xCurrentAdmin...',
   * })
   * ```
   */
  generateUnsignedTransferAdmin(opts: TransferAdminParams): Promise<UnsignedEVMTx> {
    return this.#transferAdmin.generate(this.chain, opts)
  }

  /**
   * Proposes a new TokenAdminRegistry administrator, signing + submitting with `opts.wallet`
   * (the current registry admin). Two-step: `newAdmin` must separately call `acceptAdmin`.
   * This is the registry's ADMIN role — distinct from a pool's Ownable2Step *owner*
   * (see {@link transferOwnership}); do not confuse the two.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if the signing wallet is not the
   * token's current registry administrator (including a not-yet-accepted registration), or if an
   * explicit `opts.sender` does not match the wallet's address
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * // `wallet` must sign as the token's current registry administrator; `sender` defaults to its
   * // address, so pass it only for offline builds via generateUnsignedTransferAdmin.
   * const { hash } = await cct.transferAdmin({
   *   tokenAddress: '0xToken...',
   *   newAdmin: '0xNewAdmin...',
   *   address: '0xTokenAdminRegistry...',
   *   wallet,
   * })
   * ```
   */
  transferAdmin(opts: EVMExecuteParams<TransferAdminParams>): Promise<TransactionResult> {
    return this.#transferAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `acceptAdminRole` tx (for multisig / offline signing). Second half of
   * the two-step admin handshake: a registry module's `registerAdmin` (fresh registration) or
   * the current admin's `transferAdmin` (hand-off) proposes `opts.sender` as
   * `pendingAdministrator`; `acceptAdmin` then confirms it on-chain before encoding, after which
   * {@link setPool} becomes callable by the new administrator.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is not the
   *   pending administrator
   * @example
   * ```typescript
   * // `sender` must be the pending administrator proposed by registerAdmin/transferAdmin
   * const unsigned = await cct.generateUnsignedAcceptAdmin({
   *   tokenAddress: '0xToken...',
   *   address: '0xTokenAdminRegistry...', // the TAR, or a Router/pool to resolve it from
   *   sender: '0xPendingAdmin...',
   * })
   * ```
   */
  generateUnsignedAcceptAdmin(opts: AcceptAdminParams): Promise<UnsignedEVMTx> {
    return this.#acceptAdmin.generate(this.chain, opts)
  }

  /**
   * Accepts a pending TokenAdminRegistry administrator role, signing + submitting with
   * `opts.wallet` (the pending administrator). Completes the `registerAdmin`/`transferAdmin` →
   * `acceptAdmin` handshake, after which {@link setPool} becomes callable.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is not the
   *   pending administrator
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * // `wallet` must sign as the pending administrator
   * const { hash } = await cct.acceptAdmin({
   *   tokenAddress: '0xToken...',
   *   address: '0xTokenAdminRegistry...',
   *   wallet,
   * })
   * ```
   */
  acceptAdmin(opts: EVMExecuteParams<AcceptAdminParams>): Promise<TransactionResult> {
    return this.#acceptAdmin.execute(this.chain, opts)
  }

  /**
   * Reads a token's TokenAdminRegistry entry: its `administrator`, any `pendingAdministrator`,
   * and its registered `tokenPool`.
   * @remarks Deliberately diverges from `cct.chain.getRegistryTokenConfig()`, which throws when
   * `administrator` is the zero address — exactly the post-`registerAdmin`, pre-`acceptAdmin`
   * state. This op reports `{ administrator: ZeroAddress, pendingAdministrator }` faithfully
   * instead, so a pending registration is observable; see
   * {@link GetTokenAdminRegistry} for the full rationale. `pendingAdministrator` and `tokenPool`
   * are still omitted when zero.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * const config = await cct.getTokenAdminRegistry({
   *   address: '0xTokenAdminRegistry...', // or a Router/OnRamp/OffRamp/pool to resolve it from
   *   tokenAddress: '0xToken...',
   * })
   * if (config.administrator === ZeroAddress) {
   *   console.log('pending acceptance by', config.pendingAdministrator)
   * }
   * ```
   */
  getTokenAdminRegistry(opts: GetTokenAdminRegistryParams): Promise<GetTokenAdminRegistryResult> {
    return this.#getTokenAdminRegistry.query(this.chain, opts)
  }

  /**
   * Lists every token configured in the TokenAdminRegistry resolved from `address`.
   * @remarks The registry paginates via `getAllConfiguredTokens` — `opts.page` sets the batch size per call; omit it to read the
   * whole registry in one round trip per 1000 tokens.
   * @throws {@link CCTParamsInvalidError} if `address` is not a valid address, or `page` is given
   * and is not a positive integer
   * @example
   * ```typescript
   * const tokens = await cct.getSupportedTokens({ address: '0xTokenAdminRegistry...' })
   * ```
   */
  getSupportedTokens(opts: GetSupportedTokensParams): Promise<GetSupportedTokensResult> {
    return this.#getSupportedTokens.query(this.chain, opts)
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
   * (see the example) — a `SiloedLockReleaseTokenPool` reports no `lockBox`, since it escrows per
   * remote chain. For a legacy pool's `allowList` / `rebalancer`, proxy/USDC
   * pools, or v1.5.0 `*AndProxy` pools, use `cct.chain.getTokenPoolConfig()`, the tolerant
   * transfer-flow read. No pool version exposes a pending-owner getter, so a proposed owner is
   * not readable here.
   * @remarks The Solana counterpart, `SolanaTokenManager.getTokenPoolState`, returns a different
   * shape: its fields nest under `state.config` where these are flat, it spells `token` /
   * `tokenDecimals` / `rmnProxy` as `config.mint` / `config.decimals` / `config.rmnRemote`, and its
   * `version` is the account-layout number, not this protocol semver. `owner`, `rateLimitAdmin`
   * and `router` are named alike on both.
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

  /**
   * Reads a pool's remote-lane configuration, v1.5.0 through v2.0.0: for each configured remote
   * chain, the `remoteToken`, the `remotePools` authorized to mint/release against it, and the
   * inbound/outbound rate-limiter buckets. Keyed by remote network name.
   * @remarks Omit `remoteChainSelector` to scan every lane the pool reports through
   * `getSupportedChains()`; pass one to read a single lane. `inboundRateLimiterState` /
   * `outboundRateLimiterState` are `null` when that direction is unlimited, and their amounts are
   * in the *local* token's smallest unit; v2.0.0 pools add `fast*RateLimiterState` for
   * Faster-Than-Finality and safe-finality (FCR) transfers.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is given and is not a `uint64`
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if a lane read has no remote token
   * configured — including a `remoteChainSelector` the pool knows nothing about
   * @example
   * ```typescript
   * const remotes = await cct.getTokenPoolRemotes({ poolAddress: '0xPool...' })
   * for (const [network, lane] of Object.entries(remotes)) {
   *   // inboundRateLimiterState is null when inbound transfers are unlimited
   *   console.log(network, lane.remoteToken, lane.inboundRateLimiterState?.capacity)
   * }
   * ```
   */
  getTokenPoolRemotes(opts: GetTokenPoolRemotesParams): Promise<GetTokenPoolRemotesResult> {
    return this.#getTokenPoolRemotes.query(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `setRemotePool` tx (for multisig / offline signing), replacing the
   * remote pool a lane accepts.
   * @remarks **v1.5.0 pools only.** A v1.5.0 pool holds exactly one remote pool per lane, and this
   * call overwrites it. v1.5.1 replaced it with the additive `addRemotePool` / `removeRemotePool`
   * pair and dropped `setRemotePool` from the ABI, so a v1.5.1, v1.6.1 or v2.0.0 pool throws
   * {@link CCTOperationUnsupportedError} — use {@link generateUnsignedAddRemotePool} /
   * {@link generateUnsignedRemoveRemotePool} there. No emulation is attempted: replacing a set of
   * unknown size is not one transaction.
   * @remarks `remotePoolAddress` is the *remote* chain's pool address as raw `bytes` (`0x` prefix
   * optional), not an EVM address — a Solana, Aptos or Sui pool address is 32 bytes.
   * @remarks Owner-gated on-chain. When `sender` is given it is checked against the pool's current
   * `owner` before any calldata is built; omit it to build for a signer that is not known yet.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is given and is not
   * the pool owner
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.1 or newer
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedSetRemotePool({
   *   poolAddress: '0xPool...', // a v1.5.0 pool
   *   remoteChainSelector: 5009297550715157269n, // ethereum-mainnet
   *   remotePoolAddress: '0xRemotePool...', // hex bytes; 32 bytes for a non-EVM remote
   *   sender: '0xPoolOwner...',
   * })
   * ```
   */
  generateUnsignedSetRemotePool(opts: SetRemotePoolParams): Promise<UnsignedEVMTx> {
    return this.#setRemotePool.generate(this.chain, opts)
  }

  /**
   * Replaces the remote pool a v1.5.0 pool accepts on one lane, signing + submitting with
   * `opts.wallet`. See {@link generateUnsignedSetRemotePool} for the version range and the
   * `remotePoolAddress` encoding.
   * @remarks `sender` defaults to the signing wallet, which must be the pool owner; passing a
   * different `sender` is rejected rather than signed — build with
   * {@link generateUnsignedSetRemotePool} for externally-signed flows.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is given and is not
   * the wallet's address / the pool owner
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.1 or newer
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.setRemotePool({
   *   poolAddress: '0xPool...', // a v1.5.0 pool
   *   remoteChainSelector: 5009297550715157269n,
   *   remotePoolAddress: '0xRemotePool...',
   *   wallet, // the pool owner
   * })
   * ```
   */
  setRemotePool(opts: EVMExecuteParams<SetRemotePoolParams>): Promise<TransactionResult> {
    return this.#setRemotePool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `addRemotePool` tx (for multisig / offline signing), authorizing one
   * more remote pool on a lane.
   * @remarks **v1.5.1, v1.6.1 and v2.0.0 pools.** From v1.5.1 a lane holds a *set* of remote
   * pools, which is what makes a zero-downtime remote-side pool upgrade possible: add the new
   * pool, drain the old one, then {@link removeRemotePool}. A v1.5.0 pool has no additive
   * primitive and throws {@link CCTOperationUnsupportedError} — it only supports the wholesale
   * {@link setRemotePool}.
   * @remarks `remotePoolAddress` is the *remote* chain's pool address as raw `bytes` (`0x` prefix
   * optional), not an EVM address — a Solana, Aptos or Sui pool address is 32 bytes.
   * @remarks Pre-checked against the chain: the lane's currently registered remote pools are read
   * (scoped to `remoteChainSelector`, one call) and an address already among them is rejected
   * locally instead of reverting on-chain. A lane with no configuration yet counts as having none.
   * Owner-gated: a given `sender` is checked against the pool's `owner`.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not the
   * pool owner, or `remotePoolAddress` is already registered on that lane
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.0
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedAddRemotePool({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 16015286601757825753n, // ethereum-testnet-sepolia
   *   remotePoolAddress: '0xNewRemotePool...',
   *   sender: '0xPoolOwner...',
   * })
   * ```
   */
  generateUnsignedAddRemotePool(opts: AddRemotePoolParams): Promise<UnsignedEVMTx> {
    return this.#addRemotePool.generate(this.chain, opts)
  }

  /**
   * Authorizes an additional remote pool on one lane of a v1.5.1+ pool, signing + submitting with
   * `opts.wallet`. See {@link generateUnsignedAddRemotePool} for the version range, the
   * `remotePoolAddress` encoding and the duplicate pre-check.
   * @remarks `sender` defaults to the signing wallet, which must be the pool owner; passing a
   * different `sender` is rejected rather than signed — build with
   * {@link generateUnsignedAddRemotePool} for externally-signed flows.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not the
   * wallet's address / the pool owner, or `remotePoolAddress` is already registered on that lane
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.0
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.addRemotePool({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 16015286601757825753n,
   *   remotePoolAddress: '0xNewRemotePool...',
   *   wallet, // the pool owner
   * })
   * ```
   */
  addRemotePool(opts: EVMExecuteParams<AddRemotePoolParams>): Promise<TransactionResult> {
    return this.#addRemotePool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `removeRemotePool` tx (for multisig / offline signing),
   * de-authorizing one remote pool on a lane.
   * @remarks **v1.5.1, v1.6.1 and v2.0.0 pools** — the versions where a lane holds a set of remote
   * pools. The last step of a remote-side pool upgrade started with {@link addRemotePool}. A
   * v1.5.0 pool has no removal primitive and throws {@link CCTOperationUnsupportedError}; its
   * single remote pool can only be overwritten via {@link setRemotePool}.
   * @remarks `remotePoolAddress` is the *remote* chain's pool address as raw `bytes` (`0x` prefix
   * optional), not an EVM address — a Solana, Aptos or Sui pool address is 32 bytes.
   * @remarks Pre-checked against the chain: the lane's registered remote pools are read (scoped to
   * `remoteChainSelector`, one call) and an address that is not among them is rejected locally
   * instead of reverting on-chain. Removing the lane's last remote pool is allowed — the contract
   * decides — but a lane with no configuration at all has nothing to remove and is rejected.
   * Owner-gated: a given `sender` is checked against the pool's `owner`.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not the
   * pool owner, or `remotePoolAddress` is not registered on that lane
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.0
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedRemoveRemotePool({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 16015286601757825753n,
   *   remotePoolAddress: '0xDrainedRemotePool...',
   *   sender: '0xPoolOwner...',
   * })
   * ```
   */
  generateUnsignedRemoveRemotePool(opts: RemoveRemotePoolParams): Promise<UnsignedEVMTx> {
    return this.#removeRemotePool.generate(this.chain, opts)
  }

  /**
   * De-authorizes a remote pool on one lane of a v1.5.1+ pool, signing + submitting with
   * `opts.wallet`. See {@link generateUnsignedRemoveRemotePool} for the version range, the
   * `remotePoolAddress` encoding and the membership pre-check.
   * @remarks `sender` defaults to the signing wallet, which must be the pool owner; passing a
   * different `sender` is rejected rather than signed — build with
   * {@link generateUnsignedRemoveRemotePool} for externally-signed flows.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not the
   * wallet's address / the pool owner, or `remotePoolAddress` is not registered on that lane
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.0
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.removeRemotePool({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 16015286601757825753n,
   *   remotePoolAddress: '0xDrainedRemotePool...',
   *   wallet, // the pool owner
   * })
   * ```
   */
  removeRemotePool(opts: EVMExecuteParams<RemoveRemotePoolParams>): Promise<TransactionResult> {
    return this.#removeRemotePool.execute(this.chain, opts)
  }

  /**
   * Applies the pool's remote-lane configuration, signing + submitting with `opts.wallet`.
   * @remarks Same version-discriminated params as
   * {@link generateUnsignedApplyChainUpdates} — see there for the v1.5.0 vs v1.5.1 divergence.
   * `opts.sender` defaults to the wallet's own address (the only address `onlyOwner` can pass) and
   * is rejected if it differs, so the wallet must be the pool owner.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `version` does not match the
   * pool's own generation, or `sender` is given and is not the wallet address / pool owner. As
   * with {@link generateUnsignedApplyChainUpdates}, an enabled rate limiter on a **v1.5.0 or
   * v1.5.1** pool must satisfy the stricter `0 < rate < capacity`.
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * // `wallet` must sign as the pool owner
   * const { hash } = await cct.applyChainUpdates({
   *   version: '1.5.1',
   *   poolAddress: '0xPool...',
   *   remoteChainSelectorsToRemove: [],
   *   chainsToAdd: [
   *     {
   *       remoteChainSelector: 16015286601757825753n,
   *       remoteTokenAddress: '0xRemoteToken...',
   *       remotePoolAddresses: ['0xRemotePool...'],
   *       inboundRateLimiterConfig: { enabled: false },
   *       outboundRateLimiterConfig: { enabled: false },
   *     },
   *   ],
   *   wallet,
   * })
   * ```
   */
  applyChainUpdates(opts: EVMExecuteParams<ApplyChainUpdatesParams>): Promise<TransactionResult> {
    return this.#applyChainUpdates.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `applyChainUpdates` tx (for multisig / offline signing), configuring,
   * enabling and disabling the pool's remote lanes: remote token, remote pool(s), and both
   * directional rate limits.
   *
   * @remarks **The parameter shape is version-discriminated**, because the contract's own
   * signature changed at v1.5.1 — this is the one CCT pool write where the caller must say which
   * generation it is writing for, via `opts.version`:
   *
   * - `version: '1.5.0'` — a single `chains` array. Each entry carries the enable/disable bit
   *   inline (`allowed: false` removes the lane) and a **singular** `remotePoolAddress`.
   * - `version: '1.5.1'` — removals in `remoteChainSelectorsToRemove`, additions in `chainsToAdd`,
   *   and each addition carries **plural** `remotePoolAddresses`. This is also the shape for
   *   v1.6.1 and v2.0.0 pools, whose calldata is byte-identical to v1.5.1's.
   *
   * The declaration is checked against the pool's on-chain `typeAndVersion`, so writing the wrong
   * shape is a parameter error here rather than a tx that reverts on an unknown selector (the two
   * signatures have different selectors: `0xdb6327dc` vs `0xe8a1da17`).
   *
   * Rate limits use the SDK's `enabled` spelling, not the ABI's `isEnabled`, matching the Solana
   * counterpart; amounts are in the token's smallest unit. Pass `opts.sender` to pre-flight it
   * against the pool's `owner()` — `applyChainUpdates` is `onlyOwner`.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `version` does not match the
   * pool's own generation, or `sender` is not the pool owner. An enabled rate limiter must have
   * `rate <= capacity` on every version; on a **v1.5.0 or v1.5.1** pool the bound is stricter
   * (`0 < rate < capacity`), so a `rate` of `0n` or a `rate` equal to `capacity` is also rejected
   * there — v1.6.1 and v2.0.0 allow both.
   *
   * Each lane array must also be dense (no holes) and free of repeated selectors, and a lane
   * being *added* may not use the `0n` selector — the contract would accept it as a permanently
   * unroutable lane rather than reverting. `remoteChainSelectorsToRemove` still accepts `0n`, so
   * a pool already holding such a lane can be repaired; listing one selector in both
   * `chainsToAdd` and `remoteChainSelectorsToRemove` remains the wholesale-replace idiom.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example Enabling a lane on a v1.6.1 pool (the `1.5.1` shape) while retiring an old one:
   * ```typescript
   * const unsigned = await cct.generateUnsignedApplyChainUpdates({
   *   version: '1.5.1',
   *   poolAddress: '0xPool...',
   *   sender: '0xPoolOwner...',
   *   remoteChainSelectorsToRemove: [3478487238524512106n], // arbitrum-sepolia
   *   chainsToAdd: [
   *     {
   *       remoteChainSelector: 16015286601757825753n, // ethereum-sepolia
   *       remoteTokenAddress: '0xRemoteToken...',
   *       remotePoolAddresses: ['0xRemotePool...'],
   *       inboundRateLimiterConfig: { enabled: true, capacity: 100_000_000n, rate: 167_000n },
   *       outboundRateLimiterConfig: { enabled: false },
   *     },
   *   ],
   * })
   * ```
   * @example Disabling a lane on a v1.5.0 pool, where removal is `allowed: false`:
   * ```typescript
   * const unsigned = await cct.generateUnsignedApplyChainUpdates({
   *   version: '1.5.0',
   *   poolAddress: '0xLegacyPool...',
   *   chains: [
   *     {
   *       remoteChainSelector: 16015286601757825753n,
   *       allowed: false,
   *       remoteTokenAddress: '0xRemoteToken...',
   *       remotePoolAddress: '0xRemotePool...', // still required, ignored by the contract
   *       inboundRateLimiterConfig: { enabled: false },
   *       outboundRateLimiterConfig: { enabled: false },
   *     },
   *   ],
   * })
   * ```
   */
  generateUnsignedApplyChainUpdates(opts: ApplyChainUpdatesParams): Promise<UnsignedEVMTx> {
    return this.#applyChainUpdates.generate(this.chain, opts)
  }
}

export * from '../errors.ts'
export type { AcceptAdminParams } from './token-admin-registry/operations/accept-admin.ts'
export type {
  RegisterAdminMethod,
  RegisterAdminParams,
} from './token-admin-registry/operations/register-admin.ts'
export type {
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
} from './token-admin-registry/operations/get-token-admin-registry.ts'
export type { SetPoolParams } from './token-admin-registry/operations/set-pool.ts'
export type { TransferAdminParams } from './token-admin-registry/operations/transfer-admin.ts'
export type {
  GetSupportedTokensParams,
  GetSupportedTokensResult,
} from './token-admin-registry/operations/get-supported-tokens.ts'
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
export type {
  GetTokenPoolRemotesParams,
  GetTokenPoolRemotesResult,
} from './token-pool/operations/get-token-pool-remotes.ts'
export type { SetRemotePoolParams } from './token-pool/operations/set-remote-pool.ts'
export type { AddRemotePoolParams } from './token-pool/operations/add-remote-pool.ts'
export type { RemoveRemotePoolParams } from './token-pool/operations/remove-remote-pool.ts'
export type {
  ApplyChainUpdatesParamVersion,
  ApplyChainUpdatesParams,
  ApplyChainUpdatesParamsV1_5_0,
  ApplyChainUpdatesParamsV1_5_1,
  ChainUpdateV1_5_0,
  ChainUpdateV1_5_1,
  RateLimitConfigInput,
} from './token-pool/operations/apply-chain-updates.ts'
/** The lane types `GetTokenPoolRemotesResult` is keyed over; shared with `Chain.getTokenPoolRemotes`. */
export type { RateLimiterState, TokenPoolRemote } from '../../chain.ts'
export type { DeployLockboxParams } from './lockbox/operations/deploy-lockbox.ts'
export type { AuthorizeLockboxCallersParams } from './lockbox/operations/authorize-callers.ts'
export type {
  DeployArtifact,
  DeployResult,
  EVMExecuteParams,
  ExplorerVerificationInput,
} from './operation.ts'
export type { TransactionResult } from '../operation.ts'
