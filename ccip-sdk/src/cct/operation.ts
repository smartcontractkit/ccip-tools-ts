/**
 * Cross-family CCT write contract. {@link Operation} defines the shared
 * generate/execute surface; each chain family supplies its own lifecycle base.
 *
 * @packageDocumentation
 */

import type { ChainTransaction } from '../types.ts'

/** Result of a successful CCT write: the confirmed on-chain tx hash. */
export type TransactionResult = Pick<ChainTransaction, 'hash'>

/** Result of a successful contract-deployment write: the tx hash plus the deployed address. */
export type DeployResult = TransactionResult & { address: string }

/**
 * Abstract CCT write operation: build unsigned tx(s) with {@link generate}, or
 * sign and submit with {@link execute}.
 */
export abstract class Operation<Chain, Params, Tx, Result> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string
  /** Reject invalid params before any chain RPC. */
  protected abstract validate(params: Params): void
  /** Build unsigned transaction(s); no wallet required. */
  abstract generate(chain: Chain, params: Params): Promise<Tx>
  /** Sign and submit via `params.wallet`; returns once confirmed. */
  abstract execute(chain: Chain, params: Params & { wallet: unknown }): Promise<Result>
}
