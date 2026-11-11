import { Buffer } from 'buffer'

import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  AddressLookupTableProgram,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

import type { SolanaChain } from '../../../solana/index.ts'
import { resolveTokenProgram } from '../../../solana/utils.ts'
import { deriveFeeBillingTokenConfigPda } from './fee-quoter.ts'
import { deriveExternalTokenPoolsSignerPda, deriveTokenAdminRegistryPda } from './router.ts'
import { deriveTokenPoolConfigPda, deriveTokenPoolSignerPda } from './token-pool.ts'

/** Owner of every sysvar account. */
const SYSVAR_OWNER = new PublicKey('Sysvar1111111111111111111111111111111111111')

const CREATE_LOOKUP_TABLE_DISCRIMINATOR = 0
const CREATE_LOOKUP_TABLE_DATA_LENGTH = 13

type DeriveCcipLookupTableAddressesParams = {
  lookupTableAddress: PublicKey
  tokenMint: PublicKey
  poolProgram: PublicKey
  /** Router recorded in the pool state. */
  router: PublicKey
}

type BuildCreateLookupTableInstructionParams = {
  authority: PublicKey
  payer: PublicKey
  recentSlot: number | bigint
}

type BuildCreateLookupTableInstructionResult = {
  instruction: TransactionInstruction
  lookupTableAddress: PublicKey
}

/** How many entries back in `SlotHashes` a lookup table's recent slot is, for RPC nodes behind. */
export const LOOKUP_TABLE_SLOT_MARGIN = 32

// SlotHashes: a u64 count, then (u64 slot, 32-byte hash) entries, newest first
const SLOT_HASH_ENTRY_SIZE = 40

/**
 * Picks the recent slot to create a lookup table from: the {@link LOOKUP_TABLE_SLOT_MARGIN}th
 * newest entry of the node's `SlotHashes` (its oldest, if it has fewer), or the finalized slot if
 * the sysvar cannot be read.
 *
 * @remarks The ALT program only accepts a slot in the `SlotHashes` of the node that runs the
 * transaction, so the slot comes from that list, which also holds on a fresh fork or local
 * validator with a short history. Going back {@link LOOKUP_TABLE_SLOT_MARGIN} entries covers a
 * load-balanced RPC that simulates or lands the transaction on a node behind the one that answered.
 * It shortens the 512-slot window to land the creation by that margin.
 */
export async function recentLookupTableSlot(connection: {
  getAccountInfo: (
    address: PublicKey,
    commitment: 'confirmed',
  ) => Promise<{ owner: PublicKey; data: Buffer } | null>
  getSlot: (commitment: 'finalized') => Promise<number>
}): Promise<number> {
  const sysvar = await connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY, 'confirmed')
  if (sysvar?.owner.equals(SYSVAR_OWNER) && sysvar.data.length >= 8 + SLOT_HASH_ENTRY_SIZE) {
    const entries = Math.min(
      Number(sysvar.data.readBigUInt64LE(0)),
      Math.floor((sysvar.data.length - 8) / SLOT_HASH_ENTRY_SIZE),
    )
    if (entries > 0) {
      const index = Math.min(LOOKUP_TABLE_SLOT_MARGIN, entries - 1)
      return Number(sysvar.data.readBigUInt64LE(8 + index * SLOT_HASH_ENTRY_SIZE))
    }
  }
  return connection.getSlot('finalized')
}

/** Builds an ALT create instruction without requiring the authority signature. */
export function buildCreateLookupTableInstruction({
  authority,
  payer,
  recentSlot,
}: BuildCreateLookupTableInstructionParams): BuildCreateLookupTableInstructionResult {
  const recentSlotBigInt = BigInt(recentSlot)
  const recentSlotBuffer = Buffer.alloc(8)
  recentSlotBuffer.writeBigUInt64LE(recentSlotBigInt)

  const [lookupTableAddress, bump] = PublicKey.findProgramAddressSync(
    [authority.toBuffer(), recentSlotBuffer],
    AddressLookupTableProgram.programId,
  )

  const data = Buffer.alloc(CREATE_LOOKUP_TABLE_DATA_LENGTH)
  data.writeUInt32LE(CREATE_LOOKUP_TABLE_DISCRIMINATOR, 0)
  data.writeBigUInt64LE(recentSlotBigInt, 4)
  data.writeUInt8(bump, 12)

  return {
    lookupTableAddress,
    instruction: new TransactionInstruction({
      programId: AddressLookupTableProgram.programId,
      keys: [
        { pubkey: lookupTableAddress, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  }
}

/** Derives the standard CCIP token pool addresses stored in a pool lookup table. */
export async function deriveCcipLookupTableAddresses(
  chain: SolanaChain,
  { lookupTableAddress, tokenMint, poolProgram, router }: DeriveCcipLookupTableAddressesParams,
): Promise<PublicKey[]> {
  const tokenProgram = await resolveTokenProgram(chain.connection, tokenMint)
  const poolConfig = deriveTokenPoolConfigPda(poolProgram, tokenMint)
  const { feeQuoter } = await chain._getRouterConfig(router.toBase58())

  const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, tokenMint)
  const poolSigner = deriveTokenPoolSignerPda(poolProgram, tokenMint)
  const poolTokenAta = getAssociatedTokenAddressSync(tokenMint, poolSigner, true, tokenProgram)
  const feeTokenConfig = deriveFeeBillingTokenConfigPda(feeQuoter, tokenMint)
  const routerPoolSigner = deriveExternalTokenPoolsSignerPda(router, poolProgram)

  return [
    lookupTableAddress,
    tokenAdminRegistry,
    poolProgram,
    poolConfig,
    poolTokenAta,
    poolSigner,
    tokenProgram,
    tokenMint,
    feeTokenConfig,
    routerPoolSigner,
  ]
}
