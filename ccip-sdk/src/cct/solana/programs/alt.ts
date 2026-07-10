import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import { deriveFeeBillingTokenConfigPda } from './fee-quoter.ts'
import { deriveExternalTokenPoolsSignerPda, deriveTokenAdminRegistryPda } from './router.ts'
import { deriveTokenPoolConfigPda, deriveTokenPoolSignerPda } from './token-pool.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { resolveATA } from '../../../solana/utils.ts'

type DeriveCcipLookupTableAddressesParams = {
  lookupTableAddress: PublicKey
  tokenMint: PublicKey
  poolProgram: PublicKey
  authority: PublicKey
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
