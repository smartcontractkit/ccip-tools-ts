import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import { validatePublicKey, validateTokenProgram } from '../../validate.ts'

/** Parameters for deriving and creating a Solana associated token account. */
type CreateTokenAccountParams = {
  /** SPL token mint address for the associated token account. */
  tokenAddress: string
  /** Wallet or PDA owner address for the associated token account. */
  ownerAddress: string
}

/** Parameters for unsigned Solana associated token account creation. */
export type GenerateCreateTokenAccountParams = SolanaGenerateParams<CreateTokenAccountParams>

/** Unsigned associated token account creation tx plus the derived token account address. */
export type GenerateCreateTokenAccountResult = UnsignedSolanaTx & { tokenAccountAddress: string }

/** Parameters for executing Solana associated token account creation. */
export type ExecuteCreateTokenAccountParams = SolanaExecuteParams<CreateTokenAccountParams>

/** Result of executing Solana associated token account creation. */
export type ExecuteCreateTokenAccountResult = TransactionHash & { tokenAccountAddress: string }

/** Creates an Associated Token Account for any wallet or PDA owner. */
export class CreateTokenAccount extends SolanaOperation<
  CreateTokenAccountParams,
  GenerateCreateTokenAccountResult
> {
  readonly name = 'createTokenAccount'

  /** Validates create-token-account parameters. */
  protected validate(params: GenerateCreateTokenAccountParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'ownerAddress', params.ownerAddress)
  }

  /** Builds an unsigned idempotent associated token account creation transaction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: GenerateCreateTokenAccountParams,
  ): Promise<GenerateCreateTokenAccountResult> {
    const payer = new PublicKey(params.payer)
    const mint = new PublicKey(params.tokenAddress)
    const owner = new PublicKey(params.ownerAddress)
    const mintAccount = await chain.connection.getAccountInfo(mint)

    if (!mintAccount) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'token mint not found')
    }

    validateTokenProgram(this.name, 'tokenAddress', mintAccount.owner)

    const tokenAccount = getAssociatedTokenAddressSync(mint, owner, true, mintAccount.owner)

    chain.logger.debug(
      `${this.name}: mint = ${mint.toBase58()}, owner = ${owner.toBase58()}, tokenAccount = ${tokenAccount.toBase58()}, tokenProgram = ${mintAccount.owner.toBase58()}`,
    )

    return {
      family: ChainFamily.Solana,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          tokenAccount,
          owner,
          mint,
          mintAccount.owner,
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
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const tx = await this.generate(chain, { ...rest, payer: wallet.publicKey.toBase58() })
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return { ...hash, tokenAccountAddress: tx.tokenAccountAddress }
  }
}
