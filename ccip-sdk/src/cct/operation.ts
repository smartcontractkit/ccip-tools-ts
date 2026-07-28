/**
 * Cross-family CCT write contract. {@link Operation} defines the shared
 * generate/execute surface; each chain family supplies its own lifecycle base.
 *
 * @packageDocumentation
 */

import type { ChainTransaction } from '../types.ts'

/** Confirmed on-chain hash returned by a successful CCT write. */
export type TransactionHash = Pick<ChainTransaction, 'hash'>

/**
 * Abstract CCT write operation: build unsigned tx(s) with {@link generate}, or
 * sign and submit with {@link execute}.
 */
export abstract class Operation<Chain, Params, Tx, Result = TransactionHash> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string
  /** Reject invalid params before any chain RPC. */
  protected abstract validate(params: Params): void
  /** Build unsigned transaction(s); no wallet required. */
  abstract generate(chain: Chain, params: Params): Promise<Tx>
  /** Sign and submit via `params.wallet`; returns once confirmed. */
  abstract execute(chain: Chain, params: Params & { wallet: unknown }): Promise<Result>
}
