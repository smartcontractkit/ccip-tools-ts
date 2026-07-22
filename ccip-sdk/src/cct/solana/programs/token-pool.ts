import { Buffer } from 'buffer'

import { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import {
  type TokenPoolConfig,
  TOKEN_POOL_IDL,
  tokenPoolCoder,
} from '../../../solana/idl/token-pool-coder.ts'
export type { TokenPoolConfig } from '../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { simulationProvider } from '../../../solana/utils.ts'
import { CCTTokenPoolStateDecodeError } from '../../errors.ts'

/** Canonical Solana token pool program addresses. */
export const TOKEN_POOL_PROGRAMS = {
  'burn-mint': '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB',
  'lock-release': '8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC',
} as const

/** Canonical Solana token pool program type. */
export type TokenPoolType = keyof typeof TOKEN_POOL_PROGRAMS

type TokenPoolStateDecodeContext = {
  tokenPool: string
  mint: string
  poolProgram: string
}

/** Resolves a canonical token pool program type to its address. */
export function resolveTokenPoolProgram(poolType: TokenPoolType): PublicKey {
  return new PublicKey(TOKEN_POOL_PROGRAMS[poolType])
}

/** Creates an Anchor Program client for a token pool program. */
export function createTokenPoolProgram(
  chain: SolanaChain,
  poolProgram: PublicKey,
  payer: PublicKey,
) {
  return new Program(TOKEN_POOL_IDL, poolProgram, simulationProvider(chain, payer))
}

/** Decodes a canonical token pool state account. */
export function decodeTokenPoolState(
  data: Buffer,
  context: TokenPoolStateDecodeContext,
): { version: number; config: TokenPoolConfig } {
  try {
    return tokenPoolCoder.accounts.decode('state', data)
  } catch (cause) {
    throw new CCTTokenPoolStateDecodeError(context.tokenPool, {
      cause: cause instanceof Error ? cause : undefined,
      context: {
        mint: context.mint,
        poolProgram: context.poolProgram,
      },
    })
  }
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
