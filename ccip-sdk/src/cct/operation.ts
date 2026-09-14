/**
 * Cross-family CCT write contract: the pre-RPC lifecycle (validate → parse) plus the
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
 * @remarks {@link parse} is the default pre-RPC hook: use it when the op normalizes, or when a
 * validated value must reach `buildUnsigned` already narrowed. Reach for {@link validate} only
 * when the op purely rejects and `Parsed = P`.
 */
export abstract class Operation<Chain, Params extends object, Tx, Result, Parsed = Params> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string

  /**
   * Reject invalid params before any chain RPC. No-op by default: an op that normalizes as it
   * checks does that work in {@link parse} instead, and needs no empty stub here.
   */
  protected validate(_params: Params): void {}

  /**
   * Normalize validated params for the builder — defaults, conversions, derived values. Identity
   * by default, so an op that needs no normalization declares nothing.
   */
  protected parse(params: Params): Parsed {
    // `as Parsed` alone does not narrow: `Parsed` is a default, not a constraint.
    return params as unknown as Parsed
  }

  /** {@link validate} then {@link parse} — the single pre-RPC step, before any chain access. */
  protected prepare(params: Params): Parsed {
    this.validate(params)
    return this.parse(params)
  }
  /** Build unsigned transaction(s); no wallet required. */
  abstract generate(chain: Chain, params: Params): Promise<Tx>
  /** Sign and submit via `params.wallet`; returns once confirmed. */
  abstract execute(chain: Chain, params: ExecuteParams<Params>): Promise<Result>
}
