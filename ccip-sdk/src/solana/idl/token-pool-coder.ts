import { type Idl, type IdlTypes, BorshCoder } from '@coral-xyz/anchor'

import { IDL as BASE_TOKEN_POOL } from './1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL } from './1.6.0/BURN_MINT_TOKEN_POOL.ts'
import { IDL as LOCK_RELEASE_TOKEN_POOL } from './1.6.0/LOCK_RELEASE_TOKEN_POOL.ts'

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
export const tokenPoolCoder = new BorshCoder(TOKEN_POOL_IDL)

/** Borsh decoder for lock-release token pool instructions and canonical token pool accounts. */
export const lockReleaseTokenPoolCoder = new BorshCoder(LOCK_RELEASE_TOKEN_POOL_IDL)
