import type { Idl, IdlTypes } from '@coral-xyz/anchor'

import { sizedCoder } from '../coder.ts'
import { IDL as BASE_TOKEN_POOL } from './1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL } from './1.6.0/BURN_MINT_TOKEN_POOL.ts'
import { IDL as LOCK_RELEASE_TOKEN_POOL } from './1.6.0/LOCK_RELEASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL_V2 } from './2.0.0/BURN_MINT_TOKEN_POOL.ts'

/** Adds shared base token-pool types, events, and errors to a pool-specific IDL. */
function composeTokenPoolIdl<T extends Idl>(poolIdl: T) {
  return {
    ...poolIdl,
    types: BASE_TOKEN_POOL.types,
    events: BASE_TOKEN_POOL.events,
    errors: [...BASE_TOKEN_POOL.errors, ...(poolIdl.errors ?? [])],
  }
}

/** Burn-mint token pool IDL with shared base definitions. */
export const TOKEN_POOL_IDL = composeTokenPoolIdl(BURN_MINT_TOKEN_POOL)

/** Lock-release token pool IDL with shared base definitions. */
export const LOCK_RELEASE_TOKEN_POOL_IDL = composeTokenPoolIdl(LOCK_RELEASE_TOKEN_POOL)

/** Shared state configuration stored by canonical Solana token pools. */
export type TokenPoolConfig = IdlTypes<typeof TOKEN_POOL_IDL>['BaseConfig']

/** Borsh decoder for burn-mint token pool instructions and canonical token pool accounts. */
export const tokenPoolCoder = sizedCoder(TOKEN_POOL_IDL)

/** Borsh decoder for lock-release token pool instructions and canonical token pool accounts. */
export const lockReleaseTokenPoolCoder = sizedCoder(LOCK_RELEASE_TOKEN_POOL_IDL)

/**
 * CCIP 2.0 burn-mint token pool IDL. Also encodes the 2.0-only base pool instructions of
 * lock-release pools (chain config v2, FTF chain config overrides, fee withdrawal,
 * `initialize_by_multisig`), whose accounts and args are identical in both programs.
 */
export const TOKEN_POOL_V2_IDL = BURN_MINT_TOKEN_POOL_V2

/** Borsh coder for CCIP 2.0 token pool instructions; see {@link TOKEN_POOL_V2_IDL}. */
export const tokenPoolV2Coder = sizedCoder(TOKEN_POOL_V2_IDL)
