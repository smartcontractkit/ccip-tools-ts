import { type PublicKey, SystemProgram } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type PoolProgramRef,
  createTokenPoolProgram,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

/** Parameters shared by Solana token pool `configureAllowlist` generation and execution. */
type ConfigureAllowlistParams = PoolProgramRef & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Addresses to append to the pool allowlist. Must not contain duplicates. */
  add: string[]
  /** Whether the pool should enforce its allowlist. */
  enabled: boolean
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedConfigureAllowlistParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  add: PublicKey[]
  enabled: boolean
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana token pool allowlist configuration. */
export type GenerateConfigureAllowlistParams = SolanaGenerateParams<ConfigureAllowlistParams>

/** Unsigned Solana token pool allowlist configuration result. */
export type GenerateConfigureAllowlistResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool allowlist configuration. */
export type ExecuteConfigureAllowlistParams = SolanaExecuteParams<ConfigureAllowlistParams>

/** Result of executing Solana token pool allowlist configuration. */
export type ExecuteConfigureAllowlistResult = TransactionResult

/** Adds addresses to and enables or disables a Solana token pool allowlist. */
export class ConfigureAllowlist extends SolanaOperation<
  ConfigureAllowlistParams,
  UnsignedSolanaTx,
  ParsedConfigureAllowlistParams
> {
  readonly name = 'configureAllowlist'

  /** {@link parse} validates and normalizes all parameters. */
  protected validate(_params: GenerateConfigureAllowlistParams): void {}

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(
    params: GenerateConfigureAllowlistParams,
  ): ParsedConfigureAllowlistParams {
    if (!Array.isArray(params.add)) {
      throw new CCTParamsInvalidError(this.name, 'add', 'must be an array')
    }
    if (typeof params.enabled !== 'boolean') {
      throw new CCTParamsInvalidError(this.name, 'enabled', 'must be a boolean')
    }

    const add = params.add.map((address, index) =>
      parsePublicKey(this.name, `add[${index}]`, address),
    )
    if (new Set(add.map((address) => address.toBase58())).size !== add.length) {
      throw new CCTParamsInvalidError(this.name, 'add', 'must not contain duplicate addresses')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram: resolvePoolProgram(this.name, params),
      add,
      enabled: params.enabled,
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `configureAllowList` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedConfigureAllowlistParams,
  ): Promise<UnsignedSolanaTx> {
    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const state = deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress)

    const instruction = await program.methods
      .configureAllowList(opts.add, opts.enabled)
      .accountsStrict({
        state,
        mint: opts.tokenAddress,
        authority: opts.authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteConfigureAllowlistParams,
  ): Promise<ExecuteConfigureAllowlistResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const generateParams: GenerateConfigureAllowlistParams = {
      ...rest,
      payer: wallet.publicKey.toBase58(),
    }
    const parsed = this.prepare(generateParams)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'configureAllowlist requires authority to be the executing wallet. Use generateUnsignedConfigureAllowlist for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
