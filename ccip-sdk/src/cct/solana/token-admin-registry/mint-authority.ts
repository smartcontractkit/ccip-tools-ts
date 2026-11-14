/**
 * The Router's two ways for a token's owner to act on its TokenAdminRegistry: as the mint
 * authority itself, or as a signer of a 1-of-N SPL multisig mint authority.
 *
 * @packageDocumentation
 */

import { MULTISIG_SIZE, unpackMint, unpackMultisig } from '@solana/spl-token'
import type { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../solana/index.ts'
import { resolveTokenMint } from '../../../solana/utils.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/**
 * A token's mint authority (`null` if the mint has none), and its threshold and signers when it is
 * an initialized SPL multisig of the mint's token program, as the Router loads it.
 */
export type TokenMintAuthority = {
  mintAuthority: PublicKey | null
  multisig?: { m: number; signers: PublicKey[] }
}

/** Reads `address` as an initialized SPL multisig of `tokenProgram`, if it is one. */
async function readMultisig(
  chain: SolanaChain,
  address: PublicKey,
  tokenProgram: PublicKey,
): Promise<TokenMintAuthority['multisig']> {
  const account = await chain.connection.getAccountInfo(address)
  if (!account?.owner.equals(tokenProgram) || account.data.length !== MULTISIG_SIZE) return
  const multisig = unpackMultisig(address, account, tokenProgram)
  if (!multisig.isInitialized) return
  const signers = [
    multisig.signer1,
    multisig.signer2,
    multisig.signer3,
    multisig.signer4,
    multisig.signer5,
    multisig.signer6,
    multisig.signer7,
    multisig.signer8,
    multisig.signer9,
    multisig.signer10,
    multisig.signer11,
  ].slice(0, multisig.n)
  return { m: multisig.m, signers }
}

/** Reads a token's mint authority, and whether it is an SPL multisig. */
export async function readTokenMintAuthority(
  chain: SolanaChain,
  tokenMint: PublicKey,
): Promise<TokenMintAuthority> {
  const mintAccount = await resolveTokenMint(chain.connection, tokenMint)
  const { mintAuthority } = unpackMint(tokenMint, mintAccount, mintAccount.owner)
  if (!mintAuthority) return { mintAuthority }
  const multisig = await readMultisig(chain, mintAuthority, mintAccount.owner)
  return { mintAuthority, ...(multisig && { multisig }) }
}

/**
 * Checks what the Router's `multisig_owner_*` instructions require of a multisig mint authority:
 * a 1-of-N multisig (threshold 1) that lists `authority` as a signer.
 * @throws {@link CCTParamsInvalidError} if the threshold is not 1, or `authority` is not a signer.
 */
export function validateMultisigOwnerSigner(
  operation: string,
  mintAuthority: PublicKey,
  { m, signers }: NonNullable<TokenMintAuthority['multisig']>,
  authority: PublicKey,
): void {
  if (m !== 1)
    throw new CCTParamsInvalidError(
      operation,
      'authority',
      `the mint authority ${mintAuthority.toBase58()} is a ${m}-of-${signers.length} multisig; the Router accepts only 1-of-N multisig mint authorities, so use the ccip-admin path`,
    )
  if (!signers.some((signer) => signer.equals(authority)))
    throw new CCTParamsInvalidError(
      operation,
      'authority',
      `must be a signer of the mint authority multisig ${mintAuthority.toBase58()}`,
    )
}
