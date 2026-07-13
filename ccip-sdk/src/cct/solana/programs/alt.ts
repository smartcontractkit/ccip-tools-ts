import { Buffer } from 'buffer'

import {
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

const CREATE_LOOKUP_TABLE_DISCRIMINATOR = 0
const CREATE_LOOKUP_TABLE_DATA_LENGTH = 13

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
