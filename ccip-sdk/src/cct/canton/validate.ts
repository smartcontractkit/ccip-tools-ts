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
 * Validate a `RawInstanceAddress` (`"instanceId@party"`) and split it.
 * @param operation - CCT operation name, for error context.
 * @param param - Param name, for error context.
 * @param value - Raw instance address to validate.
 * @returns the instance ID and owner party.
 */
export function parseRawInstanceAddress(
  operation: string,
  param: string,
  value: string,
): { instanceId: string; owner: string } {
  if (!value || typeof value !== 'string') {
    throw new CCTParamsInvalidError(operation, param, 'raw instance address is required')
  }
  const parts = value.split('@')
  if (parts.length !== 2 || !parts[0]) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `expected a raw instance address "instanceId@hint::1220<64-hex>", got "${value}"`,
    )
  }
  const owner = parsePartyId(operation, param, parts[1]!)
  return { instanceId: parts[0], owner }
}

/**
 * The owner of a raw `"instanceId@owner"` address (validated), or `undefined`
 * for the hashed `0x<64-hex>` form.
 * @param operation - CCT operation name, for error context.
 * @param param - Param name, for error context.
 * @param value - Instance address, raw or hashed.
 */
export function instanceAddressOwner(
  operation: string,
  param: string,
  value: string,
): string | undefined {
  return value.includes('@') ? parseRawInstanceAddress(operation, param, value).owner : undefined
}

/**
 * Validate and return a Canton instrument ID. Accepts both the structured
 * `{ admin, id }` form and the string form `"hint::1220<fingerprint>::tokenId"`
 * (the first two `::`-separated segments are the admin party ID, the rest is
 * the token id).
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
    if (parts.length !== 3) {
      throw new CCTParamsInvalidError(
        operation,
        param,
        `instrument ID string must be "hint::1220<fingerprint>::tokenId", got "${value}"`,
      )
    }
    const tokenId = parts[2]!
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
