import { PublicKey } from '@solana/web3.js'

import { CCIPAddressInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError } from '../errors.ts'

/** Parses `value` as a Solana public key or throws a CCT validation error. */
export function parsePublicKey(operation: string, param: string, value: unknown): PublicKey {
  if (typeof value !== 'string') {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
    )
  }

  try {
    return new PublicKey(value)
  } catch {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
      {
        cause: new CCIPAddressInvalidError(value, ChainFamily.Solana),
      },
    )
  }
}

/** Asserts `value` is a valid Solana public key string. */
export function validatePublicKey(operation: string, param: string, value: unknown): void {
  parsePublicKey(operation, param, value)
}

/** Asserts ALT writable indexes are a non-empty list of byte values when provided. */
export function validateWritableIndexes(
  operation: string,
  param: string,
  writableIndexes: unknown,
): void {
  if (writableIndexes === undefined) return
  if (!Array.isArray(writableIndexes) || writableIndexes.length === 0) {
    throw new CCTParamsInvalidError(operation, param, 'must be a non-empty array')
  }

  for (const [i, index] of writableIndexes.entries()) {
    if (!Number.isInteger(index) || index < 0 || index > 255) {
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must be an integer between 0 and 255',
      )
    }
  }
}
