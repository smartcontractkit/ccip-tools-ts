/**
 * Aptos Cross-Chain Token (CCT) admin operations.
 *
 * @packageDocumentation
 */

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosChain } from '../../aptos/index.ts'
import type { ChainContext } from '../../chain.ts'
import type { ChainFamily } from '../../networks.ts'
import { TokenManager } from '../token-manager.ts'
import {
  type ExecuteAcceptOwnershipParams,
  type ExecuteAcceptOwnershipResult,
  type ExecuteAppendRemotePoolAddressesParams,
  type ExecuteAppendRemotePoolAddressesResult,
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type ExecuteDeleteChainConfigParams,
  type ExecuteDeleteChainConfigResult,
  type ExecuteExecuteOwnershipTransferParams,
  type ExecuteExecuteOwnershipTransferResult,
  type ExecuteRemoveRemotePoolAddressesParams,
  type ExecuteRemoveRemotePoolAddressesResult,
  type ExecuteSetChainRateLimiterConfigParams,
  type ExecuteSetChainRateLimiterConfigResult,
  type ExecuteSetRateLimitAdminParams,
  type ExecuteSetRateLimitAdminResult,
  type ExecuteTransferOwnershipParams,
  type ExecuteTransferOwnershipResult,
  type GenerateAcceptOwnershipParams,
  type GenerateAcceptOwnershipResult,
  type GenerateAppendRemotePoolAddressesParams,
  type GenerateAppendRemotePoolAddressesResult,
  type GenerateApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesResult,
  type GenerateDeleteChainConfigParams,
  type GenerateDeleteChainConfigResult,
  type GenerateExecuteOwnershipTransferParams,
  type GenerateExecuteOwnershipTransferResult,
  type GenerateRemoveRemotePoolAddressesParams,
  type GenerateRemoveRemotePoolAddressesResult,
  type GenerateSetChainRateLimiterConfigParams,
  type GenerateSetChainRateLimiterConfigResult,
  type GenerateSetRateLimitAdminParams,
  type GenerateSetRateLimitAdminResult,
  type GenerateTransferOwnershipParams,
  type GenerateTransferOwnershipResult,
  AcceptOwnership,
  AppendRemotePoolAddresses,
  ApplyChainUpdates,
  DeleteChainConfig,
  ExecuteOwnershipTransfer,
  RemoveRemotePoolAddresses,
  SetChainRateLimiterConfig,
  SetRateLimitAdmin,
  TransferOwnership,
} from './pool/operations/index.ts'
import { type MintBurnRolesResult, getMintBurnRoles } from './token/get-mint-burn-roles.ts'
import {
  type ExecuteDeployTokenParams,
  type ExecuteDeployTokenResult,
  type ExecuteGrantMintBurnAccessParams,
  type ExecuteGrantMintBurnAccessResult,
  type ExecuteRevokeMintBurnAccessParams,
  type ExecuteRevokeMintBurnAccessResult,
  type GenerateDeployTokenParams,
  type GenerateDeployTokenResult,
  type GenerateGrantMintBurnAccessParams,
  type GenerateGrantMintBurnAccessResult,
  type GenerateRevokeMintBurnAccessParams,
  type GenerateRevokeMintBurnAccessResult,
  DeployToken,
  GrantMintBurnAccess,
  RevokeMintBurnAccess,
} from './token/operations/index.ts'
import {
  type ExecuteAcceptAdminRoleParams,
  type ExecuteAcceptAdminRoleResult,
  type ExecuteProposeAdminRoleParams,
  type ExecuteProposeAdminRoleResult,
  type ExecuteSetPoolParams,
  type ExecuteSetPoolResult,
  type ExecuteTransferAdminRoleParams,
  type ExecuteTransferAdminRoleResult,
  type GenerateAcceptAdminRoleParams,
  type GenerateAcceptAdminRoleResult,
  type GenerateProposeAdminRoleParams,
  type GenerateProposeAdminRoleResult,
  type GenerateSetPoolParams,
  type GenerateSetPoolResult,
  type GenerateTransferAdminRoleParams,
  type GenerateTransferAdminRoleResult,
  AcceptAdminRole,
  ProposeAdminRole,
  SetPool,
  TransferAdminRole,
} from './token-admin-registry/operations/index.ts'
import {
  type ExecuteDeployPoolParams,
  type ExecuteDeployPoolResult,
  type GenerateDeployPoolParams,
  type GenerateDeployPoolResult,
  DeployPool,
} from './token-pool/operations/index.ts'

/** CCT admin facade for Aptos. */
export class AptosTokenManager extends TokenManager<typeof ChainFamily.Aptos> {
  readonly chain: AptosChain
  readonly #proposeAdminRole = new ProposeAdminRole()
  readonly #acceptAdminRole = new AcceptAdminRole()
  readonly #transferAdminRole = new TransferAdminRole()
  readonly #setPool = new SetPool()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #appendRemotePoolAddresses = new AppendRemotePoolAddresses()
  readonly #removeRemotePoolAddresses = new RemoveRemotePoolAddresses()
  readonly #deleteChainConfig = new DeleteChainConfig()
  readonly #setChainRateLimiterConfig = new SetChainRateLimiterConfig()
  readonly #setRateLimitAdmin = new SetRateLimitAdmin()
  readonly #transferOwnership = new TransferOwnership()
  readonly #acceptOwnership = new AcceptOwnership()
  readonly #executeOwnershipTransfer = new ExecuteOwnershipTransfer()
  readonly #deployPool = new DeployPool()
  readonly #deployToken = new DeployToken()
  readonly #grantMintBurnAccess = new GrantMintBurnAccess()
  readonly #revokeMintBurnAccess = new RevokeMintBurnAccess()

  /** Creates an Aptos CCT manager for an existing chain. */
  constructor(chain: AptosChain) {
    super()
    this.chain = chain
  }

  /** Wraps an existing {@link AptosChain}. */
  static fromChain(chain: AptosChain): AptosTokenManager {
    return new AptosTokenManager(chain)
  }

  /** Creates from an Aptos SDK provider. */
  static async fromProvider(provider: Aptos, ctx?: ChainContext): Promise<AptosTokenManager> {
    return new AptosTokenManager(await AptosChain.fromProvider(provider, ctx))
  }

  /** Creates from an RPC URL. */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<AptosTokenManager> {
    return new AptosTokenManager(await AptosChain.fromUrl(url, ctx))
  }

  /** Provider of the underlying chain. */
  get provider(): Aptos {
    return this.chain.provider
  }

  /**
   * Builds an unsigned Aptos `deployToken` transaction (managed fungible asset).
   *
   * @example
   * ```ts
   * const cct = AptosTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedDeployToken({
   *   sender,
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 8,
   * })
   * ```
   */
  generateUnsignedDeployToken(opts: GenerateDeployTokenParams): Promise<GenerateDeployTokenResult> {
    return this.#deployToken.generate(this.chain, opts)
  }

  /**
   * Deploys an Aptos managed token; returns the transaction hash and token address.
   *
   * @example
   * ```ts
   * const cct = AptosTokenManager.fromChain(chain)
   * const { hash, tokenAddress } = await cct.deployToken({
   *   wallet,
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 8,
   * })
   * ```
   */
  deployToken(opts: ExecuteDeployTokenParams): Promise<ExecuteDeployTokenResult> {
    return this.#deployToken.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned Aptos `deployPool` transaction (token pool object).
   *
   * @example
   * ```ts
   * const cct = AptosTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedDeployPool({
   *   sender,
   *   tokenAddress,
   * })
   * ```
   */
  generateUnsignedDeployPool(opts: GenerateDeployPoolParams): Promise<GenerateDeployPoolResult> {
    return this.#deployPool.generate(this.chain, opts)
  }

  /**
   * Deploys an Aptos token pool; returns the transaction hash and pool address.
   *
   * @example
   * ```ts
   * const cct = AptosTokenManager.fromChain(chain)
   * const { hash, poolAddress } = await cct.deployPool({
   *   wallet,
   *   tokenAddress,
   * })
   * ```
   */
  deployPool(opts: ExecuteDeployPoolParams): Promise<ExecuteDeployPoolResult> {
    return this.#deployPool.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos `grantMintBurnAccess` transaction. */
  generateUnsignedGrantMintBurnAccess(
    opts: GenerateGrantMintBurnAccessParams,
  ): Promise<GenerateGrantMintBurnAccessResult> {
    return this.#grantMintBurnAccess.generate(this.chain, opts)
  }
  /** Grants mint/burn access on a token to an authority (Aptos). */
  grantMintBurnAccess(
    opts: ExecuteGrantMintBurnAccessParams,
  ): Promise<ExecuteGrantMintBurnAccessResult> {
    return this.#grantMintBurnAccess.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos `revokeMintBurnAccess` transaction. */
  generateUnsignedRevokeMintBurnAccess(
    opts: GenerateRevokeMintBurnAccessParams,
  ): Promise<GenerateRevokeMintBurnAccessResult> {
    return this.#revokeMintBurnAccess.generate(this.chain, opts)
  }
  /** Revokes mint/burn access on a token from an authority (Aptos). */
  revokeMintBurnAccess(
    opts: ExecuteRevokeMintBurnAccessParams,
  ): Promise<ExecuteRevokeMintBurnAccessResult> {
    return this.#revokeMintBurnAccess.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos `proposeAdminRole` transaction (owner proposes administrator). */
  generateUnsignedProposeAdminRole(
    opts: GenerateProposeAdminRoleParams,
  ): Promise<GenerateProposeAdminRoleResult> {
    return this.#proposeAdminRole.generate(this.chain, opts)
  }
  /** Proposes a token administrator in the TokenAdminRegistry. */
  proposeAdminRole(opts: ExecuteProposeAdminRoleParams): Promise<ExecuteProposeAdminRoleResult> {
    return this.#proposeAdminRole.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos `acceptAdminRole` transaction (wallet must be the pending admin). */
  generateUnsignedAcceptAdminRole(
    opts: GenerateAcceptAdminRoleParams,
  ): Promise<GenerateAcceptAdminRoleResult> {
    return this.#acceptAdminRole.generate(this.chain, opts)
  }
  /** Accepts a pending token administrator role. */
  acceptAdminRole(opts: ExecuteAcceptAdminRoleParams): Promise<ExecuteAcceptAdminRoleResult> {
    return this.#acceptAdminRole.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos `transferAdminRole` transaction (wallet must be the current admin). */
  generateUnsignedTransferAdminRole(
    opts: GenerateTransferAdminRoleParams,
  ): Promise<GenerateTransferAdminRoleResult> {
    return this.#transferAdminRole.generate(this.chain, opts)
  }
  /** Transfers the token administrator role to a new admin. */
  transferAdminRole(opts: ExecuteTransferAdminRoleParams): Promise<ExecuteTransferAdminRoleResult> {
    return this.#transferAdminRole.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos `setPool` transaction (registers a token pool). */
  generateUnsignedSetPool(opts: GenerateSetPoolParams): Promise<GenerateSetPoolResult> {
    return this.#setPool.generate(this.chain, opts)
  }
  /** Registers a token pool. The wallet must be the token admin. */
  setPool(opts: ExecuteSetPoolParams): Promise<ExecuteSetPoolResult> {
    return this.#setPool.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `applyChainUpdates` transaction (add/remove remote chains). */
  generateUnsignedApplyChainUpdates(
    opts: GenerateApplyChainUpdatesParams,
  ): Promise<GenerateApplyChainUpdatesResult> {
    return this.#applyChainUpdates.generate(this.chain, opts)
  }
  /** Applies remote-chain config updates to an Aptos token pool. */
  applyChainUpdates(opts: ExecuteApplyChainUpdatesParams): Promise<ExecuteApplyChainUpdatesResult> {
    return this.#applyChainUpdates.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `appendRemotePoolAddresses` transaction. */
  generateUnsignedAppendRemotePoolAddresses(
    opts: GenerateAppendRemotePoolAddressesParams,
  ): Promise<GenerateAppendRemotePoolAddressesResult> {
    return this.#appendRemotePoolAddresses.generate(this.chain, opts)
  }
  /** Appends remote pool addresses to a remote-chain config on an Aptos token pool. */
  appendRemotePoolAddresses(
    opts: ExecuteAppendRemotePoolAddressesParams,
  ): Promise<ExecuteAppendRemotePoolAddressesResult> {
    return this.#appendRemotePoolAddresses.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `removeRemotePoolAddresses` transaction. */
  generateUnsignedRemoveRemotePoolAddresses(
    opts: GenerateRemoveRemotePoolAddressesParams,
  ): Promise<GenerateRemoveRemotePoolAddressesResult> {
    return this.#removeRemotePoolAddresses.generate(this.chain, opts)
  }
  /** Removes remote pool addresses from a remote-chain config on an Aptos token pool. */
  removeRemotePoolAddresses(
    opts: ExecuteRemoveRemotePoolAddressesParams,
  ): Promise<ExecuteRemoveRemotePoolAddressesResult> {
    return this.#removeRemotePoolAddresses.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `deleteChainConfig` transaction. */
  generateUnsignedDeleteChainConfig(
    opts: GenerateDeleteChainConfigParams,
  ): Promise<GenerateDeleteChainConfigResult> {
    return this.#deleteChainConfig.generate(this.chain, opts)
  }
  /** Removes a remote-chain config from an Aptos token pool. */
  deleteChainConfig(opts: ExecuteDeleteChainConfigParams): Promise<ExecuteDeleteChainConfigResult> {
    return this.#deleteChainConfig.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `setChainRateLimiterConfig` transaction (per-chain rate limits). */
  generateUnsignedSetChainRateLimiterConfig(
    opts: GenerateSetChainRateLimiterConfigParams,
  ): Promise<GenerateSetChainRateLimiterConfigResult> {
    return this.#setChainRateLimiterConfig.generate(this.chain, opts)
  }
  /** Sets per-chain rate limiter config on an Aptos token pool. */
  setChainRateLimiterConfig(
    opts: ExecuteSetChainRateLimiterConfigParams,
  ): Promise<ExecuteSetChainRateLimiterConfigResult> {
    return this.#setChainRateLimiterConfig.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `setRateLimitAdmin` transaction (unsupported on Aptos — rejects). */
  generateUnsignedSetRateLimitAdmin(
    opts: GenerateSetRateLimitAdminParams,
  ): Promise<GenerateSetRateLimitAdminResult> {
    return this.#setRateLimitAdmin.generate(this.chain, opts)
  }
  /** Sets the rate-limit admin — unsupported on Aptos (owner-managed); always rejects. */
  setRateLimitAdmin(opts: ExecuteSetRateLimitAdminParams): Promise<ExecuteSetRateLimitAdminResult> {
    return this.#setRateLimitAdmin.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `transferOwnership` transaction (propose new owner). */
  generateUnsignedTransferOwnership(
    opts: GenerateTransferOwnershipParams,
  ): Promise<GenerateTransferOwnershipResult> {
    return this.#transferOwnership.generate(this.chain, opts)
  }
  /** Proposes a new owner for an Aptos token pool. */
  transferOwnership(opts: ExecuteTransferOwnershipParams): Promise<ExecuteTransferOwnershipResult> {
    return this.#transferOwnership.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `acceptOwnership` transaction. */
  generateUnsignedAcceptOwnership(
    opts: GenerateAcceptOwnershipParams,
  ): Promise<GenerateAcceptOwnershipResult> {
    return this.#acceptOwnership.generate(this.chain, opts)
  }
  /** Accepts proposed ownership of an Aptos token pool. */
  acceptOwnership(opts: ExecuteAcceptOwnershipParams): Promise<ExecuteAcceptOwnershipResult> {
    return this.#acceptOwnership.execute(this.chain, opts)
  }

  /** Builds an unsigned Aptos pool `executeOwnershipTransfer` transaction (finalize transfer). */
  generateUnsignedExecuteOwnershipTransfer(
    opts: GenerateExecuteOwnershipTransferParams,
  ): Promise<GenerateExecuteOwnershipTransferResult> {
    return this.#executeOwnershipTransfer.generate(this.chain, opts)
  }
  /** Finalizes an ownership transfer on an Aptos token pool. */
  executeOwnershipTransfer(
    opts: ExecuteExecuteOwnershipTransferParams,
  ): Promise<ExecuteExecuteOwnershipTransferResult> {
    return this.#executeOwnershipTransfer.execute(this.chain, opts)
  }

  /** Reads a token's current mint/burn roles, read-only. */
  getMintBurnRoles(tokenAddress: string): Promise<MintBurnRolesResult> {
    return getMintBurnRoles(this.chain, tokenAddress)
  }
}

export * from '../errors.ts'
export type { TransactionHash } from '../operation.ts'
export type { MintBurnRolesResult } from './token/get-mint-burn-roles.ts'
export type * from './pool/operations/index.ts'
export type * from './token/operations/index.ts'
export type * from './token-pool/operations/index.ts'
export type * from './token-admin-registry/operations/index.ts'
