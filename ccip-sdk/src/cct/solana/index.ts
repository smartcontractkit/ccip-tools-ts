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
import {
  type ExecuteCreateTokenAccountParams,
  type ExecuteCreateTokenAccountResult,
  type ExecuteDeployTokenParams,
  type ExecuteDeployTokenResult,
  type GenerateCreateTokenAccountParams,
  type GenerateCreateTokenAccountResult,
  type GenerateDeployTokenParams,
  type GenerateDeployTokenResult,
  CreateTokenAccount,
} from './token/operations/index.ts'
import {
  type ExecuteAppendToLookupTableParams,
  type ExecuteAppendToLookupTableResult,
  type ExecuteCreateLookupTableParams,
  type ExecuteCreateLookupTableResult,
  type ExecuteSetPoolParams,
  type ExecuteSetPoolResult,
  type GenerateAppendToLookupTableParams,
  type GenerateAppendToLookupTableResult,
  type GenerateCreateLookupTableParams,
  type GenerateCreateLookupTableResult,
  type GenerateSetPoolParams,
  type GenerateSetPoolResult,
  AppendToLookupTable,
  CreateLookupTable,
  SetPool,
} from './token-admin-registry/operations/index.ts'
import {
  type ExecuteCreateTokenMultisigParams,
  type ExecuteCreateTokenMultisigResult,
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type GenerateCreateTokenMultisigParams,
  type GenerateCreateTokenMultisigResult,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  CreateTokenMultisig,
  DeployTokenPool,
} from './token-pool/operations/index.ts'

/** CCT admin facade for Solana. */
export class SolanaTokenManager extends TokenManager<typeof ChainFamily.Solana> {
  readonly chain: SolanaChain
  // Token operations
  readonly #createTokenAccount = new CreateTokenAccount()

  // Token admin registry operations
  readonly #appendToLookupTable = new AppendToLookupTable()
  readonly #createLookupTable = new CreateLookupTable()
  readonly #setPool = new SetPool()

  // Token pool operations
  readonly #createTokenMultisig = new CreateTokenMultisig()
  readonly #deployTokenPool = new DeployTokenPool()

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
   * Builds unsigned Solana mint creation instructions, optionally with initial supply.
   *
   * The `payer` defaults as mint, freeze, and metadata update authority.
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
  async generateUnsignedDeployToken(
    opts: GenerateDeployTokenParams,
  ): Promise<GenerateDeployTokenResult> {
    const { DeployToken } = await import('./token/operations/index.ts')
    return new DeployToken().generate(this.chain, opts)
  }

  /**
   * Creates a Solana mint, optionally with initial supply.
   *
   * The wallet public key defaults as mint, freeze, and metadata update authority.
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
  async deployToken(opts: ExecuteDeployTokenParams): Promise<ExecuteDeployTokenResult> {
    const { DeployToken } = await import('./token/operations/index.ts')
    return new DeployToken().execute(this.chain, opts)
  }

  /**
   * Builds an unsigned idempotent associated token account create instruction.
   *
   * The owner may be a wallet or PDA. For pool reserve accounts, pass the pool signer PDA as
   * `ownerAddress`.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedCreateTokenAccount({
   *   payer,
   *   tokenAddress: mint,
   *   ownerAddress: owner,
   * })
   * ```
   */
  generateUnsignedCreateTokenAccount(
    opts: GenerateCreateTokenAccountParams,
  ): Promise<GenerateCreateTokenAccountResult> {
    return this.#createTokenAccount.generate(this.chain, opts)
  }

  /**
   * Creates an associated token account for a wallet or PDA owner.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.createTokenAccount({ wallet, tokenAddress: mint, ownerAddress: owner })
   * ```
   */
  createTokenAccount(
    opts: ExecuteCreateTokenAccountParams,
  ): Promise<ExecuteCreateTokenAccountResult> {
    return this.#createTokenAccount.execute(this.chain, opts)
  }

  /**
   * Builds unsigned SPL Token multisig creation instructions.
   * The default signers are pool signer PDA and mint authority.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedCreateTokenMultisig({
   *   payer,
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   threshold: 2,
   *   additionalSigners: [admin],
   * })
   * ```
   */
  generateUnsignedCreateTokenMultisig(
    opts: GenerateCreateTokenMultisigParams,
  ): Promise<GenerateCreateTokenMultisigResult> {
    return this.#createTokenMultisig.generate(this.chain, opts)
  }

  /**
   * Creates an SPL Token multisig account.
   * The default signers are pool signer PDA and mint authority.
   * Wallet pays fees and must match the mint authority.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const { hash, multisigAddress } = await cct.createTokenMultisig({
   *   wallet,
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   threshold: 2,
   * })
   * ```
   */
  createTokenMultisig(
    opts: ExecuteCreateTokenMultisigParams,
  ): Promise<ExecuteCreateTokenMultisigResult> {
    return this.#createTokenMultisig.execute(this.chain, opts)
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
   * @remarks
   * This only builds the pool `initialize` instruction. `authority` must be allowed to initialize
   * the pool. This does not create the pool signer PDA's associated token account.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedDeployTokenPool({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
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
   * @remarks
   * This only sends the pool `initialize` instruction. The signer must be allowed to initialize the
   * pool. This does not create the pool signer PDA's associated token account.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.deployTokenPool({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
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
export type * from './token/operations/index.ts'
export type * from './token-pool/operations/index.ts'
export type * from './token-admin-registry/operations/index.ts'
