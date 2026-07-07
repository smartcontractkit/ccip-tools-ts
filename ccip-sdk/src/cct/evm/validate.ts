/**
 * Shared parameter validators for EVM CCT operations. Throws
 * {@link CCTParamsInvalidError} before any RPC so invalid inputs fail fast.
 *
 * @packageDocumentation
 */

import { isAddress } from 'ethers'

import { CCTParamsInvalidError } from '../errors.ts'

/**
 * Asserts `value` is a valid EVM address. Tags the error with `operation` and `param`.
 * @throws {@link CCTParamsInvalidError}
 */
export function validateAddress(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid address, got ${String(value)}`,
    )
  }
}
