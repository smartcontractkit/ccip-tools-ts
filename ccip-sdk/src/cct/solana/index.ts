/**
 * Solana Cross-Chain Token (CCT) admin operations.
 *
 * @packageDocumentation
 */

import type { Connection } from '@solana/web3.js'

import type { ChainContext } from '../../chain.ts'
import type { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'
import { TokenManager } from '../token-manager.ts'
import { type SerializedSolanaTxEncoding, serializeUnsignedSolanaTx } from './serialize.ts'
import {
  type ExecuteApproveTokenParams,
  type ExecuteApproveTokenResult,
  type ExecuteCreateTokenAccountParams,
  type ExecuteCreateTokenAccountResult,
  type ExecuteDeployTokenParams,
  type ExecuteDeployTokenResult,
  type ExecuteMintTokensParams,
  type ExecuteMintTokensResult,
  type ExecuteSetTokenAuthorityParams,
  type ExecuteSetTokenAuthorityResult,
  type GenerateApproveTokenParams,
  type GenerateApproveTokenResult,
  type GenerateCreateTokenAccountParams,
  type GenerateCreateTokenAccountResult,
  type GenerateDeployTokenParams,
  type GenerateDeployTokenResult,
  type GenerateMintTokensParams,
  type GenerateMintTokensResult,
  type GenerateSetTokenAuthorityParams,
  type GenerateSetTokenAuthorityResult,
  ApproveToken,
  CreateTokenAccount,
  MintTokens,
  SetTokenAuthority,
} from './token/operations/index.ts'
import {
  type ExecuteAcceptAdminParams,
  type ExecuteAcceptAdminResult,
  type ExecuteAppendToLookupTableParams,
  type ExecuteAppendToLookupTableResult,
  type ExecuteCreateLookupTableParams,
  type ExecuteCreateLookupTableResult,
  type ExecuteRegisterAdminParams,
  type ExecuteRegisterAdminResult,
  type ExecuteSetPoolParams,
  type ExecuteSetPoolResult,
  type ExecuteTransferAdminParams,
  type ExecuteTransferAdminResult,
  type GenerateAcceptAdminParams,
  type GenerateAcceptAdminResult,
  type GenerateAppendToLookupTableParams,
  type GenerateAppendToLookupTableResult,
  type GenerateCreateLookupTableParams,
  type GenerateCreateLookupTableResult,
  type GenerateRegisterAdminParams,
  type GenerateRegisterAdminResult,
  type GenerateSetPoolParams,
  type GenerateSetPoolResult,
  type GenerateTransferAdminParams,
  type GenerateTransferAdminResult,
  type GetSupportedTokensParams,
  type GetTokenAdminRegistryParams,
  type GetTokenAdminRegistryResult,
  AcceptAdmin,
  AppendToLookupTable,
  CreateLookupTable,
  GetSupportedTokens,
  GetTokenAdminRegistry,
  RegisterAdmin,
  SetPool,
  TransferAdmin,
} from './token-admin-registry/operations/index.ts'
import {
  type BaseGetTokenPoolStateResult,
  type BurnMintPoolProgramRef,
  type CustomPoolProgramRef,
  type ExecuteAcceptOwnershipParams,
  type ExecuteAcceptOwnershipResult,
  type ExecuteAppendRemotePoolAddressesParams,
  type ExecuteAppendRemotePoolAddressesResult,
  type ExecuteApplyChainUpdatesParams,
  type ExecuteApplyChainUpdatesResult,
  type ExecuteConfigureAllowlistParams,
  type ExecuteConfigureAllowlistResult,
  type ExecuteCreateTokenMultisigParams,
  type ExecuteCreateTokenMultisigResult,
  type ExecuteDeleteChainRemoteConfigParams,
  type ExecuteDeleteChainRemoteConfigResult,
  type ExecuteDeployTokenPoolParams,
  type ExecuteDeployTokenPoolResult,
  type ExecuteEditChainRemoteConfigParams,
  type ExecuteEditChainRemoteConfigResult,
  type ExecuteInitChainRemoteConfigParams,
  type ExecuteInitChainRemoteConfigResult,
  type ExecuteProvideLiquidityParams,
  type ExecuteProvideLiquidityResult,
  type ExecuteRemoveFromAllowlistParams,
  type ExecuteRemoveFromAllowlistResult,
  type ExecuteSetCanAcceptLiquidityParams,
  type ExecuteSetCanAcceptLiquidityResult,
  type ExecuteSetChainRateLimitParams,
  type ExecuteSetChainRateLimitResult,
  type ExecuteSetRateLimitAdminParams,
  type ExecuteSetRateLimitAdminResult,
  type ExecuteSetRebalancerParams,
  type ExecuteSetRebalancerResult,
  type ExecuteTransferOwnershipParams,
  type ExecuteTransferOwnershipResult,
  type ExecuteWithdrawLiquidityParams,
  type ExecuteWithdrawLiquidityResult,
  type GenerateAcceptOwnershipParams,
  type GenerateAcceptOwnershipResult,
  type GenerateAppendRemotePoolAddressesParams,
  type GenerateAppendRemotePoolAddressesResult,
  type GenerateApplyChainUpdatesParams,
  type GenerateApplyChainUpdatesResult,
  type GenerateConfigureAllowlistParams,
  type GenerateConfigureAllowlistResult,
  type GenerateCreateTokenMultisigParams,
  type GenerateCreateTokenMultisigResult,
  type GenerateDeleteChainRemoteConfigParams,
  type GenerateDeleteChainRemoteConfigResult,
  type GenerateDeployTokenPoolParams,
  type GenerateDeployTokenPoolResult,
  type GenerateEditChainRemoteConfigParams,
  type GenerateEditChainRemoteConfigResult,
  type GenerateInitChainRemoteConfigParams,
  type GenerateInitChainRemoteConfigResult,
  type GenerateProvideLiquidityParams,
  type GenerateProvideLiquidityResult,
  type GenerateRemoveFromAllowlistParams,
  type GenerateRemoveFromAllowlistResult,
  type GenerateSetCanAcceptLiquidityParams,
  type GenerateSetCanAcceptLiquidityResult,
  type GenerateSetChainRateLimitParams,
  type GenerateSetChainRateLimitResult,
  type GenerateSetRateLimitAdminParams,
  type GenerateSetRateLimitAdminResult,
  type GenerateSetRebalancerParams,
  type GenerateSetRebalancerResult,
  type GenerateTransferOwnershipParams,
  type GenerateTransferOwnershipResult,
  type GenerateWithdrawLiquidityParams,
  type GenerateWithdrawLiquidityResult,
  type GetTokenPoolRemotesParams,
  type GetTokenPoolRemotesResult,
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  type LockReleaseGetTokenPoolStateResult,
  type LockReleasePoolProgramRef,
  AcceptOwnership,
  AppendRemotePoolAddresses,
  ApplyChainUpdates,
  ConfigureAllowlist,
  CreateTokenMultisig,
  DeleteChainRemoteConfig,
  DeployTokenPool,
  EditChainRemoteConfig,
  GetTokenPoolRemotes,
  GetTokenPoolState,
  InitChainRemoteConfig,
  ProvideLiquidity,
  RemoveFromAllowlist,
  SetCanAcceptLiquidity,
  SetChainRateLimit,
  SetRateLimitAdmin,
  SetRebalancer,
  TransferOwnership,
  WithdrawLiquidity,
} from './token-pool/operations/index.ts'

/** CCT admin facade for Solana. */
export class SolanaTokenManager extends TokenManager<typeof ChainFamily.Solana> {
  readonly chain: SolanaChain
  // Token operations
  readonly #approveToken = new ApproveToken()
  readonly #createTokenAccount = new CreateTokenAccount()
  readonly #mintTokens = new MintTokens()
  readonly #setTokenAuthority = new SetTokenAuthority()

  // Token admin registry operations
  readonly #acceptAdmin = new AcceptAdmin()
  readonly #appendToLookupTable = new AppendToLookupTable()
  readonly #createLookupTable = new CreateLookupTable()
  readonly #getSupportedTokens = new GetSupportedTokens()
  readonly #getTokenAdminRegistry = new GetTokenAdminRegistry()
  readonly #registerAdmin = new RegisterAdmin()
  readonly #setPool = new SetPool()
  readonly #transferAdmin = new TransferAdmin()

  // Token pool operations
  readonly #acceptOwnership = new AcceptOwnership()
  readonly #appendRemotePoolAddresses = new AppendRemotePoolAddresses()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #configureAllowlist = new ConfigureAllowlist()
  readonly #createTokenMultisig = new CreateTokenMultisig()
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #deleteChainRemoteConfig = new DeleteChainRemoteConfig()
  readonly #editChainRemoteConfig = new EditChainRemoteConfig()
  readonly #getTokenPoolRemotes = new GetTokenPoolRemotes()
  readonly #getTokenPoolState = new GetTokenPoolState()
  readonly #initChainRemoteConfig = new InitChainRemoteConfig()
  readonly #provideLiquidity = new ProvideLiquidity()
  readonly #removeFromAllowlist = new RemoveFromAllowlist()
  readonly #setCanAcceptLiquidity = new SetCanAcceptLiquidity()
  readonly #setChainRateLimit = new SetChainRateLimit()
  readonly #setRateLimitAdmin = new SetRateLimitAdmin()
  readonly #setRebalancer = new SetRebalancer()
  readonly #transferOwnership = new TransferOwnership()
  readonly #withdrawLiquidity = new WithdrawLiquidity()

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
    const { SolanaChain } = await import('../../solana/index.ts')
    return new SolanaTokenManager(await SolanaChain.fromConnection(provider, ctx))
  }

  /** Creates from an RPC URL. */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<SolanaTokenManager> {
    const { SolanaChain } = await import('../../solana/index.ts')
    return new SolanaTokenManager(await SolanaChain.fromUrl(url, ctx))
  }

  /** Provider of the underlying chain. */
  get provider(): Connection {
    return this.chain.connection
  }

  /**
   * Builds unsigned Solana mint creation instructions, optionally with initial supply.
   * The `payer` defaults as mint, freeze, and metadata update authority.
   *
   * @throws {@link CCTParamsInvalidError} If token parameters are invalid.
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
   * The wallet public key defaults as mint, freeze, and metadata update authority.
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If token parameters are invalid.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
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
   * Builds unsigned instructions to approve a delegate to transfer SPL tokens.
   *
   * @see {@link approveToken} For wallet-based execution.
   *
   * @remarks
   * This is a prerequisite for pool liquidity operations: approve the pool signer PDA as `delegate`
   * with the maximum allowance it may transfer during `provideLiquidity`. Approval grants a trusted
   * delegate spend authority and replaces the account's existing delegate and allowance; set `amount`
   * to `0n` to clear the allowance. `tokenAccount` defaults to the authority's existing associated token
   * account. For an SPL Token multisig authority, provide `multisigSigners` and collect member signatures
   * externally.
   *
   * @throws {@link CCTParamsInvalidError} If an address, allowance, or multisig signer is invalid.
   * @throws {@link CCIPTokenAccountNotFoundError} If the token account does not exist.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedApproveToken({
   *   payer: owner,
   *   tokenAddress: mint,
   *   delegate,
   *   amount: 1_000_000n,
   * })
   * ```
   */
  generateUnsignedApproveToken(
    opts: GenerateApproveTokenParams,
  ): Promise<GenerateApproveTokenResult> {
    return this.#approveToken.generate(this.chain, opts)
  }

  /**
   * Approves a delegate to transfer SPL tokens from the selected token account using the executing
   * authority wallet.
   *
   * @see {@link generateUnsignedApproveToken} For externally signed transactions.
   *
   * @remarks
   * This is a prerequisite for pool liquidity operations: approve the pool signer PDA as `delegate`
   * with the maximum allowance it may transfer during `provideLiquidity`. Approval grants a trusted
   * delegate spend authority and replaces the account's existing delegate and allowance; set `amount`
   * to `0n` to clear the allowance. `tokenAccount` defaults to the authority's existing associated token
   * account. SPL Token multisig authorities require `multisigSigners`.
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address, allowance, or multisig signer is invalid, or
   * `authority` does not match the executing wallet.
   * @throws {@link CCIPTokenAccountNotFoundError} If the token account does not exist.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If simulation or the SPL Token program rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.approveToken({ wallet, tokenAddress: mint, delegate, amount: 1_000_000n })
   * ```
   */
  approveToken(opts: ExecuteApproveTokenParams): Promise<ExecuteApproveTokenResult> {
    return this.#approveToken.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned idempotent associated token account create instruction.
   *
   * @remarks
   * This operation is idempotent and safe to re-run. For the canonical pool setup flow, pass the
   * `poolSignerAddress` returned by `generateUnsignedDeployTokenPool` as `ownerAddress`, then call
   * `generateUnsignedSetPool`.
   *
   * @see {@link generateUnsignedDeployTokenPool}
   * @see {@link generateUnsignedSetPool}
   *
   * @throws {@link CCTParamsInvalidError} If an address is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
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
   * @remarks
   * This operation is idempotent and safe to re-run. For the canonical pool setup flow, pass the
   * `poolSignerAddress` returned by `deployTokenPool` as `ownerAddress`, then call `setPool`.
   *
   * @see {@link deployTokenPool}
   * @see {@link setPool}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
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
   * Builds unsigned instructions to mint SPL tokens to a recipient's existing associated token account.
   *
   * @remarks
   * `amount` is in base units. The recipient ATA must already exist; use
   * {@link generateUnsignedCreateTokenAccount} to create it. `authority` defaults to `payer`. For
   * an SPL Token multisig authority, provide `multisigSigners` and collect member signatures
   * externally.
   *
   * @throws {@link CCTParamsInvalidError} If an address, amount, or multisig signer is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCIPTokenAccountNotFoundError} If the recipient ATA is missing; create it first
   * with {@link generateUnsignedCreateTokenAccount}.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedMintTokens({
   *   payer: mintAuthority,
   *   tokenAddress: mint,
   *   recipient,
   *   amount: 1_000_000n, // One token for a mint with six decimals
   * })
   * ```
   */
  generateUnsignedMintTokens(opts: GenerateMintTokensParams): Promise<GenerateMintTokensResult> {
    return this.#mintTokens.generate(this.chain, opts)
  }

  /**
   * Mints SPL tokens to a recipient's existing associated token account using the executing wallet.
   *
   * @remarks
   * `amount` is in base units. The recipient ATA must already exist; use {@link createTokenAccount}
   * to create it. SPL Token multisig authorities require `multisigSigners` and external member
   * signatures; use {@link generateUnsignedMintTokens}.
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address, amount, or multisig signer is invalid, or
   * `authority` does not match the executing wallet.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCIPTokenAccountNotFoundError} If the recipient ATA is missing; create it first
   * with {@link createTokenAccount}.
   * @throws {@link CCTTxFailedError} If simulation or the SPL Token program rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.mintTokens({
   *   wallet,
   *   tokenAddress: mint,
   *   recipient,
   *   amount: 1_000_000n, // One token for a mint with six decimals
   * })
   * ```
   */
  mintTokens(opts: ExecuteMintTokensParams): Promise<ExecuteMintTokensResult> {
    return this.#mintTokens.execute(this.chain, opts)
  }

  /**
   * Builds unsigned instructions for an immediate SPL Token mint and/or freeze authority update.
   *
   * @see {@link setTokenAuthority} For wallet-based execution.
   *
   * @remarks
   * ⚠️ **IRREVERSIBLE:** Setting `newAuthority` to null **permanently revokes** the selected authority
   * roles for the SPL Token. Once revoked, the authority cannot be recovered or transferred.
   * Example: revoked mint authority prevents anyone from minting tokens. Use with extreme caution.
   *
   * Once confirmed, the current authority loses the selected roles. Set `authorityTypes` to
   * `['mint']`, `['freeze']`, or both. All selected roles must have the same current authority. The
   * instructions are atomic: no role changes if any selected update fails.
   * `authority` defaults to `payer`. For an SPL Token multisig authority, provide `multisigSigners`
   * and collect member signatures externally.
   *
   * @throws {@link CCTParamsInvalidError} If an address or authority role selection is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetTokenAuthority({
   *   payer: currentAuthority,
   *   tokenAddress: mint,
   *   newAuthority,
   *   authorityTypes: ['mint'],
   * })
   * ```
   *
   * @example Permanently revoke mint authority
   * ```ts
   * const revokeUnsigned = await cct.generateUnsignedSetTokenAuthority({
   *   payer: currentAuthority,
   *   tokenAddress: mint,
   *   newAuthority: null, // ⚠️ PERMANENT
   *   authorityTypes: ['mint'],
   * })
   * ```
   */
  generateUnsignedSetTokenAuthority(
    opts: GenerateSetTokenAuthorityParams,
  ): Promise<GenerateSetTokenAuthorityResult> {
    return this.#setTokenAuthority.generate(this.chain, opts)
  }

  /**
   * Immediately sets SPL Token mint and/or freeze authority using the executing wallet.
   *
   * @see {@link generateUnsignedSetTokenAuthority} For externally signed transactions.
   *
   * @remarks
   * ⚠️ **IRREVERSIBLE:** Setting `newAuthority` to null **permanently revokes** the selected authority
   * roles for the SPL Token. Once revoked, the authority cannot be recovered or transferred.
   * Example: revoked mint authority prevents anyone from minting tokens. Use with extreme caution.
   *
   * Once confirmed, the current authority loses the selected roles. Set `authorityTypes` to
   * `['mint']`, `['freeze']`, or both. All selected roles must have the same current authority. The
   * transaction is atomic: no role changes if any selected update fails.
   * SPL Token multisig authorities require `multisigSigners` and external member signatures; use
   * {@link generateUnsignedSetTokenAuthority}.
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address or authority role selection is invalid, or
   * `authority` does not match the executing wallet.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If simulation or the SPL Token program rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setTokenAuthority({ wallet, tokenAddress: mint, newAuthority, authorityTypes: ['mint'] })
   * ```
   */
  setTokenAuthority(opts: ExecuteSetTokenAuthorityParams): Promise<ExecuteSetTokenAuthorityResult> {
    return this.#setTokenAuthority.execute(this.chain, opts)
  }

  /**
   * Builds unsigned SPL Token multisig creation instructions.
   * The pool signer PDA occupies `threshold` slots; non-pool signers must meet the threshold independently.
   *
   * @remarks When `payer` differs from the mint authority, both must sign: the mint authority is
   * the `createAccountWithSeed` base account.
   *
   * @throws {@link CCTParamsInvalidError} If multisig parameters are invalid or the mint has no authority.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
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
   * The pool signer PDA occupies `threshold` slots; non-pool signers must meet the threshold independently.
   * Wallet pays fees and must match the mint authority.
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If multisig parameters are invalid or the wallet is not the mint authority.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const { hash, multisigAddress } = await cct.createTokenMultisig({
   *   wallet,
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   threshold: 2,
   *   additionalSigners: [admin],
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
   * Defaults to create+extend. Specify a canonical `poolType` or custom `poolProgramAddress`.
   * Use `mode: 'createEmpty'` to create an empty ALT, e.g. with an EOA payer and vault authority,
   * then populate it later through the authority. If `authority` is omitted, it defaults to `payer`.
   *
   * @throws {@link CCTParamsInvalidError} If an address or lookup table parameter is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
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
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address or lookup table parameter is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
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
   * Builds an unsigned instruction to append addresses to a token pool allowlist and toggle
   * enforcement. Every call overwrites enforcement; pass `add: []` to toggle it without appending
   * an address. Addresses in `add` must be unique; existing allowlist entries are rejected by the
   * program. The pool must be initialized first. Pass canonical `poolType` or a compatible
   * `poolProgramAddress`; `authority` defaults to `payer`.
   *
   * @see {@link configureAllowlist}
   * @see {@link generateUnsignedDeployTokenPool}
   * @see {@link generateUnsignedRemoveFromAllowlist}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedConfigureAllowlist({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   add: [allowedSender],
   *   enabled: true,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedConfigureAllowlist(
    opts: GenerateConfigureAllowlistParams,
  ): Promise<GenerateConfigureAllowlistResult> {
    return this.#configureAllowlist.generate(this.chain, opts)
  }

  /**
   * Appends addresses to and configures an initialized Solana token pool allowlist using the pool
   * owner wallet. Every call overwrites enforcement; pass `add: []` to toggle it without
   * appending an address. Addresses in `add` must be unique; existing allowlist entries are
   * rejected by the program.
   *
   * @see {@link generateUnsignedConfigureAllowlist}
   * @see {@link deployTokenPool}
   * @see {@link removeFromAllowlist}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.configureAllowlist({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   add: [],
   *   enabled: false,
   *   wallet,
   * })
   * ```
   */
  configureAllowlist(
    opts: ExecuteConfigureAllowlistParams,
  ): Promise<ExecuteConfigureAllowlistResult> {
    return this.#configureAllowlist.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana token pool initialize instructions.
   *
   * @remarks
   * This only builds the pool `initialize` instruction for the canonical `burn-mint` and
   * `lock-release` programs selected by `poolType`; custom pool deployment is unsupported. `authority`
   * must be allowed to initialize the pool. This does not create the pool signer PDA's associated
   * token account; use the returned `poolSignerAddress` with `generateUnsignedCreateTokenAccount`
   * before `generateUnsignedSetPool`.
   *
   * @see {@link generateUnsignedCreateTokenAccount}
   * @see {@link generateUnsignedSetPool}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid.
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
   * This only sends the pool `initialize` instruction for the canonical `burn-mint` and
   * `lock-release` programs selected by `poolType`; custom pool deployment is unsupported. The signer
   * must be allowed to initialize the pool. This does not create the pool signer PDA's associated
   * token account; use the returned `poolSignerAddress` with `createTokenAccount` before `setPool`.
   *
   * @see {@link createTokenAccount}
   * @see {@link setPool}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
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
   * Builds ordered unsigned transactions that remove remote-chain configs and add new configs with
   * their remote pools and rate limits. This accepts the same `remoteChainSelectorsToRemove` and
   * `chainsToAdd` parameters as EVM `applyChainUpdates`.
   *
   * @remarks Removals run before additions. Each added chain is initialized, configured, and
   * rate-limited as one transaction group; returns one or more packed transactions. To replace a
   * chain, include its selector in both `remoteChainSelectorsToRemove` and `chainsToAdd`.
   * Solana requires `remoteTokenDecimals`. `authority` must be the pool owner and defaults to `payer`.
   *
   * @see {@link applyChainUpdates}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or chain update is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsignedTxs = await cct.generateUnsignedApplyChainUpdates({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelectorsToRemove: [oldSelector],
   *   chainsToAdd: [{
   *     remoteChainSelector: newSelector,
   *     remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
   *     remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
   *     remoteTokenDecimals: 18,
   *     inboundRateLimiterConfig: { enabled: false },
   *     outboundRateLimiterConfig: { enabled: true, capacity: 1_000_000n, rate: 1_000n },
   *   }],
   *   payer,
   *   authority,
   * })
   *
   * for (const unsignedTx of unsignedTxs) {
   *   // Sign and submit each transaction in order.
   * }
   * ```
   */
  generateUnsignedApplyChainUpdates(
    opts: GenerateApplyChainUpdatesParams,
  ): Promise<GenerateApplyChainUpdatesResult> {
    return this.#applyChainUpdates.generateBatch(this.chain, opts)
  }

  /**
   * Applies EVM-equivalent remote-chain configuration changes with the pool owner wallet.
   *
   * @remarks Removals run before additions. Each added chain is initialized, configured, and
   * rate-limited as one transaction group. Groups are submitted sequentially and are not atomic;
   * if a later transaction fails, earlier groups may already be committed. The result contains every
   * transaction hash. To replace a chain, include its selector in both `remoteChainSelectorsToRemove`
   * and `chainsToAdd`. `wallet` must be the
   * pool owner and is the fee payer and default authority.
   *
   * @see {@link generateUnsignedApplyChainUpdates}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter or chain update is invalid, or the
   * authority differs from the executing wallet.
   * @throws {@link CCTTxFailedError} If a chain config already exists or is missing, the wallet is
   * not the pool owner, or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.applyChainUpdates({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelectorsToRemove: [],
   *   chainsToAdd: [{
   *     remoteChainSelector: selector,
   *     remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
   *     remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
   *     remoteTokenDecimals: 18,
   *     inboundRateLimiterConfig: { enabled: false },
   *     outboundRateLimiterConfig: { enabled: false },
   *   }],
   *   wallet,
   * })
   * ```
   */
  applyChainUpdates(opts: ExecuteApplyChainUpdatesParams): Promise<ExecuteApplyChainUpdatesResult> {
    return this.#applyChainUpdates.executeBatch(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that appends remote pool addresses to an initialized Solana
   * token pool remote-chain config. Pass canonical `poolType` or a compatible
   * `poolProgramAddress`; `authority` defaults to `payer`.
   *
   * @remarks `remotePoolAddresses` must be non-empty and contain no duplicates. Existing addresses
   * are retained. On-chain execution rejects addresses already present. To clear all pools, use
   * `generateUnsignedEditChainRemoteConfig` with `remotePoolAddresses: []`. The remote-chain config
   * must already exist.
   *
   * @see {@link appendRemotePoolAddresses}
   * @see {@link generateUnsignedEditChainRemoteConfig}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter, selector, or remote pool address is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedAppendRemotePoolAddresses({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedAppendRemotePoolAddresses(
    opts: GenerateAppendRemotePoolAddressesParams,
  ): Promise<GenerateAppendRemotePoolAddressesResult> {
    return this.#appendRemotePoolAddresses.generate(this.chain, opts)
  }

  /**
   * Appends remote pool addresses to an initialized Solana token pool remote-chain config with the
   * pool owner wallet.
   *
   * @remarks `remotePoolAddresses` must be non-empty and contain no duplicates. Existing addresses
   * are retained. The remote-chain config must already exist; addresses already on-chain cause the
   * transaction to fail. To clear all pools, use `editChainRemoteConfig` with
   * `remotePoolAddresses: []`.
   *
   * @see {@link generateUnsignedAppendRemotePoolAddresses}
   * @see {@link editChainRemoteConfig}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter or remote pool address is invalid, or
   * the authority differs from the executing wallet.
   * @throws {@link CCTTxFailedError} If the chain config does not exist, the wallet is not the pool
   * owner, an address already exists, or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.appendRemotePoolAddresses({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
   *   wallet,
   * })
   * ```
   */
  appendRemotePoolAddresses(
    opts: ExecuteAppendRemotePoolAddressesParams,
  ): Promise<ExecuteAppendRemotePoolAddressesResult> {
    return this.#appendRemotePoolAddresses.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that initializes a Solana token pool remote-chain config for a
   * previously unconfigured selector. Pass canonical `poolType` or a compatible
   * `poolProgramAddress`; `authority` defaults to
   * `payer`.
   *
   * @remarks This creates the chain-config PDA once and fails if it already exists. Configure
   * remote pools and rate limits separately before using the lane.
   *
   * @see {@link initChainRemoteConfig}
   * @see {@link generateUnsignedEditChainRemoteConfig}
   * @see {@link generateUnsignedDeleteChainRemoteConfig}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or remote config value is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedInitChainRemoteConfig({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
   *   remoteTokenDecimals: 18,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedInitChainRemoteConfig(
    opts: GenerateInitChainRemoteConfigParams,
  ): Promise<GenerateInitChainRemoteConfigResult> {
    return this.#initChainRemoteConfig.generate(this.chain, opts)
  }

  /**
   * Initializes a Solana token pool remote-chain config for a previously unconfigured selector
   * with the pool owner wallet.
   *
   * @remarks This creates the chain-config PDA once and fails if it already exists. Configure
   * remote pools and rate limits separately before using the lane.
   *
   * @see {@link generateUnsignedInitChainRemoteConfig}
   * @see {@link editChainRemoteConfig}
   * @see {@link deleteChainRemoteConfig}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If simulation or the pool rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.initChainRemoteConfig({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
   *   remoteTokenDecimals: 18,
   *   wallet,
   * })
   * ```
   */
  initChainRemoteConfig(
    opts: ExecuteInitChainRemoteConfigParams,
  ): Promise<ExecuteInitChainRemoteConfigResult> {
    return this.#initChainRemoteConfig.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that closes a Solana token pool remote-chain config. Pass
   * canonical `poolType` or a compatible `poolProgramAddress`; `authority` defaults to `payer`.
   *
   * @remarks
   * Destructive: this closes the remote-chain config account and returns its rent to `authority`.
   * CCIP transfers for `remoteChainSelector` fail until the config is recreated with
   * `generateUnsignedInitChainRemoteConfig`. On-chain execution requires `authority` to be the
   * token pool owner and the chain config to exist.
   *
   * @see {@link deleteChainRemoteConfig}
   * @see {@link generateUnsignedInitChainRemoteConfig}
   * @see {@link generateUnsignedEditChainRemoteConfig}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or remote chain selector is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedDeleteChainRemoteConfig({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedDeleteChainRemoteConfig(
    opts: GenerateDeleteChainRemoteConfigParams,
  ): Promise<GenerateDeleteChainRemoteConfigResult> {
    return this.#deleteChainRemoteConfig.generate(this.chain, opts)
  }

  /**
   * Closes an initialized Solana token pool remote-chain config with the pool owner wallet.
   *
   * @remarks
   * Destructive: this closes the remote-chain config account and returns its rent to the wallet.
   * CCIP transfers for `remoteChainSelector` fail until the config is recreated with
   * `initChainRemoteConfig`.
   *
   * @see {@link generateUnsignedDeleteChainRemoteConfig}
   * @see {@link initChainRemoteConfig}
   * @see {@link editChainRemoteConfig}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If the chain config does not exist, the wallet is not the pool
   * owner, or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.deleteChainRemoteConfig({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   wallet,
   * })
   * ```
   */
  deleteChainRemoteConfig(
    opts: ExecuteDeleteChainRemoteConfigParams,
  ): Promise<ExecuteDeleteChainRemoteConfigResult> {
    return this.#deleteChainRemoteConfig.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that assigns the rate-limit admin for an initialized Solana
   * token pool. Pass canonical `poolType` or a compatible `poolProgramAddress`; `authority`
   * defaults to `payer`.
   *
   * @remarks On-chain execution requires `authority` to be the pool owner. This assignment takes
   * effect immediately; unlike ownership transfer, it has no acceptance step. The new rate-limit
   * admin may configure chain rate limits but cannot change this role.
   *
   * @see {@link setRateLimitAdmin}
   * @see {@link generateUnsignedSetChainRateLimit}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or public key is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetRateLimitAdmin({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   newRateLimitAdmin,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedSetRateLimitAdmin(
    opts: GenerateSetRateLimitAdminParams,
  ): Promise<GenerateSetRateLimitAdminResult> {
    return this.#setRateLimitAdmin.generate(this.chain, opts)
  }

  /**
   * Assigns the rate-limit admin for an initialized Solana token pool with the pool owner wallet.
   *
   * @remarks This assignment takes effect immediately; unlike ownership transfer, it has no
   * acceptance step. The new rate-limit admin may configure chain rate limits but cannot change
   * this role.
   *
   * @see {@link generateUnsignedSetRateLimitAdmin}
   * @see {@link setChainRateLimit}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If the pool does not exist, the wallet is not the pool owner,
   * or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setRateLimitAdmin({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   newRateLimitAdmin,
   *   wallet,
   * })
   * ```
   */
  setRateLimitAdmin(opts: ExecuteSetRateLimitAdminParams): Promise<ExecuteSetRateLimitAdminResult> {
    return this.#setRateLimitAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction to deposit a rebalancer's tokens into a lock-release pool.
   * Pass `poolType: 'lock-release'` or a compatible `poolProgramAddress`; a custom program must
   * have the canonical lock-release `provideLiquidity` instruction and account layout. `authority`
   * defaults to `payer`. `amount` is a positive u64 in base units.
   *
   * @remarks The pool config must have `canAcceptLiquidity: true` and a `rebalancer` equal to the
   * transaction authority. Before this operation, the rebalancer ATA must delegate at least `amount`
   * to the pool signer PDA; use {@link generateUnsignedApproveToken}.
   *
   * @see {@link provideLiquidity}
   * @see {@link generateUnsignedApproveToken}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter, address, or amount is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool state is missing.
   * @throws {@link CCIPTokenAccountNotFoundError} If the rebalancer or pool vault ATA is missing; create it first.
   *
   * @example Prepare and generate liquidity instructions
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const amount = 1_000_000n
   * const { config } = await cct.getTokenPoolState({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   * })
   * const approval = await cct.generateUnsignedApproveToken({
   *   payer: rebalancer,
   *   tokenAddress: mint,
   *   delegate: config.poolSigner,
   *   amount,
   * })
   * const liquidity = await cct.generateUnsignedProvideLiquidity({
   *   payer: rebalancer,
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   amount,
   * })
   * ```
   */
  generateUnsignedProvideLiquidity(
    opts: GenerateProvideLiquidityParams,
  ): Promise<GenerateProvideLiquidityResult> {
    return this.#provideLiquidity.generate(this.chain, opts)
  }

  /**
   * Deposits tokens from the executing rebalancer wallet into a lock-release pool.
   * Pass `poolType: 'lock-release'` or a compatible `poolProgramAddress`; a custom program must
   * have the canonical lock-release `provideLiquidity` instruction and account layout. The wallet's
   * associated token account must exist and hold the positive u64 `amount` in base units.
   *
   * @remarks The pool config must have `canAcceptLiquidity: true` and a `rebalancer` equal to the
   * transaction authority. Before this operation, the rebalancer ATA must delegate at least `amount`
   * to the pool signer PDA; use {@link approveToken} first.
   *
   * @see {@link generateUnsignedProvideLiquidity}
   * @see {@link approveToken}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter, address, or amount is invalid, or
   * the authority differs from the executing wallet.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool state is missing.
   * @throws {@link CCIPTokenAccountNotFoundError} If the rebalancer or pool vault ATA is missing; create it first.
   * @throws {@link CCTTxFailedError} If the source ATA does not delegate enough tokens to the pool
   * signer, the pool rejects the rebalancer, liquidity is disabled, the token account lacks funds,
   * or simulation/submission fails.
   *
   * @example Prepare and provide liquidity
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const amount = 1_000_000n
   * const { config } = await cct.getTokenPoolState({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   * })
   * await cct.approveToken({ wallet, tokenAddress: mint, delegate: config.poolSigner, amount })
   * await cct.provideLiquidity({ wallet, tokenAddress: mint, poolType: 'lock-release', amount })
   * ```
   */
  provideLiquidity(opts: ExecuteProvideLiquidityParams): Promise<ExecuteProvideLiquidityResult> {
    return this.#provideLiquidity.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction to withdraw tokens from a lock-release pool to a rebalancer's
   * associated token account. Pass `poolType: 'lock-release'` or a compatible `poolProgramAddress`;
   * a custom program must have the canonical lock-release `withdrawLiquidity` instruction and account
   * layout. `authority` defaults to `payer`. `amount` is a positive u64 in base units.
   *
   * @remarks The pool config must have `canAcceptLiquidity: true` and a `rebalancer` equal to the
   * transaction authority. The rebalancer's associated token account must already exist.
   *
   * @see {@link withdrawLiquidity}
   * @see {@link generateUnsignedSetRebalancer}
   * @see {@link generateUnsignedSetCanAcceptLiquidity}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter, address, or amount is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   *
   * @example Generate a liquidity withdrawal instruction
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const withdrawal = await cct.generateUnsignedWithdrawLiquidity({
   *   payer: rebalancer,
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   amount: 1_000_000n,
   * })
   * ```
   */
  generateUnsignedWithdrawLiquidity(
    opts: GenerateWithdrawLiquidityParams,
  ): Promise<GenerateWithdrawLiquidityResult> {
    return this.#withdrawLiquidity.generate(this.chain, opts)
  }

  /**
   * Withdraws tokens from a lock-release pool into the executing rebalancer wallet's associated
   * token account. Pass `poolType: 'lock-release'` or a compatible `poolProgramAddress`; a custom
   * program must have the canonical lock-release `withdrawLiquidity` instruction and account layout.
   * The wallet's associated token account must exist. `amount` is a positive u64 in base units.
   *
   * @remarks The pool config must have `canAcceptLiquidity: true` and a `rebalancer` equal to the
   * transaction authority.
   *
   * @see {@link generateUnsignedWithdrawLiquidity}
   * @see {@link setRebalancer}
   * @see {@link setCanAcceptLiquidity}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter, address, or amount is invalid, or
   * the authority differs from the executing wallet.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If the pool rejects the rebalancer, liquidity is disabled,
   * lacks liquidity, the token account does not exist, or simulation/submission fails.
   *
   * @example Withdraw liquidity
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.withdrawLiquidity({
   *   wallet,
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   amount: 1_000_000n,
   * })
   * ```
   */
  withdrawLiquidity(opts: ExecuteWithdrawLiquidityParams): Promise<ExecuteWithdrawLiquidityResult> {
    return this.#withdrawLiquidity.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that sets whether an initialized Solana lock-release token pool
   * accepts `provideLiquidity` deposits and `withdrawLiquidity` transfers. Pass canonical
   * `poolType: 'lock-release'` or a compatible `poolProgramAddress`; `authority` defaults to `payer`.
   *
   * @remarks
   * ⚠️ **Consequence:** Setting `allow` to `true` lets the rebalancer both `provideLiquidity` and
   * `withdrawLiquidity`. Setting `allow` to `false` **disables both** — liquidity already in the pool cannot be
   * withdrawn until `allow` is re-enabled. Verify the current liquidity balance before flipping to `false`.
   *
   * @see {@link setCanAcceptLiquidity}
   * @see {@link generateUnsignedSetRebalancer}
   *
   * @throws {@link CCTParamsInvalidError} If `allow`, a pool parameter, or public key is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetCanAcceptLiquidity({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   allow: true,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedSetCanAcceptLiquidity(
    opts: GenerateSetCanAcceptLiquidityParams,
  ): Promise<GenerateSetCanAcceptLiquidityResult> {
    return this.#setCanAcceptLiquidity.generate(this.chain, opts)
  }

  /**
   * Sets whether an initialized Solana lock-release token pool accepts `provideLiquidity` deposits
   * and `withdrawLiquidity` transfers using the pool owner wallet.
   *
   * @remarks
   * ⚠️ **Consequence:** Setting `allow` to `true` lets the rebalancer both `provideLiquidity` and
   * `withdrawLiquidity`. Setting `allow` to `false` **disables both** — liquidity already in the pool cannot be
   * withdrawn until `allow` is re-enabled. Verify the current liquidity balance before flipping to `false`.
   *
   * @see {@link generateUnsignedSetCanAcceptLiquidity}
   * @see {@link setRebalancer}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If `allow` or a pool parameter is invalid, or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If the wallet is not the pool owner or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setCanAcceptLiquidity({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   allow: true,
   *   wallet,
   * })
   * ```
   */
  setCanAcceptLiquidity(
    opts: ExecuteSetCanAcceptLiquidityParams,
  ): Promise<ExecuteSetCanAcceptLiquidityResult> {
    return this.#setCanAcceptLiquidity.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that sets the address authorized to provide or withdraw
   * liquidity for an initialized Solana lock-release token pool. Pass canonical
   * `poolType: 'lock-release'` or a compatible `poolProgramAddress`; `authority` defaults to
   * `payer`. The default/zero public key (`11111111111111111111111111111111`) disables
   * rebalancing.
   *
   * @remarks
   * ⚠️ **Consequence:** Rebalancer is the address allowed to provide or withdraw liquidity.
   * Setting the zero address (`11111111111111111111111111111111`) removes the rebalancer; until a new one
   * is set, **no account can provide or withdraw liquidity**, even liquidity already in the pool.
   * This does not affect whether the pool accepts liquidity — see {@link setCanAcceptLiquidity}.
   *
   * @see {@link setRebalancer}
   * @see {@link setCanAcceptLiquidity}
   * @see {@link generateUnsignedSetCanAcceptLiquidity}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or public key is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetRebalancer({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   rebalancer,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedSetRebalancer(
    opts: GenerateSetRebalancerParams,
  ): Promise<GenerateSetRebalancerResult> {
    return this.#setRebalancer.generate(this.chain, opts)
  }

  /**
   * Sets the address authorized to provide or withdraw liquidity for an initialized Solana
   * lock-release token pool using the pool owner wallet. Pass canonical `poolType: 'lock-release'`
   * or a compatible `poolProgramAddress`; set `rebalancer` to the default/zero public key
   * (`11111111111111111111111111111111`) to disable rebalancing.
   *
   * @remarks
   * ⚠️ **Consequence:** Rebalancer is the address allowed to provide or withdraw liquidity.
   * Setting the zero address (`11111111111111111111111111111111`) removes the rebalancer; until a new one
   * is set, **no account can provide or withdraw liquidity**, even liquidity already in the pool.
   * This does not affect whether the pool accepts liquidity — see {@link setCanAcceptLiquidity}.
   *
   * @see {@link generateUnsignedSetRebalancer}
   * @see {@link setCanAcceptLiquidity}
   * @see {@link generateUnsignedSetCanAcceptLiquidity}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If the wallet is not the pool owner or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setRebalancer({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   rebalancer,
   *   wallet,
   * })
   * ```
   *
   * @example Disable rebalancing
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setRebalancer({
   *   tokenAddress: mint,
   *   poolType: 'lock-release',
   *   rebalancer: PublicKey.default.toBase58(), // disable
   *   wallet,
   * })
   * ```
   */
  setRebalancer(opts: ExecuteSetRebalancerParams): Promise<ExecuteSetRebalancerResult> {
    return this.#setRebalancer.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that proposes a new owner for an initialized Solana token pool.
   * Pass canonical `poolType` or a compatible `poolProgramAddress`; `authority` defaults to `payer`.
   * The operation reads pool state and rejects the current owner or default public key. The proposed
   * owner must accept ownership separately before the transfer takes effect.
   *
   * @see {@link transferOwnership}
   * @see {@link generateUnsignedAcceptOwnership}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or public key is invalid.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool account does not exist.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedTransferOwnership({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   newOwner,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedTransferOwnership(
    opts: GenerateTransferOwnershipParams,
  ): Promise<GenerateTransferOwnershipResult> {
    return this.#transferOwnership.generate(this.chain, opts)
  }

  /**
   * Proposes a new owner for an initialized Solana token pool using the current owner wallet.
   * It rejects the current owner or default public key. The proposed owner must accept ownership
   * separately before the transfer takes effect.
   *
   * @see {@link generateUnsignedTransferOwnership}
   * @see {@link acceptOwnership}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool account does not exist.
   * @throws {@link CCTTxFailedError} If the wallet is not the pool owner or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.transferOwnership({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   newOwner,
   *   wallet,
   * })
   * ```
   */
  transferOwnership(opts: ExecuteTransferOwnershipParams): Promise<ExecuteTransferOwnershipResult> {
    return this.#transferOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that accepts pending ownership of an initialized Solana token
   * pool. Pass canonical `poolType` or a compatible `poolProgramAddress`; `authority` defaults to
   * `payer`. The operation reads pool state and requires it to be the proposed owner.
   *
   * @see {@link acceptOwnership}
   * @see {@link generateUnsignedTransferOwnership}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or public key is invalid.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool account does not exist.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedAcceptOwnership({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedAcceptOwnership(
    opts: GenerateAcceptOwnershipParams,
  ): Promise<GenerateAcceptOwnershipResult> {
    return this.#acceptOwnership.generate(this.chain, opts)
  }

  /**
   * Accepts pending ownership of an initialized Solana token pool using the proposed owner wallet.
   * It verifies the wallet is the proposed owner before submitting.
   *
   * @see {@link generateUnsignedAcceptOwnership}
   * @see {@link transferOwnership}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool account does not exist.
   * @throws {@link CCTTxFailedError} If the wallet is not the proposed owner or
   * simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.acceptOwnership({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   wallet,
   * })
   * ```
   */
  acceptOwnership(opts: ExecuteAcceptOwnershipParams): Promise<ExecuteAcceptOwnershipResult> {
    return this.#acceptOwnership.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that sets inbound and outbound rate limits for an initialized
   * Solana token pool remote-chain config. Pass canonical `poolType` or a compatible
   * `poolProgramAddress`; `authority` defaults to `payer`.
   *
   * @remarks On-chain execution requires `authority` to be the pool owner or rate-limit admin.
   * The remote-chain config must already exist. Enabled limits require `rate <= capacity`;
   * disabled limits default omitted values to zero and reject nonzero values.
   *
   * @see {@link setChainRateLimit}
   * @see {@link generateUnsignedInitChainRemoteConfig}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter, rate limit, or selector is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedSetChainRateLimit({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   inbound: { enabled: true, capacity: 1_000_000n, rate: 1_000n },
   *   outbound: { enabled: false }, // Disabled limits default capacity and rate to zero.
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedSetChainRateLimit(
    opts: GenerateSetChainRateLimitParams,
  ): Promise<GenerateSetChainRateLimitResult> {
    return this.#setChainRateLimit.generate(this.chain, opts)
  }

  /**
   * Sets inbound and outbound rate limits for an initialized Solana token pool remote-chain config
   * with the pool owner or rate-limit admin wallet.
   *
   * @remarks The remote-chain config must already exist. Enabled limits require `rate <= capacity`;
   * disabled limits default omitted values to zero and reject nonzero values.
   *
   * @see {@link generateUnsignedSetChainRateLimit}
   * @see {@link initChainRemoteConfig}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter or rate limit is invalid, or the
   * authority differs from the executing wallet.
   * @throws {@link CCTTxFailedError} If the chain config does not exist, the wallet is neither the
   * pool owner nor rate-limit admin, or simulation/submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.setChainRateLimit({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   inbound: { enabled: true, capacity: 1_000_000n, rate: 1_000n },
   *   outbound: { enabled: false }, // Disabled limits default capacity and rate to zero.
   *   wallet,
   * })
   * ```
   */
  setChainRateLimit(opts: ExecuteSetChainRateLimitParams): Promise<ExecuteSetChainRateLimitResult> {
    return this.#setChainRateLimit.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction that replaces an initialized Solana token pool remote-chain
   * config. Initialize the config first with `generateUnsignedInitChainRemoteConfig`. Each call
   * replaces the remote token address, pool addresses, and decimals. Pass canonical `poolType` or
   * a compatible `poolProgramAddress`; `authority` defaults to `payer`.
   *
   * @see {@link editChainRemoteConfig}
   * @see {@link generateUnsignedInitChainRemoteConfig}
   * @see {@link generateUnsignedDeleteChainRemoteConfig}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter or remote config value is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedEditChainRemoteConfig({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
   *   remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
   *   remoteTokenDecimals: 18,
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedEditChainRemoteConfig(
    opts: GenerateEditChainRemoteConfigParams,
  ): Promise<GenerateEditChainRemoteConfigResult> {
    return this.#editChainRemoteConfig.generate(this.chain, opts)
  }

  /**
   * Replaces an initialized Solana token pool remote-chain config with the pool owner wallet.
   * Initialize the config first with `initChainRemoteConfig`. Each call replaces the remote token
   * address, pool addresses, and decimals.
   *
   * @see {@link generateUnsignedEditChainRemoteConfig}
   * @see {@link initChainRemoteConfig}
   * @see {@link deleteChainRemoteConfig}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If simulation or the pool rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.editChainRemoteConfig({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   *   remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
   *   remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
   *   remoteTokenDecimals: 18,
   *   wallet,
   * })
   * ```
   */
  editChainRemoteConfig(
    opts: ExecuteEditChainRemoteConfigParams,
  ): Promise<ExecuteEditChainRemoteConfigResult> {
    return this.#editChainRemoteConfig.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana lookup table extend instructions.
   *
   * Pass `tokenAddress` with a canonical `poolType` or custom `poolProgramAddress` to append the
   * standard CCIP pool addresses; pass `additionalAddresses` to append manual addresses. `authority`
   * defaults to `payer`.
   *
   * @throws {@link CCTParamsInvalidError} If an address or lookup table parameter is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
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
   * Pass `tokenAddress` with a canonical `poolType` or custom `poolProgramAddress` to append the
   * standard CCIP pool addresses.
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address or lookup table parameter is invalid.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
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
   * Builds an unsigned Solana instruction that accepts a pending token administrator role.
   *
   * The supplied authority must be the pending token administrator.
   *
   * @remarks
   * Call this after {@link generateUnsignedRegisterAdmin} or {@link generateUnsignedTransferAdmin}
   * and before {@link generateUnsignedSetPool}. `authority` defaults to `payer`; Squads/vault
   * flows should use this method with their fee payer and signing authority explicitly.
   *
   * @see {@link generateUnsignedRegisterAdmin}
   * @see {@link generateUnsignedTransferAdmin}
   * @see {@link generateUnsignedSetPool}
   *
   * @throws {@link CCTParamsInvalidError} If an address is invalid or the authority is not the
   * pending token administrator.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenNotConfiguredError} If the token is not registered.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedAcceptAdmin({
   *   tokenAddress: mint,
   *   address: router,
   *   payer: pendingAdmin,
   * })
   * ```
   */
  generateUnsignedAcceptAdmin(opts: GenerateAcceptAdminParams): Promise<GenerateAcceptAdminResult> {
    return this.#acceptAdmin.generate(this.chain, opts)
  }

  /**
   * Accepts a pending token administrator role using the pending administrator wallet.
   *
   * @remarks
   * Call this after {@link registerAdmin} or {@link transferAdmin} and before {@link setPool}.
   * `authority` defaults to `wallet`; Squads/vault flows should use
   * {@link generateUnsignedAcceptAdmin} instead.
   *
   * @see {@link registerAdmin}
   * @see {@link transferAdmin}
   * @see {@link setPool}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address is invalid or `authority` does not match
   * the executing wallet/pending token administrator.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenNotConfiguredError} If the token is not registered.
   * @throws {@link CCTTxFailedError} If simulation or the Router rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.acceptAdmin({ tokenAddress: mint, address: router, wallet: pendingAdminWallet })
   * ```
   */
  acceptAdmin(opts: ExecuteAcceptAdminParams): Promise<ExecuteAcceptAdminResult> {
    return this.#acceptAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned Solana token registration instruction.
   *
   * This proposes the registry administrator. The proposed admin must accept the role using
   * {@link generateUnsignedAcceptAdmin} before calling {@link generateUnsignedSetPool}. The
   * administrator defaults to the mint authority and the method to `owner`;
   * choose `ccip-admin` when the Router CCIP admin signs. Provide `administrator`
   * to nominate a different admin or register a mint with no mint authority.
   *
   * @see {@link generateUnsignedAcceptAdmin}
   * @see {@link generateUnsignedSetPool}
   *
   * @throws {@link CCTParamsInvalidError} If an address or `registrationMethod` is invalid, the
   * authority does not match the selected registration method, `administrator` is required, or a
   * registry entry already exists for the token.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedRegisterAdmin({
   *   tokenAddress: mint,
   *   address: router,
   *   payer: mintAuthority,
   * })
   * ```
   */
  generateUnsignedRegisterAdmin(
    opts: GenerateRegisterAdminParams,
  ): Promise<GenerateRegisterAdminResult> {
    return this.#registerAdmin.generate(this.chain, opts)
  }

  /**
   * Proposes a token registry administrator using the executing wallet as registration authority
   * and fee payer. The proposed admin must {@link acceptAdmin} before calling {@link setPool}.
   *
   * @see {@link acceptAdmin}
   * @see {@link setPool}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address or `registrationMethod` is invalid, the
   * authority does not match the selected registration method or executing wallet,
   * `administrator` is required, or a registry entry already exists for the token.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenMintNotFoundError} If the mint does not exist.
   * @throws {@link CCIPTokenMintInvalidError} If the mint is not owned by an SPL Token program.
   * @throws {@link CCTTxFailedError} If simulation or the Router rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.registerAdmin({
   *   tokenAddress: mint,
   *   address: router,
   *   wallet,
   * })
   * ```
   */
  registerAdmin(opts: ExecuteRegisterAdminParams): Promise<ExecuteRegisterAdminResult> {
    return this.#registerAdmin.execute(this.chain, opts)
  }

  /**
   * Builds an unsigned instruction to remove addresses from a token pool allowlist. The pool must
   * be initialized first. Pass canonical `poolType` or a compatible `poolProgramAddress`;
   * `authority` defaults to `payer`. Every removed address must already be allowlisted or the
   * transaction reverts.
   *
   * @remarks Removal does not change enforcement; removing the last allowed sender while the
   * allowlist is enabled blocks all senders — use `configureAllowlist` to toggle.
   *
   * @see {@link generateUnsignedConfigureAllowlist}
   * @see {@link removeFromAllowlist}
   *
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedRemoveFromAllowlist({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remove: [sender],
   *   payer,
   *   authority,
   * })
   * ```
   */
  generateUnsignedRemoveFromAllowlist(
    opts: GenerateRemoveFromAllowlistParams,
  ): Promise<GenerateRemoveFromAllowlistResult> {
    return this.#removeFromAllowlist.generate(this.chain, opts)
  }

  /**
   * Removes addresses from an initialized Solana token pool allowlist using the pool owner wallet.
   * Every removed address must already be allowlisted or the transaction reverts.
   *
   * @remarks Removal does not change enforcement; removing the last allowed sender while the
   * allowlist is enabled blocks all senders — use `configureAllowlist` to toggle.
   *
   * @see {@link configureAllowlist}
   * @see {@link generateUnsignedRemoveFromAllowlist}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If a pool parameter is invalid or the authority differs
   * from the executing wallet.
   * @throws {@link CCTTxFailedError} If transaction simulation or submission fails.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.removeFromAllowlist({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remove: [sender],
   *   wallet,
   * })
   * ```
   */
  removeFromAllowlist(
    opts: ExecuteRemoveFromAllowlistParams,
  ): Promise<ExecuteRemoveFromAllowlistResult> {
    return this.#removeFromAllowlist.execute(this.chain, opts)
  }

  /**
   * Builds unsigned Solana `setPool` instructions.
   *
   * The token must first be registered and its proposed administrator accepted. The `payer` pays
   * transaction fees; `authority` defaults to `payer`, while Squads/multisig flows should pass
   * the token admin/vault authority explicitly. For a newly deployed canonical pool, create the
   * pool signer's ATA before calling this operation.
   *
   * @see {@link generateUnsignedRegisterAdmin}
   * @see {@link generateUnsignedAcceptAdmin}
   * @see {@link generateUnsignedDeployTokenPool}
   * @see {@link generateUnsignedCreateTokenAccount}
   *
   * @throws {@link CCTParamsInvalidError} If an address or `writableIndexes` is invalid.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
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
   * Registers a token pool. The token must first be registered and its proposed administrator
   * accepted; the wallet must be the token admin authority. For a newly deployed canonical pool,
   * create the pool signer's ATA before calling this operation.
   *
   * @see {@link registerAdmin}
   * @see {@link acceptAdmin}
   * @see {@link deployTokenPool}
   * @see {@link createTokenAccount}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address or `writableIndexes` is invalid.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCTTxFailedError} If simulation or the Router rejects the transaction.
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
   * Builds an unsigned Solana instruction that transfers a token administrator role.
   *
   * @remarks
   * This transfers an already accepted administrator role; it does not register a token. The
   * proposed administrator must call {@link generateUnsignedAcceptAdmin} before becoming the
   * current administrator.
   *
   * @see {@link generateUnsignedAcceptAdmin}
   *
   * @throws {@link CCTParamsInvalidError} If an address is invalid or the authority is not the
   * current token administrator.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenNotConfiguredError} If the token is not registered.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const unsigned = await cct.generateUnsignedTransferAdmin({
   *   tokenAddress: mint,
   *   address: router,
   *   newAdmin,
   *   payer: currentAdmin,
   * })
   * ```
   */
  generateUnsignedTransferAdmin(
    opts: GenerateTransferAdminParams,
  ): Promise<GenerateTransferAdminResult> {
    return this.#transferAdmin.generate(this.chain, opts)
  }

  /**
   * Transfers a token administrator role using the executing wallet as the current administrator.
   *
   * @remarks
   * This transfers an already accepted administrator role; it does not register a token. The
   * proposed administrator must call {@link acceptAdmin} before becoming the current administrator.
   *
   * @see {@link acceptAdmin}
   *
   * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
   * @throws {@link CCTParamsInvalidError} If an address is invalid or `authority` does not match
   * the executing wallet/current token administrator.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenNotConfiguredError} If the token is not registered.
   * @throws {@link CCTTxFailedError} If simulation or the Router rejects the transaction.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * await cct.transferAdmin({
   *   tokenAddress: mint,
   *   address: router,
   *   newAdmin,
   *   wallet: currentAdminWallet,
   * })
   * ```
   */
  transferAdmin(opts: ExecuteTransferAdminParams): Promise<ExecuteTransferAdminResult> {
    return this.#transferAdmin.execute(this.chain, opts)
  }

  /**
   * Reads all, or one selected, Solana token pool remote-chain configurations.
   *
   * @remarks Results are keyed by remote network name. Omit `remoteChainSelector` to scan all
   * configured remotes; provide it to query one. Rate-limit amounts use the local mint's smallest
   * unit.
   *
   * @throws {@link CCTParamsInvalidError} If the token or pool program address or remote selector is invalid.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the pool state account does not exist.
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} If the selected remote-chain config does not exist.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const remotes = await cct.getTokenPoolRemotes({
   *   tokenAddress: mint,
   *   poolType: 'burn-mint',
   *   remoteChainSelector: 5009297550715157269n,
   * })
   * console.log(remotes)
   * ```
   */
  getTokenPoolRemotes(opts: GetTokenPoolRemotesParams): Promise<GetTokenPoolRemotesResult> {
    return this.#getTokenPoolRemotes.query(this.chain, opts)
  }

  /**
   * Reads a Lock/Release token pool's state account, whose config also reports its liquidity
   * fields (`rebalancer`, `canAcceptLiquidity`).
   *
   * @remarks The EVM counterpart, `EVMTokenManager.getTokenPoolState`, returns a different shape:
   * its fields are flat where these nest under `state.config`, it spells `config.mint` /
   * `config.decimals` / `config.rmnRemote` as `token` / `tokenDecimals` / `rmnProxy`, and its
   * `version` is the pool's protocol semver (`'2.0.0'`), not the account-layout number returned
   * here. `owner`, `rateLimitAdmin` and `router` are named alike on both.
   *
   * @throws {@link CCTParamsInvalidError} If the token or pool program address is invalid.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the pool state account does not exist.
   * @throws {@link CCTDataDecodeError} If the pool state account cannot be decoded.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const state = await cct.getTokenPoolState({
   *   poolType: 'lock-release',
   *   tokenAddress: mint,
   * })
   * // config.owner must sign pool writes; config.rateLimitAdmin may set rate limits
   * console.log(state.config.owner, state.config.mint, state.config.decimals)
   * // lock-release only: who rebalances the pool, and whether it accepts liquidity
   * console.log(state.config.rebalancer, state.config.canAcceptLiquidity)
   * ```
   */
  getTokenPoolState(
    opts: LockReleasePoolProgramRef & { tokenAddress: string },
  ): Promise<LockReleaseGetTokenPoolStateResult>
  /**
   * Reads a Burn/Mint or custom token pool's state account; its config carries no liquidity
   * fields. Pass `poolProgramAddress` instead of `poolType` for a custom pool program.
   */
  getTokenPoolState(
    opts: (BurnMintPoolProgramRef | CustomPoolProgramRef) & { tokenAddress: string },
  ): Promise<BaseGetTokenPoolStateResult>
  /**
   * Reads a pool state account whose program is not known statically; narrow the result on the
   * presence of the lock-release-only config fields.
   */
  getTokenPoolState(opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult>
  /**
   * Implementation for the overloads above; callers always resolve to one of those.
   * */
  getTokenPoolState(opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult> {
    return this.#getTokenPoolState.query(this.chain, opts)
  }

  /**
   * Reads a token's TokenAdminRegistry administrator, pending administrator, and pool lookup table.
   *
   * @throws {@link CCTParamsInvalidError} If `address` or `tokenAddress` is not a valid Solana public key.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   * @throws {@link CCIPTokenNotConfiguredError} If the token is not registered.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const config = await cct.getTokenAdminRegistry({
   *   address: router,
   *   tokenAddress: mint,
   * })
   * ```
   */
  getTokenAdminRegistry(opts: GetTokenAdminRegistryParams): Promise<GetTokenAdminRegistryResult> {
    return this.#getTokenAdminRegistry.query(this.chain, opts)
  }

  /**
   * Lists all SPL token mints configured in a Router's TokenAdminRegistry in a single scan;
   * pagination is not supported.
   *
   * @throws {@link CCTParamsInvalidError} If `address` is not a valid Solana public key.
   * @throws {@link CCIPContractNotRouterError} If `address` does not resolve to a Router.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const tokens = await cct.getSupportedTokens({ address: router })
   * ```
   */
  getSupportedTokens(opts: GetSupportedTokensParams): Promise<string[]> {
    return this.#getSupportedTokens.query(this.chain, opts)
  }

  /**
   * Serializes an unsigned Solana CCT tx for external signing.
   *
   * @throws {@link CCTParamsInvalidError} If `encoding` is unsupported or the transaction uses
   * address lookup tables, which legacy-message serialization cannot represent.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
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
export {
  type TokenPoolType,
  TOKEN_POOL_PROGRAMS,
  deriveTokenPoolSignerPda,
  resolveTokenPoolProgram,
} from './programs/token-pool.ts'
export { TOKEN_AUTHORITY_TYPES } from './token/constants.ts'
export { DEFAULT_WRITABLE_INDEXES, REGISTRATION_METHODS } from './token-admin-registry/constants.ts'
export type { TransactionResult } from '../operation.ts'
export type { SerializedSolanaTxEncoding } from './serialize.ts'
export type * from './token/operations/index.ts'
export type * from './token-pool/operations/index.ts'
export type * from './token-admin-registry/operations/index.ts'
