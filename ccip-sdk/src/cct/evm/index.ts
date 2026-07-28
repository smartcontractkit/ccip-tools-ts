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
import type { TransactionHash } from '../operation.ts'
import { TokenManager } from '../token-manager.ts'
import { type AcceptOwnershipParams, AcceptOwnership } from './pool/operations/accept-ownership.ts'
import {
  type AppendRemotePoolAddressesParams,
  AppendRemotePoolAddresses,
} from './pool/operations/append-remote-pool-addresses.ts'
import {
  type ApplyChainUpdatesParams,
  ApplyChainUpdates,
} from './pool/operations/apply-chain-updates.ts'
import {
  type DeleteChainConfigParams,
  DeleteChainConfig,
} from './pool/operations/delete-chain-config.ts'
import {
  type RemoveRemotePoolAddressesParams,
  RemoveRemotePoolAddresses,
} from './pool/operations/remove-remote-pool-addresses.ts'
import {
  type SetAllowedFinalityConfigParams,
  SetAllowedFinalityConfig,
} from './pool/operations/set-allowed-finality-config.ts'
import {
  type SetChainRateLimiterConfigParams,
  SetChainRateLimiterConfig,
} from './pool/operations/set-chain-rate-limiter-config.ts'
import { type SetFeeAdminParams, SetFeeAdmin } from './pool/operations/set-fee-admin.ts'
import {
  type SetRateLimitAdminParams,
  SetRateLimitAdmin,
} from './pool/operations/set-rate-limit-admin.ts'
import {
  type SetTokenTransferFeeConfigParams,
  SetTokenTransferFeeConfig,
} from './pool/operations/set-token-transfer-fee-config.ts'
import {
  type TransferOwnershipParams,
  TransferOwnership,
} from './pool/operations/transfer-ownership.ts'
import { type MintBurnRolesResult, getMintBurnRoles } from './token/get-mint-burn-roles.ts'
import {
  type DeployCrossChainPoolTokenParams,
  type DeployCrossChainPoolTokenResult,
  DeployCrossChainPoolToken,
} from './token/operations/deploy-cross-chain-pool-token.ts'
import {
  type DeployTokenParams,
  type DeployTokenResult,
  DeployToken,
} from './token/operations/deploy-token.ts'
import {
  type GrantMintBurnAccessParams,
  GrantMintBurnAccess,
} from './token/operations/grant-mint-burn-access.ts'
import {
  type RevokeMintBurnAccessParams,
  RevokeMintBurnAccess,
} from './token/operations/revoke-mint-burn-access.ts'
import {
  type AcceptAdminRoleParams,
  AcceptAdminRole,
} from './token-admin-registry/operations/accept-admin-role.ts'
import {
  type ProposeAdminRoleParams,
  ProposeAdminRole,
} from './token-admin-registry/operations/propose-admin-role.ts'
import { type SetPoolParams, SetPool } from './token-admin-registry/operations/set-pool.ts'
import {
  type TransferAdminRoleParams,
  TransferAdminRole,
} from './token-admin-registry/operations/transfer-admin-role.ts'
import {
  type DeployPoolViaFactoryParams,
  type DeployPoolViaFactoryResult,
  DeployPoolViaFactory,
} from './token-pool/operations/deploy-pool-via-factory.ts'
import {
  type DeployPoolParams,
  type DeployPoolResult,
  DeployPool,
} from './token-pool/operations/deploy-pool.ts'
import {
  type DeployTokenAndPoolViaFactoryParams,
  type DeployTokenAndPoolViaFactoryResult,
  DeployTokenAndPoolViaFactory,
} from './token-pool/operations/deploy-token-and-pool-via-factory.ts'
import {
  type ProvideLiquidityParams,
  ProvideLiquidity,
} from './token-pool/operations/provide-liquidity.ts'

/** CCT admin operations for EVM chains, delegating each op to an operation class. */
export class EVMTokenManager extends TokenManager<typeof ChainFamily.EVM> {
  readonly chain: EVMChain
  readonly #setPool = new SetPool()
  readonly #proposeAdminRole = new ProposeAdminRole()
  readonly #acceptAdminRole = new AcceptAdminRole()
  readonly #transferAdminRole = new TransferAdminRole()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #deleteChainConfig = new DeleteChainConfig()
  readonly #appendRemotePoolAddresses = new AppendRemotePoolAddresses()
  readonly #removeRemotePoolAddresses = new RemoveRemotePoolAddresses()
  readonly #setRateLimitAdmin = new SetRateLimitAdmin()
  readonly #setFeeAdmin = new SetFeeAdmin()
  readonly #setAllowedFinalityConfig = new SetAllowedFinalityConfig()
  readonly #setChainRateLimiterConfig = new SetChainRateLimiterConfig()
  readonly #setTokenTransferFeeConfig = new SetTokenTransferFeeConfig()
  readonly #transferOwnership = new TransferOwnership()
  readonly #acceptOwnership = new AcceptOwnership()
  readonly #grantMintBurnAccess = new GrantMintBurnAccess()
  readonly #revokeMintBurnAccess = new RevokeMintBurnAccess()
  readonly #deployToken = new DeployToken()
  readonly #deployCrossChainPoolToken = new DeployCrossChainPoolToken()
  readonly #deployPool = new DeployPool()
  readonly #deployPoolViaFactory = new DeployPoolViaFactory()
  readonly #deployTokenAndPoolViaFactory = new DeployTokenAndPoolViaFactory()
  readonly #provideLiquidity = new ProvideLiquidity()

  /** Wraps the chain this manager builds and submits through. */
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
  setPool(opts: SetPoolParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#setPool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned `proposeAdminRole` tx (for multisig / offline signing).
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedProposeAdminRole({
   *   tokenAddress: '0xToken...',
   *   registryModuleAddress: '0xRegistryModuleOwnerCustom...',
   *   registrationMethod: 'owner', // default; how the module verifies your authority
   *   sender: '0xTokenOwner...',
   * })
   * ```
   */
  generateUnsignedProposeAdminRole(opts: ProposeAdminRoleParams): Promise<UnsignedEVMTx> {
    return this.#proposeAdminRole.generate(this.chain, opts)
  }

  /**
   * Proposes the caller as token administrator, signing + submitting with `opts.wallet`.
   * The wallet must hold the authority the `registrationMethod` checks (token owner by default).
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   * @example
   * ```typescript
   * const { hash } = await cct.proposeAdminRole({
   *   tokenAddress: '0xToken...',
   *   registryModuleAddress: '0xRegistryModuleOwnerCustom...',
   *   wallet,
   * })
   * ```
   */
  proposeAdminRole(opts: ProposeAdminRoleParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#proposeAdminRole.execute(this.chain, opts)
  }

  /** Builds an unsigned `acceptAdminRole` tx. @throws {@link CCTParamsInvalidError} */
  generateUnsignedAcceptAdminRole(opts: AcceptAdminRoleParams): Promise<UnsignedEVMTx> {
    return this.#acceptAdminRole.generate(this.chain, opts)
  }
  /** Accepts the pending admin role, signing with `opts.wallet`. */
  acceptAdminRole(opts: AcceptAdminRoleParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#acceptAdminRole.execute(this.chain, opts)
  }

  /** Builds an unsigned `transferAdminRole` tx (proposes a new pending admin). */
  generateUnsignedTransferAdminRole(opts: TransferAdminRoleParams): Promise<UnsignedEVMTx> {
    return this.#transferAdminRole.generate(this.chain, opts)
  }
  /** Transfers (proposes) the admin role to `newAdmin`, signing with `opts.wallet`. */
  transferAdminRole(opts: TransferAdminRoleParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#transferAdminRole.execute(this.chain, opts)
  }

  /** Builds unsigned `applyChainUpdates` tx (add/remove remote chain configs on a pool). */
  generateUnsignedApplyChainUpdates(opts: ApplyChainUpdatesParams): Promise<UnsignedEVMTx> {
    return this.#applyChainUpdates.generate(this.chain, opts)
  }
  /** Applies remote-chain config updates to a pool, signing with `opts.wallet`. */
  applyChainUpdates(opts: ApplyChainUpdatesParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#applyChainUpdates.execute(this.chain, opts)
  }

  /** Builds unsigned `deleteChainConfig` tx (removes a remote chain from a pool). */
  generateUnsignedDeleteChainConfig(opts: DeleteChainConfigParams): Promise<UnsignedEVMTx> {
    return this.#deleteChainConfig.generate(this.chain, opts)
  }
  /** Deletes a remote-chain config from a pool, signing with `opts.wallet`. */
  deleteChainConfig(opts: DeleteChainConfigParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#deleteChainConfig.execute(this.chain, opts)
  }

  /** Builds unsigned `appendRemotePoolAddresses` txs (one per address). */
  generateUnsignedAppendRemotePoolAddresses(
    opts: AppendRemotePoolAddressesParams,
  ): Promise<UnsignedEVMTx> {
    return this.#appendRemotePoolAddresses.generate(this.chain, opts)
  }
  /** Appends remote pool addresses to a pool (multi-tx), signing with `opts.wallet`. */
  appendRemotePoolAddresses(
    opts: AppendRemotePoolAddressesParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#appendRemotePoolAddresses.execute(this.chain, opts)
  }

  /** Builds unsigned `removeRemotePoolAddresses` txs (one per address). */
  generateUnsignedRemoveRemotePoolAddresses(
    opts: RemoveRemotePoolAddressesParams,
  ): Promise<UnsignedEVMTx> {
    return this.#removeRemotePoolAddresses.generate(this.chain, opts)
  }
  /** Removes remote pool addresses from a pool (multi-tx), signing with `opts.wallet`. */
  removeRemotePoolAddresses(
    opts: RemoveRemotePoolAddressesParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#removeRemotePoolAddresses.execute(this.chain, opts)
  }

  /** Builds unsigned `setRateLimitAdmin` tx. */
  generateUnsignedSetRateLimitAdmin(opts: SetRateLimitAdminParams): Promise<UnsignedEVMTx> {
    return this.#setRateLimitAdmin.generate(this.chain, opts)
  }
  /** Sets the pool's rate-limit admin, signing with `opts.wallet`. */
  setRateLimitAdmin(opts: SetRateLimitAdminParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#setRateLimitAdmin.execute(this.chain, opts)
  }

  /** Builds unsigned `setFeeAdmin` tx (v2.0+ pools). */
  generateUnsignedSetFeeAdmin(opts: SetFeeAdminParams): Promise<UnsignedEVMTx> {
    return this.#setFeeAdmin.generate(this.chain, opts)
  }
  /** Sets the pool's fee admin (v2.0+), signing with `opts.wallet`. */
  setFeeAdmin(opts: SetFeeAdminParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#setFeeAdmin.execute(this.chain, opts)
  }

  /** Builds unsigned `setAllowedFinalityConfig` tx (v2.0+ pools). */
  generateUnsignedSetAllowedFinalityConfig(
    opts: SetAllowedFinalityConfigParams,
  ): Promise<UnsignedEVMTx> {
    return this.#setAllowedFinalityConfig.generate(this.chain, opts)
  }
  /** Sets the pool's allowed finality config (v2.0+), signing with `opts.wallet`. */
  setAllowedFinalityConfig(
    opts: SetAllowedFinalityConfigParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#setAllowedFinalityConfig.execute(this.chain, opts)
  }

  /** Builds unsigned `setChainRateLimiterConfig` tx(s) (v1.6 = one per chain, v2.0 = batched). */
  generateUnsignedSetChainRateLimiterConfig(
    opts: SetChainRateLimiterConfigParams,
  ): Promise<UnsignedEVMTx> {
    return this.#setChainRateLimiterConfig.generate(this.chain, opts)
  }
  /** Sets per-chain rate limiter config on a pool, signing with `opts.wallet`. */
  setChainRateLimiterConfig(
    opts: SetChainRateLimiterConfigParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#setChainRateLimiterConfig.execute(this.chain, opts)
  }

  /** Builds unsigned `setTokenTransferFeeConfig` tx (v2.0+ pools). */
  generateUnsignedSetTokenTransferFeeConfig(
    opts: SetTokenTransferFeeConfigParams,
  ): Promise<UnsignedEVMTx> {
    return this.#setTokenTransferFeeConfig.generate(this.chain, opts)
  }
  /** Sets token-transfer fee config on a pool (v2.0+), signing with `opts.wallet`. */
  setTokenTransferFeeConfig(
    opts: SetTokenTransferFeeConfigParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#setTokenTransferFeeConfig.execute(this.chain, opts)
  }

  /** Builds unsigned `transferOwnership` tx (Ownable2Step, pool). */
  generateUnsignedTransferOwnership(opts: TransferOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#transferOwnership.generate(this.chain, opts)
  }
  /** Transfers pool ownership (proposes new owner), signing with `opts.wallet`. */
  transferOwnership(opts: TransferOwnershipParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#transferOwnership.execute(this.chain, opts)
  }

  /** Builds unsigned `acceptOwnership` tx (Ownable2Step, pool). */
  generateUnsignedAcceptOwnership(opts: AcceptOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#acceptOwnership.generate(this.chain, opts)
  }
  /** Accepts pending pool ownership, signing with `opts.wallet`. */
  acceptOwnership(opts: AcceptOwnershipParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#acceptOwnership.execute(this.chain, opts)
  }

  /** Builds unsigned `grantMintBurnAccess` tx (grant mint/burn role on a token). */
  generateUnsignedGrantMintBurnAccess(opts: GrantMintBurnAccessParams): Promise<UnsignedEVMTx> {
    return this.#grantMintBurnAccess.generate(this.chain, opts)
  }
  /** Grants mint/burn role(s) on a token, signing with `opts.wallet`. */
  grantMintBurnAccess(
    opts: GrantMintBurnAccessParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#grantMintBurnAccess.execute(this.chain, opts)
  }

  /** Builds unsigned `revokeMintBurnAccess` tx (revoke mint/burn role on a token). */
  generateUnsignedRevokeMintBurnAccess(opts: RevokeMintBurnAccessParams): Promise<UnsignedEVMTx> {
    return this.#revokeMintBurnAccess.generate(this.chain, opts)
  }
  /** Revokes a mint/burn role on a token, signing with `opts.wallet`. */
  revokeMintBurnAccess(
    opts: RevokeMintBurnAccessParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    return this.#revokeMintBurnAccess.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned CrossChainToken deploy tx (contract creation).
   * `ownerAddress` is required here (no signer to derive it from).
   */
  generateUnsignedDeployToken(opts: DeployTokenParams): Promise<UnsignedEVMTx> {
    return this.#deployToken.generate(this.chain, opts)
  }
  /**
   * Deploys a CrossChainToken, signing with `opts.wallet`; returns the deployed
   * `tokenAddress`. `ownerAddress` defaults to the signer's address.
   */
  deployToken(opts: DeployTokenParams & { wallet: unknown }): Promise<DeployTokenResult> {
    return this.#deployToken.execute(this.chain, opts)
  }

  /** Builds an unsigned CrossChainPoolToken deploy tx (combined token+pool, creation). */
  generateUnsignedDeployCrossChainPoolToken(
    opts: DeployCrossChainPoolTokenParams,
  ): Promise<UnsignedEVMTx> {
    return this.#deployCrossChainPoolToken.generate(this.chain, opts)
  }
  /** Deploys a CrossChainPoolToken (token == pool), signing with `opts.wallet`; returns its address. */
  deployCrossChainPoolToken(
    opts: DeployCrossChainPoolTokenParams & { wallet: unknown },
  ): Promise<DeployCrossChainPoolTokenResult> {
    return this.#deployCrossChainPoolToken.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool-creation tx. `lock-release` requires `lockBoxAddress`
   * here (the signed `deployPool` auto-deploys one).
   */
  generateUnsignedDeployPool(opts: DeployPoolParams): Promise<UnsignedEVMTx> {
    return this.#deployPool.generate(this.chain, opts)
  }
  /**
   * Deploys a CCIP token pool, signing with `opts.wallet`; returns the `poolAddress`.
   * For `lock-release`, auto-deploys an `ERC20LockBox` and authorizes the pool on it.
   */
  deployPool(opts: DeployPoolParams & { wallet: unknown }): Promise<DeployPoolResult> {
    return this.#deployPool.execute(this.chain, opts)
  }

  /** Builds an unsigned `TokenPoolFactory` pool-deploy tx for an existing token. Requires `futureOwner`. */
  generateUnsignedDeployPoolViaFactory(opts: DeployPoolViaFactoryParams): Promise<UnsignedEVMTx> {
    return this.#deployPoolViaFactory.generate(this.chain, opts)
  }
  /** Deploys a pool for an existing token via TokenPoolFactory 2.0.0 (CREATE2); returns the `poolAddress`. */
  deployPoolViaFactory(
    opts: DeployPoolViaFactoryParams & { wallet: unknown },
  ): Promise<DeployPoolViaFactoryResult> {
    return this.#deployPoolViaFactory.execute(this.chain, opts)
  }

  /** Builds an unsigned `TokenPoolFactory` token+pool-deploy tx. Requires `futureOwner`. */
  generateUnsignedDeployTokenAndPoolViaFactory(
    opts: DeployTokenAndPoolViaFactoryParams,
  ): Promise<UnsignedEVMTx> {
    return this.#deployTokenAndPoolViaFactory.generate(this.chain, opts)
  }
  /** Deploys a new token + its pool in one tx via TokenPoolFactory 2.0.0 (CREATE2); returns both addresses. */
  deployTokenAndPoolViaFactory(
    opts: DeployTokenAndPoolViaFactoryParams & { wallet: unknown },
  ): Promise<DeployTokenAndPoolViaFactoryResult> {
    return this.#deployTokenAndPoolViaFactory.execute(this.chain, opts)
  }

  /** Builds unsigned `provideLiquidity` txs (`[approve, provide/deposit]`) for a lock-release pool. */
  generateUnsignedProvideLiquidity(opts: ProvideLiquidityParams): Promise<UnsignedEVMTx> {
    return this.#provideLiquidity.generate(this.chain, opts)
  }
  /** Provides liquidity to a lock-release pool, signing with `opts.wallet`. */
  provideLiquidity(opts: ProvideLiquidityParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#provideLiquidity.execute(this.chain, opts)
  }

  /** Reads the current MINTER/BURNER role holders on a CrossChainToken (read-only). */
  getMintBurnRoles(tokenAddress: string): Promise<MintBurnRolesResult> {
    return getMintBurnRoles(this.chain, tokenAddress)
  }
}

export * from '../errors.ts'
export type { DeployVerification, DeployVerificationTarget } from './deploy-verification.ts'
export type { SetPoolParams } from './token-admin-registry/operations/set-pool.ts'
export type {
  EVMRegistrationMethod,
  ProposeAdminRoleParams,
} from './token-admin-registry/operations/propose-admin-role.ts'
export type { AcceptAdminRoleParams } from './token-admin-registry/operations/accept-admin-role.ts'
export type { TransferAdminRoleParams } from './token-admin-registry/operations/transfer-admin-role.ts'
export type {
  ApplyChainUpdatesParams,
  RateLimiterConfig,
  RemoteChainConfig,
} from './pool/operations/apply-chain-updates.ts'
export type { DeleteChainConfigParams } from './pool/operations/delete-chain-config.ts'
export type { AppendRemotePoolAddressesParams } from './pool/operations/append-remote-pool-addresses.ts'
export type { RemoveRemotePoolAddressesParams } from './pool/operations/remove-remote-pool-addresses.ts'
export type { SetRateLimitAdminParams } from './pool/operations/set-rate-limit-admin.ts'
export type { SetFeeAdminParams } from './pool/operations/set-fee-admin.ts'
export type { SetAllowedFinalityConfigParams } from './pool/operations/set-allowed-finality-config.ts'
export type {
  ChainRateLimiterConfig,
  SetChainRateLimiterConfigParams,
} from './pool/operations/set-chain-rate-limiter-config.ts'
export type { SetTokenTransferFeeConfigParams } from './pool/operations/set-token-transfer-fee-config.ts'
export type { TransferOwnershipParams } from './pool/operations/transfer-ownership.ts'
export type { AcceptOwnershipParams } from './pool/operations/accept-ownership.ts'
export type {
  GrantMintBurnAccessParams,
  GrantMintBurnRole,
} from './token/operations/grant-mint-burn-access.ts'
export type {
  RevokeMintBurnAccessParams,
  RevokeMintBurnRole,
} from './token/operations/revoke-mint-burn-access.ts'
export type { DeployTokenParams, DeployTokenResult } from './token/operations/deploy-token.ts'
export type {
  DeployCrossChainPoolTokenParams,
  DeployCrossChainPoolTokenResult,
} from './token/operations/deploy-cross-chain-pool-token.ts'
export type { ProvideLiquidityParams } from './token-pool/operations/provide-liquidity.ts'
export type {
  DeployPoolParams,
  DeployPoolResult,
  EVMPoolType,
} from './token-pool/operations/deploy-pool.ts'
export type {
  DeployPoolViaFactoryParams,
  DeployPoolViaFactoryResult,
  FactoryPoolType,
} from './token-pool/operations/deploy-pool-via-factory.ts'
export type {
  DeployTokenAndPoolViaFactoryParams,
  DeployTokenAndPoolViaFactoryResult,
} from './token-pool/operations/deploy-token-and-pool-via-factory.ts'
export type { MintBurnRolesResult } from './token/get-mint-burn-roles.ts'
export type { TransactionHash } from '../operation.ts'
