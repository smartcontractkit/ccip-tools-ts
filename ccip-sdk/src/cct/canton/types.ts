/**
 * Canton-specific CCT result types. {@link UnsignedCantonTx} and
 * {@link CantonWallet} already live in `../../canton/types.ts` and are reused
 * as-is — the CCT Canton operations build the same `JsCommands` payloads the
 * core CantonChain `sendMessage`/`execute` paths already submit.
 *
 * @packageDocumentation
 */

import type { TransactionResult } from '../operation.ts'
import type { JsSubmitAndWaitForTransactionResponse } from '../../canton/client/index.ts'

/**
 * Result of a confirmed Canton CCT write: the shared `TransactionResult.hash`
 * (the Canton `updateId`) plus the raw ledger response for callers that need
 * to parse created-event labels (e.g. a deployed pool's instance address).
 */
export type CantonTransactionResult = TransactionResult & {
  /** Canton `updateId` — the transaction hash. */
  hash: string
  /** Raw ledger transaction response (events, offset, recordId) for result parsing. */
  response: JsSubmitAndWaitForTransactionResponse
}

/**
 * Result of `deployTokenPool`: an atomic `CreateAndExercise` that creates the
 * pool AND runs `Initialize` (TAR registration + lane rate limiters) in one
 * transaction. Adds the created pool's contract ID, the rate-limiter CIDs
 * deployed for its lanes, the `TokenConfig` CID the inline
 * `ProposeAdministrator`/`AcceptAdminRole`/`SetPool` calls produced (mirroring
 * Daml's `InitializeResult`), and the pool's raw instance address derived
 * from the created-event labels (the ops/EDS handoff reads this).
 *
 * `edsConfig` is intentionally NOT returned here — it is assembled separately
 * by the EDS-standup pipeline from the pool's instance address. See the CCT
 * Canton implementation plan.
 */
export type CantonDeployResult = CantonTransactionResult & {
  /** Created `BurnMintTokenPool` / `LockReleaseTokenPool` contract ID. */
  poolCid: string
  /** `RateLimiterV2` contract IDs deployed for the lanes passed to `Initialize`. */
  rateLimiterCids?: string[]
  /** `TokenConfig` contract ID the TAR registered for the instrument. */
  tokenConfigCid?: string
  /** Raw hex instance address of the deployed pool (`keccak256` of the unpack string). */
  poolInstanceAddress?: string
}

/**
 * Result of a TAR admin write (`setPool`, `registerAdmin`, `acceptAdmin`,
 * `transferAdmin`): the transaction result plus the `tokenConfigCid` the TAR
 * created/updated for the instrument (consumed by follow-on choices).
 */
export type CantonTarAdminResult = CantonTransactionResult & {
  /** `TokenConfig` contract ID for the instrument after the write. */
  tokenConfigCid: string
  /** Pending admin party, for `registerAdmin` / `transferAdmin` (undefined for `acceptAdmin`). */
  pendingAdmin?: string
  /** Accepted admin party, for `acceptAdmin` (undefined for the propose/transfer ops). */
  admin?: string
}
