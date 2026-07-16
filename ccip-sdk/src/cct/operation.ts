/**
 * Cross-family CCT write contract. {@link Operation} defines the shared
 * generate/execute surface; each chain family supplies its own lifecycle base.
 *
 * @packageDocumentation
 */

import type { ChainTransaction } from '../types.ts'

/** Result of a successful CCT write: the confirmed on-chain tx hash. */
export type TransactionResult = Pick<ChainTransaction, 'hash'>

/**
 * Execute params for a CCT write: an op's own params plus the signing `wallet`.
 * Families extend with submit-time extras (e.g. Solana's `computeUnits`).
 */
export type ExecuteParams<P extends object> = P & { wallet: unknown }

/**
 * Abstract CCT write operation: build unsigned tx(s) with {@link generate}, or
 * sign and submit with {@link execute}.
 */
export abstract class Operation<Chain, Params extends object, Tx, Result> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string
  /** Reject invalid params before any chain RPC. */
  protected abstract validate(params: Params): void
  /** Build unsigned transaction(s); no wallet required. */
  abstract generate(chain: Chain, params: Params): Promise<Tx>
  /** Sign and submit via `params.wallet`; returns once confirmed. */
  abstract execute(chain: Chain, params: ExecuteParams<Params>): Promise<Result>
}
