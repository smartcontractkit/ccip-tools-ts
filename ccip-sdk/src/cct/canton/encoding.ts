/**
 * Daml-LF JSON encoders for CCIP choice arguments — the shapes the Canton JSON
 * Ledger API (and therefore the Wallet Gateway `prepareExecute` path) expects:
 * bare strings for Text/Party, `null` for `Optional None`, `{"tag","value"}`
 * for variants, JSON arrays for `GenMap`s, and `{"unpack": …}` for the
 * `RawInstanceAddress` newtype.
 *
 * Verified against the Go bindings in
 * `chainlink-canton-fcr/bindings/generated/latest/` and the Daml sources under
 * `chainlink-canton-fcr/contracts/ccip/`.
 *
 * @packageDocumentation
 */

import type { FinalityConfig as FinalityConfigArg } from '../../canton/bindings/ccip-codec-v2-2.0.0/lib/CCIP/CodecV2/FinalityConfig/module.js'
import type { TransferTimeout as TransferTimeoutArg } from '../../canton/bindings/ccip-registry-burn-mint-token-pool-v2-2.1.1/lib/CCIP/Registry/BurnMintTokenPoolV2Types/module.js'
import type {
  RateLimitDirection as RateLimitDirectionArg,
  RateLimitMode as RateLimitModeArg,
} from '../../canton/bindings/ccip-registry-rate-limiter-v2-2.0.1/lib/CCIP/Registry/RateLimiterV2/module.js'

/** Empty `Splice.Api.Token.MetadataV1.ChoiceContext` (`values` is a `TextMap` → JSON object). */
export const EMPTY_CHOICE_CONTEXT: Record<string, unknown> = { values: {} }

/**
 * Encode a `Chainlink.InstanceAddress.RawInstanceAddress` newtype. Note this
 * takes the RAW form (`"instanceId@party"`), not the hashed `0x…` instance
 * address.
 */
export function rawInstanceAddress(raw: string): { unpack: string } {
  return { unpack: raw }
}

/** Pool transfer timeout — Daml variant `Indefinite | RelativeHours Int`. */
export type TransferTimeout =
  { type: 'Indefinite' } | { type: 'RelativeHours'; hours: number | bigint }

/** Encode a {@link TransferTimeout} as a Daml variant. */
export function encodeTransferTimeout(t: TransferTimeout): TransferTimeoutArg {
  return t.type === 'Indefinite'
    ? { tag: 'Indefinite', value: {} }
    : { tag: 'RelativeHours', value: t.hours.toString() }
}

/** Finality config — Daml variant `WaitForFinality | WaitForSafe | BlockDepth Int`. */
export type FinalityConfig =
  | { type: 'WaitForFinality' }
  | { type: 'WaitForSafe' }
  | { type: 'BlockDepth'; blockConfirmations: number | bigint }

/** Encode a {@link FinalityConfig} as a Daml variant. */
export function encodeFinalityConfig(f: FinalityConfig): FinalityConfigArg {
  switch (f.type) {
    case 'WaitForFinality':
      return { tag: 'WaitForFinality', value: {} }
    case 'WaitForSafe':
      return { tag: 'WaitForSafe', value: {} }
    case 'BlockDepth':
      return { tag: 'BlockDepth', value: f.blockConfirmations.toString() }
  }
}

/**
 * Rate-limiter direction — Daml **enum**
 * `RateLimitDirection_Inbound | RateLimitDirection_Outbound`. Canton's JSON Ledger API encodes enums as a
 * **bare string** (the constructor name), NOT the `{tag, value:{}}` variant
 * form (that form is for payload-carrying variants and causes
 * `Expected ujson.Str` at submit). Mirrors go-daml's `JsonCodec.enumToDynamicValue`
 * → `enum.GetEnumConstructor()` (returns `string(e)`).
 */
export function encodeRateLimitDirection(direction: 'inbound' | 'outbound'): RateLimitDirectionArg {
  return direction === 'inbound' ? 'RateLimitDirection_Inbound' : 'RateLimitDirection_Outbound'
}

/**
 * Rate-limiter mode — Daml **enum**
 * `RateLimitMode_DefaultFinality | RateLimitMode_CustomFinality`. Bare-string encoded (see
 * {@link encodeRateLimitDirection}); NOT `{tag, value:{}}`.
 */
export function encodeRateLimitMode(mode: 'defaultFinality' | 'customFinality'): RateLimitModeArg {
  return mode === 'defaultFinality'
    ? 'RateLimitMode_DefaultFinality'
    : 'RateLimitMode_CustomFinality'
}

/** Current time as a Daml `Time` (ISO-8601, microsecond padding). */
export function damlTimeNow(): string {
  // JS gives millisecond precision; Daml accepts ISO-8601 — pad to the
  // microsecond form the ledger canonically emits.
  return new Date().toISOString().replace(/(\.\d{3})Z$/, '$1000Z')
}
