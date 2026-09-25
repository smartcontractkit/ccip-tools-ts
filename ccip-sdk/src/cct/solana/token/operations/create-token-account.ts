import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import type { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveATA } from '../../../../solana/utils.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey } from '../../validate.ts'

/** Parameters for deriving and creating a Solana associated token account. */
type CreateTokenAccountParams = {
  /** SPL token mint address for the associated token account. */
  tokenAddress: string
  /** Wallet or PDA owner address for the associated token account. */
  ownerAddress: string
}

/** Parameters for unsigned Solana associated token account creation. */
export type GenerateCreateTokenAccountParams = SolanaGenerateParams<CreateTokenAccountParams>

type ParsedCreateTokenAccountParams = {
  payer: PublicKey
  tokenAddress: PublicKey
  ownerAddress: PublicKey
}

/** Unsigned associated token account creation tx plus the derived token account address. */
export type GenerateCreateTokenAccountResult = UnsignedSolanaTx & { tokenAccountAddress: string }

/** Parameters for executing Solana associated token account creation. */
export type ExecuteCreateTokenAccountParams = SolanaExecuteParams<CreateTokenAccountParams>

/** Result of executing Solana associated token account creation. */
export type ExecuteCreateTokenAccountResult = TransactionResult & { tokenAccountAddress: string }

/** Creates an Associated Token Account for any wallet or PDA owner. */
export class CreateTokenAccount extends SolanaOperation<
  CreateTokenAccountParams,
  GenerateCreateTokenAccountResult,
  ParsedCreateTokenAccountParams
> {
  readonly name = 'createTokenAccount'

  /** Parses create-token-account parameters. */
  protected override parse(
    params: GenerateCreateTokenAccountParams,
  ): ParsedCreateTokenAccountParams {
    return {
      payer: parsePublicKey(this.name, 'payer', params.payer),
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      ownerAddress: parsePublicKey(this.name, 'ownerAddress', params.ownerAddress),
    }
  }

  /** Builds an unsigned idempotent associated token account creation transaction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: ParsedCreateTokenAccountParams,
  ): Promise<GenerateCreateTokenAccountResult> {
    const { payer, tokenAddress: mint, ownerAddress: owner } = params
    const { ata: tokenAccount, tokenProgram } = await resolveATA(chain.connection, mint, owner)

    chain.logger.debug(
      `${this.name}: mint = ${mint.toBase58()}, owner = ${owner.toBase58()}, tokenAccount = ${tokenAccount.toBase58()}, tokenProgram = ${tokenProgram.toBase58()}`,
    )

    return {
      family: ChainFamily.Solana,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          tokenAccount,
          owner,
          mint,
          tokenProgram,
        ),
      ],
      mainIndex: 0,
      tokenAccountAddress: tokenAccount.toBase58(),
    }
  }

  /** Generate, sign, simulate, send, confirm, and return the derived token account address. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteCreateTokenAccountParams,
  ): Promise<ExecuteCreateTokenAccountResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    const tx = await this.buildUnsigned(chain, parsed)
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)

    return { ...hash, tokenAccountAddress: tx.tokenAccountAddress }
  }
}
