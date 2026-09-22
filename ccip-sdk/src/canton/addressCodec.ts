import { getBytes, hexlify, toUtf8String } from 'ethers'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { getDataBytes, hashedUtf8Hex, isCantonPartyId } from '../utils.ts'

/*
 * Canton Types
 * */

declare const partyIdBrand: unique symbol

/**
 * Branded Canton party ID (`hint::1220<64-hex-fingerprint>`, not a 3-part instrument id).
 *
 * At runtime this is a plain string; the brand guarantees that every value of this
 * type has been validated by {@link parsePartyId} — it is always non-empty and
 * matches the Canton party ID format. Being a string subtype, a `PartyId` can be
 * used anywhere a plain `string` is expected.
 */
export type PartyId = string & { readonly [partyIdBrand]: true }

/**
 * Validates a string as a Canton party ID.
 *
 * @throws {@link CCIPError} with code `ADDRESS_INVALID` if the input is empty or does
 * not match the Canton party ID format.
 */
export function parsePartyId(party: string): PartyId {
  if (!party) {
    throw new CCIPError(CCIPErrorCode.ADDRESS_INVALID, 'Invalid PartyId: cannot be empty', {
      context: { party },
    })
  }
  if (!isCantonPartyId(party)) {
    throw new CCIPError(
      CCIPErrorCode.ADDRESS_INVALID,
      'Invalid PartyId: must match Canton party ID format',
      {
        context: { party },
      },
    )
  }
  return party as PartyId
}

/*
 * Canton Addresses
 * */

export interface CantonAddress {
  instanceAddress(): InstanceAddress
}

/** Length in bytes of an {@link InstanceAddress}. */
export const INSTANCE_ADDRESS_LENGTH = 32

/**
 * 32-byte keccak256 hash of a `instanceId@owner` raw instance address.
 *
 * The bytes are immutable; the hex form (`0x`-prefixed, lowercase) is the canonical
 * representation used by `hex()`, `toString()` and `toJSON()`.
 */
export class InstanceAddress implements CantonAddress {
  /** Byte representation. */
  readonly bytes: Uint8Array

  /**
   * Creates an InstanceAddress from exactly 32 bytes.
   *
   * Prefer {@link InstanceAddress.fromBytes} / {@link InstanceAddress.fromHex} for
   * arbitrary-length input (left-padding / left-cropping semantics).
   */
  constructor(bytes: Uint8Array) {
    if (bytes.length !== INSTANCE_ADDRESS_LENGTH) {
      throw new CCIPError(
        CCIPErrorCode.ADDRESS_INVALID,
        `InstanceAddress must be exactly ${INSTANCE_ADDRESS_LENGTH} bytes, got ${bytes.length}`,
        { context: { length: bytes.length } },
      )
    }
    this.bytes = bytes.slice()
  }

  instanceAddress(): InstanceAddress {
    return this
  }

  /**
   * Converts a byte array to an InstanceAddress.
   * If `b` is larger than 32 bytes, it is cropped from the left; otherwise it is
   * left-padded with zeros.
   */
  static fromBytes(b: Uint8Array | readonly number[]): InstanceAddress {
    const data = getDataBytes(b)
    const trimmed = data.slice(Math.max(0, data.length - INSTANCE_ADDRESS_LENGTH))
    const bytes = new Uint8Array(INSTANCE_ADDRESS_LENGTH)
    bytes.set(trimmed, INSTANCE_ADDRESS_LENGTH - trimmed.length)
    return new InstanceAddress(bytes)
  }

  /**
   * Converts a hex string (optionally `0x`-prefixed) to an InstanceAddress, left-padded
   * with zeros.
   *
   * @throws {@link CCIPError} with code `ADDRESS_INVALID` if the input is not valid hex.
   */
  static fromHex(s: string): InstanceAddress {
    const hex = s.trim()
    const unprefixed = hex.startsWith('0x') ? hex.slice(2) : hex
    if (
      unprefixed.length === 0 ||
      unprefixed.length > 2 * INSTANCE_ADDRESS_LENGTH ||
      unprefixed.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/.test(unprefixed)
    ) {
      throw new CCIPError(CCIPErrorCode.ADDRESS_INVALID, `Invalid InstanceAddress hex: "${s}"`, {
        context: { address: s },
      })
    }
    return InstanceAddress.fromBytes(getBytes(`0x${unprefixed}`))
  }

  /** `0x`-prefixed lowercase hex representation. */
  hex(): string {
    return hexlify(this.bytes)
  }

  /** Compares two InstanceAddresses byte-wise. */
  compare(other: InstanceAddress): -1 | 0 | 1 {
    const a = this.hex()
    const b = other.hex()
    return a < b ? -1 : a > b ? 1 : 0
  }

  /** Whether both addresses hold the same bytes. */
  equals(other: InstanceAddress): boolean {
    return this.compare(other) === 0
  }

  /** Hex form. */
  toString(): string {
    return this.hex()
  }

  /** Hex form for JSON serialization. */
  toJSON(): string {
    return this.hex()
  }
}

/**
 * Raw instance address in `"instanceId@owner"` unpack form.
 *
 * `owner` is a validated {@link PartyId}; the constructor rejects empty instance IDs.
 */
export class RawInstanceAddress implements CantonAddress {
  /** Instance ID part (before the `@`). */
  readonly instanceId: string
  /** Owner party part (after the `@`). */
  readonly owner: PartyId

  /**
   * Builds a raw instance address from its parts.
   *
   * @throws {@link CCIPError} with code `ADDRESS_INVALID` if either part is empty.
   */
  constructor(instanceId: string, owner: PartyId) {
    if (!instanceId || !owner) {
      throw new CCIPError(
        CCIPErrorCode.ADDRESS_INVALID,
        'Invalid raw instance address: parts cannot be empty',
        {
          context: { instanceId, owner },
        },
      )
    }
    this.instanceId = instanceId
    this.owner = owner
  }

  instanceAddress(): InstanceAddress {
    return this.toInstanceAddress()
  }

  /**
   * Validates and parses a raw instance address: must contain exactly one `@`
   * with non-empty instance ID and owner parts.
   *
   * @throws {@link CCIPError} with code `ADDRESS_INVALID` if the input is malformed.
   */
  static fromString(s: string): RawInstanceAddress {
    const parts = s.split('@')
    if (parts.length !== 2) {
      throw new CCIPError(
        CCIPErrorCode.ADDRESS_INVALID,
        'Invalid raw instance address: must contain exactly one "@"',
        {
          context: { address: s },
        },
      )
    }
    const [instanceId, owner] = parts
    if (!instanceId || !owner) {
      throw new CCIPError(
        CCIPErrorCode.ADDRESS_INVALID,
        'Invalid raw instance address: parts cannot be empty',
        {
          context: { address: s },
        },
      )
    }
    return new RawInstanceAddress(instanceId, parsePartyId(owner))
  }

  /**
   * Parses a raw instance address from a UTF-8 hex string (optionally `0x`-prefixed),
   * as returned by the Canton indexer for `unpack` address fields.
   *
   * @throws {@link CCIPError} with code `ADDRESS_INVALID` if the input is not valid hex
   * or does not decode to a valid raw instance address.
   */
  static fromHex(s: string): RawInstanceAddress {
    let decoded: string
    try {
      decoded = toUtf8String(getBytes(s.trim()))
    } catch (error) {
      throw new CCIPError(
        CCIPErrorCode.ADDRESS_INVALID,
        `Invalid raw instance address hex: "${s}"`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { address: s },
        },
      )
    }
    return RawInstanceAddress.fromString(decoded)
  }

  /**
   * keccak256 of the raw instance address string.
   */
  toInstanceAddress(): InstanceAddress {
    return InstanceAddress.fromHex(`0x${hashedUtf8Hex(this.toString())}`)
  }

  /**
   * Daml record passed as the `unpack` field in choice arguments.
   */
  binding(): { unpack: string } {
    return { unpack: this.toString() }
  }

  /** `"instanceId@owner"` form. */
  toString(): string {
    return `${this.instanceId}@${this.owner}`
  }

  /** `"instanceId@owner"` form for JSON serialization. */
  toJSON(): string {
    return this.toString()
  }
}

/**
 * Parses a string in either raw or hex form into the corresponding address type:
 * - strings containing `@` are parsed as {@link RawInstanceAddress};
 * - hex strings that decode to a UTF-8 raw address (as returned by the Canton
 *   indexer for `unpack` fields) are parsed as {@link RawInstanceAddress};
 * - any other hex string is treated as a 32-byte {@link InstanceAddress} hash.
 *
 * Discriminate the result with `instanceof`.
 *
 * @throws {@link CCIPError} with code `ADDRESS_INVALID` if the input matches neither form.
 */
export function parseInstanceAddress(s: string | undefined): RawInstanceAddress | InstanceAddress {
  if (s === undefined) {
    throw new CCIPError(CCIPErrorCode.ADDRESS_INVALID, `Invalid instance address: "${s}"`, {
      context: { address: s },
    })
  }

  const trimmed = s.trim()
  if (trimmed.includes('@')) return RawInstanceAddress.fromString(trimmed)
  if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
    try {
      return RawInstanceAddress.fromHex(trimmed)
    } catch {
      // not a UTF-8-encoded raw address — treat as a 32-byte hash
      return InstanceAddress.fromHex(trimmed)
    }
  }
  throw new CCIPError(CCIPErrorCode.ADDRESS_INVALID, `Invalid instance address: "${s}"`, {
    context: { address: s },
  })
}

/*
 * Helper functions
 * */

export function addressesMatch(
  l1: readonly CantonAddress[],
  l2: readonly CantonAddress[],
): boolean {
  const addresses1 = new Set(l1.map((address) => address.instanceAddress().hex()))
  const addresses2 = new Set(l2.map((address) => address.instanceAddress().hex()))
  return (
    addresses1.size === addresses2.size &&
    [...addresses1].every((address) => addresses2.has(address))
  )
}

export function addressesContains(
  got: readonly CantonAddress[],
  want: readonly CantonAddress[],
): boolean {
  const gotAddresses = got.map((address) => address.instanceAddress().hex())
  const wantAddresses = want.map((address) => address.instanceAddress().hex())
  return wantAddresses.every((address) => gotAddresses.includes(address))
}

export function addressesMissing(
  got: readonly CantonAddress[],
  want: readonly CantonAddress[],
): CantonAddress[] {
  const gotAddresses = got.map((address) => address.instanceAddress().hex())
  return want.filter((address) => !gotAddresses.includes(address.instanceAddress().hex()))
}
