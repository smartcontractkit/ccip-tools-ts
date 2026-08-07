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
  type ExecuteRemoveFromAllowlistParams,
  type ExecuteRemoveFromAllowlistResult,
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
  type GenerateRemoveFromAllowlistParams,
  type GenerateRemoveFromAllowlistResult,
  type GetTokenPoolStateParams,
  type GetTokenPoolStateResult,
  ConfigureAllowlist,
  CreateTokenMultisig,
  DeleteChainRemoteConfig,
  DeployTokenPool,
  EditChainRemoteConfig,
  GetTokenPoolState,
  InitChainRemoteConfig,
  RemoveFromAllowlist,
} from './token-pool/operations/index.ts'

/** CCT admin facade for Solana. */
export class SolanaTokenManager extends TokenManager<typeof ChainFamily.Solana> {
  readonly chain: SolanaChain
  // Token operations
  readonly #createTokenAccount = new CreateTokenAccount()

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
  readonly #configureAllowlist = new ConfigureAllowlist()
  readonly #createTokenMultisig = new CreateTokenMultisig()
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #deleteChainRemoteConfig = new DeleteChainRemoteConfig()
  readonly #editChainRemoteConfig = new EditChainRemoteConfig()
  readonly #getTokenPoolState = new GetTokenPoolState()
  readonly #initChainRemoteConfig = new InitChainRemoteConfig()
  readonly #removeFromAllowlist = new RemoveFromAllowlist()

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
   * Reads a Burn/Mint, Lock/Release, or custom token pool's state account.
   * Pass `poolProgramAddress` instead of `poolType` for a custom pool program.
   *
   * @throws {@link CCTParamsInvalidError} If the token or pool program address is invalid.
   * @throws {@link CCIPTokenPoolStateNotFoundError} If the pool state account does not exist.
   * @throws {@link CCTDataDecodeError} If the pool state account cannot be decoded.
   *
   * @example
   * ```ts
   * const cct = SolanaTokenManager.fromChain(chain)
   * const state = await cct.getTokenPoolState({
   *   poolType: 'burn-mint',
   *   tokenAddress: mint,
   * })
   * ```
   */
  getTokenPoolState<P extends GetTokenPoolStateParams>(
    opts: P,
  ): Promise<GetTokenPoolStateResult<P>> {
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
export type { TransactionResult } from '../operation.ts'
export type { SerializedSolanaTxEncoding } from './serialize.ts'
export type * from './token/operations/index.ts'
export type * from './token-pool/operations/index.ts'
export type * from './token-admin-registry/operations/index.ts'
