/**
 * Shared parameter validators for EVM CCT ops.
 *
 * @packageDocumentation
 */

import { isAddress } from 'ethers'

import { CCIPCctParamsInvalidError } from '../../errors/index.ts'

/**
 * Asserts `value` is a valid EVM address.
 * @throws {@link CCIPCctParamsInvalidError} if it is not
 */
export function validateAddress(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new CCIPCctParamsInvalidError(
      operation,
      param,
      `must be a valid address, got ${String(value)}`,
    )
  }
}
