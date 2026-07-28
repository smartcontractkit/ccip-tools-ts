/**
 * getMintBurnRoles (Solana) — reads a mint's current mint authority and, if that
 * authority is an SPL Token multisig, its threshold and members.
 *
 * On Solana "mint/burn access" is the single SPL mint authority (not a role set),
 * optionally an m-of-n multisig. Read-only — not a write {@link Operation}.
 *
 * @packageDocumentation
 */

import {
  MULTISIG_SIZE,
  MintLayout,
  MultisigLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/** A mint's mint-authority, with multisig detail when applicable. */
export type MintBurnRolesResult = {
  /** Current mint authority (base58), or `null` if disabled. */
  mintAuthority: string | null
  /** Whether the mint authority is an SPL Token multisig. */
  isMultisig: boolean
  /** Multisig threshold (m-of-n). Only set when `isMultisig` is true. */
  multisigThreshold?: number
  /** Multisig members. Only set when `isMultisig` is true. */
  multisigMembers?: Array<{ address: string }>
}

const SIGNER_KEYS = [
  'signer1',
  'signer2',
  'signer3',
  'signer4',
  'signer5',
  'signer6',
  'signer7',
  'signer8',
  'signer9',
  'signer10',
  'signer11',
] as const

/** Reads the mint authority (and multisig detail) for a Solana mint. */
export async function getMintBurnRoles(
  chain: SolanaChain,
  tokenAddress: string,
): Promise<MintBurnRolesResult> {
  const mintPubkey = new PublicKey(tokenAddress)
  const mintAccountInfo = await chain.connection.getAccountInfo(mintPubkey)
  if (!mintAccountInfo) {
    throw new CCTParamsInvalidError(
      'getMintBurnRoles',
      'tokenAddress',
      'mint account not found on-chain',
    )
  }

  const rawMint = MintLayout.decode(mintAccountInfo.data)
  const mintAuthority = rawMint.mintAuthorityOption === 1 ? rawMint.mintAuthority.toBase58() : null
  if (!mintAuthority) return { mintAuthority: null, isMultisig: false }

  const authorityInfo = await chain.connection.getAccountInfo(new PublicKey(mintAuthority))
  const isOwnedByTokenProgram =
    authorityInfo?.owner.equals(TOKEN_PROGRAM_ID) ||
    authorityInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
  if (!authorityInfo || authorityInfo.data.length !== MULTISIG_SIZE || !isOwnedByTokenProgram) {
    return { mintAuthority, isMultisig: false }
  }

  const rawMultisig = MultisigLayout.decode(authorityInfo.data)
  if (!rawMultisig.isInitialized) return { mintAuthority, isMultisig: false }

  const multisigMembers: Array<{ address: string }> = []
  for (let i = 0; i < rawMultisig.n; i++) {
    multisigMembers.push({ address: rawMultisig[SIGNER_KEYS[i]!].toBase58() })
  }
  chain.logger.debug(
    `getMintBurnRoles: token=${tokenAddress}, authority=${mintAuthority}, isMultisig=true, threshold=${rawMultisig.m}, members=${multisigMembers.length}`,
  )
  return { mintAuthority, isMultisig: true, multisigThreshold: rawMultisig.m, multisigMembers }
}
