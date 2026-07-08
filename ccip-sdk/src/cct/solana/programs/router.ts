import { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { IDL as CCIP_ROUTER_IDL } from '../../../solana/idl/1.6.0/CCIP_ROUTER.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { simulationProvider } from '../../../solana/utils.ts'

/** Creates an Anchor Program client for the CCIP Router program. */
export function createRouterProgram(chain: SolanaChain, router: PublicKey, payer: PublicKey) {
  return new Program(CCIP_ROUTER_IDL, router, simulationProvider(chain, payer))
}

/** Derives the Router config PDA. */
export function deriveRouterConfigPda(router: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], router)[0]
}

/** Derives the Router token admin registry PDA for a mint. */
export function deriveTokenAdminRegistryPda(router: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_admin_registry'), mint.toBuffer()],
    router,
  )[0]
}
