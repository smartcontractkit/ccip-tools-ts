import { concat, decodeBase58, decodeBase64, getBytes, hexlify, keccak256, toBeHex } from 'ethers'
import type { CCIPMessage, CCIPVersion } from '../types.ts'

export type LeafHasher<V extends CCIPVersion = CCIPVersion> = (message: CCIPMessage<V>) => string

const INTERNAL_DOMAIN_SEPARATOR = toBeHex(1, 32)
export const LEAF_DOMAIN_SEPARATOR = '0x00'
export const ZERO_HASH = hexlify(new Uint8Array(32).fill(0xff))

/**
 * Computes the Keccak-256 hash of the concatenation of two hash values.
 * @param a The first hash as a Hash type.
 * @param b The second hash as a Hash type.
 * @returns The Keccak-256 hash result as a Hash type.
 */
export function hashInternal(a: string, b: string): string {
  if (a > b) {
    ;[a, b] = [b, a]
  }
  const combinedData = concat([INTERNAL_DOMAIN_SEPARATOR, a, b])
  return keccak256(combinedData)
}

export function getAddressBytes(address: string): Uint8Array {
  if (address.startsWith('0x')) {
    return getBytes(address)
  } else {
    return getBytes(toBeHex(decodeBase58(address), 32))
  }
}

export function getDataBytes(data: string): Uint8Array {
  if (data.startsWith('0x')) {
    return getBytes(data)
  } else {
    return decodeBase64(data)
  }
}
