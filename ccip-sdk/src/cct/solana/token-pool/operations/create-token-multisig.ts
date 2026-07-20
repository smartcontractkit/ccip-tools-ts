import { MULTISIG_SIZE, createInitializeMultisigInstruction, unpackMint } from '@solana/spl-token'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { concat, hexlify, randomBytes, sha256, toUtf8Bytes } from 'ethers'

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
import {
  type TokenPoolType,
  deriveTokenPoolSignerPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  validateInteger,
  validateNonEmptyString,
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
  validateTokenProgram,
} from '../../validate.ts'

export const SOLANA_MULTISIG_MAX_SIGNERS = 11

/**
 * Parameters for creating an SPL Token multisig account for a Solana SPL mint.
 *
 * Default multisig signers are the token pool signer PDA for `poolType` and the mint authority
 * read from `tokenAddress`. `additionalSigners` are appended after those defaults.
 */
type CreateTokenMultisigParams = {
  tokenAddress: string
  poolType: TokenPoolType
  threshold: number
  /** Extra multisig member addresses in addition to pool signer PDA and mint authority. */
  additionalSigners?: string[]
  /** Optional human seed; internally hashed with mint to fit Solana's 32-byte seed limit. */
  seed?: string
}

/** Parameters for unsigned Solana token multisig generation. */
export type GenerateCreateTokenMultisigParams = SolanaGenerateParams<CreateTokenMultisigParams>

/** Unsigned token multisig transaction plus the created multisig address. */
export type GenerateCreateTokenMultisigResult = UnsignedSolanaTx & { multisigAddress: string }

/** Parameters for executing Solana token multisig creation. */
export type ExecuteCreateTokenMultisigParams = SolanaExecuteParams<CreateTokenMultisigParams>

/** Result of executing Solana token multisig creation. */
export type ExecuteCreateTokenMultisigResult = TransactionHash & { multisigAddress: string }

function dedupePublicKeys(signers: PublicKey[]) {
  const seen = new Set<string>()
  return signers.filter((signer) => {
    const address = signer.toBase58()
    if (seen.has(address)) return false
    seen.add(address)
    return true
  })
}

function validateMultisigSigners(operation: string, signers: PublicKey[], threshold: number) {
  if (signers.length < 1 || signers.length > SOLANA_MULTISIG_MAX_SIGNERS) {
    throw new CCTParamsInvalidError(
      operation,
      'additionalSigners',
      `multisig must have between 1 and ${SOLANA_MULTISIG_MAX_SIGNERS} total signers`,
    )
  }
  if (threshold < 1 || threshold > signers.length) {
    throw new CCTParamsInvalidError(
      operation,
      'threshold',
      'must be between 1 and total signer count',
    )
  }
}

function validateMintAccount(
  operation: string,
  mintAccount: Parameters<typeof unpackMint>[1],
): asserts mintAccount is NonNullable<Parameters<typeof unpackMint>[1]> {
  if (!mintAccount) throw new CCTParamsInvalidError(operation, 'tokenAddress', 'mint not found')
  validateTokenProgram(operation, 'tokenAddress', mintAccount.owner)
}

function getMintAuthority(
  operation: string,
  tokenMint: PublicKey,
  mintAccount: Parameters<typeof unpackMint>[1],
  tokenProgram: PublicKey,
): PublicKey {
  const { mintAuthority } = unpackMint(tokenMint, mintAccount, tokenProgram)
  if (!mintAuthority) {
    throw new CCTParamsInvalidError(operation, 'tokenAddress', 'mint has no mint authority')
  }
  return new PublicKey(mintAuthority.toBase58())
}

/**
 * Creates an SPL Token multisig with pool signer + mint authority + optional extra signers.
 *
 * The multisig account is derived with `createAccountWithSeed`, so no new signer keypair is needed.
 */
export class CreateTokenMultisig extends SolanaOperation<
  CreateTokenMultisigParams,
  GenerateCreateTokenMultisigResult
> {
  readonly name = 'createTokenMultisig'

  /** Validates public keys, threshold, and optional seed before mint/account RPCs. */
  protected validate(params: GenerateCreateTokenMultisigParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePoolType(this.name, 'poolType', params.poolType)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.additionalSigners !== undefined) {
      validatePublicKeys(this.name, 'additionalSigners', params.additionalSigners)
    }
    validateInteger(this.name, 'threshold', params.threshold)
    if (params.seed !== undefined) validateNonEmptyString(this.name, 'seed', params.seed)
  }

  /** Builds create-with-seed and initialize-multisig instructions. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateCreateTokenMultisigParams,
  ): Promise<GenerateCreateTokenMultisigResult> {
    const payer = new PublicKey(opts.payer)
    const tokenMint = new PublicKey(opts.tokenAddress)
    const poolProgram = resolveTokenPoolProgram(opts.poolType)
    const mintAccount = await chain.connection.getAccountInfo(tokenMint)
    validateMintAccount(this.name, mintAccount)

    const tokenProgram = mintAccount.owner
    const authority = getMintAuthority(this.name, tokenMint, mintAccount, tokenProgram)

    const signers = dedupePublicKeys([
      deriveTokenPoolSignerPda(poolProgram, tokenMint),
      authority,
      ...(opts.additionalSigners ?? []).map((signer) => new PublicKey(signer)),
    ])
    validateMultisigSigners(this.name, signers, opts.threshold)

    const seedMaterial = opts.seed ?? hexlify(randomBytes(16)).slice(2)
    const seedInput = concat([toUtf8Bytes(seedMaterial), tokenMint.toBuffer()])
    const seedHash = sha256(seedInput)
    const seed = seedHash.slice(2, 34)

    const multisig = await PublicKey.createWithSeed(authority, seed, tokenProgram)
    const lamports = await chain.connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE)
    const createIx = SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      newAccountPubkey: multisig,
      basePubkey: authority,
      seed,
      space: MULTISIG_SIZE,
      lamports,
      programId: tokenProgram,
    })
    const initIx = createInitializeMultisigInstruction(
      multisig,
      signers,
      opts.threshold,
      tokenProgram,
    )

    return {
      family: ChainFamily.Solana,
      instructions: [createIx, initIx],
      mainIndex: 0,
      multisigAddress: multisig.toBase58(),
    }
  }

  /** Generate, sign, simulate, send, and return the created multisig address. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteCreateTokenMultisigParams,
  ): Promise<ExecuteCreateTokenMultisigResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const generateParams: GenerateCreateTokenMultisigParams = {
      ...rest,
      payer: wallet.publicKey.toBase58(),
    }
    this.validate(generateParams)

    const tokenMint = new PublicKey(generateParams.tokenAddress)
    const mintAccount = await chain.connection.getAccountInfo(tokenMint)
    validateMintAccount(this.name, mintAccount)

    const tokenProgram = mintAccount.owner
    const mintAuthority = getMintAuthority(this.name, tokenMint, mintAccount, tokenProgram)
    if (!mintAuthority.equals(wallet.publicKey)) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        'createTokenMultisig requires the executing wallet to be the mint authority. Use generateUnsignedCreateTokenMultisig for vault-owned mints and have the vault sign/execute it.',
      )
    }

    const tx = await this.buildUnsigned(chain, generateParams)
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return { ...hash, multisigAddress: tx.multisigAddress }
  }
}
