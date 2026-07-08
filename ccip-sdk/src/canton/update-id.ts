import { isHexString } from 'ethers'

import { normalizeHex } from '../utils.ts'

/**
 * Canton ledger update ID normalization.
 *
 * Canton returns update IDs as LedgerStrings: `1220` (multihash prefix) + 32-byte
 * SHA-256 digest (68 hex chars total). The deprecated `transaction-by-id` endpoint
 * is strict about format; `update-by-id` (used by the Go CLI) expects the canonical form.
 */

/** Canton multihash prefix for SHA-256 update IDs (`0x12 0x20` as hex). */
export const CANTON_UPDATE_ID_PREFIX = '1220'

/** Full canonical update ID length: prefix (4) + digest (64) = 68 hex chars. */
export const CANTON_UPDATE_ID_HEX_LENGTH = 68

const CANTON_UPDATE_ID_DIGEST_HEX_LENGTH =
  CANTON_UPDATE_ID_HEX_LENGTH - CANTON_UPDATE_ID_PREFIX.length

/**
 * Returns true when `id` looks like a Canton ledger update ID (not a CCIP message ID).
 *
 * Message IDs use `0x` + 64 hex. Update IDs use `1220` + 64 hex (optionally with `0x`).
 */
export function isCantonUpdateId(id: string): boolean {
  const hex = normalizeHex(id)
  return (
    hex.length === CANTON_UPDATE_ID_HEX_LENGTH &&
    hex.startsWith(CANTON_UPDATE_ID_PREFIX) &&
    isHexString(`0x${hex}`, CANTON_UPDATE_ID_HEX_LENGTH / 2)
  )
}

/**
 * Normalize a Canton update ID for ledger API lookups.
 *
 * - Strips optional `0x`
 * - Prepends `1220` when only the 32-byte digest is provided
 * - Lowercases hex
 */
export function normalizeCantonUpdateId(updateId: string): string {
  const hex = normalizeHex(updateId)
  if (
    hex.length === CANTON_UPDATE_ID_DIGEST_HEX_LENGTH &&
    isHexString(`0x${hex}`, CANTON_UPDATE_ID_DIGEST_HEX_LENGTH / 2)
  ) {
    return `${CANTON_UPDATE_ID_PREFIX}${hex}`
  }
  if (isCantonUpdateId(hex)) return hex
  return updateId.trim()
}
