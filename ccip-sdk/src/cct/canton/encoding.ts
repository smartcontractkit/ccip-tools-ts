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

/** Empty `Splice.Api.Token.MetadataV1.ChoiceContext` (`values` is a `GenMap` → JSON array). */
export const EMPTY_CHOICE_CONTEXT: Record<string, unknown> = { values: [] }

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
  | { type: 'Indefinite' }
  | { type: 'RelativeHours'; hours: number | bigint }

/** Encode a {@link TransferTimeout} as a Daml variant. */
export function encodeTransferTimeout(t: TransferTimeout): Record<string, unknown> {
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
export function encodeFinalityConfig(f: FinalityConfig): Record<string, unknown> {
  switch (f.type) {
    case 'WaitForFinality':
      return { tag: 'WaitForFinality', value: {} }
    case 'WaitForSafe':
      return { tag: 'WaitForSafe', value: {} }
    case 'BlockDepth':
      return { tag: 'BlockDepth', value: f.blockConfirmations.toString() }
  }
}

/** Rate-limiter direction — Daml variant `RateLimitDirection_Inbound | RateLimitDirection_Outbound`. */
export function encodeRateLimitDirection(direction: 'inbound' | 'outbound'): Record<string, unknown> {
  return {
    tag: direction === 'inbound' ? 'RateLimitDirection_Inbound' : 'RateLimitDirection_Outbound',
    value: {},
  }
}

/** Rate-limiter mode — Daml variant `RateLimitMode_DefaultFinality | RateLimitMode_CustomFinality`. */
export function encodeRateLimitMode(mode: 'defaultFinality' | 'customFinality'): Record<string, unknown> {
  return {
    tag: mode === 'defaultFinality' ? 'RateLimitMode_DefaultFinality' : 'RateLimitMode_CustomFinality',
    value: {},
  }
}

/** Current time as a Daml `Time` (ISO-8601, microsecond padding). */
export function damlTimeNow(): string {
  // JS gives millisecond precision; Daml accepts ISO-8601 — pad to the
  // microsecond form the ledger canonically emits.
  return new Date().toISOString().replace(/(\.\d{3})Z$/, '$1000Z')
}
