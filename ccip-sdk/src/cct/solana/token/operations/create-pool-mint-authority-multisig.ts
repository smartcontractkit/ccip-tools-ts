import { MULTISIG_SIZE, createInitializeMultisigInstruction } from '@solana/spl-token'
import { PublicKey, SystemProgram } from '@solana/web3.js'

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

/** SPL Token multisig supports at most 11 signers. */
const MAX_MULTISIG_SIGNERS = 11

/**
 * Parameters for creating an SPL Token multisig whose first signer is the pool signer PDA.
 * **Solana burn-mint pools only.**
 */
type CreatePoolMintAuthorityMultisigParams = {
  /** SPL token mint (base58). */
  mint: string
  /** Burn-mint pool program ID (base58) used to derive the pool signer PDA. */
  poolProgramId: string
  /** Additional signers (base58), e.g. a Squads vault. The pool signer PDA is auto-prepended. */
  additionalSigners: string[]
  /** Required number of signers (m-of-n). Must be a positive integer. */
  threshold: number
  /**
   * Optional seed for the multisig account, derived via `createAccountWithSeed`. When omitted a
   * random seed is generated so only the payer must sign (matching the `deployToken` convention).
   */
  seed?: string
}

/** Parameters for unsigned Solana create-pool-mint-authority-multisig generation. */
export type GenerateCreatePoolMintAuthorityMultisigParams =
  SolanaGenerateParams<CreatePoolMintAuthorityMultisigParams>

/** Unsigned Solana create-pool-mint-authority-multisig result, including the derived addresses. */
export type GenerateCreatePoolMintAuthorityMultisigResult = UnsignedSolanaTx & {
  /** The multisig account address (base58), derivable pre-submit via `createAccountWithSeed`. */
  multisigAddress: string
  /** The auto-derived pool signer PDA (base58). */
  poolSignerPda: string
  /** All signers in order: `[poolSignerPda, ...additionalSigners]`. */
  allSigners: string[]
}

/** Parameters for executing Solana create-pool-mint-authority-multisig. */
export type ExecuteCreatePoolMintAuthorityMultisigParams =
  SolanaExecuteParams<CreatePoolMintAuthorityMultisigParams>

/** Result of executing Solana create-pool-mint-authority-multisig. */
export type ExecuteCreatePoolMintAuthorityMultisigResult = TransactionHash & {
  /** The created multisig account address (base58). */
  multisigAddress: string
  /** The auto-derived pool signer PDA (base58). */
  poolSignerPda: string
  /** All signers in order: `[poolSignerPda, ...additionalSigners]`. */
  allSigners: string[]
}

/**
 * Creates an SPL Token multisig with the pool signer PDA as its first signer. The multisig
 * account is created with `createAccountWithSeed` (seed provided or auto-generated) so the
 * address is derivable pre-submit and only the payer must sign. **Solana burn-mint pools only.**
 */
export class CreatePoolMintAuthorityMultisig extends SolanaOperation<
  CreatePoolMintAuthorityMultisigParams,
  GenerateCreatePoolMintAuthorityMultisigResult,
  ExecuteCreatePoolMintAuthorityMultisigResult
> {
  readonly name = 'createPoolMintAuthorityMultisig'

  /** Validates public keys, signer count, and threshold before any RPC. */
  protected validate(params: GenerateCreatePoolMintAuthorityMultisigParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'mint', params.mint)
    validatePublicKey(this.name, 'poolProgramId', params.poolProgramId)

    if (!Array.isArray(params.additionalSigners) || params.additionalSigners.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'additionalSigners',
        'must have at least one additional signer',
      )
    }
    params.additionalSigners.forEach((signer, i) =>
      validatePublicKey(this.name, `additionalSigners[${i}]`, signer),
    )

    // Total signers = 1 (pool signer PDA) + additionalSigners.length
    const totalSigners = 1 + params.additionalSigners.length
    if (totalSigners > MAX_MULTISIG_SIGNERS) {
      throw new CCTParamsInvalidError(
        this.name,
        'additionalSigners',
        `total signers (${totalSigners}) exceeds SPL Token multisig limit of ${MAX_MULTISIG_SIGNERS}`,
      )
    }
    if (!Number.isInteger(params.threshold) || params.threshold < 1) {
      throw new CCTParamsInvalidError(this.name, 'threshold', 'must be a positive integer')
    }
    if (params.threshold > totalSigners) {
      throw new CCTParamsInvalidError(
        this.name,
        'threshold',
        `threshold (${params.threshold}) exceeds total signers (${totalSigners})`,
      )
    }
  }

  /** Builds the create-account + initialize-multisig instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: GenerateCreatePoolMintAuthorityMultisigParams,
  ): Promise<GenerateCreatePoolMintAuthorityMultisigResult> {
    const payer = new PublicKey(params.payer)
    const mint = new PublicKey(params.mint)
    const poolProgram = new PublicKey(params.poolProgramId)

    const poolSignerPda = deriveTokenPoolSignerPda(poolProgram, mint)
    const allSignerPubkeys = [
      poolSignerPda,
      ...params.additionalSigners.map((s) => new PublicKey(s)),
    ]

    const tokenProgramId = await detectMintTokenProgram(chain, this.name, 'mint', mint)
    const lamports = await chain.connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE)

    const seed = params.seed ?? `multisig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const multisig = await PublicKey.createWithSeed(payer, seed, tokenProgramId)

    const instructions = [
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer,
        newAccountPubkey: multisig,
        basePubkey: payer,
        seed,
        lamports,
        space: MULTISIG_SIZE,
        programId: tokenProgramId,
      }),
      createInitializeMultisigInstruction(
        multisig,
        allSignerPubkeys,
        params.threshold,
        tokenProgramId,
      ),
    ]

    const allSigners = allSignerPubkeys.map((pk) => pk.toBase58())
    chain.logger.debug(
      `${this.name}: multisig = ${multisig.toBase58()}, poolSignerPda = ${poolSignerPda.toBase58()}, signers = ${allSigners.length}, threshold = ${params.threshold}`,
    )

    return {
      family: ChainFamily.Solana,
      instructions,
      mainIndex: 1,
      multisigAddress: multisig.toBase58(),
      poolSignerPda: poolSignerPda.toBase58(),
      allSigners,
    }
  }

  /** Adds the derived multisig metadata to the execute result. */
  protected override resultFromGenerated(
    hash: TransactionHash,
    tx: GenerateCreatePoolMintAuthorityMultisigResult,
  ): ExecuteCreatePoolMintAuthorityMultisigResult {
    return {
      ...hash,
      multisigAddress: tx.multisigAddress,
      poolSignerPda: tx.poolSignerPda,
      allSigners: tx.allSigners,
    }
  }
}
