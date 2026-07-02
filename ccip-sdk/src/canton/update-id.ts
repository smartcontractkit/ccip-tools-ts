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

/**
 * Returns true when `id` looks like a Canton ledger update ID (not a CCIP message ID).
 *
 * Message IDs use `0x` + 64 hex. Update IDs use `1220` + 64 hex (optionally with `0x`).
 */
export function isCantonUpdateId(id: string): boolean {
  const hex = id.trim().replace(/^0x/i, '')
  return new RegExp(`^${CANTON_UPDATE_ID_PREFIX}[0-9a-fA-F]{64}$`).test(hex)
}

/**
 * Normalize a Canton update ID for ledger API lookups.
 *
 * - Strips optional `0x`
 * - Prepends `1220` when only the 32-byte digest is provided
 * - Lowercases hex
 */
export function normalizeCantonUpdateId(updateId: string): string {
  let id = updateId.trim()
  if (/^0x/i.test(id)) id = id.slice(2)
  if (/^[0-9a-fA-F]{64}$/.test(id)) return `${CANTON_UPDATE_ID_PREFIX}${id.toLowerCase()}`
  if (isCantonUpdateId(id)) return id.toLowerCase()
  return updateId.trim()
}
