import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { deriveTokenPoolSignerPda } from '../../programs/token-pool.ts'
import { validatePublicKey } from '../../validate.ts'
import { detectMintTokenProgram } from './spl.ts'

/** Parameters for creating the pool signer PDA's associated token account. **Solana only.** */
type CreatePoolTokenAccountParams = {
  /** SPL token mint (base58). */
  tokenAddress: string
  /** Pool state PDA (base58). The pool program ID is derived from its on-chain owner. */
  poolAddress: string
}

/** Parameters for unsigned Solana create-pool-token-account generation. */
export type GenerateCreatePoolTokenAccountParams =
  SolanaGenerateParams<CreatePoolTokenAccountParams>

/** Unsigned Solana create-pool-token-account result, including the derived addresses. */
export type GenerateCreatePoolTokenAccountResult = UnsignedSolanaTx & {
  /** The pool token ATA (base58), derivable pre-submit. */
  poolTokenAccount: string
  /** The pool signer PDA that owns the ATA (base58). */
  poolSignerPda: string
}

/** Parameters for executing Solana create-pool-token-account. */
export type ExecuteCreatePoolTokenAccountParams = SolanaExecuteParams<CreatePoolTokenAccountParams>

/** Result of executing Solana create-pool-token-account. */
export type ExecuteCreatePoolTokenAccountResult = TransactionHash & {
  /** The created pool token ATA (base58). */
  poolTokenAccount: string
  /** The pool signer PDA that owns the ATA (base58). */
  poolSignerPda: string
}

/**
 * Creates the pool signer PDA's associated token account (the pool "vault") via
 * `createAssociatedTokenAccountIdempotentInstruction`, so it is safe to call even when the ATA
 * already exists. The pool program ID is read from the pool state account's on-chain owner.
 */
export class CreatePoolTokenAccount extends SolanaOperation<
  CreatePoolTokenAccountParams,
  GenerateCreatePoolTokenAccountResult,
  ExecuteCreatePoolTokenAccountResult
> {
  readonly name = 'createPoolTokenAccount'

  /** Validates the mint, pool, and payer public keys before any RPC. */
  protected validate(params: GenerateCreatePoolTokenAccountParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
  }

  /** Builds the idempotent create-ATA instruction for the pool signer PDA. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: GenerateCreatePoolTokenAccountParams,
  ): Promise<GenerateCreatePoolTokenAccountResult> {
    const payer = new PublicKey(params.payer)
    const mint = new PublicKey(params.tokenAddress)

    const poolStateInfo = await chain.connection.getAccountInfo(new PublicKey(params.poolAddress))
    if (!poolStateInfo) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        'pool state account not found on-chain',
      )
    }
    const poolProgram = poolStateInfo.owner

    const tokenProgramId = await detectMintTokenProgram(chain, this.name, 'tokenAddress', mint)

    const poolSignerPda = deriveTokenPoolSignerPda(poolProgram, mint)
    const poolTokenAta = getAssociatedTokenAddressSync(
      mint,
      poolSignerPda,
      true, // allowOwnerOffCurve — PDAs are off-curve
      tokenProgramId,
    )

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      poolTokenAta,
      poolSignerPda,
      mint,
      tokenProgramId,
    )

    chain.logger.debug(
      `${this.name}: poolTokenAta = ${poolTokenAta.toBase58()}, poolSignerPda = ${poolSignerPda.toBase58()}`,
    )

    return {
      family: ChainFamily.Solana,
      instructions: [createAtaIx],
      mainIndex: 0,
      poolTokenAccount: poolTokenAta.toBase58(),
      poolSignerPda: poolSignerPda.toBase58(),
    }
  }

  /** Adds the derived ATA and owner to the execute result. */
  protected override resultFromGenerated(
    hash: TransactionHash,
    tx: GenerateCreatePoolTokenAccountResult,
  ): ExecuteCreatePoolTokenAccountResult {
    return { ...hash, poolTokenAccount: tx.poolTokenAccount, poolSignerPda: tx.poolSignerPda }
  }
}
