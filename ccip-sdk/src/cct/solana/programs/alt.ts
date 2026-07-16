import { Buffer } from 'buffer'

import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

import { deriveFeeBillingTokenConfigPda } from './fee-quoter.ts'
import { deriveExternalTokenPoolsSignerPda, deriveTokenAdminRegistryPda } from './router.ts'
import { deriveTokenPoolConfigPda, deriveTokenPoolSignerPda } from './token-pool.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { resolveATA } from '../../../solana/utils.ts'

const CREATE_LOOKUP_TABLE_DISCRIMINATOR = 0
const CREATE_LOOKUP_TABLE_DATA_LENGTH = 13

type DeriveCcipLookupTableAddressesParams = {
  lookupTableAddress: PublicKey
  tokenMint: PublicKey
  poolProgram: PublicKey
  authority: PublicKey
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
  { lookupTableAddress, tokenMint, poolProgram, authority }: DeriveCcipLookupTableAddressesParams,
): Promise<PublicKey[]> {
  const { tokenProgram } = await resolveATA(chain.connection, tokenMint, authority)
  const poolConfig = deriveTokenPoolConfigPda(poolProgram, tokenMint)
  const { router: routerAddress } = await chain.getTokenPoolConfig(poolConfig.toBase58())
  const router = new PublicKey(routerAddress)
  const { feeQuoter } = await chain._getRouterConfig(routerAddress)

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
