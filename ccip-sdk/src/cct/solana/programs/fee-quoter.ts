import { PublicKey } from '@solana/web3.js'

/** Derives the FeeQuoter billing token config PDA for a mint. */
export function deriveFeeBillingTokenConfigPda(feeQuoter: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_billing_token_config'), mint.toBuffer()],
    feeQuoter,
  )[0]
}
