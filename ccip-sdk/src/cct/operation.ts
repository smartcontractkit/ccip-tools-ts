/**
 * Cross-family CCT write contract: the pre-RPC preparation plus the
 * generate/execute surface. Mirrors {@link Query} for reads; families bind `Chain` and supply
 * `buildUnsigned`/`execute`.
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
 *
 * @remarks Override {@link prepare} to validate or normalize params before chain access.
 */
export abstract class Operation<Chain, Params extends object, Tx, Result, Parsed = Params> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string

  /**
   * Validate and normalize params before chain access, without mutating the caller's input.
   * Returns params unchanged by default.
   */
  protected prepare(params: Params): Parsed {
    // `as Parsed` alone does not narrow: `Parsed` is a default, not a constraint.
    return params as unknown as Parsed
  }
  /** Build unsigned transaction(s); no wallet required. */
  abstract generate(chain: Chain, params: Params): Promise<Tx>
  /** Sign and submit via `params.wallet`; returns once confirmed. */
  abstract execute(chain: Chain, params: ExecuteParams<Params>): Promise<Result>
}
