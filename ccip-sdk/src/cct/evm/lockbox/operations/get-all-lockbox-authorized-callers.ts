/**
 * getAllLockboxAuthorizedCallers — reads callers authorized to invoke an `ERC20LockBox`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { assertLockbox, readAllLockboxAuthorizedCallers } from '../contracts.ts'

/** Parameters for {@link GetAllLockboxAuthorizedCallers}. */
export type GetAllLockboxAuthorizedCallersParams = { lockbox: string }
/** Authorized callers in the contract's enumerable-set order. */
export type GetAllLockboxAuthorizedCallersResult = string[]

/**
 * Lists all callers authorized to deposit into or withdraw from the lockbox.
 * @throws {@link CCTParamsInvalidError} if `lockbox` is invalid
 * @throws {@link CCTContractTypeInvalidError} if `lockbox` is not `ERC20LockBox`
 */
export class GetAllLockboxAuthorizedCallers extends EVMQuery<
  GetAllLockboxAuthorizedCallersParams,
  GetAllLockboxAuthorizedCallersResult
> {
  readonly name = 'getAllLockboxAuthorizedCallers'

  protected prepare(
    params: GetAllLockboxAuthorizedCallersParams,
  ): GetAllLockboxAuthorizedCallersParams {
    validateNonZeroAddress(this.name, 'lockbox', params.lockbox)
    return params
  }

  protected async read(
    chain: EVMChain,
    { lockbox }: GetAllLockboxAuthorizedCallersParams,
  ): Promise<GetAllLockboxAuthorizedCallersResult> {
    await assertLockbox(this.name, chain, lockbox)
    return readAllLockboxAuthorizedCallers(chain, lockbox)
  }
}
