/**
 * Canton CCT param validation helpers. Each parser throws
 * {@link CCTParamsInvalidError} on bad input before any chain RPC, mirroring
 * the Solana/EVM `validate.ts` pattern.
 *
 * @packageDocumentation
 */

import { isCantonPartyId } from '../../shared/codec.ts'
import { CCTParamsInvalidError } from '../errors.ts'

/**
 * Validate and return a Canton party ID (`hint::1220<64-hex>`).
 * @param operation - CCT operation name, for error context.
 * @param param - Param name, for error context.
 * @param value - Party ID string to validate.
 */
export function parsePartyId(operation: string, param: string, value: string): string {
  if (!value || typeof value !== 'string') {
    throw new CCTParamsInvalidError(operation, param, 'party ID is required')
  }
  if (!isCantonPartyId(value)) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `expected a Canton party ID "hint::1220<64-hex>", got "${value}"`,
    )
  }
  return value
}

/**
 * Validate and return a Canton instrument ID. Accepts both the structured
 * `{ admin, id }` form and the string form `"admin::id"` (where `admin` is a
 * party ID and `id` is the token name).
 * @returns the normalized `{ admin, id }` object.
 */
export function parseInstrumentId(
  operation: string,
  param: string,
  value: { admin: string; id: string } | string,
): { admin: string; id: string } {
  if (!value) {
    throw new CCTParamsInvalidError(operation, param, 'instrument ID is required')
  }
  if (typeof value === 'string') {
    // String form: "adminParty::fingerprint::tokenId" — the admin party is the
    // first two `::` segments (hint::fingerprint), the id is the trailing segment.
    const parts = value.split('::')
    if (parts.length < 3) {
      throw new CCTParamsInvalidError(
        operation,
        param,
        `instrument ID string must be "hint::1220<fingerprint>::tokenId", got "${value}"`,
      )
    }
    const tokenId = parts.slice(2).join('::')
    const admin = `${parts[0]}::${parts[1]}`
    if (!isCantonPartyId(admin)) {
      throw new CCTParamsInvalidError(
        operation,
        param,
        `instrument ID admin must be a Canton party ID, got "${admin}"`,
      )
    }
    return { admin, id: tokenId }
  }
  if (typeof value !== 'object' || !value.admin || !value.id) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      'instrument ID object must have { admin, id }',
    )
  }
  if (!isCantonPartyId(value.admin)) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `instrument ID admin must be a Canton party ID, got "${value.admin}"`,
    )
  }
  if (!value.id || typeof value.id !== 'string') {
    throw new CCTParamsInvalidError(operation, param, 'instrument ID id must be a non-empty string')
  }
  return { admin: value.admin, id: value.id }
}

/**
 * Validate and return a Canton contract ID (a ledger contract ID string, e.g.
 * `#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry:00...`).
 * Contract IDs are opaque ledger-assigned strings; we only check presence.
 */
export function parseContractCid(operation: string, param: string, value: string): string {
  if (!value || typeof value !== 'string') {
    throw new CCTParamsInvalidError(operation, param, 'contract ID is required')
  }
  return value
}

/**
 * Validate that a value is a non-empty string.
 */
export function parseNonEmptyString(operation: string, param: string, value: string): string {
  if (!value || typeof value !== 'string') {
    throw new CCTParamsInvalidError(operation, param, `${param} is required`)
  }
  return value
}
