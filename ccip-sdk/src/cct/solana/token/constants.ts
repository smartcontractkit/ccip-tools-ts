import { PublicKey } from '@solana/web3.js'

/** Metaplex Token Metadata program address. */
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

/** SPL Token authority roles that can be set. */
export const TOKEN_AUTHORITY_TYPES = {
  MINT: 'mint',
  FREEZE: 'freeze',
} as const
