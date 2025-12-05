import {
  type BigNumberish,
  type BytesLike,
  concat,
  dataLength,
  toBeHex,
  zeroPadBytes,
} from 'ethers'

/**
 * Encodes a numeric value as a 32-byte hex string.
 * @param value - Numeric value to encode.
 * @returns 32-byte hex string representation of the value.
 */
export const encodeNumber = (value: BigNumberish): string => toBeHex(value, 32)

/**
 * Encodes dynamic bytes without the struct offset prefix.
 */
export const encodeRawBytes = (value: BytesLike): string =>
  concat([
    encodeNumber(dataLength(value)),
    zeroPadBytes(value, Math.ceil(dataLength(value) / 32) * 32),
  ])
