/**
 * Shared parameter validators for EVM CCT ops.
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
