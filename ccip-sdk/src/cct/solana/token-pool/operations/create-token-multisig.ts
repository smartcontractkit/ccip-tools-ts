import { MULTISIG_SIZE, createInitializeMultisigInstruction, unpackMint } from '@solana/spl-token'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { concat, hexlify, randomBytes, sha256, toUtf8Bytes } from 'ethers'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveTokenMint } from '../../../../solana/utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
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
  parseOptionalPublicKey,
  parsePublicKey,
  validateAuthorityMatchesWallet,
  validateInteger,
  validateNonEmptyString,
  validatePoolType,
} from '../../validate.ts'

export const SOLANA_MULTISIG_MAX_SIGNERS = 11

type MintAccount = NonNullable<Parameters<typeof unpackMint>[1]>

/**
 * Parameters for creating an SPL Token multisig account for a Solana SPL mint.
 *
 * The pool signer PDA occupies `threshold` slots so it can mint autonomously. The mint authority
 * read from `tokenAddress` and `additionalSigners` supply the independent signer slots.
 */
type CreateTokenMultisigParams = {
  tokenAddress: string
  poolType: TokenPoolType
  /**
   * Address of the `poolType` program. Defaults to the canonical address for `poolType`; set it
   * where that program is deployed elsewhere. The pool signer PDA derives from it.
   */
  poolProgramAddress?: string
  threshold: number
  /** Extra multisig member addresses in addition to pool signer PDA and mint authority. */
  additionalSigners?: string[]
  /** Optional human seed; internally hashed with mint to fit Solana's 32-byte seed limit. */
  seed?: string
}

/** Parameters for unsigned Solana token multisig generation. */
export type GenerateCreateTokenMultisigParams = SolanaGenerateParams<CreateTokenMultisigParams>

type ParsedCreateTokenMultisigParams = {
  tokenMint: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  threshold: number
  additionalSigners: PublicKey[]
  seed?: string
}

/** Unsigned token multisig transaction plus the created multisig address. */
export type GenerateCreateTokenMultisigResult = UnsignedSolanaTx & { multisigAddress: string }

/** Parameters for executing Solana token multisig creation. */
export type ExecuteCreateTokenMultisigParams = SolanaExecuteParams<CreateTokenMultisigParams>

/** Result of executing Solana token multisig creation. */
export type ExecuteCreateTokenMultisigResult = TransactionResult & { multisigAddress: string }

function dedupePublicKeys(signers: PublicKey[]) {
  const seen = new Set<string>()
  return signers.filter((signer) => {
    const address = signer.toBase58()
    if (seen.has(address)) return false
    seen.add(address)
    return true
  })
}

function validatePoolMultisigConfig(
  operation: string,
  signers: PublicKey[],
  poolSigner: PublicKey,
  threshold: number,
) {
  const poolSignerCount = signers.filter((signer) => signer.equals(poolSigner)).length
  const nonPoolSignerCount = signers.length - poolSignerCount

  if (signers.length < 2 || signers.length > SOLANA_MULTISIG_MAX_SIGNERS) {
    throw new CCTParamsInvalidError(
      operation,
      'additionalSigners',
      `multisig must have between 2 and ${SOLANA_MULTISIG_MAX_SIGNERS} total signers`,
    )
  }
  if (threshold < 1) {
    throw new CCTParamsInvalidError(operation, 'threshold', 'must be at least 1')
  }
  if (threshold > signers.length) {
    throw new CCTParamsInvalidError(operation, 'threshold', 'cannot exceed total signer count')
  }
  if (poolSignerCount < threshold) {
    throw new CCTParamsInvalidError(
      operation,
      'threshold',
      'pool signer must occupy at least threshold signer slots',
    )
  }
  if (nonPoolSignerCount < threshold) {
    throw new CCTParamsInvalidError(
      operation,
      'threshold',
      'requires at least threshold non-pool signers',
    )
  }
}

function getMintAuthority(
  operation: string,
  tokenMint: PublicKey,
  mintAccount: MintAccount,
  tokenProgram: PublicKey,
): PublicKey {
  const { mintAuthority } = unpackMint(tokenMint, mintAccount, tokenProgram)
  if (!mintAuthority) {
    throw new CCTParamsInvalidError(operation, 'tokenAddress', 'mint has no mint authority')
  }
  return new PublicKey(mintAuthority.toBase58())
}

/**
 * Derives the multisig account `createTokenMultisig` creates for a seed: an account with seed
 * under the mint authority (`base`), so the same seed always yields the same address.
 * @returns The multisig address, and the account seed (the seed hashed with the mint).
 */
export async function deriveTokenMultisigAddress(
  base: PublicKey,
  seed: string,
  tokenMint: PublicKey,
  tokenProgram: PublicKey,
): Promise<{ address: PublicKey; accountSeed: string }> {
  const accountSeed = sha256(concat([toUtf8Bytes(seed), tokenMint.toBuffer()])).slice(2, 34)
  return {
    address: await PublicKey.createWithSeed(base, accountSeed, tokenProgram),
    accountSeed,
  }
}

/**
 * Creates an SPL Token multisig with threshold pool signer slots and independent signers.
 *
 * The multisig account is derived with `createAccountWithSeed`, so no new signer keypair is needed.
 */
export class CreateTokenMultisig extends SolanaOperation<
  CreateTokenMultisigParams,
  GenerateCreateTokenMultisigResult,
  ParsedCreateTokenMultisigParams
> {
  readonly name = 'createTokenMultisig'

  /** Parses public keys, threshold, and optional seed before mint/account RPCs. */
  protected override prepare(
    params: GenerateCreateTokenMultisigParams,
  ): ParsedCreateTokenMultisigParams {
    validatePoolType(this.name, 'poolType', params.poolType)
    if (params.additionalSigners !== undefined && !Array.isArray(params.additionalSigners)) {
      throw new CCTParamsInvalidError(this.name, 'additionalSigners', 'must be an array')
    }
    validateInteger(this.name, 'threshold', params.threshold, 1, SOLANA_MULTISIG_MAX_SIGNERS)
    if (params.seed !== undefined) validateNonEmptyString(this.name, 'seed', params.seed)

    return {
      tokenMint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram:
        parseOptionalPublicKey(this.name, 'poolProgramAddress', params.poolProgramAddress) ??
        resolveTokenPoolProgram(params.poolType),
      payer: parsePublicKey(this.name, 'payer', params.payer),
      threshold: params.threshold,
      additionalSigners: (params.additionalSigners ?? []).map((signer, i) =>
        parsePublicKey(this.name, `additionalSigners[${i}]`, signer),
      ),
      ...(params.seed !== undefined && { seed: params.seed }),
    }
  }

  /** Builds create-with-seed and initialize-multisig instructions. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedCreateTokenMultisigParams,
    mintContext?: { account: MintAccount; authority: PublicKey },
  ): Promise<GenerateCreateTokenMultisigResult> {
    const { payer, tokenMint, poolProgram } = opts
    const mintAccount =
      mintContext?.account ?? (await resolveTokenMint(chain.connection, tokenMint))

    const tokenProgram = mintAccount.owner
    const authority =
      mintContext?.authority ?? getMintAuthority(this.name, tokenMint, mintAccount, tokenProgram)

    const poolSigner = deriveTokenPoolSignerPda(poolProgram, tokenMint)
    const nonPoolSigners = dedupePublicKeys([authority, ...opts.additionalSigners]).filter(
      (signer) => !signer.equals(poolSigner),
    )

    const signers = [...Array.from({ length: opts.threshold }, () => poolSigner), ...nonPoolSigners]
    validatePoolMultisigConfig(this.name, signers, poolSigner, opts.threshold)

    const { address: multisig, accountSeed: seed } = await deriveTokenMultisigAddress(
      authority,
      opts.seed ?? hexlify(randomBytes(16)).slice(2),
      tokenMint,
      tokenProgram,
    )
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
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    const mintAccount = await resolveTokenMint(chain.connection, parsed.tokenMint)

    const tokenProgram = mintAccount.owner
    const mintAuthority = getMintAuthority(this.name, parsed.tokenMint, mintAccount, tokenProgram)
    validateAuthorityMatchesWallet(
      this.name,
      mintAuthority,
      wallet.publicKey,
      'createTokenMultisig requires the executing wallet to be the mint authority. Use generateUnsignedCreateTokenMultisig for vault-owned mints and have the vault sign/execute it.',
    )

    const tx = await this.buildUnsigned(chain, parsed, {
      account: mintAccount,
      authority: mintAuthority,
    })
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return { ...hash, multisigAddress: tx.multisigAddress }
  }
}
