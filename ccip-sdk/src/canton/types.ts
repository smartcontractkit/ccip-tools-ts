import type { ChainFamily } from '../types.ts'
import type { JsCommands } from './client/index.ts'

/**
 * A Canton "wallet" identifies the acting party and optionally overrides the
 * bearer token used for Ledger API authentication.
 */
export interface CantonWallet {
  /** Daml party ID used for `actAs` in command submissions. */
  party: string
}

/**
 * Type-guard for {@link CantonWallet}.
 */
export function isCantonWallet(v: unknown): v is CantonWallet {
  return (
    typeof v === 'object' &&
    v !== null &&
    'party' in v &&
    typeof (v as CantonWallet).party === 'string' &&
    (v as CantonWallet).party.length > 0
  )
}

/**
 * An unsigned Canton transaction wraps a `JsCommands` object ready to be
 * submitted to the Canton Ledger API via `submitAndWait` /
 * `submitAndWaitForTransaction`.
 */
export interface UnsignedCantonTx {
  family: typeof ChainFamily.Canton
  /** The Canton command payload ready for submission. */
  commands: JsCommands
}
