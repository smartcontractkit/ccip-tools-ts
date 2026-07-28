import { Buffer } from 'buffer'

import { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { IDL as BASE_TOKEN_POOL_IDL } from '../../../solana/idl/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL_IDL } from '../../../solana/idl/1.6.0/BURN_MINT_TOKEN_POOL.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { simulationProvider } from '../../../solana/utils.ts'

const TOKEN_POOL_IDL = {
  ...BURN_MINT_TOKEN_POOL_IDL,
  types: BASE_TOKEN_POOL_IDL.types,
}

/** Creates an Anchor Program client for a token pool program. */
export function createTokenPoolProgram(
  chain: SolanaChain,
  poolProgram: PublicKey,
  payer: PublicKey,
) {
  return new Program(TOKEN_POOL_IDL, poolProgram, simulationProvider(chain, payer))
}

/** Derives the token pool global config PDA. */
export function deriveTokenPoolGlobalConfigPda(poolProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], poolProgram)[0]
}

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

/** Derives the token pool program data PDA. */
export function deriveTokenPoolProgramDataPda(poolProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [poolProgram.toBuffer()],
    new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
  )[0]
}
