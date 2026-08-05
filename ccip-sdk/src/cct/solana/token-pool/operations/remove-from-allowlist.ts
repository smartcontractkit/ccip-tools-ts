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

/** Parameters shared by Solana token pool `removeFromAllowlist` generation and execution. */
type RemoveFromAllowlistParams = PoolProgramRef & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Addresses to remove from the pool allowlist. */
  allowlist: string[]
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedRemoveFromAllowlistParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  allowlist: PublicKey[]
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana token pool allowlist removal. */
export type GenerateRemoveFromAllowlistParams = SolanaGenerateParams<RemoveFromAllowlistParams>

/** Unsigned Solana token pool allowlist removal result. */
export type GenerateRemoveFromAllowlistResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool allowlist removal. */
export type ExecuteRemoveFromAllowlistParams = SolanaExecuteParams<RemoveFromAllowlistParams>

/** Result of executing Solana token pool allowlist removal. */
export type ExecuteRemoveFromAllowlistResult = TransactionResult

/** Removes addresses from a Solana token pool allowlist. */
export class RemoveFromAllowlist extends SolanaOperation<
  RemoveFromAllowlistParams,
  UnsignedSolanaTx,
  ParsedRemoveFromAllowlistParams
> {
  readonly name = 'removeFromAllowlist'

  /** Validation runs in {@link parse}. */
  protected validate(_params: GenerateRemoveFromAllowlistParams): void {}

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(
    params: GenerateRemoveFromAllowlistParams,
  ): ParsedRemoveFromAllowlistParams {
    if (!Array.isArray(params.allowlist)) {
      throw new CCTParamsInvalidError(this.name, 'allowlist', 'must be an array')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram: resolvePoolProgram(this.name, params),
      allowlist: params.allowlist.map((address, index) =>
        parsePublicKey(this.name, `allowlist[${index}]`, address),
      ),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `removeFromAllowList` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedRemoveFromAllowlistParams,
  ): Promise<UnsignedSolanaTx> {
    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const state = deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress)

    const instruction = await program.methods
      .removeFromAllowList(opts.allowlist)
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
    params: ExecuteRemoveFromAllowlistParams,
  ): Promise<ExecuteRemoveFromAllowlistResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const generateParams: GenerateRemoveFromAllowlistParams = {
      ...rest,
      payer: wallet.publicKey.toBase58(),
    }
    const parsed = this.prepare(generateParams)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'removeFromAllowlist requires authority to be the executing wallet. Use generateUnsignedRemoveFromAllowlist for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
