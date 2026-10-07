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
  type ApplyCCVConfigUpdatesParams,
  ApplyCCVConfigUpdates,
} from './advanced-pool-hooks/operations/apply-ccv-config-updates.ts'
import {
  type DeployAdvancedPoolHooksParams,
  DeployAdvancedPoolHooks,
} from './advanced-pool-hooks/operations/deploy-advanced-pool-hooks.ts'
import {
  type GetAllAdvancedPoolHooksAuthorizedCallersParams,
  type GetAllAdvancedPoolHooksAuthorizedCallersResult,
  GetAllAdvancedPoolHooksAuthorizedCallers,
} from './advanced-pool-hooks/operations/get-all-advanced-pool-hooks-authorized-callers.ts'
import {
  type GetAllCCVConfigsParams,
  type GetAllCCVConfigsResult,
  GetAllCCVConfigs,
} from './advanced-pool-hooks/operations/get-all-ccv-configs.ts'
import {
  type GetCCVConfigParams,
  type GetCCVConfigResult,
  GetCCVConfig,
} from './advanced-pool-hooks/operations/get-ccv-config.ts'
import {
  type GetPolicyEngineParams,
  type GetPolicyEngineResult,
  GetPolicyEngine,
} from './advanced-pool-hooks/operations/get-policy-engine.ts'
import {
  type GetRequiredCCVsParams,
  type GetRequiredCCVsResult,
  GetRequiredCCVs,
} from './advanced-pool-hooks/operations/get-required-ccvs.ts'
import {
  type GetThresholdAmountParams,
  type GetThresholdAmountResult,
  GetThresholdAmount,
} from './advanced-pool-hooks/operations/get-threshold-amount.ts'
import {
  type SetPolicyEngineParams,
  SetPolicyEngine,
} from './advanced-pool-hooks/operations/set-policy-engine.ts'
import {
  type SetThresholdAmountParams,
  SetThresholdAmount,
} from './advanced-pool-hooks/operations/set-threshold-amount.ts'
import {
  type UpdateAdvancedPoolHooksAuthorizedCallersParams,
  UpdateAdvancedPoolHooksAuthorizedCallers,
} from './advanced-pool-hooks/operations/update-authorized-callers.ts'
import { type DeployLockboxParams, DeployLockbox } from './lockbox/operations/deploy-lockbox.ts'
import { type DepositToLockboxParams, DepositToLockbox } from './lockbox/operations/deposit.ts'
import {
  type GetAllLockboxAuthorizedCallersParams,
  type GetAllLockboxAuthorizedCallersResult,
  GetAllLockboxAuthorizedCallers,
} from './lockbox/operations/get-all-lockbox-authorized-callers.ts'
import {
  type UpdateLockboxAuthorizedCallersParams,
  UpdateLockboxAuthorizedCallers,
} from './lockbox/operations/update-authorized-callers.ts'
import {
  type WithdrawFromLockboxParams,
  WithdrawFromLockbox,
} from './lockbox/operations/withdraw.ts'
import type { DeployResult, EVMExecuteParams } from './operation.ts'
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
import {
  type DeployTokenAndTokenPoolViaFactoryParams,
  type DeployTokenPoolWithExistingTokenViaFactoryParams,
  type FactoryDeploy,
  deployTokenAndTokenPoolViaFactory,
  deployTokenPoolWithExistingTokenViaFactory,
} from './token-pool-factory/deploy.ts'
import {
  type AcceptPoolOwnershipParams,
  AcceptPoolOwnership,
} from './token-pool/operations/accept-pool-ownership.ts'
import { type AddRemotePoolParams, AddRemotePool } from './token-pool/operations/add-remote-pool.ts'
import {
  type ApplyAllowlistUpdatesParams,
  ApplyAllowlistUpdates,
} from './token-pool/operations/apply-allowlist-updates.ts'
import {
  type ApplyChainUpdatesParams,
  ApplyChainUpdates,
} from './token-pool/operations/apply-chain-updates.ts'
import {
  type ApplyTokenTransferFeeConfigUpdatesParams,
  ApplyTokenTransferFeeConfigUpdates,
} from './token-pool/operations/apply-token-transfer-fee-config-updates.ts'
import {
  type DeployTokenPoolParams,
  DeployTokenPool,
} from './token-pool/operations/deploy-token-pool.ts'
import {
  type GetAdvancedPoolHooksParams,
  type GetAdvancedPoolHooksResult,
  GetAdvancedPoolHooks,
} from './token-pool/operations/get-advanced-pool-hooks.ts'
import {
  type GetAllowedFinalityConfigParams,
  type GetAllowedFinalityConfigResult,
  GetAllowedFinalityConfig,
} from './token-pool/operations/get-allowed-finality-config.ts'
import {
  type GetAllowlistEnabledParams,
  type GetAllowlistEnabledResult,
  GetAllowlistEnabled,
} from './token-pool/operations/get-allowlist-enabled.ts'
import {
  type GetAllowlistParams,
  type GetAllowlistResult,
  GetAllowlist,
} from './token-pool/operations/get-allowlist.ts'
import {
  type GetDynamicConfigParams,
  type GetDynamicConfigResult,
  GetDynamicConfig,
} from './token-pool/operations/get-dynamic-config.ts'
import { type GetFeeParams, type GetFeeResult, GetFee } from './token-pool/operations/get-fee.ts'
import {
  type GetLockboxParams,
  type GetLockboxResult,
  GetLockbox,
} from './token-pool/operations/get-lockbox.ts'
import {
  type GetRebalancerParams,
  type GetRebalancerResult,
  GetRebalancer,
} from './token-pool/operations/get-rebalancer.ts'
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
  type GetTokenTransferFeeConfigParams,
  type GetTokenTransferFeeConfigResult,
  GetTokenTransferFeeConfig,
} from './token-pool/operations/get-token-transfer-fee-config.ts'
import {
  type ProvideLiquidityParams,
  ProvideLiquidity,
} from './token-pool/operations/provide-liquidity.ts'
import {
  type RemoveRemotePoolParams,
  RemoveRemotePool,
} from './token-pool/operations/remove-remote-pool.ts'
import {
  type SetAllowedFinalityConfigParams,
  SetAllowedFinalityConfig,
} from './token-pool/operations/set-allowed-finality-config.ts'
import {
  type SetChainRateLimiterConfigsParams,
  SetChainRateLimiterConfigs,
} from './token-pool/operations/set-chain-rate-limiter-configs.ts'
import {
  type SetDynamicConfigParams,
  SetDynamicConfig,
} from './token-pool/operations/set-dynamic-config.ts'
import {
  type SetRateLimitAdminParams,
  SetRateLimitAdmin,
} from './token-pool/operations/set-rate-limit-admin.ts'
import { type SetRebalancerParams, SetRebalancer } from './token-pool/operations/set-rebalancer.ts'
import { type SetRemotePoolParams, SetRemotePool } from './token-pool/operations/set-remote-pool.ts'
import {
  type TransferLiquidityParams,
  TransferLiquidity,
} from './token-pool/operations/transfer-liquidity.ts'
import {
  type TransferPoolOwnershipParams,
  TransferPoolOwnership,
} from './token-pool/operations/transfer-pool-ownership.ts'
import {
  type UpdateAdvancedPoolHooksParams,
  UpdateAdvancedPoolHooks,
} from './token-pool/operations/update-advanced-pool-hooks.ts'
import {
  type WithdrawFeeTokensParams,
  WithdrawFeeTokens,
} from './token-pool/operations/withdraw-fee-tokens.ts'
import {
  type WithdrawLiquidityParams,
  WithdrawLiquidity,
} from './token-pool/operations/withdraw-liquidity.ts'
import {
  type AcceptDefaultAdminTransferParams,
  AcceptDefaultAdminTransfer,
} from './token/operations/accept-default-admin-transfer.ts'
import {
  type AcceptTokenOwnershipParams,
  AcceptTokenOwnership,
} from './token/operations/accept-token-ownership.ts'
import { type ApproveTokenParams, ApproveToken } from './token/operations/approve-token.ts'
import {
  type BeginDefaultAdminTransferParams,
  BeginDefaultAdminTransfer,
} from './token/operations/begin-default-admin-transfer.ts'
import {
  type CancelDefaultAdminTransferParams,
  CancelDefaultAdminTransfer,
} from './token/operations/cancel-default-admin-transfer.ts'
import { type DeployTokenParams, DeployToken } from './token/operations/deploy-token.ts'
import {
  type GetBurnersParams,
  type GetBurnersResult,
  GetBurners,
} from './token/operations/get-burners.ts'
import {
  type GetCCIPAdminParams,
  type GetCCIPAdminResult,
  GetCCIPAdmin,
} from './token/operations/get-ccip-admin.ts'
import {
  type GetMintersParams,
  type GetMintersResult,
  GetMinters,
} from './token/operations/get-minters.ts'
import {
  type GetTokenDefaultAdminParams,
  type GetTokenDefaultAdminResult,
  GetTokenDefaultAdmin,
} from './token/operations/get-token-default-admin.ts'
import {
  type GetTokenOwnerParams,
  type GetTokenOwnerResult,
  GetTokenOwner,
} from './token/operations/get-token-owner.ts'
import { type GrantBurnRoleParams, GrantBurnRole } from './token/operations/grant-burn-role.ts'
import {
  type GrantMintAndBurnRolesParams,
  GrantMintAndBurnRoles,
} from './token/operations/grant-mint-and-burn-roles.ts'
import { type GrantMintRoleParams, GrantMintRole } from './token/operations/grant-mint-role.ts'
import { type IsBurnerParams, type IsBurnerResult, IsBurner } from './token/operations/is-burner.ts'
import { type IsMinterParams, type IsMinterResult, IsMinter } from './token/operations/is-minter.ts'
import { type MintParams, Mint } from './token/operations/mint.ts'
import { type RevokeBurnRoleParams, RevokeBurnRole } from './token/operations/revoke-burn-role.ts'
import { type RevokeMintRoleParams, RevokeMintRole } from './token/operations/revoke-mint-role.ts'
import { type SetCCIPAdminParams, SetCCIPAdmin } from './token/operations/set-ccip-admin.ts'
import {
  type TransferTokenOwnershipParams,
  TransferTokenOwnership,
} from './token/operations/transfer-token-ownership.ts'

/** CCT admin operations for EVM chains, delegating each op to an operation class. */
export class EVMTokenManager extends TokenManager<typeof ChainFamily.EVM> {
  readonly chain: EVMChain
  // Token operations
  readonly #deployToken = new DeployToken()
  readonly #approveToken = new ApproveToken()
  readonly #mint = new Mint()
  readonly #grantMintAndBurnRoles = new GrantMintAndBurnRoles()
  readonly #grantMintRole = new GrantMintRole()
  readonly #grantBurnRole = new GrantBurnRole()
  readonly #revokeMintRole = new RevokeMintRole()
  readonly #revokeBurnRole = new RevokeBurnRole()
  readonly #getMinters = new GetMinters()
  readonly #getBurners = new GetBurners()
  readonly #isMinter = new IsMinter()
  readonly #isBurner = new IsBurner()
  readonly #getTokenOwner = new GetTokenOwner()
  readonly #getCCIPAdmin = new GetCCIPAdmin()
  readonly #getTokenDefaultAdmin = new GetTokenDefaultAdmin()
  readonly #transferTokenOwnership = new TransferTokenOwnership()
  readonly #acceptTokenOwnership = new AcceptTokenOwnership()
  readonly #beginDefaultAdminTransfer = new BeginDefaultAdminTransfer()
  readonly #acceptDefaultAdminTransfer = new AcceptDefaultAdminTransfer()
  readonly #cancelDefaultAdminTransfer = new CancelDefaultAdminTransfer()
  readonly #setCCIPAdmin = new SetCCIPAdmin()

  // Token admin registry operations
  readonly #registerAdmin = new RegisterAdmin()
  readonly #setPool = new SetPool()
  readonly #transferAdmin = new TransferAdmin()
  readonly #acceptAdmin = new AcceptAdmin()
  readonly #getTokenAdminRegistry = new GetTokenAdminRegistry()
  readonly #getSupportedTokens = new GetSupportedTokens()

  // Token pool operations
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #transferPoolOwnership = new TransferPoolOwnership()
  readonly #acceptPoolOwnership = new AcceptPoolOwnership()
  readonly #getTokenPoolState = new GetTokenPoolState()
  readonly #getTokenPoolRemotes = new GetTokenPoolRemotes()
  readonly #setRemotePool = new SetRemotePool()
  readonly #addRemotePool = new AddRemotePool()
  readonly #removeRemotePool = new RemoveRemotePool()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #applyAllowlistUpdates = new ApplyAllowlistUpdates()
  readonly #getAllowlist = new GetAllowlist()
  readonly #getAllowlistEnabled = new GetAllowlistEnabled()
  readonly #applyTokenTransferFeeConfigUpdates = new ApplyTokenTransferFeeConfigUpdates()
  readonly #setChainRateLimiterConfigs = new SetChainRateLimiterConfigs()
  readonly #getAllowedFinalityConfig = new GetAllowedFinalityConfig()
  readonly #getDynamicConfig = new GetDynamicConfig()
  readonly #getFee = new GetFee()
  readonly #getTokenTransferFeeConfig = new GetTokenTransferFeeConfig()
  readonly #setAllowedFinalityConfig = new SetAllowedFinalityConfig()
  readonly #getAdvancedPoolHooks = new GetAdvancedPoolHooks()
  readonly #updateAdvancedPoolHooks = new UpdateAdvancedPoolHooks()
  readonly #setRateLimitAdmin = new SetRateLimitAdmin()
  readonly #setDynamicConfig = new SetDynamicConfig()
  readonly #provideLiquidity = new ProvideLiquidity()
  readonly #withdrawFeeTokens = new WithdrawFeeTokens()
  readonly #withdrawLiquidity = new WithdrawLiquidity()
  readonly #transferLiquidity = new TransferLiquidity()
  readonly #setRebalancer = new SetRebalancer()
  readonly #getRebalancer = new GetRebalancer()
  readonly #getLockbox = new GetLockbox()

  // Advanced pool hooks operations
  readonly #deployAdvancedPoolHooks = new DeployAdvancedPoolHooks()
  readonly #applyCCVConfigUpdates = new ApplyCCVConfigUpdates()
  readonly #updateAdvancedPoolHooksAuthorizedCallers =
    new UpdateAdvancedPoolHooksAuthorizedCallers()
  readonly #getCCVConfig = new GetCCVConfig()
  readonly #getAllCCVConfigs = new GetAllCCVConfigs()
  readonly #getRequiredCCVs = new GetRequiredCCVs()
  readonly #getAllAdvancedPoolHooksAuthorizedCallers =
    new GetAllAdvancedPoolHooksAuthorizedCallers()
  readonly #getPolicyEngine = new GetPolicyEngine()
  readonly #getThresholdAmount = new GetThresholdAmount()
  readonly #setPolicyEngine = new SetPolicyEngine()
  readonly #setThresholdAmount = new SetThresholdAmount()

  // Lockbox operations
  readonly #deployLockbox = new DeployLockbox()
  readonly #updateLockboxAuthorizedCallers = new UpdateLockboxAuthorizedCallers()
  readonly #getAllLockboxAuthorizedCallers = new GetAllLockboxAuthorizedCallers()
  readonly #depositToLockbox = new DepositToLockbox()
  readonly #withdrawFromLockbox = new WithdrawFromLockbox()

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
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * (see {@link transferPoolOwnership}); do not confuse the two.
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
   * (see {@link transferPoolOwnership}); do not confuse the two.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * @remarks Step one of two: nothing changes until `newOwner` calls {@link acceptPoolOwnership},
   * and until then the current owner keeps every privilege. Re-proposing replaces the pending
   * address, and proposing the zero address cancels the transfer outright.
   * @remarks The pool's on-chain `owner()` is read either way (one extra `eth_call`): `sender`,
   * when given, is pre-flighted against it, and `newOwner` is bounded away from it even when
   * `sender` is omitted because the eventual signer is not yet known.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if `newOwner` equals `sender`
   * or the pool's current owner (the pool would revert `CannotTransferToSelf`), or if `sender` is
   * given and is not the pool owner
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedTransferPoolOwnership({
   *   poolAddress: '0xPool...',
   *   newOwner: '0xNewOwner...', // must separately call acceptPoolOwnership
   *   sender: '0xCurrentOwner...',
   * })
   * ```
   */
  generateUnsignedTransferPoolOwnership(opts: TransferPoolOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#transferPoolOwnership.generate(this.chain, opts)
  }

  /**
   * Proposes a new pool owner, signing + submitting with `opts.wallet` — which must be the pool's
   * current owner, and is what `sender` defaults to. Step one of two, per
   * {@link generateUnsignedTransferPoolOwnership}: ownership moves only once `newOwner` calls
   * {@link acceptPoolOwnership}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if `newOwner` equals the
   * signer, if `sender` is given and is not the wallet's address, or if the signer is not the pool
   * owner
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * const { hash } = await cct.transferPoolOwnership({
   *   poolAddress: '0xPool...',
   *   newOwner: '0xNewOwner...',
   *   wallet, // the current pool owner
   * })
   * ```
   */
  transferPoolOwnership(
    opts: EVMExecuteParams<TransferPoolOwnershipParams>,
  ): Promise<TransactionResult> {
    return this.#transferPoolOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `acceptOwnership` tx (for multisig / offline signing), completing a
   * transfer proposed by {@link generateUnsignedTransferPoolOwnership}. Probes the pool's on-chain
   * `typeAndVersion`, which confirms the address is a supported CCT pool — the `acceptOwnership()`
   * calldata itself is one fixed selector at every version.
   * @remarks **Nothing about the caller can be pre-flighted:** the pool authorizes this against a
   * `private` pending-owner slot with no getter, so a tx signed by anyone other than the proposed
   * owner is only rejected on-chain. `sender` therefore just sets `tx.from`.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` or `sender` is invalid
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @example
   * ```typescript
   * // signed by the address a previous transferPoolOwnership proposed
   * const unsigned = await cct.generateUnsignedAcceptPoolOwnership({
   *   poolAddress: '0xPool...',
   *   sender: '0xProposedOwner...',
   * })
   * ```
   */
  generateUnsignedAcceptPoolOwnership(opts: AcceptPoolOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#acceptPoolOwnership.generate(this.chain, opts)
  }

  /**
   * Completes a pending pool ownership transfer, signing + submitting with `opts.wallet` — which
   * must be the address {@link transferPoolOwnership} proposed. Ownership moves in this tx, and a
   * wallet that is not the proposed owner reverts rather than failing validation, per
   * {@link generateUnsignedAcceptPoolOwnership}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, or `sender` is given and is
   * not the wallet's address
   * @throws {@link CCTTxFailedError} if the tx reverts or fails — notably when the wallet is not
   * the pool's proposed owner
   * @example
   * ```typescript
   * const { hash } = await cct.acceptPoolOwnership({
   *   poolAddress: '0xPool...',
   *   wallet, // the proposed owner
   * })
   * ```
   */
  acceptPoolOwnership(
    opts: EVMExecuteParams<AcceptPoolOwnershipParams>,
  ): Promise<TransactionResult> {
    return this.#acceptPoolOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned token-admin proposal (for multisig / offline signing), or a retraction when
   * `newOwner` is zero, on either token version.
   * @deprecated Use {@link generateUnsignedBeginDefaultAdminTransfer}, or
   * {@link generateUnsignedCancelDefaultAdminTransfer} to retract; this builds exactly what they do.
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedTransferTokenOwnership({
   *   tokenAddress: '0xToken...',
   *   newOwner: '0xNewOwner...', // must separately call acceptTokenOwnership
   *   sender: '0xCurrentOwner...',
   * })
   * ```
   */
  generateUnsignedTransferTokenOwnership(
    opts: TransferTokenOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    return this.#transferTokenOwnership.generate(this.chain, opts)
  }

  /**
   * Proposes a new token admin (or retracts, for a zero `newOwner`), signing + submitting with
   * `opts.wallet` — which must be the token's current admin, and is what `sender` defaults to.
   * @deprecated Use {@link beginDefaultAdminTransfer}, or {@link cancelDefaultAdminTransfer} to
   * retract.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if `sender` is given and is not
   * the wallet's address, or per the method it routes to
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * const { hash } = await cct.transferTokenOwnership({
   *   tokenAddress: '0xToken...',
   *   newOwner: '0xNewOwner...',
   *   wallet, // the current token owner
   * })
   * ```
   */
  transferTokenOwnership(
    opts: EVMExecuteParams<TransferTokenOwnershipParams>,
  ): Promise<TransactionResult> {
    return this.#transferTokenOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned acceptance of a pending token-admin transfer (for multisig / offline
   * signing), on either token version.
   * @deprecated Use {@link generateUnsignedAcceptDefaultAdminTransfer}; this builds exactly what it
   * does.
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedAcceptTokenOwnership({
   *   tokenAddress: '0xToken...',
   *   sender: '0xProposedOwner...',
   * })
   * ```
   */
  generateUnsignedAcceptTokenOwnership(opts: AcceptTokenOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#acceptTokenOwnership.generate(this.chain, opts)
  }

  /**
   * Completes a pending token-admin transfer, signing + submitting with `opts.wallet` — which
   * must be the proposed admin. Admin rights move in this tx.
   * @deprecated Use {@link acceptDefaultAdminTransfer}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is invalid, `sender` is given and is
   * not the wallet's address, or per {@link acceptDefaultAdminTransfer}
   * @throws {@link CCTTxFailedError} if the tx reverts or fails — notably when the wallet is not
   * the token's proposed admin
   * @example
   * ```typescript
   * const { hash } = await cct.acceptTokenOwnership({
   *   tokenAddress: '0xToken...',
   *   wallet, // the proposed owner
   * })
   * ```
   */
  acceptTokenOwnership(
    opts: EVMExecuteParams<AcceptTokenOwnershipParams>,
  ): Promise<TransactionResult> {
    return this.#acceptTokenOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned token-admin proposal (for multisig / offline signing):
   * `beginDefaultAdminTransfer` on a v2.0.0 CrossChainToken, whose proposed admin accepts only
   * after the token's mandatory delay, or Ownable2Step `transferOwnership` on a v1.x
   * `FactoryBurnMintERC20`. {@link generateUnsignedAcceptDefaultAdminTransfer} builds the second tx.
   *
   * @remarks On v2, `newAdmin = 0x0` deliberately schedules default-admin renunciation, completed
   * with `renounceRole`, not {@link acceptDefaultAdminTransfer}. Replacing a pending transfer is
   * valid and cancels the old proposal on-chain. On v1, where a zero proposal would retract, zero
   * is rejected: use {@link generateUnsignedCancelDefaultAdminTransfer}.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if any address is invalid, a v2 token has no current
   * default admin, `sender` is not the current admin, or a v1 `newAdmin` is zero or the owner
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedBeginDefaultAdminTransfer({
   *   tokenAddress: '0xToken...',
   *   newAdmin: '0xNewAdmin...',
   *   sender: '0xCurrentAdmin...',
   * })
   * ```
   */
  generateUnsignedBeginDefaultAdminTransfer(
    opts: BeginDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return this.#beginDefaultAdminTransfer.generate(this.chain, opts)
  }

  /**
   * Proposes a new token admin, signing + submitting with `opts.wallet` (the current admin: v2
   * default admin, v1 owner).
   *
   * @remarks See {@link generateUnsignedBeginDefaultAdminTransfer} for version, delay, and
   * zero-address rules. `sender` defaults to the wallet address, so the admin gate runs before
   * broadcast.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` differs from the
   * wallet, or per {@link generateUnsignedBeginDefaultAdminTransfer}
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.beginDefaultAdminTransfer({
   *   tokenAddress: '0xToken...',
   *   newAdmin: '0xNewAdmin...',
   *   wallet, // current admin
   * })
   * ```
   */
  beginDefaultAdminTransfer(
    opts: EVMExecuteParams<BeginDefaultAdminTransferParams>,
  ): Promise<TransactionResult> {
    return this.#beginDefaultAdminTransfer.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned token-admin acceptance (for multisig / offline signing):
   * `acceptDefaultAdminTransfer` on a v2.0.0 CrossChainToken, whose contract enforces its mandatory
   * delay when mined, or Ownable2Step `acceptOwnership` on a v1.x `FactoryBurnMintERC20`.
   *
   * @remarks v2's pending admin and schedule are public, so this rejects a missing transfer or a
   * known `sender` other than the pending admin before signing. It cannot safely reject a schedule
   * that has not passed yet: an offline tx may be executed after it does. v1's pending owner has no
   * getter, so `sender` only sets `tx.from` there.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if no v2 transfer is pending, it schedules renunciation,
   * or `sender` is not its pending default admin
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedAcceptDefaultAdminTransfer({
   *   tokenAddress: '0xToken...',
   *   sender: '0xPendingAdmin...',
   * })
   * ```
   */
  generateUnsignedAcceptDefaultAdminTransfer(
    opts: AcceptDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return this.#acceptDefaultAdminTransfer.generate(this.chain, opts)
  }

  /**
   * Completes a pending token-admin transfer, signing + submitting with `opts.wallet` (the
   * proposed admin).
   *
   * @remarks See {@link generateUnsignedAcceptDefaultAdminTransfer} for version and delay rules.
   * The contract is the final authority on whether v2's schedule has passed and, on v1, on whether
   * the wallet is the proposed owner.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` differs from the
   * wallet, or on v2 no transfer is pending or the wallet is not its pending default admin
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain — notably before v2's delay
   * has passed, or when the wallet is not v1's proposed owner
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.acceptDefaultAdminTransfer({
   *   tokenAddress: '0xToken...',
   *   wallet, // pending admin
   * })
   * ```
   */
  acceptDefaultAdminTransfer(
    opts: EVMExecuteParams<AcceptDefaultAdminTransferParams>,
  ): Promise<TransactionResult> {
    return this.#acceptDefaultAdminTransfer.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned token-admin cancellation (for multisig / offline signing):
   * `cancelDefaultAdminTransfer` on a v2.0.0 CrossChainToken, Ownable2Step `transferOwnership(0x0)`
   * on a v1.x `FactoryBurnMintERC20`.
   *
   * @remarks On v2, a cancellation with no pending transfer is rejected even though OpenZeppelin
   * would mine it as a silent no-op. v1's pending owner has no getter, so this is not checked there.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if no v2 transfer is pending, the token has no current
   * default admin, or `sender` is not the current admin (v2 default admin, v1 owner)
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedCancelDefaultAdminTransfer({
   *   tokenAddress: '0xToken...',
   *   sender: '0xCurrentAdmin...',
   * })
   * ```
   */
  generateUnsignedCancelDefaultAdminTransfer(
    opts: CancelDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return this.#cancelDefaultAdminTransfer.generate(this.chain, opts)
  }

  /**
   * Cancels a pending token-admin transfer, signing + submitting with `opts.wallet` (the current
   * admin: v2 default admin, v1 owner).
   *
   * @remarks See {@link generateUnsignedCancelDefaultAdminTransfer} for version and
   * pending-transfer rules.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` differs from the
   * wallet, no v2 transfer is pending, the token has no current default admin, or the wallet is not
   * the current admin
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.cancelDefaultAdminTransfer({
   *   tokenAddress: '0xToken...',
   *   wallet, // current admin
   * })
   * ```
   */
  cancelDefaultAdminTransfer(
    opts: EVMExecuteParams<CancelDefaultAdminTransferParams>,
  ): Promise<TransactionResult> {
    return this.#cancelDefaultAdminTransfer.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned v2.0.0 `setCCIPAdmin` tx (for multisig / offline signing). The current
   * default admin sets the separate CCIP admin (including zero to clear it), which
   * TokenAdminRegistry can use through
   * `registerAdminViaGetCCIPAdmin`.
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTParamsInvalidError} if an address is invalid or `sender` is not the current
   * default admin
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetCCIPAdmin({
   *   tokenAddress: '0xToken...',
   *   newAdmin: '0xCCIPAdmin...',
   *   sender: '0xDefaultAdmin...',
   * })
   * ```
   */
  generateUnsignedSetCCIPAdmin(opts: SetCCIPAdminParams): Promise<UnsignedEVMTx> {
    return this.#setCCIPAdmin.generate(this.chain, opts)
  }

  /**
   * Sets a v2.0.0 CrossChainToken CCIP admin, signing + submitting with `opts.wallet` (the current
   * default admin).
   *
   * @remarks `sender` defaults to the wallet address, so the default-admin gate runs before
   * broadcast.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` differs from the
   * wallet, or the wallet is not the current default admin
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.setCCIPAdmin({
   *   tokenAddress: '0xToken...',
   *   newAdmin: '0xCCIPAdmin...',
   *   wallet, // current default admin
   * })
   * ```
   */
  setCCIPAdmin(opts: EVMExecuteParams<SetCCIPAdminParams>): Promise<TransactionResult> {
    return this.#setCCIPAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool rate-limit tx (for multisig / offline signing): sets the inbound and
   * outbound limits of one or more already-configured lanes, in a single transaction. Probes the
   * pool's on-chain `typeAndVersion` to resolve its interface + encoder.
   * @remarks **v1.5.0 pools set one lane per transaction.** v1.5.1–v1.6.1 encode the batch
   * `setChainRateLimiterConfigs(uint64[], Config[], Config[])` and v2.0.0 the reshaped
   * `setRateLimitConfig(RateLimitConfigArgs[])`, but v1.5.0 ships only the singular
   * `setChainRateLimiterConfig(uint64, Config, Config)`. To keep the one-op-one-transaction
   * contract every CCT write holds, a v1.5.0 pool therefore accepts only a single-element
   * `updates`; a multi-lane batch is rejected with {@link CCTParamsInvalidError} rather than
   * fanned out into N transactions.
   *
   * `fastFinality` is **v2.0.0-only** — the flag does not exist in the earlier ABIs, so setting it
   * (to either value) on an older pool is rejected rather than silently dropped. It defaults to
   * `false` on v2.0.0.
   *
   * This op *updates* limits on lanes that already exist; it does not add one. An unconfigured
   * selector reverts on-chain (`NonExistentChain`).
   *
   * The tx must ultimately be signed by the pool `owner` **or** its `rateLimitAdmin` — both are
   * reported by {@link getTokenPoolState}. When `opts.sender` is supplied it is pre-flighted
   * against *both* roles (two extra `eth_call`s — the pool's `owner()` and whichever getter
   * reports `rateLimitAdmin` on that version), so a
   * `sender` holding neither fails at build time rather than reverting at signing. Omit `sender`
   * to build the calldata without any role read, when the eventual signer is not yet known.
   * @throws {@link CCTParamsInvalidError} if any param is invalid: `updates` empty, a repeated
   * `remoteChainSelector`, a non-`uint64` selector, a rate above its capacity while enabled, a
   * non-zero amount while disabled, `fastFinality` set on a pre-2.0.0 pool, or `sender` given and
   * being neither the pool `owner` nor its (set) `rateLimitAdmin`. On a **v1.5.1 or v1.6.0** pool
   * the enabled-bucket bound is stricter still (`0 < rate < capacity`), so a `rate` of `0n` or a
   * `rate` equal to `capacity` is also rejected there — v1.6.1 and v2.0.0 allow both. A
   * **v1.5.0** pool accepts only a single-element `updates`.
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedSetChainRateLimiterConfigs({
   *   poolAddress: '0xPool...',
   *   updates: [
   *     {
   *       remoteChainSelector: 5009297550715157269n, // ethereum-mainnet
   *       // amounts are in the local token's smallest unit (18 decimals here)
   *       outboundRateLimiterConfig: { enabled: true, capacity: 10_000n * 10n ** 18n, rate: 100n * 10n ** 18n },
   *       inboundRateLimiterConfig: { enabled: false }, // capacity/rate default to 0n
   *     },
   *   ],
   *   sender: '0xOwnerOrRateLimitAdmin...',
   * })
   * ```
   */
  generateUnsignedSetChainRateLimiterConfigs(
    opts: SetChainRateLimiterConfigsParams,
  ): Promise<UnsignedEVMTx> {
    return this.#setChainRateLimiterConfigs.generate(this.chain, opts)
  }

  /**
   * Sets the inbound and outbound rate limits of one or more already-configured lanes in a single
   * transaction, signing + submitting with `opts.wallet`.
   * @remarks Gated on **either** the pool `owner` or its `rateLimitAdmin` — rate limits are the one
   * pool write that accepts a delegated role, so this check is a disjunction where
   * {@link transferPoolOwnership}'s is owner-only. Both roles are reported by
   * {@link getTokenPoolState}; `rateLimitAdmin` is the zero address when unset, and an unset role
   * matches nobody.
   *
   * Same version rules as {@link generateUnsignedSetChainRateLimiterConfigs}: **v1.5.0 pools set
   * one lane per transaction**, and `fastFinality` is v2.0.0-only.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or if `sender` is given and is
   * not the wallet's address, or the signer is neither the pool `owner` nor its (set)
   * `rateLimitAdmin`. On a **v1.5.1 or v1.6.0** pool an enabled rate limiter must additionally
   * satisfy `0 < rate < capacity`, so a `rate` of `0n` or a `rate` equal to `capacity` is rejected
   * there — v1.6.1 and v2.0.0 allow both. A **v1.5.0** pool accepts only a single-element
   * `updates`.
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.setChainRateLimiterConfigs({
   *   poolAddress: '0xPool...',
   *   updates: [
   *     {
   *       remoteChainSelector: 16015286601757825753n, // ethereum-testnet-sepolia
   *       outboundRateLimiterConfig: { enabled: true, capacity: 1_000n * 10n ** 18n, rate: 10n * 10n ** 18n },
   *       inboundRateLimiterConfig: { enabled: true, capacity: 1_000n * 10n ** 18n, rate: 10n * 10n ** 18n },
   *       // fastFinality: true, // v2.0.0 pools only — targets the fast-finality buckets
   *     },
   *   ],
   *   wallet, // the pool owner or its rateLimitAdmin
   * })
   * ```
   */
  setChainRateLimiterConfigs(
    opts: EVMExecuteParams<SetChainRateLimiterConfigsParams>,
  ): Promise<TransactionResult> {
    return this.#setChainRateLimiterConfigs.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `setRateLimitAdmin` tx (for multisig / offline signing): assigns the
   * role allowed to change the pool's rate limits alongside the owner. Probes the pool's on-chain
   * `typeAndVersion` to resolve its interface + encoder.
   * @remarks Owner-only, unlike the rate-limit *config* writes the pool also accepts from the
   * current `rateLimitAdmin` — this call assigns the role itself, so admitting the incumbent
   * admin would let it reassign or entrench its own privilege. When `sender` is supplied it is
   * checked against the pool's `owner()` before any calldata is built; omit it and no owner read
   * is made (nothing to compare against).
   *
   * A zero `newRateLimitAdmin` is accepted and clears the delegation, leaving the owner as the
   * only account that can change rate limits.
   * @throws {@link CCTOperationUnsupportedError} on a **v2.0.0** pool — 2.0.0 removed the
   * standalone `setRateLimitAdmin(address)` selector and folded the role into a three-field
   * dynamic config; use {@link generateUnsignedSetDynamicConfig} / {@link setDynamicConfig} there
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `poolAddress` is the zero
   * address, or `sender` is given and is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the pool owner.
   * const unsigned = await cct.generateUnsignedSetRateLimitAdmin({
   *   poolAddress: '0xPool...',
   *   newRateLimitAdmin: '0xOpsMultisig...',
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedSetRateLimitAdmin(opts: SetRateLimitAdminParams): Promise<UnsignedEVMTx> {
    return this.#setRateLimitAdmin.generate(this.chain, opts)
  }

  /**
   * Assigns the pool's rate-limit admin role, signing + submitting with `opts.wallet`. `sender`
   * defaults to the wallet's address and must equal it — the wallet must be the pool owner.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool — use {@link setDynamicConfig}
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, or the wallet is not the pool owner
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.setRateLimitAdmin({
   *   poolAddress: '0xPool...',
   *   newRateLimitAdmin: '0xOpsMultisig...',
   *   wallet,
   * })
   * ```
   */
  setRateLimitAdmin(opts: EVMExecuteParams<SetRateLimitAdminParams>): Promise<TransactionResult> {
    return this.#setRateLimitAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `setDynamicConfig` tx (for multisig / offline signing): replaces a
   * **v2.0.0** pool's whole dynamic config — the `router` it accepts ramp calls from, plus the
   * `rateLimitAdmin` and `feeAdmin` delegate roles.
   * @remarks This is where the pre-2.0.0 `setRouter` / `setRateLimitAdmin` setters went: 2.0.0
   * removed them and writes all three fields together. Consequently **all three params are
   * required** — this op deliberately does *not* read `getDynamicConfig()` to fill in what the
   * caller omitted. The calldata has to be deterministic at build time: a multisig or cold wallet
   * may sign it days later, and a hidden read would bake a value that has since moved on-chain,
   * silently reverting an unrelated config change made in the interim.
   *
   * Read the current triple with {@link getTokenPoolState} and pass it back explicitly, so what
   * is signed is exactly what was reviewed. This is also the migration path off
   * {@link setRateLimitAdmin} for a 2.0.0 pool.
   *
   * Owner-only, for the same escalation reason as {@link generateUnsignedSetRateLimitAdmin}.
   * Zero `rateLimitAdmin` / `feeAdmin` clear those delegations; `router` must be non-zero, since
   * a zero router detaches the pool from CCIP rather than clearing a privilege.
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool, which has no
   * `setDynamicConfig` — use {@link generateUnsignedSetRateLimitAdmin} there
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `poolAddress` or `router` is
   * the zero address, or `sender` is given and is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the pool owner.
   * const unsigned = await cct.generateUnsignedSetDynamicConfig({
   *   poolAddress: '0xPool...',
   *   router: '0xRouter...',
   *   rateLimitAdmin: '0xOpsMultisig...',
   *   feeAdmin: '0xFeeMultisig...',
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedSetDynamicConfig(opts: SetDynamicConfigParams): Promise<UnsignedEVMTx> {
    return this.#setDynamicConfig.generate(this.chain, opts)
  }

  /**
   * Replaces a v2.0.0 pool's dynamic config, signing + submitting with `opts.wallet`. `sender`
   * defaults to the wallet's address and must equal it — the wallet must be the pool owner.
   * @remarks Writes all three fields in one call, so **all three params are required**: read the
   * current triple with {@link getTokenPoolState} and pass back whatever you are not changing, as
   * below. A missing field is a validation error, never "leave that one alone" — nothing is
   * backfilled from `getDynamicConfig()`; see {@link generateUnsignedSetDynamicConfig} for why.
   * On a 2.0.0 pool this replaces {@link setRateLimitAdmin}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool — use {@link setRateLimitAdmin}
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, or the wallet is not the pool owner
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * // change only rateLimitAdmin: read the current config and pass the rest back unchanged
   * const state = await cct.getTokenPoolState({ poolAddress: '0xPool...' })
   * if (state.version !== '2.0.0') throw new Error('pre-2.0.0 pool: use setRateLimitAdmin')
   * const { hash } = await cct.setDynamicConfig({
   *   poolAddress: '0xPool...',
   *   router: state.router,
   *   rateLimitAdmin: '0xOpsMultisig...',
   *   feeAdmin: state.feeAdmin,
   *   wallet,
   * })
   * ```
   */
  setDynamicConfig(opts: EVMExecuteParams<SetDynamicConfigParams>): Promise<TransactionResult> {
    return this.#setDynamicConfig.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `setAllowedFinalityConfig` tx (for multisig / offline signing).
   * Configures the **v2.0.0-only** FTF minimum block depth and optional FCR/safe-finality mode.
   *
   * @remarks This replaces the whole finality config: `allowedFinality.finalityDepth` is an integer
   * in `[0, 65535]`, and `0` disables FTF; omitting `allowedFinality.finalitySafe` disables FCR.
   * To preserve one setting while changing the other, first call {@link getAllowedFinalityConfig}.
   * The pool owner is the only permitted caller; when `sender` is supplied it is checked against
   * `owner()` before calldata is returned.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` is zero, or `sender`
   * is supplied and is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetAllowedFinalityConfig({
   *   poolAddress: '0xPool...',
   *   allowedFinality: { finalityDepth: 5, finalitySafe: true },
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedSetAllowedFinalityConfig(
    opts: SetAllowedFinalityConfigParams,
  ): Promise<UnsignedEVMTx> {
    return this.#setAllowedFinalityConfig.generate(this.chain, opts)
  }

  /**
   * Sets the finality modes a **v2.0.0** pool accepts, signing + submitting as its owner.
   *
   * @remarks This replaces the whole finality config: `allowedFinality.finalityDepth` is an integer
   * in `[0, 65535]`, and `0` disables FTF; omitting `allowedFinality.finalitySafe` disables FCR.
   * To preserve one setting while changing the other, first call {@link getAllowedFinalityConfig}.
   * `sender` defaults to the wallet address and, when supplied, must equal it.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `sender` differs from the wallet,
   * or the wallet is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.setAllowedFinalityConfig({
   *   poolAddress: '0xPool...',
   *   allowedFinality: { finalityDepth: 5, finalitySafe: true },
   *   wallet,
   * })
   * ```
   */
  setAllowedFinalityConfig(
    opts: EVMExecuteParams<SetAllowedFinalityConfigParams>,
  ): Promise<TransactionResult> {
    return this.#setAllowedFinalityConfig.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned **v2.0.0** pool token-transfer-fee update transaction.
   *
   * @remarks Each remote selector appears once across `updates` and `disables`. Every update must
   * set `isEnabled` to `true`; `disables` removes its config. The pool owner may submit it, and
   * `sender`, when supplied, is pre-flighted against that role.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid or `sender` is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedApplyTokenTransferFeeConfigUpdates({
   *   poolAddress: '0xPool...',
   *   updates: [{
   *     remoteChainSelector: 16015286601757825753n,
   *     tokenTransferFeeConfig: {
   *       destGasOverhead: 100_000,
   *       destBytesOverhead: 32,
   *       finalityFeeUSDCents: 10,
   *       fastFinalityFeeUSDCents: 20,
   *       finalityTransferFeeBps: 25,
   *       fastFinalityTransferFeeBps: 50,
   *       isEnabled: true,
   *     },
   *   }],
   *   disables: [],
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedApplyTokenTransferFeeConfigUpdates(
    opts: ApplyTokenTransferFeeConfigUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    return this.#applyTokenTransferFeeConfigUpdates.generate(this.chain, opts)
  }

  /**
   * Updates or disables token-transfer fees for destination chains on a **v2.0.0** pool.
   *
   * @remarks Each remote selector appears once across `updates` and `disables`. Every update must
   * set `isEnabled` to `true`; `disables` removes its config. The signing wallet must be the pool
   * owner.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `sender` differs from the wallet,
   * or the wallet holds neither role
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.applyTokenTransferFeeConfigUpdates({
   *   poolAddress: '0xPool...',
   *   updates: [{
   *     remoteChainSelector: 16015286601757825753n,
   *     tokenTransferFeeConfig: {
   *       destGasOverhead: 100_000,
   *       destBytesOverhead: 32,
   *       finalityFeeUSDCents: 10,
   *       fastFinalityFeeUSDCents: 20,
   *       finalityTransferFeeBps: 25,
   *       fastFinalityTransferFeeBps: 50,
   *       isEnabled: true,
   *     },
   *   }],
   *   disables: [5009297550715157269n],
   *   wallet, // pool owner
   * })
   * ```
   */
  applyTokenTransferFeeConfigUpdates(
    opts: EVMExecuteParams<ApplyTokenTransferFeeConfigUpdatesParams>,
  ): Promise<TransactionResult> {
    return this.#applyTokenTransferFeeConfigUpdates.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned **v2.0.0** pool fee-token withdrawal transaction.
   *
   * @remarks The pool owner or delegated `feeAdmin` may transfer the full balances of the selected
   * fee tokens to `recipient`. On LockRelease pools, bridge liquidity remains in the external
   * lockbox and is not withdrawable here.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid or `sender` holds neither role
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedWithdrawFeeTokens({
   *   poolAddress: '0xPool...',
   *   feeTokens: ['0xFeeToken...'],
   *   recipient: '0xRecipient...',
   *   sender: '0xFeeAdmin...',
   * })
   * ```
   */
  generateUnsignedWithdrawFeeTokens(opts: WithdrawFeeTokensParams): Promise<UnsignedEVMTx> {
    return this.#withdrawFeeTokens.generate(this.chain, opts)
  }

  /**
   * Withdraws the selected fee-token balances from a **v2.0.0** pool to `recipient`.
   *
   * @remarks The signing wallet must be the pool owner or delegated `feeAdmin`.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `sender` differs from the wallet,
   * or the wallet holds neither role
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.withdrawFeeTokens({
   *   poolAddress: '0xPool...',
   *   feeTokens: ['0xFeeToken...'],
   *   recipient: '0xRecipient...',
   *   wallet, // pool owner or configured feeAdmin
   * })
   * ```
   */
  withdrawFeeTokens(opts: EVMExecuteParams<WithdrawFeeTokensParams>): Promise<TransactionResult> {
    return this.#withdrawFeeTokens.execute(this.chain, opts)
  }

  /**
   * Reads the finality modes a **v2.0.0+** pool accepts.
   *
   * @remarks `finalityDepth` is the FTF minimum block depth (`0` when disabled); `finalitySafe`
   * is `true` when FCR/safe finality is allowed.
   *
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const allowedFinality = await cct.getAllowedFinalityConfig({ poolAddress: '0xPool...' })
   * ```
   */
  getAllowedFinalityConfig(
    opts: GetAllowedFinalityConfigParams,
  ): Promise<GetAllowedFinalityConfigResult> {
    return this.#getAllowedFinalityConfig.query(this.chain, opts)
  }

  /**
   * Builds an unsigned `AdvancedPoolHooks` deployment tx (for multisig / offline signing).
   *
   * @remarks A v2.0.0 pool holds no sender allowlist and no CCV configuration itself — both live
   * on this contract. Deploy it, then bind it with {@link updateAdvancedPoolHooks} (or pass its
   * address as `deployTokenPool`'s `advancedPoolHooks`). The hooks' configuration methods take
   * the hooks' own `advancedPoolHooks` or a bound pool's `poolAddress`, so hooks can be configured
   * before binding.
   * @remarks The deployed address is only known once mined, so it is NOT returned here — use
   * {@link deployAdvancedPoolHooks} to receive it. The same applies to the constructor args
   * needed for explorer verification.
   * @remarks `allowlist` is a permanent choice: omitting it (or passing `[]`) disables the
   * allowlist for the contract's whole lifetime. See {@link DeployAdvancedPoolHooksParams}.
   *
   * @throws {@link CCTParamsInvalidError} if any address is invalid, zero or duplicated, or
   * `thresholdAmount` is not a `uint256`
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * // allowlist, thresholdAmount and policyEngine default to off
   * const unsigned = await cct.generateUnsignedDeployAdvancedPoolHooks({
   *   authorizedCallers: ['0xPool...'],
   *   sender: '0xDeployer...',
   * })
   * ```
   */
  generateUnsignedDeployAdvancedPoolHooks(
    opts: DeployAdvancedPoolHooksParams,
  ): Promise<UnsignedEVMTx> {
    return this.#deployAdvancedPoolHooks.generate(this.chain, opts)
  }

  /**
   * Deploys an `AdvancedPoolHooks` contract: the allowlist + CCV + policy-engine layer a v2.0.0
   * pool delegates to.
   *
   * @remarks Returns the deployed address plus the `verification` input (contract name and
   * ABI-encoded constructor args) a block explorer needs to verify the source.
   * @remarks Binding the pool ({@link updateAdvancedPoolHooks}) and authorizing it on the hooks
   * are independent: list every pool in `authorizedCallers` here, or add them later with the
   * hooks' own `applyAuthorizedCallerUpdates`, otherwise transfers revert `UnauthorizedCaller`.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any address is invalid, zero or duplicated, or
   * `thresholdAmount` is not a `uint256`
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines without an address
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * // thresholdAmount and policyEngine default to off
   * const { hash, contractAddress, verification } = await cct.deployAdvancedPoolHooks({
   *   allowlist: ['0xSender...'],
   *   authorizedCallers: ['0xPool...'],
   *   wallet,
   * })
   * ```
   */
  deployAdvancedPoolHooks(
    opts: EVMExecuteParams<DeployAdvancedPoolHooksParams>,
  ): Promise<DeployResult> {
    return this.#deployAdvancedPoolHooks.execute(this.chain, opts)
  }

  /**
   * Reads one remote chain's complete CCV config from `AdvancedPoolHooks`.
   *
   * @remarks An all-empty result is normal: the selector has no configured requirements. Base
   * lists apply to every transfer; threshold lists add requirements at or above the hooks'
   * threshold amount. `address(0)` selects the default CCV.
   *
   * @throws {@link CCTParamsInvalidError} if the target or `remoteChainSelector` is invalid, or
   * `poolAddress` has no hooks bound
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const config = await cct.getCCVConfig({
   *   advancedPoolHooks: '0xHooks...',
   *   remoteChainSelector: 5009297550715157269n,
   * })
   * ```
   */
  getCCVConfig(opts: GetCCVConfigParams): Promise<GetCCVConfigResult> {
    return this.#getCCVConfig.query(this.chain, opts)
  }

  /**
   * Lists every remote chain with a non-empty base CCV config.
   *
   * @remarks The result follows the contract's enumerable-set order, which is not a stable sort.
   * A config with only threshold CCVs cannot exist; threshold CCVs require a base list.
   *
   * @throws {@link CCTParamsInvalidError} if the target is invalid, or `poolAddress` has no hooks
   * bound
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const configs = await cct.getAllCCVConfigs({ advancedPoolHooks: '0xHooks...' })
   * ```
   */
  getAllCCVConfigs(opts: GetAllCCVConfigsParams): Promise<GetAllCCVConfigsResult> {
    return this.#getAllCCVConfigs.query(this.chain, opts)
  }

  /**
   * Resolves the CCVs required for a proposed inbound or outbound transfer.
   *
   * @remarks This is the hooks contract's current decision for the selector, amount, and direction;
   * it includes threshold CCVs when the amount reaches the configured threshold. The standard
   * `AdvancedPoolHooks` ignores the interface's token/finality/extra-data arguments, so this query
   * supplies their neutral values internally.
   *
   * @throws {@link CCTParamsInvalidError} if a param is invalid, or `poolAddress` has no hooks bound
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const ccvs = await cct.getRequiredCCVs({
   *   advancedPoolHooks: '0xHooks...',
   *   remoteChainSelector: 5009297550715157269n,
   *   amount: 1_000_000n,
   *   direction: 'outbound',
   * })
   * ```
   */
  getRequiredCCVs(opts: GetRequiredCCVsParams): Promise<GetRequiredCCVsResult> {
    return this.#getRequiredCCVs.query(this.chain, opts)
  }

  /**
   * Builds an unsigned `applyCCVConfigUpdates` tx (for multisig / offline signing); use
   * {@link applyCCVConfigUpdates} to sign and submit it directly.
   *
   * @remarks Each entry replaces one remote chain's complete base and threshold CCV lists.
   * Threshold lists require a non-empty matching base list; CCVs cannot repeat within or across
   * those paired lists. `address(0)` in any list selects the default CCV. The target is probed
   * to confirm it reports `AdvancedPoolHooks` before calldata is returned.
   *
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, CCVs are duplicated, a threshold
   * list lacks base CCVs, `poolAddress` has no hooks bound, or `sender` is not the hooks owner
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedApplyCCVConfigUpdates({
   *   advancedPoolHooks: '0xHooks...',
   *   ccvConfigArgs: [{
   *     remoteChainSelector: 5009297550715157269n,
   *     outboundCCVs: ['0xCCV...'],
   *     thresholdOutboundCCVs: [],
   *     inboundCCVs: [],
   *     thresholdInboundCCVs: []
   *   }],
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedApplyCCVConfigUpdates(opts: ApplyCCVConfigUpdatesParams): Promise<UnsignedEVMTx> {
    return this.#applyCCVConfigUpdates.generate(this.chain, opts)
  }

  /**
   * Replaces per-chain CCV requirements, signing + submitting as the hooks owner. Use
   * {@link generateUnsignedApplyCCVConfigUpdates} for multisig or offline signing.
   *
   * @remarks Base CCVs apply to every transfer; threshold CCVs add requirements only above the
   * hooks' configured threshold. `sender` defaults to the wallet address and, when supplied,
   * must equal it. `address(0)` in any list selects the default CCV. The target is probed to
   * confirm it is an `AdvancedPoolHooks` contract.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, CCVs are duplicated, a threshold
   * list lacks base CCVs, `poolAddress` has no hooks bound, `sender` differs from the wallet, or
   * the wallet is not the hooks owner
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.applyCCVConfigUpdates({
   *   advancedPoolHooks: '0xHooks...',
   *   ccvConfigArgs: [{
   *     remoteChainSelector: 5009297550715157269n,
   *     outboundCCVs: ['0xCCV...'],
   *     thresholdOutboundCCVs: [],
   *     inboundCCVs: [],
   *     thresholdInboundCCVs: []
   *   }],
   *   wallet,
   * })
   * ```
   */
  applyCCVConfigUpdates(
    opts: EVMExecuteParams<ApplyCCVConfigUpdatesParams>,
  ): Promise<TransactionResult> {
    return this.#applyCCVConfigUpdates.execute(this.chain, opts)
  }

  /**
   * Lists callers authorized for hooks preflight and postflight checks.
   *
   * @throws {@link CCTParamsInvalidError} if the target is invalid, or `poolAddress` has no hooks
   * bound
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   *
   * @example
   * ```ts
   * const callers = await cct.getAllAdvancedPoolHooksAuthorizedCallers({
   *   advancedPoolHooks: '0xHooks...',
   * })
   * ```
   */
  getAllAdvancedPoolHooksAuthorizedCallers(
    opts: GetAllAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<GetAllAdvancedPoolHooksAuthorizedCallersResult> {
    return this.#getAllAdvancedPoolHooksAuthorizedCallers.query(this.chain, opts)
  }

  /**
   * Reads the hooks policy engine; the zero address means policy checks are disabled.
   *
   * @throws {@link CCTParamsInvalidError} if the target is invalid, or `poolAddress` has no hooks
   * bound
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   *
   * @example
   * ```ts
   * const policyEngine = await cct.getPolicyEngine({ advancedPoolHooks: '0xHooks...' })
   * ```
   */
  getPolicyEngine(opts: GetPolicyEngineParams): Promise<GetPolicyEngineResult> {
    return this.#getPolicyEngine.query(this.chain, opts)
  }

  /**
   * Reads the amount at which additional CCVs apply; zero means they are disabled.
   *
   * @throws {@link CCTParamsInvalidError} if the target is invalid, or `poolAddress` has no hooks
   * bound
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   *
   * @example
   * ```ts
   * const thresholdAmount = await cct.getThresholdAmount({ advancedPoolHooks: '0xHooks...' })
   * ```
   */
  getThresholdAmount(opts: GetThresholdAmountParams): Promise<GetThresholdAmountResult> {
    return this.#getThresholdAmount.query(this.chain, opts)
  }

  /**
   * Builds an unsigned authorized-caller update for an `AdvancedPoolHooks`; use
   * {@link updateAdvancedPoolHooksAuthorizedCallers} to sign and submit it directly.
   *
   * @remarks Caller arrays reject duplicates (including different address casing). Removes run
   * before adds, so a caller present in both lists remains authorized. The hooks target and
   * supplied owner are pre-flighted before calldata is returned.
   *
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` has no hooks bound,
   * or `sender` is not the hooks owner
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedUpdateAdvancedPoolHooksAuthorizedCallers({
   *   advancedPoolHooks: '0xHooks...',
   *   addedCallers: ['0xPool...'],
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedUpdateAdvancedPoolHooksAuthorizedCallers(
    opts: UpdateAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<UnsignedEVMTx> {
    return this.#updateAdvancedPoolHooksAuthorizedCallers.generate(this.chain, opts)
  }

  /**
   * Updates callers permitted to invoke hooks checks, signing + submitting as the hooks owner.
   * Use {@link generateUnsignedUpdateAdvancedPoolHooksAuthorizedCallers} for multisig or offline signing.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` has no hooks bound,
   * `sender` differs from the wallet, or the wallet is not the hooks owner
   * @throws {@link CCIPExecTxRevertedError} if the transaction reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.updateAdvancedPoolHooksAuthorizedCallers({
   *   advancedPoolHooks: '0xHooks...',
   *   addedCallers: ['0xPool...'],
   *   wallet,
   * })
   * ```
   */
  updateAdvancedPoolHooksAuthorizedCallers(
    opts: EVMExecuteParams<UpdateAdvancedPoolHooksAuthorizedCallersParams>,
  ): Promise<TransactionResult> {
    return this.#updateAdvancedPoolHooksAuthorizedCallers.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `setPolicyEngine` tx for an `AdvancedPoolHooks`; use
   * {@link setPolicyEngine} to sign and submit it directly.
   *
   * @remarks The zero address disables policy checks. A non-zero engine must have deployed code
   * and implement `attach()` / `detach()`; code presence alone cannot verify that interface. The
   * target is probed to confirm it reports `AdvancedPoolHooks`. When `sender` is supplied, it must
   * be the current hooks owner.
   *
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` has no hooks bound,
   * a non-zero engine has no deployed code, or `sender` is not the hooks owner
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetPolicyEngine({
   *   advancedPoolHooks: '0xHooks...',
   *   newPolicyEngine: '0xPolicyEngine...',
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedSetPolicyEngine(opts: SetPolicyEngineParams): Promise<UnsignedEVMTx> {
    return this.#setPolicyEngine.generate(this.chain, opts)
  }

  /**
   * Attaches a policy engine to an `AdvancedPoolHooks`, signing + submitting as its owner. Pass
   * the zero address to disable policy checks. Use {@link generateUnsignedSetPolicyEngine} for
   * multisig or offline signing.
   *
   * @remarks The hooks contract detaches the old engine before attaching the new one. A reverting
   * old-engine detach reverts this transaction; use the contract's explicit recovery setter if
   * that is intentional.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` has no hooks bound,
   * a non-zero engine has no deployed code, `sender` differs from the wallet, or the wallet is not
   * the hooks owner
   * @throws {@link CCIPExecTxRevertedError} if the transaction reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.setPolicyEngine({
   *   advancedPoolHooks: '0xHooks...',
   *   newPolicyEngine: '0xPolicyEngine...',
   *   wallet,
   * })
   * ```
   */
  setPolicyEngine(opts: EVMExecuteParams<SetPolicyEngineParams>): Promise<TransactionResult> {
    return this.#setPolicyEngine.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `setThresholdAmount` tx for an `AdvancedPoolHooks`; use
   * {@link setThresholdAmount} to sign and submit it directly.
   *
   * @remarks Zero disables threshold CCVs; base CCVs continue to apply. The target is probed to
   * confirm it reports `AdvancedPoolHooks`; when `sender` is supplied, it must be the current
   * hooks owner.
   *
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` has no hooks bound,
   * or `sender` is not the hooks owner
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetThresholdAmount({
   *   advancedPoolHooks: '0xHooks...',
   *   thresholdAmount: 1_000_000n,
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedSetThresholdAmount(opts: SetThresholdAmountParams): Promise<UnsignedEVMTx> {
    return this.#setThresholdAmount.generate(this.chain, opts)
  }

  /**
   * Sets the amount at which an `AdvancedPoolHooks` requires additional CCVs, signing + submitting
   * as its owner. Pass zero to disable threshold CCVs. Use
   * {@link generateUnsignedSetThresholdAmount} for multisig or offline signing.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTContractTypeInvalidError} if the target is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} if `poolAddress` is a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if a param is invalid, `poolAddress` has no hooks bound,
   * `sender` differs from the wallet, or the wallet is not the hooks owner
   * @throws {@link CCIPExecTxRevertedError} if the transaction reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.setThresholdAmount({
   *   advancedPoolHooks: '0xHooks...',
   *   thresholdAmount: 1_000_000n,
   *   wallet,
   * })
   * ```
   */
  setThresholdAmount(opts: EVMExecuteParams<SetThresholdAmountParams>): Promise<TransactionResult> {
    return this.#setThresholdAmount.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `updateAdvancedPoolHooks` tx (for multisig / offline signing):
   * points a **v2.0.0** pool at an `AdvancedPoolHooks` contract, or detaches the current one
   * with the zero address.
   *
   * @remarks Unlike a LockRelease pool's `lockBox`, which the constructor fixes in an
   * `immutable` slot with no setter, the hooks binding is a plain storage slot this op
   * overwrites — a mis-bound lockbox needs a new pool, a mis-bound hooks contract needs one
   * transaction. Do not assume the two ctor args behave alike.
   * @remarks Read the current binding with {@link getAdvancedPoolHooks} first: a re-point to the
   * address already bound is rejected rather than burned as a no-op transaction.
   * @remarks A non-zero target is probed and must report `typeAndVersion() == "AdvancedPoolHooks
   * …"`. The pool accepts any address, so this catches an EOA or a mis-pasted token/router/pool
   * address that would otherwise brick every transfer through the pool.
   *
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is zero/invalid, `advancedPoolHooks`
   * is invalid, the pool is already bound to it, or `sender` is not the pool owner
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported,
   * or a non-zero `advancedPoolHooks` is not an `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedUpdateAdvancedPoolHooks({
   *   poolAddress: '0xPool...',
   *   advancedPoolHooks: '0xHooks...',
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedUpdateAdvancedPoolHooks(
    opts: UpdateAdvancedPoolHooksParams,
  ): Promise<UnsignedEVMTx> {
    return this.#updateAdvancedPoolHooks.generate(this.chain, opts)
  }

  /**
   * Points a **v2.0.0** pool at an `AdvancedPoolHooks` contract, or detaches the current one
   * with the zero address. Owner-only.
   *
   * @remarks This moves the pool's entire allowlist and CCV posture in one transaction: the new
   * contract's configuration takes effect for the next transfer, and the old one's stops
   * applying. Detaching leaves the pool enforcing neither.
   * @remarks The binding is re-pointable, in deliberate contrast to `i_lockBox` — see
   * {@link generateUnsignedUpdateAdvancedPoolHooks}.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported,
   * or a non-zero `advancedPoolHooks` is not an `AdvancedPoolHooks` contract
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is zero/invalid, `advancedPoolHooks`
   * is invalid, the pool is already bound to it, or `sender` differs from the wallet
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.updateAdvancedPoolHooks({
   *   poolAddress: '0xPool...',
   *   advancedPoolHooks: '0xHooks...',
   *   wallet,
   * })
   * ```
   */
  updateAdvancedPoolHooks(
    opts: EVMExecuteParams<UpdateAdvancedPoolHooksParams>,
  ): Promise<TransactionResult> {
    return this.#updateAdvancedPoolHooks.execute(this.chain, opts)
  }

  /**
   * Reads the `AdvancedPoolHooks` contract a **v2.0.0+** pool is bound to.
   *
   * @remarks The zero address is a normal result: no hooks are bound, so the pool enforces no
   * sender allowlist and no CCV requirements.
   *
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const hooks = await cct.getAdvancedPoolHooks({ poolAddress: '0xPool...' })
   * if (hooks === ZeroAddress) console.log('pool enforces no allowlist or CCV requirements')
   * ```
   */
  getAdvancedPoolHooks(opts: GetAdvancedPoolHooksParams): Promise<GetAdvancedPoolHooksResult> {
    return this.#getAdvancedPoolHooks.query(this.chain, opts)
  }

  /**
   * Reads a **v2.0.0+** pool's router and delegated admin roles.
   *
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const config = await cct.getDynamicConfig({ poolAddress: '0xPool...' })
   * ```
   */
  getDynamicConfig(opts: GetDynamicConfigParams): Promise<GetDynamicConfigResult> {
    return this.#getDynamicConfig.query(this.chain, opts)
  }

  /**
   * Reads the fee parameters a **v2.0.0+** pool applies to a destination chain and finality.
   *
   * @remarks `getFee` reports the configured USD-cent and basis-point values, not a fee amount.
   * `finality` defaults to `'finalized'`.
   *
   * @throws {@link CCTParamsInvalidError} if a parameter is invalid
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const fee = await cct.getFee({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 16015286601757825753n,
   * })
   * ```
   */
  getFee(opts: GetFeeParams): Promise<GetFeeResult> {
    return this.#getFee.query(this.chain, opts)
  }

  /**
   * Reads token-transfer fee configuration for a destination chain from a **v2.0.0+** pool.
   *
   * @remarks The pool token is read automatically. `finality` and `tokenArgs` default to
   * `'finalized'` and `'0x'`, respectively, which are correct for standard pools.
   *
   * @throws {@link CCTParamsInvalidError} if a parameter is invalid
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const config = await cct.getTokenTransferFeeConfig({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 16015286601757825753n,
   * })
   * ```
   */
  getTokenTransferFeeConfig(
    opts: GetTokenTransferFeeConfigParams,
  ): Promise<GetTokenTransferFeeConfigResult> {
    return this.#getTokenTransferFeeConfig.query(this.chain, opts)
  }

  /**
   * Builds an unsigned ERC-20 `approve` tx (for multisig / offline signing): grants `spender` an
   * allowance over `sender`'s tokens.
   * @remarks The prerequisite for {@link generateUnsignedProvideLiquidity} — a pool deposits with
   * `safeTransferFrom`, so a rebalancer must approve the **pool** for at least the deposit first,
   * or the deposit reverts `ERC20InsufficientAllowance`. The cross-family counterpart of Solana's
   * `approveToken`, which delegates SPL spend authority for the same reason.
   * @remarks Works on **any** ERC-20, not only CCT-deployed tokens: `approve(address,uint256)` is
   * identical across `FactoryBurnMintERC20` v1.5.1 / v1.6.2 and v2.0.0's `CrossChainToken`, and a
   * LockRelease pool may escrow a third-party token. No `typeAndVersion` probe and no chain read.
   * @remarks `amount` **replaces** the current allowance (it does not add to it) and is consumed
   * as it is spent; `0n` revokes.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` or `spender` is invalid or zero, or
   * `amount` is not a `uint256`
   * @example
   * ```typescript
   * // approve a LockRelease pool for a deposit, then deposit
   * await cct.approveToken({ tokenAddress: token, spender: pool, amount, wallet })
   * await cct.provideLiquidity({ poolAddress: pool, amount, wallet })
   * ```
   */
  generateUnsignedApproveToken(opts: ApproveTokenParams): Promise<UnsignedEVMTx> {
    return this.#approveToken.generate(this.chain, opts)
  }

  /**
   * Grants an ERC-20 allowance, signing + submitting with `opts.wallet`. `sender` defaults to the
   * wallet's address and must equal it — the allowance comes out of the signing account's balance,
   * so approving on behalf of another address is rejected rather than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is given and is not
   * the wallet's address
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.approveToken({
   *   tokenAddress: '0xToken...',
   *   spender: '0xPool...',
   *   amount: 1_000000000000000000n,
   *   wallet, // the rebalancer
   * })
   * ```
   */
  approveToken(opts: EVMExecuteParams<ApproveTokenParams>): Promise<TransactionResult> {
    return this.#approveToken.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `provideLiquidity` tx (for multisig / offline signing): deposits
   * `amount` of the pool's token into a **LockRelease** pool (v1.5.0–v1.6.1).
   * @remarks Gated on the pool's `rebalancer`, **not** its owner: the pool accepts liquidity
   * calls only from the account appointed with {@link generateUnsignedSetRebalancer}, and reverts
   * `Unauthorized` for everyone else, the owner included. A given `sender` is checked against
   * `getRebalancer()` before any calldata is built.
   * @remarks The rebalancer must hold `amount` of the pool's token **and** have approved the pool
   * for it — the deposit is a `transferFrom`. Set that allowance with
   * {@link generateUnsignedApproveToken} / {@link approveToken}, `spender` being the pool. Both
   * are read before the calldata is returned, so a missing approval is reported here instead of
   * reverting `ERC20InsufficientAllowance` in the wallet. Matches Solana's `provideLiquidity`,
   * which likewise refuses to build without the delegation behind it.
   * @remarks On a v1.5.0 / v1.5.1 pool the immutable `acceptLiquidity` flag is read too: a pool
   * deployed with it `false` can never take deposits, so that is reported before signing rather
   * than as a `LiquidityNotAccepted` revert. v1.6.x pools have no flag.
   * @remarks On a `SiloedLockReleaseTokenPool` this funds the *unsiloed* bucket, gated on the
   * unsiloed rebalancer; the per-lane `provideSiloedLiquidity` is not exposed.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is a BurnMint pool, which has no
   * liquidity to manage
   * @throws {@link CCTOperationUnsupportedError} on a **v2.0.0** pool, which escrows through an
   * external `ERC20LockBox` instead — see {@link deployLockbox} / {@link updateLockboxAuthorizedCallers}
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `amount` is zero, the pool
   * cannot accept liquidity, or `sender` is given and is not the pool's rebalancer
   * @throws {@link CCTTxFailedError} if `sender` holds less than `amount` of the pool's token, or
   * has approved the pool for less than `amount`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the pool rebalancer.
   * const unsigned = await cct.generateUnsignedProvideLiquidity({
   *   poolAddress: '0xPool...',
   *   amount: 1_000000000000000000n,
   *   sender: '0xRebalancer...',
   * })
   * ```
   */
  generateUnsignedProvideLiquidity(opts: ProvideLiquidityParams): Promise<UnsignedEVMTx> {
    return this.#provideLiquidity.generate(this.chain, opts)
  }

  /**
   * Deposits liquidity into a LockRelease pool, signing + submitting with `opts.wallet`. `sender`
   * defaults to the wallet's address and must equal it — the wallet must be the pool's
   * rebalancer, and must have approved `amount` to the pool with {@link approveToken}.
   * @remarks On a `SiloedLockReleaseTokenPool` this funds the *unsiloed* bucket only.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, or the wallet is not the pool's rebalancer
   * @throws {@link CCTTxFailedError} if the wallet's token balance or its approval to the pool is
   * below `amount`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.provideLiquidity({
   *   poolAddress: '0xPool...',
   *   amount: 1_000000000000000000n,
   *   wallet, // the pool rebalancer
   * })
   * ```
   */
  provideLiquidity(opts: EVMExecuteParams<ProvideLiquidityParams>): Promise<TransactionResult> {
    return this.#provideLiquidity.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `withdrawLiquidity` tx (for multisig / offline signing): pulls
   * `amount` of the pool's token back out of a **LockRelease** pool (v1.5.0–v1.6.1).
   * @remarks Gated on the pool's `rebalancer`, **not** its owner, and the tokens are sent to
   * `msg.sender` — so they land with the rebalancer, whoever signs. A given `sender` is checked
   * against `getRebalancer()` before any calldata is built.
   * @remarks The pool's withdrawable liquidity is read first (its balance, or
   * `getUnsiloedLiquidity()` on a siloed pool), so withdrawing more than it can pay is reported
   * before signing. Advisory only: every CCIP transfer moves it, so a later shortfall still
   * reverts `InsufficientLiquidity`.
   * @remarks On a `SiloedLockReleaseTokenPool` this draws on the *unsiloed* bucket only, gated on
   * the unsiloed rebalancer; the per-lane `withdrawSiloedLiquidity` is not exposed.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a **v2.0.0** pool, which escrows through an
   * external `ERC20LockBox` instead
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `amount` is zero, or `sender`
   * is given and is not the pool's rebalancer
   * @throws {@link CCTTxFailedError} if the pool's withdrawable liquidity is below `amount`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the pool rebalancer.
   * const unsigned = await cct.generateUnsignedWithdrawLiquidity({
   *   poolAddress: '0xPool...',
   *   amount: 1_000000000000000000n,
   *   sender: '0xRebalancer...',
   * })
   * ```
   */
  generateUnsignedWithdrawLiquidity(opts: WithdrawLiquidityParams): Promise<UnsignedEVMTx> {
    return this.#withdrawLiquidity.generate(this.chain, opts)
  }

  /**
   * Withdraws liquidity from a LockRelease pool to the signing wallet, which must be the pool's
   * rebalancer. `sender` defaults to the wallet's address and must equal it.
   * @remarks On a `SiloedLockReleaseTokenPool` this draws on the *unsiloed* bucket only.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, or the wallet is not the pool's rebalancer
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain, e.g.
   * `InsufficientLiquidity`
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.withdrawLiquidity({
   *   poolAddress: '0xPool...',
   *   amount: 1_000000000000000000n,
   *   wallet, // the pool rebalancer, which also receives the tokens
   * })
   * ```
   */
  withdrawLiquidity(opts: EVMExecuteParams<WithdrawLiquidityParams>): Promise<TransactionResult> {
    return this.#withdrawLiquidity.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `transferLiquidity` tx (for multisig / offline signing): moves
   * liquidity out of an older LockRelease pool (`from`) into this one (v1.5.0–v1.6.1). The
   * pool-upgrade primitive.
   * @remarks Two-step, because the new pool withdraws from the old one as its rebalancer: first
   * point the **old** pool's rebalancer at the new pool with
   * {@link generateUnsignedSetRebalancer}, then call this on the **new** pool.
   * @remarks The source pool is read before any calldata is built: it must be a LockRelease pool
   * escrowing the **same token**, hold the amount, and have `poolAddress` as its rebalancer. The
   * token check has no on-chain counterpart, and a mismatch does not revert: the destination would
   * silently receive an asset it does not manage.
   * @remarks From v1.6.1, `amount: MaxUint256` means "the source pool's whole balance"; on a
   * v1.5.x pool that sentinel does not exist and is rejected rather than left to revert.
   * @remarks A `SiloedLockReleaseTokenPool` source gives up only its *unsiloed* bucket, so "hold the
   * amount" means `getUnsiloedLiquidity()`, and `MaxUint256` is rejected: its whole balance
   * includes the per-lane silos, which its `withdrawLiquidity` cannot pay out.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is a BurnMint pool, or a
   * `SiloedLockReleaseTokenPool` — siloed liquidity is per-lane and has no `transferLiquidity`
   * @throws {@link CCTOperationUnsupportedError} on a **v2.0.0** pool, which escrows through an
   * external `ERC20LockBox` instead
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `from` equals `poolAddress`,
   * `amount` is zero or is `MaxUint256` from a siloed `from`, `from` is a v2.0.0 pool, `from`
   * escrows a different token or does not have `poolAddress` as its rebalancer, or `sender` is
   * given and does not own `poolAddress`
   * @throws {@link CCTTxFailedError} if `from`'s withdrawable liquidity is below `amount`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * import { MaxUint256 } from 'ethers'
   *
   * // step 1, on the old pool: let the new pool withdraw from it
   * await cct.setRebalancer({ poolAddress: oldPool, rebalancer: newPool, wallet })
   * // step 2, on the new pool: pull everything across (v1.6.1+)
   * const unsigned = await cct.generateUnsignedTransferLiquidity({
   *   poolAddress: newPool,
   *   from: oldPool, // the source pool, not the signer — see `sender`
   *   amount: MaxUint256, // the source pool's whole balance
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedTransferLiquidity(opts: TransferLiquidityParams): Promise<UnsignedEVMTx> {
    return this.#transferLiquidity.generate(this.chain, opts)
  }

  /**
   * Migrates liquidity from an older LockRelease pool into this one, signing + submitting with
   * `opts.wallet`. `sender` defaults to the wallet's address and must equal it — the wallet must
   * own the destination pool. See {@link generateUnsignedTransferLiquidity} for the two-step
   * rebalancer wiring this depends on.
   * @remarks A `SiloedLockReleaseTokenPool` source gives up only its *unsiloed* bucket, and
   * `MaxUint256` from one is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the source pool is not wired to `poolAddress`, `amount` is `MaxUint256`
   * from a siloed `from`, or the wallet does not own `poolAddress`
   * @throws {@link CCTTxFailedError} if `from`'s withdrawable liquidity is below `amount`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain, e.g.
   * `InsufficientLiquidity` when the source pool holds less than `amount`
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.transferLiquidity({
   *   poolAddress: newPool,
   *   from: oldPool,
   *   amount: 1_000000000000000000n,
   *   wallet, // owner of the new pool
   * })
   * ```
   */
  transferLiquidity(opts: EVMExecuteParams<TransferLiquidityParams>): Promise<TransactionResult> {
    return this.#transferLiquidity.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `setRebalancer` tx (for multisig / offline signing): appoints the
   * **LockRelease** pool role allowed to move liquidity (v1.5.0–v1.6.1).
   * @remarks Owner-only, and the appointee — not the owner — is who
   * {@link generateUnsignedProvideLiquidity} and {@link generateUnsignedWithdrawLiquidity} then
   * accept. When `sender` is supplied it is checked against the pool's `owner()` before any
   * calldata is built; omit it and no owner read is made (nothing to compare against).
   *
   * A zero `rebalancer` is accepted and revokes the role, which stops liquidity movement
   * entirely: the pool then accepts those calls from nobody.
   * @remarks On a `SiloedLockReleaseTokenPool` this sets the *unsiloed* rebalancer, which is what
   * its plain `provideLiquidity` / `withdrawLiquidity` gate on; the per-lane
   * `setSiloRebalancer` is not exposed.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a **v2.0.0** pool, which authorizes liquidity
   * on its `ERC20LockBox` instead — see {@link updateLockboxAuthorizedCallers}
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `poolAddress` is the zero
   * address, or `sender` is given and is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the pool owner.
   * const unsigned = await cct.generateUnsignedSetRebalancer({
   *   poolAddress: '0xPool...',
   *   rebalancer: '0xLiquidityOps...',
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedSetRebalancer(opts: SetRebalancerParams): Promise<UnsignedEVMTx> {
    return this.#setRebalancer.generate(this.chain, opts)
  }

  /**
   * Appoints the pool's rebalancer, signing + submitting with `opts.wallet`. `sender` defaults to
   * the wallet's address and must equal it — the wallet must be the pool owner.
   * @remarks On a `SiloedLockReleaseTokenPool` this sets the *unsiloed* rebalancer only.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, or the wallet is not the pool owner
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.setRebalancer({
   *   poolAddress: '0xPool...',
   *   rebalancer: '0xLiquidityOps...',
   *   wallet, // the pool owner
   * })
   * ```
   */
  setRebalancer(opts: EVMExecuteParams<SetRebalancerParams>): Promise<TransactionResult> {
    return this.#setRebalancer.execute(this.chain, opts)
  }

  /**
   * Reads a LockRelease pool's rebalancer — the account allowed to move its liquidity
   * (v1.5.0–v1.6.1).
   * @remarks Informational, for audit and UX: the liquidity write ops make this same check
   * themselves, so there is no need to call this first.
   * @remarks On a `SiloedLockReleaseTokenPool` this is the *unsiloed* rebalancer, which is what
   * its plain `provideLiquidity` / `withdrawLiquidity` gate on.
   * @returns The rebalancer, checksummed. The zero address when none is configured, meaning the
   * pool accepts liquidity calls from nobody.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a **v2.0.0** pool, which has no rebalancer —
   * its `ERC20LockBox` authorizes its own callers
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * const rebalancer = await cct.getRebalancer({ poolAddress: '0xPool...' })
   * ```
   */
  getRebalancer(opts: GetRebalancerParams): Promise<GetRebalancerResult> {
    return this.#getRebalancer.query(this.chain, opts)
  }

  /**
   * Reads the `ERC20LockBox` a v2.0.0 LockRelease pool escrows through — fixed in its constructor
   * and immutable thereafter.
   * @remarks The address {@link depositToLockbox} / {@link withdrawFromLockbox} need: those ops
   * target the lockbox, not the pool. Also the way to confirm a pool is wired to the lockbox you
   * authorized, which is where a `deployLockbox` → `deployTokenPool` sequence goes wrong quietly.
   * @returns The lockbox, checksummed.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is a BurnMint pool, or a
   * `SiloedLockReleaseTokenPool` — a siloed pool escrows per remote chain and declares
   * `getLockBox(uint64)` instead, so it has no single lockbox
   * @throws {@link CCTOperationUnsupportedError} below **v2.0.0**, where a LockRelease pool holds
   * its liquidity itself — see {@link getRebalancer} and {@link provideLiquidity}
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * const lockbox = await cct.getLockbox({ poolAddress: '0xPool...' })
   * ```
   */
  getLockbox(opts: GetLockboxParams): Promise<GetLockboxResult> {
    return this.#getLockbox.query(this.chain, opts)
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
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines with no, invalid, or unexpected contract address
   *
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
   * Builds an unsigned `grantMintAndBurnRoles` tx (for multisig / offline signing): grants a
   * supported CCT token's mint **and** burn roles to one account, in a single transaction. This
   * is the call that lets a freshly deployed burn/mint pool bridge the token.
   *
   * @remarks Supported by v1.5.1 / v1.6.2 and v2.0.0 `CrossChainToken`; v2 enforces the
   * mint/burn role admin through AccessControl. Rejected only when `burnAndMinter` already holds
   * *both* roles; holding just one still builds, since this call is what completes the pair.
   *
   * @see {@link deployTokenPool} — the primary use case is granting these roles to a freshly
   * deployed pool
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` lacks the version's
   * role-admin permission, or `burnAndMinter` already holds both roles
   *
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the v1 owner or v2 role admin.
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedGrantMintAndBurnRoles({
   *   tokenAddress: '0xToken...',
   *   burnAndMinter: '0xPool...', // the token's burn/mint pool
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedGrantMintAndBurnRoles(opts: GrantMintAndBurnRolesParams): Promise<UnsignedEVMTx> {
    return this.#grantMintAndBurnRoles.generate(this.chain, opts)
  }

  /**
   * Grants a supported CCT token's mint and burn roles to one account, signing + submitting with
   * `opts.wallet` (the v1 token owner or v2 mint/burn role admin).
   *
   * @remarks See {@link generateUnsignedGrantMintAndBurnRoles} for the version and redundancy
   * rules. `sender` defaults to the wallet's address, so the role-admin gate always runs before
   * this submits.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the wallet lacks the version's role-admin permission, or
   * `burnAndMinter` already holds both roles
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.grantMintAndBurnRoles({
   *   tokenAddress: '0xToken...',
   *   burnAndMinter: '0xPool...',
   *   wallet, // v1 token owner or v2 mint/burn role admin
   * })
   * ```
   */
  grantMintAndBurnRoles(
    opts: EVMExecuteParams<GrantMintAndBurnRolesParams>,
  ): Promise<TransactionResult> {
    return this.#grantMintAndBurnRoles.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `grantMintRole` tx (for multisig / offline signing): grants a
   * supported CCT token's mint role to one account. Pair it with
   * {@link generateUnsignedGrantBurnRole}, or use
   * {@link generateUnsignedGrantMintAndBurnRoles} to grant both in one transaction.
   *
   * @remarks v1.5.1 / v1.6.2 tokens encode `grantMintRole` and require the token owner; a v2.0.0
   * `CrossChainToken` encodes `grantRole(MINTER_ROLE, minter)` and requires its mint-role admin.
   * A redundant grant is rejected, since the chain would mine it as a silent no-op rather than
   * revert.
   *
   * @see {@link deployTokenPool} — the primary use case is granting this role to a freshly
   * deployed pool
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` lacks the version's
   * role-admin permission, or `minter` already holds the mint role
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedGrantMintRole({
   *   tokenAddress: '0xToken...',
   *   minter: '0xMinter...',
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedGrantMintRole(opts: GrantMintRoleParams): Promise<UnsignedEVMTx> {
    return this.#grantMintRole.generate(this.chain, opts)
  }

  /**
   * Grants a supported CCT token's mint role to one account, signing + submitting with
   * `opts.wallet` (the v1 token owner or v2 mint-role admin).
   *
   * @see {@link generateUnsignedGrantMintRole} for the version and redundancy rules.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the wallet lacks the version's role-admin permission, or `minter`
   * already holds the role
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.grantMintRole({
   *   tokenAddress: '0xToken...',
   *   minter: '0xMinter...',
   *   wallet, // v1 token owner or v2 mint-role admin
   * })
   * ```
   */
  grantMintRole(opts: EVMExecuteParams<GrantMintRoleParams>): Promise<TransactionResult> {
    return this.#grantMintRole.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `grantBurnRole` tx (for multisig / offline signing): grants a
   * supported CCT token's burn role to one account. Pair it with
   * {@link generateUnsignedGrantMintRole}, or use
   * {@link generateUnsignedGrantMintAndBurnRoles} to grant both in one transaction.
   *
   * @remarks v1.5.1 / v1.6.2 tokens encode `grantBurnRole` and require the token owner; a v2.0.0
   * `CrossChainToken` encodes `grantRole(BURNER_ROLE, burner)` and requires its burn-role admin.
   * A redundant grant is rejected — see {@link generateUnsignedGrantMintRole}.
   *
   * @see {@link deployTokenPool} — the primary use case is granting this role to a freshly
   * deployed pool
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` lacks the version's
   * role-admin permission, or `burner` already holds the burn role
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedGrantBurnRole({
   *   tokenAddress: '0xToken...',
   *   burner: '0xBurner...',
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedGrantBurnRole(opts: GrantBurnRoleParams): Promise<UnsignedEVMTx> {
    return this.#grantBurnRole.generate(this.chain, opts)
  }

  /**
   * Grants a supported CCT token's burn role to one account, signing + submitting with
   * `opts.wallet` (the v1 token owner or v2 burn-role admin).
   *
   * @remarks See {@link generateUnsignedGrantBurnRole} for the version and redundancy rules.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the wallet lacks the version's role-admin permission, or `burner`
   * already holds the role
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.grantBurnRole({
   *   tokenAddress: '0xToken...',
   *   burner: '0xBurner...',
   *   wallet, // v1 token owner or v2 burn-role admin
   * })
   * ```
   */
  grantBurnRole(opts: EVMExecuteParams<GrantBurnRoleParams>): Promise<TransactionResult> {
    return this.#grantBurnRole.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `revokeMintRole` tx (for multisig / offline signing): removes a
   * supported CCT token's mint role from one account.
   *
   * @remarks v1.5.1 / v1.6.2 tokens encode `revokeMintRole`; a v2.0.0 `CrossChainToken` encodes
   * `revokeRole(MINTER_ROLE, minter)`. A missing role is rejected, since the chain would mine a
   * silent no-op.
   *
   * @see {@link deployTokenPool} — the mirror of the grant made to a freshly deployed pool
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` lacks the version's
   * role-admin permission, or `minter` does not currently hold the mint role
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedRevokeMintRole({
   *   tokenAddress: '0xToken...',
   *   minter: '0xOldPool...', // must currently hold the role
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedRevokeMintRole(opts: RevokeMintRoleParams): Promise<UnsignedEVMTx> {
    return this.#revokeMintRole.generate(this.chain, opts)
  }

  /**
   * Removes a supported CCT token's mint role from one account, signing + submitting with
   * `opts.wallet` (the v1 token owner or v2 mint-role admin).
   *
   * @remarks See {@link generateUnsignedRevokeMintRole} for the version and role-state rules.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the wallet lacks the version's role-admin permission, or `minter` does
   * not hold the role
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.revokeMintRole({
   *   tokenAddress: '0xToken...',
   *   minter: '0xOldPool...',
   *   wallet, // v1 token owner or v2 mint-role admin
   * })
   * ```
   */
  revokeMintRole(opts: EVMExecuteParams<RevokeMintRoleParams>): Promise<TransactionResult> {
    return this.#revokeMintRole.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `revokeBurnRole` tx (for multisig / offline signing): removes a
   * supported CCT token's burn role from one account.
   *
   * @remarks v1.5.1 / v1.6.2 tokens encode `revokeBurnRole`; a v2.0.0 `CrossChainToken` encodes
   * `revokeRole(BURNER_ROLE, burner)`. A missing role is rejected — see
   * {@link generateUnsignedRevokeMintRole}.
   *
   * @see {@link deployTokenPool} — the mirror of the grant made to a freshly deployed pool
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` lacks the version's
   * role-admin permission, or `burner` does not currently hold the burn role
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedRevokeBurnRole({
   *   tokenAddress: '0xToken...',
   *   burner: '0xOldPool...', // must currently hold the role
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedRevokeBurnRole(opts: RevokeBurnRoleParams): Promise<UnsignedEVMTx> {
    return this.#revokeBurnRole.generate(this.chain, opts)
  }

  /**
   * Removes a supported CCT token's burn role from one account, signing + submitting with
   * `opts.wallet` (the v1 token owner or v2 burn-role admin).
   *
   * @remarks See {@link generateUnsignedRevokeBurnRole} for the version and role-state rules.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported version
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the wallet lacks the version's role-admin permission, or `burner` does
   * not hold the role
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   *
   * @example
   * ```typescript
   * const cct = EVMTokenManager.fromChain(chain)
   * const { hash } = await cct.revokeBurnRole({
   *   tokenAddress: '0xToken...',
   *   burner: '0xOldPool...',
   *   wallet, // v1 token owner or v2 burn-role admin
   * })
   * ```
   */
  revokeBurnRole(opts: EVMExecuteParams<RevokeBurnRoleParams>): Promise<TransactionResult> {
    return this.#revokeBurnRole.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `mint` tx (for multisig / offline signing): mints new supply of a
   * BurnMintERC677 token to `account`. The manual mint — seeding liquidity, topping up test
   * supply — not the bridge path, which mints through the pool.
   * @remarks v1.5.1 / v1.6.2 tokens only; v2.0.0's `CrossChainToken` gates minting through
   * AccessControl, which ships separately. `sender` is checked against the token's
   * `isMinter(address)`, **not** its owner: `mint` is `onlyMinter`, and the owner is the role
   * admin, who need not hold the role. Grant it first with `grantMintRole`. The full sequence:
   * {@link deployToken} → `grantMintRole` → {@link generateUnsignedMint}, checking the grant
   * landed with {@link isMinter} (or {@link getMinters} for the whole set).
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * (a v2.0.0 `CrossChainToken` included, since it gates mint/burn through AccessControl)
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is given and does
   * not hold the token's mint role
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must hold the mint role.
   * const unsigned = await cct.generateUnsignedMint({
   *   tokenAddress: '0xToken...',
   *   account: '0xRecipient...',
   *   amount: 1_000_000000000000000000n, // 1000 tokens at 18 decimals
   *   sender: '0xMinter...',
   * })
   * ```
   */
  generateUnsignedMint(opts: MintParams): Promise<UnsignedEVMTx> {
    return this.#mint.generate(this.chain, opts)
  }

  /**
   * Mints new supply of a BurnMintERC677 token to `account`, signing + submitting with
   * `opts.wallet` (an address holding the token's mint role).
   * @remarks See {@link generateUnsignedMint} for the version and role rules. `sender` defaults
   * to the wallet's address, so the mint-role check always runs before this submits.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * (a v2.0.0 `CrossChainToken` included, since it gates mint/burn through AccessControl)
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, or the wallet does not hold the token's mint role
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain — e.g. the mint would
   * exceed the token's `maxSupply`, which is not pre-flighted
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.mint({
   *   tokenAddress: '0xToken...',
   *   account: '0xRecipient...',
   *   amount: 1_000_000000000000000000n,
   *   wallet, // must hold the mint role
   * })
   * ```
   */
  mint(opts: EVMExecuteParams<MintParams>): Promise<TransactionResult> {
    return this.#mint.execute(this.chain, opts)
  }

  /**
   * Lists every account holding a BurnMintERC677 token's mint role, via `getMinters()`.
   * @remarks Informational, for audit and UX. To check *one* address, use {@link isMinter} — one
   * call instead of an unbounded set plus a client-side scan.
   * @remarks v1.5.1 / v1.6.2 tokens only: v2.0.0's `CrossChainToken` uses AccessControl, which
   * does not enumerate role members, so there is no equivalent read.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * (a v2.0.0 `CrossChainToken` included, since it gates mint/burn through AccessControl)
   * @example
   * ```typescript
   * const minters = await cct.getMinters({ tokenAddress: '0xToken...' })
   * console.log(minters) // ['0xPool...', '0xOpsKey...']
   * ```
   */
  getMinters(opts: GetMintersParams): Promise<GetMintersResult> {
    return this.#getMinters.query(this.chain, opts)
  }

  /**
   * Lists every account holding a BurnMintERC677 token's burn role, via `getBurners()`.
   * @remarks Same shape and caveats as {@link getMinters}; to check one address, use
   * {@link isBurner}.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * (a v2.0.0 `CrossChainToken` included, since it gates mint/burn through AccessControl)
   * @example
   * ```typescript
   * const burners = await cct.getBurners({ tokenAddress: '0xToken...' })
   * ```
   */
  getBurners(opts: GetBurnersParams): Promise<GetBurnersResult> {
    return this.#getBurners.query(this.chain, opts)
  }

  /**
   * Reads whether `account` holds a supported CCT token's mint role.
   * @remarks v1 uses `isMinter(address)`; v2 uses AccessControl `hasRole`. Use this individual
   * membership check rather than {@link getMinters}, which is v1-only.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` or `account` is not a valid, non-zero
   * address
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   * @example
   * ```typescript
   * if (await cct.isMinter({ tokenAddress: '0xToken...', account: '0xOpsKey...' })) {
   *   await cct.mint({ tokenAddress: '0xToken...', account: '0xRecipient...', amount, wallet })
   * }
   * ```
   */
  isMinter(opts: IsMinterParams): Promise<IsMinterResult> {
    return this.#isMinter.query(this.chain, opts)
  }

  /**
   * Reads whether `account` holds a supported CCT token's burn role.
   * @remarks v1 uses `isBurner(address)`; v2 uses AccessControl `hasRole`. Use this individual
   * membership check rather than {@link getBurners}, which is v1-only.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` or `account` is not a valid, non-zero
   * address
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677
   * token nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   * @example
   * ```typescript
   * const poolCanBurn = await cct.isBurner({ tokenAddress: '0xToken...', account: '0xPool...' })
   * ```
   */
  isBurner(opts: IsBurnerParams): Promise<IsBurnerResult> {
    return this.#isBurner.query(this.chain, opts)
  }

  /**
   * Reads a token's current `owner()` (Ownable2Step), checksummed — the authority that grants and
   * revokes mint/burn roles on a BurnMintERC677 token.
   * @remarks Current owner only. A token's *proposed* owner is a `private` slot with no getter, so
   * a pending transfer cannot be read on EVM (same limitation as a v1 `acceptDefaultAdminTransfer`
   * / `acceptPoolOwnership`). On a v2.0.0 `CrossChainToken`, `owner()` aliases the
   * `DEFAULT_ADMIN_ROLE` holder — use {@link getTokenDefaultAdmin} for its pending transfer.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   * @example
   * ```typescript
   * const owner = await cct.getTokenOwner({ tokenAddress: '0xToken...' })
   * ```
   */
  getTokenOwner(opts: GetTokenOwnerParams): Promise<GetTokenOwnerResult> {
    return this.#getTokenOwner.query(this.chain, opts)
  }

  /**
   * Reads a token's current `getCCIPAdmin()`, checksummed — the single-step CCIP admin the
   * `ccip-admin` registration method authorizes against.
   * @remarks Single-step: there is no pending CCIP admin slot, so this current value is complete
   * (contrast {@link getTokenDefaultAdmin}, which is two-step). `getCCIPAdmin()` is declared
   * identically across every supported token version.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   * @example
   * ```typescript
   * const ccipAdmin = await cct.getCCIPAdmin({ tokenAddress: '0xToken...' })
   * ```
   */
  getCCIPAdmin(opts: GetCCIPAdminParams): Promise<GetCCIPAdminResult> {
    return this.#getCCIPAdmin.query(this.chain, opts)
  }

  /**
   * Reads a v2.0.0 `CrossChainToken`'s AccessControl default admin: its current `defaultAdmin` and
   * any scheduled `pendingDefaultAdmin` (`{ newAdmin, schedule }`), together.
   * @remarks `pendingDefaultAdmin` is omitted when no transfer is scheduled — test with
   * `'pendingDefaultAdmin' in result`, not a zero-address compare, mirroring
   * {@link getTokenAdminRegistry}'s `pendingAdministrator`. v2.0.0 CrossChainToken only; a v1.x
   * `FactoryBurnMintERC20` has no default admin — read its {@link getTokenOwner} instead.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   * @example
   * ```typescript
   * const { defaultAdmin, pendingDefaultAdmin } = await cct.getTokenDefaultAdmin({
   *   tokenAddress: '0xToken...',
   * })
   * if (pendingDefaultAdmin) {
   *   console.log('pending', pendingDefaultAdmin.newAdmin, 'at', pendingDefaultAdmin.schedule)
   * }
   * ```
   */
  getTokenDefaultAdmin(opts: GetTokenDefaultAdminParams): Promise<GetTokenDefaultAdminResult> {
    return this.#getTokenDefaultAdmin.query(this.chain, opts)
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
   * → {@link deployTokenPool} (passing the lockbox) → {@link updateLockboxAuthorizedCallers}
   * (`addedCallers: [pool]`, plus whoever funds it) → {@link setPool} → configure lanes →
   * {@link depositToLockbox}. The deposit is not optional: a v2.0.0 pool cannot release until
   * its lockbox holds liquidity.
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
   * lockbox) → {@link updateLockboxAuthorizedCallers} (`addedCallers: [pool]`, plus whoever funds it) →
   * {@link setPool} → configure lanes → {@link depositToLockbox}. The deposit is not optional: a
   * v2.0.0 pool cannot release until its lockbox holds liquidity.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines with no, invalid, or unexpected contract address
   *
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
   * {@link updateLockboxAuthorizedCallers} before the pool can lock/release.
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
   * {@link deployTokenPool} (passing this lockbox) → {@link updateLockboxAuthorizedCallers}
   * (`addedCallers: [pool]`, plus whoever funds it) → {@link setPool} → configure lanes →
   * {@link depositToLockbox}. The deposit is not optional: a v2.0.0 pool cannot release until
   * its lockbox holds liquidity.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines with no, invalid, or unexpected contract address
   *
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
   * Builds an unsigned `TokenPoolFactory` (v2.0.0) `deployTokenAndTokenPool` call — deploying a
   * CrossChainToken and its pool (and, for LockRelease, a lockbox) and configuring the given remote
   * lanes, all in one transaction — and returns it with the locally-predicted token, pool, and
   * (auto-deployed) lockbox addresses, known before signing.
   *
   * @remarks **Unsigned-only.** The factory salt is `keccak256(abi.encodePacked(salt, msg.sender))`,
   * so `sender` (whoever sends this) is baked into the addresses; sign with a wallet whose address
   * equals `sender`. The predicted pool address depends on the factory's `getStaticConfig()`
   * (`rmnProxy`/`ccipRouter`), read over RPC — pass `expectedStaticConfig` to pin it to trusted
   * values. Ownership is *proposed* (Ownable2Step) to `futureOwner`; batch the accepts separately.
   * @throws {@link CCTParamsInvalidError} on invalid params, empty init code, salt, static-config
   * mismatch, or an already-occupied predicted address
   * @throws {@link CCTContractTypeInvalidError} if `factory` is not a `TokenPoolFactory`
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @example
   * ```typescript
   * const { token, pool, transaction } = await cct.generateUnsignedDeployTokenAndTokenPoolViaFactory({
   *   factory: '0xFactory...',
   *   sender: '0xSafe...', // baked into the salt/addresses; must sign the tx
   *   salt: 'my-token-v1',
   *   type: 'BurnMintTokenPool',
   *   token: { name: 'My Token', symbol: 'MTK', decimals: 18, maxSupply: 0n },
   * })
   * ```
   */
  generateUnsignedDeployTokenAndTokenPoolViaFactory(
    opts: DeployTokenAndTokenPoolViaFactoryParams,
  ): Promise<FactoryDeploy> {
    return deployTokenAndTokenPoolViaFactory(this.chain, opts)
  }

  /**
   * Builds an unsigned `TokenPoolFactory` (v2.0.0) `deployTokenPoolWithExistingToken` call for an
   * already-deployed token (any ERC20 — the factory does not require a CrossChainToken), configuring
   * the given remote lanes, and returns it with the locally-predicted pool and (auto-deployed)
   * lockbox addresses, known before signing.
   *
   * @remarks Same unsigned-only, sender-bound-salt, and RPC-trust caveats as
   * {@link generateUnsignedDeployTokenAndTokenPoolViaFactory}.
   * @throws {@link CCTParamsInvalidError} on invalid params, empty init code, salt, static-config
   * mismatch, or an already-occupied predicted address
   * @throws {@link CCTContractTypeInvalidError} if `factory` is not a `TokenPoolFactory`
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @example
   * ```typescript
   * const { pool, transaction } = await cct.generateUnsignedDeployTokenPoolWithExistingTokenViaFactory({
   *   factory: '0xFactory...',
   *   sender: '0xSafe...', // baked into the salt/addresses; must sign the tx
   *   salt: 'my-pool-v1',
   *   type: 'BurnMintTokenPool',
   *   token: '0xExistingToken...',
   *   localTokenDecimals: 18,
   * })
   * ```
   */
  generateUnsignedDeployTokenPoolWithExistingTokenViaFactory(
    opts: DeployTokenPoolWithExistingTokenViaFactoryParams,
  ): Promise<FactoryDeploy> {
    return deployTokenPoolWithExistingTokenViaFactory(this.chain, opts)
  }

  /**
   * Builds an unsigned `ERC20LockBox` `applyAuthorizedCallerUpdates` tx (for multisig / offline
   * signing) that adds/removes authorized callers. Authorize a `LockReleaseTokenPool` here so it
   * can lock/release against the lockbox.
   * @remarks `lockbox` is checked on-chain before any calldata is built: a call to an EOA or an
   * undeployed address executes nothing yet mines successfully, so an address that is not a
   * deployed `ERC20LockBox` is rejected here rather than returning an unsigned tx that silently
   * authorizes nobody. When `sender` is given it is checked against the lockbox's `owner()`, since
   * `applyAuthorizedCallerUpdates` is owner-only.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if no caller is supplied, if
   * nothing at `lockbox` answers `typeAndVersion()`, or if `sender` is not the lockbox owner
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is a different contract
   * @throws {@link CCTContractVersionUnsupportedError} if `lockbox` reports an unsupported version
   * @throws {@link CCIPTypeVersionInvalidError} if `lockbox` answers `typeAndVersion()` with an
   * unparseable string
   * @example
   * ```typescript
   * // `sender` must be the lockbox owner
   * const unsigned = await cct.generateUnsignedUpdateLockboxAuthorizedCallers({
   *   lockbox: '0xLockbox...',
   *   addedCallers: ['0xPool...'], // the LockReleaseTokenPool to authorize
   *   sender: '0xLockboxOwner...',
   * })
   * ```
   */
  generateUnsignedUpdateLockboxAuthorizedCallers(
    opts: UpdateLockboxAuthorizedCallersParams,
  ): Promise<UnsignedEVMTx> {
    return this.#updateLockboxAuthorizedCallers.generate(this.chain, opts)
  }

  /**
   * Adds/removes authorized callers on an `ERC20LockBox`, signing + submitting with `opts.wallet`
   * (the lockbox owner). Authorize the `LockReleaseTokenPool` before it can lock/release.
   * @remarks Rejects a `lockbox` that is not a deployed, supported `ERC20LockBox`, and a wallet
   * that is not its owner, before the wallet is asked to sign; see
   * {@link generateUnsignedUpdateLockboxAuthorizedCallers}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if no caller is supplied, if
   * nothing at `lockbox` answers `typeAndVersion()`, if `sender` differs from the wallet, or if the
   * wallet is not the lockbox owner
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is a different contract
   * @throws {@link CCTContractVersionUnsupportedError} if `lockbox` reports an unsupported version
   * @throws {@link CCIPTypeVersionInvalidError} if `lockbox` answers `typeAndVersion()` with an
   * unparseable string
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * // `wallet` must sign as the lockbox owner
   * const { hash } = await cct.updateLockboxAuthorizedCallers({
   *   lockbox: '0xLockbox...',
   *   addedCallers: ['0xPool...'],
   *   wallet,
   * })
   * ```
   */
  updateLockboxAuthorizedCallers(
    opts: EVMExecuteParams<UpdateLockboxAuthorizedCallersParams>,
  ): Promise<TransactionResult> {
    return this.#updateLockboxAuthorizedCallers.execute(this.chain, opts)
  }

  /**
   * Lists callers authorized to deposit into or withdraw from an `ERC20LockBox`.
   *
   * @throws {@link CCTParamsInvalidError} if `lockbox` is invalid
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is not `ERC20LockBox`
   *
   * @example
   * ```ts
   * const cct = EVMTokenManager.fromChain(chain)
   * const callers = await cct.getAllLockboxAuthorizedCallers({ lockbox: '0xLockbox...' })
   * ```
   */
  getAllLockboxAuthorizedCallers(
    opts: GetAllLockboxAuthorizedCallersParams,
  ): Promise<GetAllLockboxAuthorizedCallersResult> {
    return this.#getAllLockboxAuthorizedCallers.query(this.chain, opts)
  }

  /**
   * Builds an unsigned `ERC20LockBox` `deposit` tx (for multisig / offline signing) that funds
   * the lockbox a v2.0.0 LockRelease pool releases from.
   * @remarks The step the deploy sequences stop short of: a v2.0.0 pool cannot release anything
   * until its lockbox holds liquidity. The v2.0.0 replacement for {@link provideLiquidity}.
   * @remarks `sender` must itself be an authorized caller of the lockbox — authorizing the pool
   * is not enough, because the lockbox gates the *depositor* too — and must have approved the
   * **lockbox** (not the pool) for `amount` via {@link generateUnsignedApproveToken} /
   * {@link approveToken}. Both are checked before any calldata is built.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if nothing at `lockbox`
   * answers `typeAndVersion()`, if the lockbox escrows a different token, or if `sender` is not
   * an authorized caller
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is a different contract
   * @throws {@link CCTContractVersionUnsupportedError} if `lockbox` reports an unsupported version
   * @throws {@link CCTTxFailedError} if `sender` holds, or has approved the lockbox for, less
   * than `amount`
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedDepositToLockbox({
   *   lockbox: '0xLockbox...',
   *   token: '0xToken...',
   *   amount: 1_000000000000000000n,
   *   sender: '0xAuthorizedCaller...',
   * })
   * ```
   */
  generateUnsignedDepositToLockbox(opts: DepositToLockboxParams): Promise<UnsignedEVMTx> {
    return this.#depositToLockbox.generate(this.chain, opts)
  }

  /**
   * Deposits tokens into an `ERC20LockBox`, signing + submitting with `opts.wallet` (an
   * authorized caller of the lockbox, which must have approved it for `amount`).
   * @remarks Approve first with {@link approveToken}, naming the **lockbox** as `spender`.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or the wallet is not an
   * authorized caller of the lockbox
   * @throws {@link CCTTxFailedError} if the wallet's balance or its allowance to the lockbox is
   * below `amount`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * await cct.approveToken({ tokenAddress: token, spender: lockbox, amount, wallet })
   * const { hash } = await cct.depositToLockbox({
   *   lockbox,
   *   token,
   *   amount,
   *   wallet,
   * })
   * ```
   */
  depositToLockbox(opts: EVMExecuteParams<DepositToLockboxParams>): Promise<TransactionResult> {
    return this.#depositToLockbox.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `ERC20LockBox` `withdraw` tx (for multisig / offline signing) that pulls
   * liquidity back out to an explicit `recipient`.
   * @remarks The v2.0.0 replacement for {@link withdrawLiquidity}, with one difference worth
   * noting: the payout address is a parameter, not `msg.sender`.
   * @remarks `amount` of `MaxUint256` withdraws the lockbox's entire balance.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, if nothing at `lockbox`
   * answers `typeAndVersion()`, if the lockbox escrows a different token, or if `sender` is not
   * an authorized caller
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is a different contract
   * @throws {@link CCTContractVersionUnsupportedError} if `lockbox` reports an unsupported version
   * @throws {@link CCTTxFailedError} if the lockbox holds less than `amount`
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedWithdrawFromLockbox({
   *   lockbox: '0xLockbox...',
   *   token: '0xToken...',
   *   amount: 1_000000000000000000n,
   *   recipient: '0xTreasury...',
   *   sender: '0xAuthorizedCaller...',
   * })
   * ```
   */
  generateUnsignedWithdrawFromLockbox(opts: WithdrawFromLockboxParams): Promise<UnsignedEVMTx> {
    return this.#withdrawFromLockbox.generate(this.chain, opts)
  }

  /**
   * Withdraws tokens from an `ERC20LockBox` to `recipient`, signing + submitting with
   * `opts.wallet` (an authorized caller of the lockbox).
   * @remarks The tokens go to `recipient`, which need not be the wallet.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or the wallet is not an
   * authorized caller of the lockbox
   * @throws {@link CCTTxFailedError} if the lockbox holds less than `amount`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.withdrawFromLockbox({
   *   lockbox,
   *   token,
   *   amount: MaxUint256, // the whole balance
   *   recipient: '0xTreasury...',
   *   wallet,
   * })
   * ```
   */
  withdrawFromLockbox(
    opts: EVMExecuteParams<WithdrawFromLockboxParams>,
  ): Promise<TransactionResult> {
    return this.#withdrawFromLockbox.execute(this.chain, opts)
  }

  /**
   * Reads a pool's admin state, v1.5.0 through v2.0.0: the `owner` every pool write is gated on,
   * the `rateLimitAdmin` role, its token/router and configured lanes — plus, on v2.0.0 pools, the
   * `feeAdmin` role, the allowed finality window, and a lock/release pool's `lockBox`.
   * @remarks The result is a union: `state.version === '2.0.0'` gates the roles and finality
   * window that version added, and `state.type === 'LockReleaseTokenPool'` gates its `lockBox`
   * (see the example) — a `SiloedLockReleaseTokenPool` reports no `lockBox`, since it escrows per
   * remote chain. For a legacy pool's `allowList` / `rebalancer`, proxy/USDC pools, or a v1.5.0
   * `*AndProxy` pool's `previousPool` (it reads here as its base `type`), use
   * `cct.chain.getTokenPoolConfig()`, the tolerant transfer-flow read. No pool version exposes a
   * pending-owner getter, so a proposed owner is not readable here.
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
   * // state.owner must sign transferPoolOwnership / lane config; state.rateLimitAdmin may set rate limits
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
   * `getSupportedChains()`; provide it to read one, which is the cheaper call by far on a pool with
   * many lanes. Passing a selector the pool has no config for surfaces as
   * {@link CCIPTokenPoolChainConfigNotFoundError} rather than an empty result.
   *
   * A lane's rate limiter is nullable: `inboundRateLimiterState` / `outboundRateLimiterState` are
   * `null` when that direction is unlimited, so check for `null` before reading `.capacity`.
   * Amounts are in the *local* token's smallest unit. On v2.0.0 pools each entry additionally
   * carries `fastInboundRateLimiterState` / `fastOutboundRateLimiterState`, the separate buckets
   * applied to Faster-Than-Finality and safe-finality (FCR) transfers.
   * @remarks Every pool-version difference is handled for you — v1.5.0's singular `getRemotePool`
   * vs v1.5.1+'s `getRemotePools`, and a `USDCTokenPoolProxy`'s indirection through its underlying
   * pools. Reads only; to change a lane use the lane-configuration write ops.
   * @remarks The Solana counterpart, `SolanaTokenManager.getTokenPoolRemotes`, returns this same
   * {@link TokenPoolRemote} shape, but is addressed differently: it takes the token `mint` plus a
   * pool program, where this takes the pool contract address directly.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is given and is not a `uint64`
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if a scanned lane has no remote token
   * configured
   * @example
   * ```typescript
   * // every configured lane
   * const remotes = await cct.getTokenPoolRemotes({ poolAddress: '0xPool...' })
   * for (const [network, lane] of Object.entries(remotes)) {
   *   const inbound = lane.inboundRateLimiterState
   *   console.log(network, lane.remoteToken, lane.remotePools, inbound?.capacity ?? 'unlimited')
   * }
   *
   * // or just one, avoiding a full scan
   * const one = await cct.getTokenPoolRemotes({
   *   poolAddress: '0xPool...',
   *   remoteChainSelector: 5009297550715157269n, // ethereum-mainnet
   * })
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
   * @remarks `remotePoolAddress` is the *remote* chain's pool address in that chain's own format
   * (`0x…` for EVM, base58 for Solana), validated against `remoteChainSelector`'s family and
   * encoded to the 32-byte padded `bytes` the pool stores.
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
   *   remotePoolAddress: '0xRemotePool...', // the remote chain's own format, e.g. base58 for Solana
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
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * @remarks **v1.5.1 and later pools.** From v1.5.1 a lane holds a *set* of remote
   * pools, which is what makes a zero-downtime remote-side pool upgrade possible: add the new
   * pool, drain the old one, then {@link removeRemotePool}. A v1.5.0 pool has no additive
   * primitive and throws {@link CCTOperationUnsupportedError} — it only supports the wholesale
   * {@link setRemotePool}.
   * @remarks `remotePoolAddress` is the *remote* chain's pool address in that chain's own format
   * (`0x…` for EVM, base58 for Solana), validated against `remoteChainSelector`'s family and
   * encoded to the 32-byte padded `bytes` the pool stores.
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
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * @remarks **v1.5.1 and later pools** — the versions where a lane holds a set of remote
   * pools. The last step of a remote-side pool upgrade started with {@link addRemotePool}. A
   * v1.5.0 pool has no removal primitive and throws {@link CCTOperationUnsupportedError}; its
   * single remote pool can only be overwritten via {@link setRemotePool}.
   * @remarks `remotePoolAddress` is the *remote* chain's pool address in that chain's own format
   * (`0x…` for EVM, base58 for Solana), validated against `remoteChainSelector`'s family and
   * encoded to the 32-byte padded `bytes` the pool stores.
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
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
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
   * @remarks Same params as {@link generateUnsignedApplyChainUpdates} — see there for how a
   * v1.5.0 pool is handled. `opts.sender` defaults to the wallet's own address (the only address
   * `onlyOwner` can pass) and is rejected if it differs, so the wallet must be the pool owner.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTParamsInvalidError} if any param is invalid, a lane lists several remote
   * pools for a v1.5.0 pool, or `sender` is given and is not the wallet address / pool owner. As
   * with {@link generateUnsignedApplyChainUpdates}, an enabled rate limiter on a **v1.5.0 or
   * v1.5.1** pool must satisfy the stricter `0 < rate < capacity`.
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * // `wallet` must sign as the pool owner
   * const { hash } = await cct.applyChainUpdates({
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
   * @remarks One parameter shape for every pool version: removals in
   * `remoteChainSelectorsToRemove`, additions in `chainsToAdd`, each addition carrying **plural**
   * `remotePoolAddresses` — the contract's own signature from v1.5.1 up (v1.6.0, v1.6.1 and
   * v2.0.0 included). A **v1.5.0** pool, detected from its on-chain `typeAndVersion` (a read this
   * op makes anyway), has an older signature, so the params are adapted to its single `chains`
   * array: each removal becomes an `allowed: false` lane, each addition an `allowed: true` lane.
   * A v1.5.0 pool holds a single remote pool per lane, so there each `remotePoolAddresses` must
   * have exactly one entry.
   *
   * Rate limits use the SDK's `enabled` spelling, not the ABI's `isEnabled`, matching the Solana
   * counterpart; amounts are in the token's smallest unit. Pass `opts.sender` to pre-flight it
   * against the pool's `owner()` — `applyChainUpdates` is `onlyOwner`.
   * @throws {@link CCTParamsInvalidError} if any param is invalid, a lane lists several remote
   * pools for a v1.5.0 pool, or `sender` is not the pool owner. An enabled rate limiter must have
   * `rate <= capacity` on every version; on a **v1.5.0, v1.5.1 or v1.6.0** pool the bound is
   * stricter (`0 < rate < capacity`), so a `rate` of `0n` or a `rate` equal to `capacity` is also
   * rejected there — v1.6.1 and v2.0.0 allow both.
   *
   * Each lane array must also be dense (no holes) and free of repeated selectors, and a lane
   * being *added* may not use the `0n` selector — the contract would accept it as a permanently
   * unroutable lane rather than reverting. `remoteChainSelectorsToRemove` still accepts `0n`, so
   * a pool already holding such a lane can be repaired; listing one selector in both
   * `chainsToAdd` and `remoteChainSelectorsToRemove` remains the wholesale-replace idiom.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example Enabling a lane while retiring an old one — the same call for any pool version:
   * ```typescript
   * const unsigned = await cct.generateUnsignedApplyChainUpdates({
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
   */
  generateUnsignedApplyChainUpdates(opts: ApplyChainUpdatesParams): Promise<UnsignedEVMTx> {
    return this.#applyChainUpdates.generate(this.chain, opts)
  }

  /**
   * Builds an unsigned `applyAllowListUpdates` tx (for multisig / offline signing): removes and
   * adds entries in the pool's sender allowlist in one call. Probes the pool's on-chain
   * `typeAndVersion` to resolve which contract holds its allowlist.
   * @remarks **The target moved in v2.0.0.** On v1.5.0–v1.6.1 the tx goes to the pool, gated on
   * the pool owner. A v2.0.0 pool has no allowlist of its own: the tx goes to its bound
   * `AdvancedPoolHooks` (see {@link EVMTokenManager.getAdvancedPoolHooks}), gated on the **hooks**
   * owner, and changes the allowlist of every pool bound to those hooks. A v2.0.0 pool with no
   * hooks bound is reported unsupported.
   *
   * `removes` are applied *before* `adds` on-chain. Either array may be omitted (defaults to `[]`),
   * but at least one address is required across both. They must hold no duplicates and no zero
   * address, and share no address — an address in both would end up
   * allowlisted (removes run first), which no caller can reasonably have meant.
   *
   * The holder must have been deployed **with** an allowlist (`allowlistEnabled` is immutable, and
   * the call reverts `AllowListNotEnabled` when false), and the update must actually change
   * state: the current allowlist is read first, and an entry the holder would silently ignore — a
   * `removes` that is not allowlisted, an `adds` that already is — is rejected here.
   *
   * Owner-only (`applyAllowListUpdates` is `onlyOwner`). When `sender` is supplied it is checked
   * against the holder's `owner()` before any calldata is built; omit it and no owner read is
   * made (nothing to compare against).
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool with no hooks bound
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `poolAddress` is the zero
   * address, both arrays are empty or omitted, an array holds duplicates or the zero address, an address
   * appears in both arrays, the holder has no allowlist enabled, a `removes` entry is not
   * currently allowlisted, an `adds` entry already is, or `sender` is given and is not the
   * holder's owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * // build only — sign later (multisig / offline). `sender` must be the holder's owner.
   * const unsigned = await cct.generateUnsignedApplyAllowlistUpdates({
   *   poolAddress: '0xPool...',
   *   removes: ['0xRevoked...'],
   *   adds: ['0xNewSender...'],
   *   sender: '0xOwner...',
   * })
   * ```
   */
  generateUnsignedApplyAllowlistUpdates(opts: ApplyAllowlistUpdatesParams): Promise<UnsignedEVMTx> {
    return this.#applyAllowlistUpdates.generate(this.chain, opts)
  }

  /**
   * Removes and adds entries in the pool's sender allowlist, signing + submitting with
   * `opts.wallet`. `sender` defaults to the wallet's address and must equal it — the wallet must
   * own the allowlist holder: the pool on v1.5.0–v1.6.1, its bound `AdvancedPoolHooks` on v2.0.0.
   *
   * `removes` are applied *before* `adds` on-chain, so an address listed in both would end up
   * allowlisted; that is rejected, as are duplicates and the zero address. The holder must have an
   * allowlist enabled (`allowlistEnabled` is immutable — a holder deployed without one can never
   * gain it), and every entry must change state: the current allowlist is read first, and a
   * `removes` that is not allowlisted or an `adds` that already is fails here rather than mining
   * as a no-op.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPWalletChainMismatchError} if `wallet` is connected to a different chain
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool with no hooks bound
   * @throws {@link CCTParamsInvalidError} if any param is invalid, `sender` is given and is not
   * the wallet's address, the wallet is not the holder's owner, it has no allowlist enabled, or
   * an entry would be a no-op (see {@link EVMTokenManager.generateUnsignedApplyAllowlistUpdates})
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   * @example
   * ```typescript
   * const { hash } = await cct.applyAllowlistUpdates({
   *   poolAddress: '0xPool...',
   *   removes: ['0xRevoked...'],
   *   adds: ['0xNewSender...'],
   *   wallet,
   * })
   * ```
   */
  applyAllowlistUpdates(
    opts: EVMExecuteParams<ApplyAllowlistUpdatesParams>,
  ): Promise<TransactionResult> {
    return this.#applyAllowlistUpdates.execute(this.chain, opts)
  }

  /**
   * Reads the sender allowlist the pool enforces, checksummed: its own on v1.5.0–v1.6.1, its
   * bound `AdvancedPoolHooks`' on v2.0.0. A v2.0.0 pool with no hooks bound reads `[]`.
   * @remarks `[]` does not mean "anyone may send": pair with
   * {@link EVMTokenManager.getAllowlistEnabled}, since an enabled allowlist with no entries
   * rejects every sender.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * const senders = await cct.getAllowlist({ poolAddress: '0xPool...' })
   * ```
   */
  getAllowlist(opts: GetAllowlistParams): Promise<GetAllowlistResult> {
    return this.#getAllowlist.query(this.chain, opts)
  }

  /**
   * Reads whether the pool enforces a sender allowlist: its own immutable flag on v1.5.0–v1.6.1,
   * its bound `AdvancedPoolHooks`' on v2.0.0. A v2.0.0 pool with no hooks bound reads `false`.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @example
   * ```typescript
   * if (!(await cct.getAllowlistEnabled({ poolAddress: '0xPool...' })))
   *   console.log('any sender may transfer through this pool')
   * ```
   */
  getAllowlistEnabled(opts: GetAllowlistEnabledParams): Promise<GetAllowlistEnabledResult> {
    return this.#getAllowlistEnabled.query(this.chain, opts)
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
export * from './token-admin-registry/contracts.ts'
export type { DeployTokenParams } from './token/operations/deploy-token.ts'
export type { BeginDefaultAdminTransferParams } from './token/operations/begin-default-admin-transfer.ts'
export type { AcceptDefaultAdminTransferParams } from './token/operations/accept-default-admin-transfer.ts'
export type { CancelDefaultAdminTransferParams } from './token/operations/cancel-default-admin-transfer.ts'
export type { SetCCIPAdminParams } from './token/operations/set-ccip-admin.ts'
export type { ApproveTokenParams } from './token/operations/approve-token.ts'
export type { GrantMintAndBurnRolesParams } from './token/operations/grant-mint-and-burn-roles.ts'
export type { GrantMintRoleParams } from './token/operations/grant-mint-role.ts'
export type { GrantBurnRoleParams } from './token/operations/grant-burn-role.ts'
export type { RevokeMintRoleParams } from './token/operations/revoke-mint-role.ts'
export type { RevokeBurnRoleParams } from './token/operations/revoke-burn-role.ts'
export type { MintParams } from './token/operations/mint.ts'
export type { GetMintersParams, GetMintersResult } from './token/operations/get-minters.ts'
export type { GetBurnersParams, GetBurnersResult } from './token/operations/get-burners.ts'
export type {
  GetTokenOwnerParams,
  GetTokenOwnerResult,
} from './token/operations/get-token-owner.ts'
export type { GetCCIPAdminParams, GetCCIPAdminResult } from './token/operations/get-ccip-admin.ts'
export type {
  GetTokenDefaultAdminParams,
  GetTokenDefaultAdminResult,
  PendingTokenDefaultAdmin,
} from './token/operations/get-token-default-admin.ts'
export type { IsMinterParams, IsMinterResult } from './token/operations/is-minter.ts'
export type { IsBurnerParams, IsBurnerResult } from './token/operations/is-burner.ts'
export type { TransferTokenOwnershipParams } from './token/operations/transfer-token-ownership.ts'
export type { AcceptTokenOwnershipParams } from './token/operations/accept-token-ownership.ts'
export * from './token/contracts.ts'
export type { TransferPoolOwnershipParams } from './token-pool/operations/transfer-pool-ownership.ts'
export type { AcceptPoolOwnershipParams } from './token-pool/operations/accept-pool-ownership.ts'
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
  ApplyChainUpdatesParams,
  ChainUpdate,
} from './token-pool/operations/apply-chain-updates.ts'
export type { ApplyAllowlistUpdatesParams } from './token-pool/operations/apply-allowlist-updates.ts'
export type {
  GetAllowlistParams,
  GetAllowlistResult,
} from './token-pool/operations/get-allowlist.ts'
export type {
  GetAllowlistEnabledParams,
  GetAllowlistEnabledResult,
} from './token-pool/operations/get-allowlist-enabled.ts'
export type {
  GetDynamicConfigParams,
  GetDynamicConfigResult,
} from './token-pool/operations/get-dynamic-config.ts'
export type { GetFeeParams, GetFeeResult } from './token-pool/operations/get-fee.ts'
export type {
  GetTokenTransferFeeConfigParams,
  GetTokenTransferFeeConfigResult,
} from './token-pool/operations/get-token-transfer-fee-config.ts'
export type {
  ApplyTokenTransferFeeConfigUpdatesParams,
  TokenTransferFeeConfigUpdate,
} from './token-pool/operations/apply-token-transfer-fee-config-updates.ts'
/**
 * `GetTokenPoolRemotesResult` is a `Record<string, TokenPoolRemote>`, so a caller cannot name a
 * single lane's type without these. Declared in `../../chain.ts` (shared with the core
 * `Chain.getTokenPoolRemotes`), re-exported here so this entry point is self-sufficient.
 */
export type { RateLimiterState, TokenPoolRemote, TokenTransferFeeConfig } from '../../chain.ts'
export type {
  ChainRateLimitUpdate,
  SetChainRateLimiterConfigsParams,
} from './token-pool/operations/set-chain-rate-limiter-configs.ts'
export type { RateLimitConfig } from './token-pool/rate-limit.ts'
export type { ProvideLiquidityParams } from './token-pool/operations/provide-liquidity.ts'
export type { WithdrawFeeTokensParams } from './token-pool/operations/withdraw-fee-tokens.ts'
export type { WithdrawLiquidityParams } from './token-pool/operations/withdraw-liquidity.ts'
export type { TransferLiquidityParams } from './token-pool/operations/transfer-liquidity.ts'
export type { SetRebalancerParams } from './token-pool/operations/set-rebalancer.ts'
export type {
  GetRebalancerParams,
  GetRebalancerResult,
} from './token-pool/operations/get-rebalancer.ts'
export type { GetLockboxParams, GetLockboxResult } from './token-pool/operations/get-lockbox.ts'
export type {
  GetAllowedFinalityConfigParams,
  GetAllowedFinalityConfigResult,
} from './token-pool/operations/get-allowed-finality-config.ts'
export type {
  GetAdvancedPoolHooksParams,
  GetAdvancedPoolHooksResult,
} from './token-pool/operations/get-advanced-pool-hooks.ts'
export type { SetAllowedFinalityConfigParams } from './token-pool/operations/set-allowed-finality-config.ts'
export type { UpdateAdvancedPoolHooksParams } from './token-pool/operations/update-advanced-pool-hooks.ts'
export * from './token-pool/contracts.ts'
export type { DeployLockboxParams } from './lockbox/operations/deploy-lockbox.ts'
export type { UpdateLockboxAuthorizedCallersParams } from './lockbox/operations/update-authorized-callers.ts'
export type {
  GetAllLockboxAuthorizedCallersParams,
  GetAllLockboxAuthorizedCallersResult,
} from './lockbox/operations/get-all-lockbox-authorized-callers.ts'
export * from './lockbox/contracts.ts'
export type { UpdateAdvancedPoolHooksAuthorizedCallersParams } from './advanced-pool-hooks/operations/update-authorized-callers.ts'
export type {
  GetAllAdvancedPoolHooksAuthorizedCallersParams,
  GetAllAdvancedPoolHooksAuthorizedCallersResult,
} from './advanced-pool-hooks/operations/get-all-advanced-pool-hooks-authorized-callers.ts'
export type {
  GetPolicyEngineParams,
  GetPolicyEngineResult,
} from './advanced-pool-hooks/operations/get-policy-engine.ts'
export type {
  GetThresholdAmountParams,
  GetThresholdAmountResult,
} from './advanced-pool-hooks/operations/get-threshold-amount.ts'
export type { DepositToLockboxParams } from './lockbox/operations/deposit.ts'
export type { WithdrawFromLockboxParams } from './lockbox/operations/withdraw.ts'
export type { ApplyCCVConfigUpdatesParams } from './advanced-pool-hooks/operations/apply-ccv-config-updates.ts'
export type {
  GetAllCCVConfigsParams,
  GetAllCCVConfigsResult,
} from './advanced-pool-hooks/operations/get-all-ccv-configs.ts'
export type {
  GetCCVConfigParams,
  GetCCVConfigResult,
} from './advanced-pool-hooks/operations/get-ccv-config.ts'
export type {
  CCVMessageDirection,
  GetRequiredCCVsParams,
  GetRequiredCCVsResult,
} from './advanced-pool-hooks/operations/get-required-ccvs.ts'
export type { DeployAdvancedPoolHooksParams } from './advanced-pool-hooks/operations/deploy-advanced-pool-hooks.ts'
export type { SetPolicyEngineParams } from './advanced-pool-hooks/operations/set-policy-engine.ts'
export type { SetThresholdAmountParams } from './advanced-pool-hooks/operations/set-threshold-amount.ts'
export * from './advanced-pool-hooks/contracts.ts'
export type {
  DeployTokenAndTokenPoolViaFactoryParams,
  DeployTokenPoolWithExistingTokenViaFactoryParams,
  FactoryDeploy,
  FactoryDeployCommon,
  FactoryRateLimiterConfig,
  FactoryRemoteChainConfig,
  FactoryRemoteTokenPool,
  FactoryTokenPoolType,
} from './token-pool-factory/deploy.ts'
export {
  deployTokenAndTokenPoolViaFactory,
  deployTokenAndTokenPoolViaFactoryUnchecked,
  deployTokenPoolWithExistingTokenViaFactory,
  deployTokenPoolWithExistingTokenViaFactoryUnchecked,
} from './token-pool-factory/deploy.ts'
export type {
  DeployArtifact,
  DeployResult,
  EVMExecuteParams,
  ExplorerVerificationInput,
} from './operation.ts'
export type { TransactionResult } from '../operation.ts'
