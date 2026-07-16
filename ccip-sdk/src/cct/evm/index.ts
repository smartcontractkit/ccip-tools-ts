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
import type { DeployResult, TransactionResult } from '../operation.ts'
import { TokenManager } from '../token-manager.ts'
import { type DeployTokenParams, DeployToken } from './token/operations/deploy-token.ts'
import { type SetPoolParams, SetPool } from './token-admin-registry/operations/set-pool.ts'
import { type DeployPoolParams, DeployPool } from './token-pool/operations/deploy-pool.ts'
import {
  type TransferOwnershipParams,
  TransferOwnership,
} from './token-pool/operations/transfer-ownership.ts'

/** CCT admin operations for EVM chains, delegating each op to an operation class. */
export class EVMTokenManager extends TokenManager<typeof ChainFamily.EVM> {
  readonly chain: EVMChain
  readonly #setPool = new SetPool()
  readonly #transferOwnership = new TransferOwnership()
  readonly #deployToken = new DeployToken()
  readonly #deployPool = new DeployPool()

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
  setPool(opts: SetPoolParams & { wallet: unknown }): Promise<TransactionResult> {
    return this.#setPool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool `transferOwnership` tx (for multisig / offline signing).
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a recognised pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool version is unsupported
   */
  generateUnsignedTransferOwnership(opts: TransferOwnershipParams): Promise<UnsignedEVMTx> {
    return this.#transferOwnership.generate(this.chain, opts)
  }

  /**
   * Proposes a new pool owner (two-step), signing + submitting with `opts.wallet`.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a recognised pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool version is unsupported
   * @throws {@link CCTTxFailedError} if the tx reverts or fails
   */
  transferOwnership(
    opts: TransferOwnershipParams & { wallet: unknown },
  ): Promise<TransactionResult> {
    return this.#transferOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned pool deployment tx (for multisig / offline signing). `type` +
   * `version` (default `2.0.0`) select the pool contract. The deployed address is only known
   * once mined, so it is NOT returned here — use {@link deployPool} to receive `{ hash, address }`.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @example
   * ```typescript
   * const unsigned = await cct.generateUnsignedDeployPool({
   *   type: 'BurnMintTokenPool', // or 'LockReleaseTokenPool'
   *   token: '0xToken...',
   *   localTokenDecimals: 18,
   *   rmnProxy: '0xRmnProxy...',
   *   router: '0xRouter...',
   *   sender: '0xDeployer...',
   * })
   * ```
   */
  generateUnsignedDeployPool(opts: DeployPoolParams): Promise<UnsignedEVMTx> {
    return this.#deployPool.generate(this.chain, opts)
  }

  /**
   * Deploys a token pool, signing + submitting with `opts.wallet`; resolves to the tx hash
   * and the newly deployed pool address. `type` + `version` (default `2.0.0`) select the pool.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines without an address
   * @example
   * ```typescript
   * const { hash, address } = await cct.deployPool({
   *   type: 'LockReleaseTokenPool',
   *   token: '0xToken...',
   *   localTokenDecimals: 18,
   *   rmnProxy: '0xRmnProxy...',
   *   router: '0xRouter...',
   *   wallet,
   * })
   * ```
   */
  deployPool(opts: DeployPoolParams & { wallet: unknown }): Promise<DeployResult> {
    return this.#deployPool.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned token deployment tx (for multisig / offline signing). The `version`
   * selects the contract — `2.0.0` (default) deploys `CrossChainToken`, `1.5.1` deploys
   * `FactoryBurnMintERC20`. The deployed address is only known once mined, so it is NOT
   * returned here — use {@link deployToken} to deploy and receive `{ hash, address }`.
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
   * Deploys a token, signing + submitting with `opts.wallet`; resolves to the tx hash and
   * the newly deployed token address. The `version` selects the contract — `2.0.0` (default)
   * deploys `CrossChainToken`, `1.5.1`/`1.6.2` deploy `FactoryBurnMintERC20`.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   * @throws {@link CCTTxFailedError} if the tx reverts, fails, or mines without an address
   * @example
   * ```typescript
   * const { hash, address } = await cct.deployToken({
   *   version: '1.5.1', // omit for CrossChainToken v2.0.0
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 18,
   *   maxSupply: 0n,
   *   owner: '0xOwner...',
   *   wallet,
   * })
   * ```
   */
  deployToken(opts: DeployTokenParams & { wallet: unknown }): Promise<DeployResult> {
    return this.#deployToken.execute(this.chain, opts)
  }
}

export * from '../errors.ts'
export type { SetPoolParams } from './token-admin-registry/operations/set-pool.ts'
export type { DeployTokenParams } from './token/operations/deploy-token.ts'
export type { DeployPoolParams } from './token-pool/operations/deploy-pool.ts'
export type { DeployResult, TransactionResult } from '../operation.ts'
