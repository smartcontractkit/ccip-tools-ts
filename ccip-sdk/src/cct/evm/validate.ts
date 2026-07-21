/**
 * Shared parameter validators for EVM CCT operations. Throws
 * {@link CCTParamsInvalidError} before any RPC so invalid inputs fail fast.
 *
 * @packageDocumentation
 */

import { isAddress } from 'ethers'

import { CCIPAddressInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError } from '../errors.ts'

/**
 * Asserts `value` is a valid EVM address. Links the canonical
 * {@link CCIPAddressInvalidError} as the `cause`, keeping the
 * {@link operation}/{@link param} context on top.
 * @throws {@link CCTParamsInvalidError} if `value` is not a valid address
 */
export function validateAddress(operation: string, param: string, value: unknown): void {
  if (typeof value === 'string' && isAddress(value)) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be a valid address, got ${String(value)}`,
    {
      cause: new CCIPAddressInvalidError(String(value), ChainFamily.EVM),
    },
  )
}

/**
 * Asserts `value` is a non-empty (non-blank) string.
 * @throws {@link CCTParamsInvalidError} if `value` is not a non-empty string
 */
export function validateNonEmptyString(operation: string, param: string, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be a non-empty string, got ${String(value)}`,
  )
}

/**
 * Asserts `value` is an integer in `[0, 255]` (a Solidity `uint8`).
 * @throws {@link CCTParamsInvalidError} if `value` is not such an integer
 */
export function validateUint8(operation: string, param: string, value: unknown): void {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be an integer in [0, 255], got ${String(value)}`,
  )
}

/** Largest value representable by a Solidity `uint256`. */
const UINT256_MAX = BigInt(2) ** BigInt(256) - 1n

/**
 * Asserts `value` is a `bigint` in `[0, 2^256 − 1]` (a Solidity `uint256`).
 * @throws {@link CCTParamsInvalidError} if `value` is not such a bigint
 */
export function validateUint256(operation: string, param: string, value: unknown): void {
  if (typeof value === 'bigint' && value >= 0n && value <= UINT256_MAX) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be a bigint in [0, 2^256 − 1], got ${String(value)}`,
  )
}
