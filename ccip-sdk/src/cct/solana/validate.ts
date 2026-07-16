import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import { CCIPAddressInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError } from '../errors.ts'
import { type TokenPoolType, TOKEN_POOL_PROGRAMS } from './programs/token-pool.ts'

/**
 * Asserts `value` is a valid Solana public key string.
 * @throws CCTParamsInvalidError if `value` is not a valid Solana public key string.
 */
export function validatePublicKey(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
    )
  }

  try {
    new PublicKey(value)
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

/**
 * Asserts `values` is an array of valid Solana public key strings.
 * @throws CCTParamsInvalidError if `values` is not an array or any item is invalid.
 */
export function validatePublicKeys(operation: string, param: string, values: unknown): void {
  if (!Array.isArray(values)) throw new CCTParamsInvalidError(operation, param, 'must be an array')
  for (const [i, value] of values.entries()) validatePublicKey(operation, `${param}[${i}]`, value)
}

/**
 * Asserts `value` is a non-empty string.
 * @throws CCTParamsInvalidError if `value` is not a non-empty string.
 */
export function validateNonEmptyString(operation: string, param: string, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) return
  throw new CCTParamsInvalidError(operation, param, 'must be a non-empty string')
}

/**
 * Asserts `tokenProgram` is a supported SPL Token program.
 * @throws CCTParamsInvalidError if `tokenProgram` is not SPL Token or Token-2022.
 */
export function validateTokenProgram(
  operation: string,
  param: string,
  tokenProgram: PublicKey,
  message = 'mint is not owned by SPL Token or Token-2022',
): void {
  if (tokenProgram.equals(TOKEN_PROGRAM_ID) || tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) return
  throw new CCTParamsInvalidError(operation, param, message)
}

/**
 * Asserts `value` is a supported token pool type.
 * @throws CCTParamsInvalidError if `value` is not `burn-mint` or `lock-release`.
 */
export function validatePoolType(
  operation: string,
  param: string,
  value: unknown,
): asserts value is TokenPoolType {
  if (typeof value !== 'string' || !Object.hasOwn(TOKEN_POOL_PROGRAMS, value)) {
    throw new CCTParamsInvalidError(operation, param, 'must be burn-mint or lock-release')
  }
}

/**
 * Asserts `value` is an integer, optionally inside inclusive bounds.
 * @throws CCTParamsInvalidError if `value` is not an integer or is outside bounds.
 */
export function validateInteger(
  operation: string,
  param: string,
  value: unknown,
  min?: number,
  max?: number,
): void {
  const validInteger = Number.isInteger(value)
  const validMin = min === undefined || (validInteger && Number(value) >= min)
  const validMax = max === undefined || (validInteger && Number(value) <= max)

  if (!validInteger || !validMin || !validMax) {
    const range = min !== undefined && max !== undefined ? ` between ${min} and ${max}` : ''
    throw new CCTParamsInvalidError(operation, param, `must be an integer${range}`)
  }
}

/**
 * Asserts ALT writable indexes are a non-empty list of byte values when provided.
 * @throws CCTParamsInvalidError if indexes are empty or outside byte range.
 */
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
    validateInteger(operation, `${param}[${i}]`, index, 0, 255)
  }
}
