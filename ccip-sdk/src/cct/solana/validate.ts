import { PublicKey } from '@solana/web3.js'

import { CCIPAddressInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError } from '../errors.ts'
import { type TokenPoolType, TOKEN_POOL_PROGRAMS } from './programs/token-pool.ts'

/**
 * Asserts `value` is a valid Solana public key string.
 * @throws CCTParamsInvalidError if `value` is not a valid Solana public key string.
 */
export function validatePublicKey(
  operation: string,
  param: string,
  value: unknown,
): asserts value is string {
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
 * Asserts an authority matches the executing wallet.
 * @throws CCTParamsInvalidError if authority does not match wallet.
 */
export function validateAuthorityMatchesWallet(
  operation: string,
  authority: PublicKey,
  wallet: PublicKey,
  errorMessage = 'must match the executing wallet',
): void {
  if (!authority.equals(wallet)) {
    throw new CCTParamsInvalidError(operation, 'authority', errorMessage)
  }
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
 * Asserts ALT writable indexes are a non-empty list of byte values when provided.
 * @throws CCTParamsInvalidError if `writableIndexes` is invalid.
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
    if (!Number.isInteger(index) || index < 0 || index > 255) {
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must be an integer between 0 and 255',
      )
    }
  }
}
