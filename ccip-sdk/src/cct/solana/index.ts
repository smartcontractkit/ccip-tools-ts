/**
 * Solana Cross-Chain Token (CCT) admin operations.
 *
 * @packageDocumentation
 */

import type { Connection } from '@solana/web3.js'

import type { ChainContext } from '../../chain.ts'
import type { ChainFamily } from '../../networks.ts'
import { SolanaChain } from '../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'
import { TokenManager } from '../token-manager.ts'
import { type SerializedSolanaTxEncoding, serializeUnsignedSolanaTx } from './serialize.ts'
import { type MintBurnRolesResult, getMintBurnRoles } from './token/get-mint-burn-roles.ts'
import {
  type ExecuteDeployTokenParams,
  type ExecuteDeployTokenResult,
  type GenerateDeployTokenParams,
  type GenerateDeployTokenResult,
  type ExecuteCreatePoolMintAuthorityMultisigParams,
  type ExecuteCreatePoolMintAuthorityMultisigResult,
  type ExecuteCreatePoolTokenAccountParams,
  type ExecuteCreatePoolTokenAccountResult,
  type ExecuteGrantMintBurnAccessParams,
  type ExecuteGrantMintBurnAccessResult,
  type ExecuteRevokeMintBurnAccessParams,
  type ExecuteRevokeMintBurnAccessResult,
  type ExecuteTransferMintAuthorityParams,
  type ExecuteTransferMintAuthorityResult,
  type GenerateCreatePoolMintAuthorityMultisigParams,
  type GenerateCreatePoolMintAuthorityMultisigResult,
  type GenerateCreatePoolTokenAccountParams,
  type GenerateCreatePoolTokenAccountResult,
  type GenerateGrantMintBurnAccessParams,
  type GenerateGrantMintBurnAccessResult,
  type GenerateRevokeMintBurnAccessParams,
  type GenerateRevokeMintBurnAccessResult,
  type GenerateTransferMintAuthorityParams,
  type GenerateTransferMintAuthorityResult,
  CreatePoolMintAuthorityMultisig,
  CreatePoolTokenAccount,
  DeployToken,
  GrantMintBurnAccess,
  RevokeMintBurnAccess,
  TransferMintAuthority,
} from './token/operations/index.ts'
import {
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type ExecuteAppendRemotePoolAddressesParams,
  type ExecuteAppendRemotePoolAddressesResult,
  type ExecuteDeleteChainConfigParams,
  type ExecuteDeleteChainConfigResult,
  type ExecuteRemoveRemotePoolAddressesParams,
  type ExecuteRemoveRemotePoolAddressesResult,
  type GenerateApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesResult,
  type GenerateAppendRemotePoolAddressesParams,
  type GenerateAppendRemotePoolAddressesResult,
  type GenerateDeleteChainConfigParams,
  type GenerateDeleteChainConfigResult,
  type GenerateRemoveRemotePoolAddressesParams,
  type GenerateRemoveRemotePoolAddressesResult,
  type ExecuteAcceptOwnershipParams,
  type ExecuteAcceptOwnershipResult,
  type ExecuteSetChainRateLimiterConfigParams,
  type ExecuteSetChainRateLimiterConfigResult,
  type ExecuteSetRateLimitAdminParams,
  type ExecuteSetRateLimitAdminResult,
  type ExecuteTransferOwnershipParams,
  type ExecuteTransferOwnershipResult,
  type GenerateAcceptOwnershipParams,
  type GenerateAcceptOwnershipResult,
  type GenerateSetChainRateLimiterConfigParams,
  type GenerateSetChainRateLimiterConfigResult,
  type GenerateSetRateLimitAdminParams,
  type GenerateSetRateLimitAdminResult,
  type GenerateTransferOwnershipParams,
  type GenerateTransferOwnershipResult,
  AcceptOwnership,
  ApplyChainUpdates,
  AppendRemotePoolAddresses,
  DeleteChainConfig,
  RemoveRemotePoolAddresses,
  SetChainRateLimiterConfig,
  SetRateLimitAdmin,
  TransferOwnership,
} from './pool/operations/index.ts'
import {
  type ExecuteAcceptAdminRoleParams,
  type ExecuteAcceptAdminRoleResult,
  type ExecuteAppendToLookupTableParams,
  type ExecuteAppendToLookupTableResult,
  type ExecuteCreateLookupTableParams,
  type ExecuteCreateLookupTableResult,
  type ExecuteProposeAdminRoleParams,
  type ExecuteProposeAdminRoleResult,
  type ExecuteSetPoolParams,
  type ExecuteSetPoolResult,
  type ExecuteTransferAdminRoleParams,
  type ExecuteTransferAdminRoleResult,
  type GenerateAcceptAdminRoleParams,
  type GenerateAcceptAdminRoleResult,
  type GenerateAppendToLookupTableParams,
  type GenerateAppendToLookupTableResult,
  type GenerateCreateLookupTableParams,
  type GenerateCreateLookupTableResult,
  type GenerateProposeAdminRoleParams,
  type GenerateProposeAdminRoleResult,
  type GenerateSetPoolParams,
  type GenerateSetPoolResult,
  type GenerateTransferAdminRoleParams,
  type GenerateTransferAdminRoleResult,
  AcceptAdminRole,
  AppendToLookupTable,
  CreateLookupTable,
  ProposeAdminRole,
  SetPool,
  TransferAdminRole,
} from './token-admin-registry/operations/index.ts'
import {
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  DeployTokenPool,
} from './token-pool/operations/index.ts'

/** CCT admin facade for Solana. */
export class SolanaTokenManager extends TokenManager<typeof ChainFamily.Solana> {
  readonly chain: SolanaChain
  readonly #appendToLookupTable = new AppendToLookupTable()
  readonly #createLookupTable = new CreateLookupTable()
  readonly #deployToken = new DeployToken()
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #setPool = new SetPool()
  readonly #proposeAdminRole = new ProposeAdminRole()
  readonly #acceptAdminRole = new AcceptAdminRole()
  readonly #transferAdminRole = new TransferAdminRole()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #deleteChainConfig = new DeleteChainConfig()
  readonly #appendRemotePoolAddresses = new AppendRemotePoolAddresses()
  readonly #removeRemotePoolAddresses = new RemoveRemotePoolAddresses()
  readonly #setChainRateLimiterConfig = new SetChainRateLimiterConfig()
  readonly #setRateLimitAdmin = new SetRateLimitAdmin()
  readonly #transferOwnership = new TransferOwnership()
  readonly #acceptOwnership = new AcceptOwnership()
  readonly #transferMintAuthority = new TransferMintAuthority()
  readonly #grantMintBurnAccess = new GrantMintBurnAccess()
  readonly #revokeMintBurnAccess = new RevokeMintBurnAccess()
  readonly #createPoolMintAuthorityMultisig = new CreatePoolMintAuthorityMultisig()
  readonly #createPoolTokenAccount = new CreatePoolTokenAccount()

  /** Creates a Solana CCT manager for an existing chain. */
  constructor(chain: SolanaChain) {
    super()
    this.chain = chain
  }

  /** Wraps an existing {@link SolanaChain}. */
  static fromChain(chain: SolanaChain): SolanaTokenManager {
    return new SolanaTokenManager(chain)
  }

  /** Creates from a Solana web3.js connection. */
  static async fromProvider(provider: Connection, ctx?: ChainContext): Promise<SolanaTokenManager> {
    return new SolanaTokenManager(await SolanaChain.fromConnection(provider, ctx))
  }

  /** Creates from an RPC URL. */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<SolanaTokenManager> {
    return new SolanaTokenManager(await SolanaChain.fromUrl(url, ctx))
  }

  /** Provider of the underlying chain. */
  get provider(): Connection {
    return this.chain.connection
  }

  /**
   * Builds unsigned Solana mint creation instructions. Does not mint supply.
   *
   * The `payer` is also the mint, freeze, and metadata update authority.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedDeployToken({
   *   payer,
   *   decimals: 9,
   *   tokenProgram: 'spl-token',
   *   withMetaplex: true,
   *   name: 'My Token',
   *   symbol: 'MTK',
   * })
   * ```
   */
  generateUnsignedDeployToken(opts: GenerateDeployTokenParams): Promise<GenerateDeployTokenResult> {
    return this.#deployToken.generate(this.chain, opts)
  }

  /**
   * Creates a Solana mint. Does not mint supply.
   *
   * The wallet public key is also the mint, freeze, and metadata update authority.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.deployToken({
   *   wallet,
   *   decimals: 9,
   *   tokenProgram: 'spl-token',
   *   withMetaplex: false,
   * })
   * ```
   */
  deployToken(opts: ExecuteDeployTokenParams): Promise<ExecuteDeployTokenResult> {
    return this.#deployToken.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana pool lookup table instructions.
   *
   * Defaults to create+extend. Use `mode: 'createEmpty'` to create an empty ALT, e.g. with an
   * EOA payer and vault authority, then populate it later through the authority. If `authority`
   * is omitted, it defaults to `payer`.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedCreateLookupTable({
   *   mode: 'createEmpty',
   *   payer: eoa,
   *   authority: squadsVault,
   * })
   * ```
   */
  generateUnsignedCreateLookupTable(
    opts: GenerateCreateLookupTableParams,
  ): Promise<GenerateCreateLookupTableResult> {
    return this.#createLookupTable.generate(this.chain, opts)
  }

  /**
   * Creates a Solana pool lookup table. Defaults to create+extend; pass `mode: 'createEmpty'` to
   * create an empty ALT owned by `authority` and paid by `wallet`. If `authority` is omitted, it
   * defaults to the wallet public key.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const { hash, lookupTableAddress } = await cct.createLookupTable({
   *   mode: 'createEmpty',
   *   authority: squadsVault,
   *   wallet,
   * })
   * ```
   */
  createLookupTable(opts: ExecuteCreateLookupTableParams): Promise<ExecuteCreateLookupTableResult> {
    return this.#createLookupTable.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana token pool initialize instructions.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedDeployTokenPool({
   *   tokenAddress: mint,
   *   poolProgramAddress: poolProgram,
   *   payer,
   *   authority,
   *   allowlist: [allowedSender],
   * })
   * ```
   */
  generateUnsignedDeployTokenPool(
    opts: GenerateDeployTokenPoolParams,
  ): Promise<GenerateDeployTokenPoolResult> {
    return this.#deployTokenPool.generate(this.chain, opts)
  }

  /**
   * Initializes a Solana token pool.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.deployTokenPool({
   *   tokenAddress: mint,
   *   poolProgramAddress: poolProgram,
   *   wallet,
   * })
   * ```
   */
  deployTokenPool(opts: ExecuteDeployTokenPoolParams): Promise<ExecuteDeployTokenPoolResult> {
    return this.#deployTokenPool.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana lookup table extend instructions.
   *
   * Pass `tokenAddress` and `poolProgramAddress` to append the standard CCIP pool addresses;
   * pass `additionalAddresses` to append manual addresses. `authority` defaults to `payer`.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedAppendToLookupTable({
   *   lookupTableAddress,
   *   payer: squadsVault,
   *   authority: squadsVault,
   *   tokenAddress: mint,
   *   poolProgramAddress: poolProgram,
   *   additionalAddresses: [extraAccount],
   * })
   * ```
   */
  generateUnsignedAppendToLookupTable(
    opts: GenerateAppendToLookupTableParams,
  ): Promise<GenerateAppendToLookupTableResult> {
    return this.#appendToLookupTable.generate(this.chain, opts)
  }

  /**
   * Extends a Solana lookup table.
   *
   * Pass `tokenAddress` and `poolProgramAddress` to append the standard CCIP pool addresses;
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.appendToLookupTable({
   *   lookupTableAddress,
   *   wallet,
   *   tokenAddress: mint,
   *   poolProgramAddress: poolProgram,
   *   additionalAddresses: [extraAccount],
   * })
   * ```
   */
  appendToLookupTable(
    opts: ExecuteAppendToLookupTableParams,
  ): Promise<ExecuteAppendToLookupTableResult> {
    return this.#appendToLookupTable.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana `setPool` instructions.
   *
   * The `payer` pays transaction fees. `authority` defaults to `payer`; Squads/multisig flows
   * should pass the token admin/vault authority explicitly.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetPool({
   *   tokenAddress: mint,
   *   address: router,
   *   poolLookupTableAddress: lookupTable,
   *   payer: squadsVault,
   *   authority: tokenAdmin,
   * })
   * ```
   */
  generateUnsignedSetPool(opts: GenerateSetPoolParams): Promise<GenerateSetPoolResult> {
    return this.#setPool.generate(this.chain, opts)
  }

  /**
   * Registers a token pool. The wallet must be the token admin authority.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setPool({
   *   tokenAddress: mint,
   *   address: router,
   *   poolLookupTableAddress: lookupTable,
   *   wallet,
   * })
   * ```
   */
  setPool(opts: ExecuteSetPoolParams): Promise<ExecuteSetPoolResult> {
    return this.#setPool.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `proposeAdminRole` (ownerProposeAdministrator) instructions. */
  generateUnsignedProposeAdminRole(
    opts: GenerateProposeAdminRoleParams,
  ): Promise<GenerateProposeAdminRoleResult> {
    return this.#proposeAdminRole.generate(this.chain, opts)
  }
  /** Proposes a token administrator in the Router TokenAdminRegistry. */
  proposeAdminRole(opts: ExecuteProposeAdminRoleParams): Promise<ExecuteProposeAdminRoleResult> {
    return this.#proposeAdminRole.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `acceptAdminRole` instructions (wallet must be the pending admin). */
  generateUnsignedAcceptAdminRole(
    opts: GenerateAcceptAdminRoleParams,
  ): Promise<GenerateAcceptAdminRoleResult> {
    return this.#acceptAdminRole.generate(this.chain, opts)
  }
  /** Accepts a pending token administrator role. */
  acceptAdminRole(opts: ExecuteAcceptAdminRoleParams): Promise<ExecuteAcceptAdminRoleResult> {
    return this.#acceptAdminRole.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `transferAdminRole` instructions (wallet must be the current admin). */
  generateUnsignedTransferAdminRole(
    opts: GenerateTransferAdminRoleParams,
  ): Promise<GenerateTransferAdminRoleResult> {
    return this.#transferAdminRole.generate(this.chain, opts)
  }
  /** Transfers the token administrator role to a new admin. */
  transferAdminRole(opts: ExecuteTransferAdminRoleParams): Promise<ExecuteTransferAdminRoleResult> {
    return this.#transferAdminRole.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `applyChainUpdates` instructions (add/remove remote chains). */
  generateUnsignedApplyChainUpdates(
    opts: GenerateApplyChainUpdatesParams,
  ): Promise<GenerateApplyChainUpdatesResult> {
    return this.#applyChainUpdates.generate(this.chain, opts)
  }
  /** Applies remote-chain config updates to a Solana token pool. */
  applyChainUpdates(opts: ExecuteApplyChainUpdatesParams): Promise<ExecuteApplyChainUpdatesResult> {
    return this.#applyChainUpdates.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `deleteChainConfig` instructions. */
  generateUnsignedDeleteChainConfig(
    opts: GenerateDeleteChainConfigParams,
  ): Promise<GenerateDeleteChainConfigResult> {
    return this.#deleteChainConfig.generate(this.chain, opts)
  }
  /** Removes a remote-chain config from a Solana token pool. */
  deleteChainConfig(opts: ExecuteDeleteChainConfigParams): Promise<ExecuteDeleteChainConfigResult> {
    return this.#deleteChainConfig.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `appendRemotePoolAddresses` instructions. */
  generateUnsignedAppendRemotePoolAddresses(
    opts: GenerateAppendRemotePoolAddressesParams,
  ): Promise<GenerateAppendRemotePoolAddressesResult> {
    return this.#appendRemotePoolAddresses.generate(this.chain, opts)
  }
  /** Appends remote pool addresses to a remote-chain config on a Solana token pool. */
  appendRemotePoolAddresses(
    opts: ExecuteAppendRemotePoolAddressesParams,
  ): Promise<ExecuteAppendRemotePoolAddressesResult> {
    return this.#appendRemotePoolAddresses.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `removeRemotePoolAddresses` instructions. */
  generateUnsignedRemoveRemotePoolAddresses(
    opts: GenerateRemoveRemotePoolAddressesParams,
  ): Promise<GenerateRemoveRemotePoolAddressesResult> {
    return this.#removeRemotePoolAddresses.generate(this.chain, opts)
  }
  /** Removes remote pool addresses from a remote-chain config on a Solana token pool. */
  removeRemotePoolAddresses(
    opts: ExecuteRemoveRemotePoolAddressesParams,
  ): Promise<ExecuteRemoveRemotePoolAddressesResult> {
    return this.#removeRemotePoolAddresses.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `setChainRateLimiterConfig` instructions (per-chain rate limits). */
  generateUnsignedSetChainRateLimiterConfig(
    opts: GenerateSetChainRateLimiterConfigParams,
  ): Promise<GenerateSetChainRateLimiterConfigResult> {
    return this.#setChainRateLimiterConfig.generate(this.chain, opts)
  }
  /** Sets per-chain rate limiter config on a Solana token pool. */
  setChainRateLimiterConfig(
    opts: ExecuteSetChainRateLimiterConfigParams,
  ): Promise<ExecuteSetChainRateLimiterConfigResult> {
    return this.#setChainRateLimiterConfig.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `setRateLimitAdmin` instructions. */
  generateUnsignedSetRateLimitAdmin(
    opts: GenerateSetRateLimitAdminParams,
  ): Promise<GenerateSetRateLimitAdminResult> {
    return this.#setRateLimitAdmin.generate(this.chain, opts)
  }
  /** Sets the rate-limit admin on a Solana token pool. */
  setRateLimitAdmin(opts: ExecuteSetRateLimitAdminParams): Promise<ExecuteSetRateLimitAdminResult> {
    return this.#setRateLimitAdmin.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `transferOwnership` instructions (propose new owner). */
  generateUnsignedTransferOwnership(
    opts: GenerateTransferOwnershipParams,
  ): Promise<GenerateTransferOwnershipResult> {
    return this.#transferOwnership.generate(this.chain, opts)
  }
  /** Proposes a new owner for a Solana token pool. */
  transferOwnership(opts: ExecuteTransferOwnershipParams): Promise<ExecuteTransferOwnershipResult> {
    return this.#transferOwnership.execute(this.chain, opts)
  }

  /** Builds unsigned Solana pool `acceptOwnership` instructions. */
  generateUnsignedAcceptOwnership(
    opts: GenerateAcceptOwnershipParams,
  ): Promise<GenerateAcceptOwnershipResult> {
    return this.#acceptOwnership.generate(this.chain, opts)
  }
  /** Accepts proposed ownership of a Solana token pool. */
  acceptOwnership(opts: ExecuteAcceptOwnershipParams): Promise<ExecuteAcceptOwnershipResult> {
    return this.#acceptOwnership.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `transferMintAuthority` instructions (SPL setAuthority MintTokens). */
  generateUnsignedTransferMintAuthority(
    opts: GenerateTransferMintAuthorityParams,
  ): Promise<GenerateTransferMintAuthorityResult> {
    return this.#transferMintAuthority.generate(this.chain, opts)
  }
  /** Transfers the SPL mint authority of a token to a new authority. */
  transferMintAuthority(
    opts: ExecuteTransferMintAuthorityParams,
  ): Promise<ExecuteTransferMintAuthorityResult> {
    return this.#transferMintAuthority.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `grantMintBurnAccess` instructions (grants the mint authority). */
  generateUnsignedGrantMintBurnAccess(
    opts: GenerateGrantMintBurnAccessParams,
  ): Promise<GenerateGrantMintBurnAccessResult> {
    return this.#grantMintBurnAccess.generate(this.chain, opts)
  }
  /** Grants mint/burn access on a token to an authority (Solana). */
  grantMintBurnAccess(
    opts: ExecuteGrantMintBurnAccessParams,
  ): Promise<ExecuteGrantMintBurnAccessResult> {
    return this.#grantMintBurnAccess.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `revokeMintBurnAccess` (unsupported on Solana — always rejects). */
  generateUnsignedRevokeMintBurnAccess(
    opts: GenerateRevokeMintBurnAccessParams,
  ): Promise<GenerateRevokeMintBurnAccessResult> {
    return this.#revokeMintBurnAccess.generate(this.chain, opts)
  }
  /** Revoke mint/burn access — unsupported on Solana; always rejects. */
  revokeMintBurnAccess(
    opts: ExecuteRevokeMintBurnAccessParams,
  ): Promise<ExecuteRevokeMintBurnAccessResult> {
    return this.#revokeMintBurnAccess.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `createPoolMintAuthorityMultisig` instructions. */
  generateUnsignedCreatePoolMintAuthorityMultisig(
    opts: GenerateCreatePoolMintAuthorityMultisigParams,
  ): Promise<GenerateCreatePoolMintAuthorityMultisigResult> {
    return this.#createPoolMintAuthorityMultisig.generate(this.chain, opts)
  }
  /** Creates an SPL multisig as a pool's mint authority; returns the multisig address. */
  createPoolMintAuthorityMultisig(
    opts: ExecuteCreatePoolMintAuthorityMultisigParams,
  ): Promise<ExecuteCreatePoolMintAuthorityMultisigResult> {
    return this.#createPoolMintAuthorityMultisig.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `createPoolTokenAccount` instructions (pool signer PDA's ATA). */
  generateUnsignedCreatePoolTokenAccount(
    opts: GenerateCreatePoolTokenAccountParams,
  ): Promise<GenerateCreatePoolTokenAccountResult> {
    return this.#createPoolTokenAccount.generate(this.chain, opts)
  }
  /** Creates the pool's associated token account; returns its address. */
  createPoolTokenAccount(
    opts: ExecuteCreatePoolTokenAccountParams,
  ): Promise<ExecuteCreatePoolTokenAccountResult> {
    return this.#createPoolTokenAccount.execute(this.chain, opts)
  }

  /** Reads a mint's current mint authority (and multisig detail), read-only. */
  getMintBurnRoles(tokenAddress: string): Promise<MintBurnRolesResult> {
    return getMintBurnRoles(this.chain, tokenAddress)
  }

  /**
   * Serializes an unsigned Solana CCT tx for external signing.
   *
   * @example
   * ```ts
   * const unsigned = await cct.generateUnsignedSetPool({ ...params, payer })
   * const base58 = await cct.serializeUnsignedTx(unsigned, payer)
   * const base64 = await cct.serializeUnsignedTx(unsigned, payer, 'base64')
   * ```
   */
  serializeUnsignedTx(
    unsigned: Pick<UnsignedSolanaTx, 'instructions' | 'lookupTables'>,
    payer: string,
    encoding?: SerializedSolanaTxEncoding,
  ): Promise<string> {
    return serializeUnsignedSolanaTx(this.provider, unsigned, payer, encoding)
  }
}

export * from '../errors.ts'
export type { TransactionHash } from '../operation.ts'
export type { SerializedSolanaTxEncoding } from './serialize.ts'
export type { MintBurnRolesResult } from './token/get-mint-burn-roles.ts'
export type * from './pool/operations/index.ts'
export type * from './token/operations/index.ts'
export type * from './token-pool/operations/index.ts'
export type * from './token-admin-registry/operations/index.ts'
