import { Buffer } from 'buffer'

import { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { CCIPError } from '../../../errors/index.ts'
import {
  type TokenPoolConfig,
  TOKEN_POOL_IDL,
  tokenPoolCoder,
} from '../../../solana/idl/token-pool-coder.ts'
export type { TokenPoolConfig } from '../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { simulationProvider } from '../../../solana/utils.ts'
import { CCTDataDecodeError } from '../../errors.ts'

/** Canonical Solana token pool program addresses. */
export const TOKEN_POOL_PROGRAMS = {
  'burn-mint': '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB',
  'lock-release': '8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC',
} as const

/** Canonical Solana token pool program type. */
export type TokenPoolType = keyof typeof TOKEN_POOL_PROGRAMS

/** Identifies a canonical burn-mint token pool program. */
export type BurnMintPoolProgramRef = {
  poolType: 'burn-mint'
  poolProgramAddress?: never
}

/** Identifies a canonical lock-release token pool program. */
export type LockReleasePoolProgramRef = {
  poolType: 'lock-release'
  poolProgramAddress?: never
}

/** Identifies a custom token pool program. */
export type CustomPoolProgramRef = {
  poolProgramAddress: string
  poolType?: never
}

/** Identifies a canonical token pool or a custom pool program. */
export type PoolProgramRef =
  BurnMintPoolProgramRef | LockReleasePoolProgramRef | CustomPoolProgramRef

type TokenPoolStateDecodeContext = {
  tokenPool: string
  mint: string
  poolProgram: string
  accountOwner: string
}

/**
 * Resolves a canonical token pool program type to its address.
 *
 * @example
 * ```ts
 * const poolProgram = resolveTokenPoolProgram('burn-mint')
 * ```
 */
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
    return tokenPoolCoder.accounts.decode<{ version: number; config: TokenPoolConfig }>(
      'state',
      data,
    )
  } catch (cause) {
    throw new CCTDataDecodeError(context.tokenPool, {
      cause: cause instanceof Error ? cause : CCIPError.from(cause),
      context: {
        mint: context.mint,
        poolProgram: context.poolProgram,
        accountOwner: context.accountOwner,
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

/**
 * Derives a token pool signer PDA for a mint.
 *
 * @example
 * ```ts
 * const poolProgram = resolveTokenPoolProgram('burn-mint')
 * const poolSigner = deriveTokenPoolSignerPda(poolProgram, new PublicKey(tokenAddress))
 * ```
 */
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
