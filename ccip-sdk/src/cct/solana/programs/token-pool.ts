import { PublicKey } from '@solana/web3.js'

/** Derives a token pool state/config PDA for a mint. */
export function deriveTokenPoolConfigPda(poolProgram: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_config'), mint.toBuffer()],
    poolProgram,
  )[0]
}

/** Derives a token pool signer PDA for a mint. */
export function deriveTokenPoolSignerPda(poolProgram: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_signer'), mint.toBuffer()],
    poolProgram,
  )[0]
}
