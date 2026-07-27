import { type IdlTypes, BorshCoder } from '@coral-xyz/anchor'

import { IDL as BASE_TOKEN_POOL } from './1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL } from './1.6.0/BURN_MINT_TOKEN_POOL.ts'

// Splice in base IDL types so BaseConfig is defined; required for accounts.decode.
export const TOKEN_POOL_IDL = {
  ...BURN_MINT_TOKEN_POOL,
  types: BASE_TOKEN_POOL.types,
  events: BASE_TOKEN_POOL.events,
  errors: [...BASE_TOKEN_POOL.errors, ...BURN_MINT_TOKEN_POOL.errors],
}

/** Shared state configuration stored by canonical Solana token pools. */
export type TokenPoolConfig = IdlTypes<typeof TOKEN_POOL_IDL>['BaseConfig']

/** Borsh decoder for canonical token pool accounts. */
export const tokenPoolCoder = new BorshCoder(TOKEN_POOL_IDL)
