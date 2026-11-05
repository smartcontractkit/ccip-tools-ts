import { PublicKey } from '@solana/web3.js'

import { METADATA_PROGRAM_ID } from '../token/constants.ts'

/** Derives the Metaplex metadata PDA for a mint. */
export function deriveMetadataAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0]
}
