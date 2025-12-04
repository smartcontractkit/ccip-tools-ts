import { beginCell, Cell } from '@ton/core'
import { createHash } from 'crypto'

/**
 * Computes SHA256 hash of data and returns as hex string
 * Used throughout TON hasher for domain separation and message hashing
 */
export const sha256 = (data: Uint8Array): string => {
  return '0x' + createHash('sha256').update(data).digest('hex')
}

/**
 * Converts hex string to Buffer, handling 0x prefix normalization
 * Returns empty buffer for empty input
 */
export const hexToBuffer = (value: string): Buffer => {
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  return normalized.length === 0 ? Buffer.alloc(0) : Buffer.from(normalized, 'hex')
}

/**
 * Converts various numeric types to BigInt for TON's big integer operations
 * Used throughout the hasher for chain selectors, amounts, and sequence numbers
 */
export const toBigInt = (value: bigint | number | string): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  return BigInt(value)
}

/**
 * Attempts to parse hex string as TON BOC (Bag of Cells) format
 * Falls back to storing raw bytes as cell data if BOC parsing fails
 * Used for parsing message data, extra data, and other hex-encoded fields
 */
export const tryParseCell = (hex: string): Cell => {
  const bytes = hexToBuffer(hex)
  if (bytes.length === 0) return beginCell().endCell()
  try {
    return Cell.fromBoc(bytes)[0]
  } catch {
    return beginCell().storeBuffer(bytes).endCell()
  }
}

/**
 * Extracts the 32-bit magic tag from a BOC-encoded cell
 * Magic tags identify the type of TON structures (e.g., extra args types)
 * Used for type detection and validation when decoding CCIP extra args
 * Returns tag as 0x-prefixed hex string for easy comparison
 */
export function extractMagicTag(bocHex: string): string {
  const cell = Cell.fromBoc(hexToBuffer(bocHex))[0]
  const tag = cell.beginParse().loadUint(32)
  return `0x${tag.toString(16).padStart(8, '0')}`
}
