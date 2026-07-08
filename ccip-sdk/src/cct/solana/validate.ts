import { SolanaChain } from '../../solana/index.ts'
import { CCTParamsInvalidError } from '../errors.ts'

/** Asserts `value` is a valid Solana public key string. */
export function validatePublicKey(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
    )
  }

  try {
    SolanaChain.getAddress(value)
  } catch (error) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
      { cause: error instanceof Error ? error : undefined },
    )
  }
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
