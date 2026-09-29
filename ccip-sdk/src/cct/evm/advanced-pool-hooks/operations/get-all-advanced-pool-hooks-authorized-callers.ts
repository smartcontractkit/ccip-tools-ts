/**
 * getAllAdvancedPoolHooksAuthorizedCallers — reads callers authorized to invoke
 * `AdvancedPoolHooks` checks.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { assertAdvancedPoolHooksContract, readAllAuthorizedCallers } from '../contracts.ts'

/** Parameters for {@link GetAllAdvancedPoolHooksAuthorizedCallers}. */
export type GetAllAdvancedPoolHooksAuthorizedCallersParams = { advancedPoolHooks: string }
/** Authorized callers in the contract's enumerable-set order. */
export type GetAllAdvancedPoolHooksAuthorizedCallersResult = string[]

/**
 * Lists all callers authorized for hooks preflight and postflight checks.
 * @throws {@link CCTParamsInvalidError} if `advancedPoolHooks` is invalid
 * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
 */
export class GetAllAdvancedPoolHooksAuthorizedCallers extends EVMQuery<
  GetAllAdvancedPoolHooksAuthorizedCallersParams,
  GetAllAdvancedPoolHooksAuthorizedCallersResult
> {
  readonly name = 'getAllAdvancedPoolHooksAuthorizedCallers'

  protected prepare(
    params: GetAllAdvancedPoolHooksAuthorizedCallersParams,
  ): GetAllAdvancedPoolHooksAuthorizedCallersParams {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    return params
  }

  protected async read(
    chain: EVMChain,
    { advancedPoolHooks }: GetAllAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<GetAllAdvancedPoolHooksAuthorizedCallersResult> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    return readAllAuthorizedCallers(chain, advancedPoolHooks)
  }
}
