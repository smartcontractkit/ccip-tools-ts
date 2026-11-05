/**
 * getAllAdvancedPoolHooksAuthorizedCallers — reads callers authorized to invoke
 * `AdvancedPoolHooks` checks.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import {
  type AdvancedPoolHooksTarget,
  readAllAuthorizedCallers,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link GetAllAdvancedPoolHooksAuthorizedCallers}. */
export type GetAllAdvancedPoolHooksAuthorizedCallersParams = AdvancedPoolHooksTarget
/** Authorized callers in the contract's enumerable-set order. */
export type GetAllAdvancedPoolHooksAuthorizedCallersResult = string[]

/**
 * Lists all callers authorized for hooks preflight and postflight checks.
 * @throws {@link CCTParamsInvalidError} if the target is invalid
 * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
 * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
 */
export class GetAllAdvancedPoolHooksAuthorizedCallers extends EVMQuery<
  GetAllAdvancedPoolHooksAuthorizedCallersParams,
  GetAllAdvancedPoolHooksAuthorizedCallersResult
> {
  readonly name = 'getAllAdvancedPoolHooksAuthorizedCallers'

  protected prepare(
    params: GetAllAdvancedPoolHooksAuthorizedCallersParams,
  ): GetAllAdvancedPoolHooksAuthorizedCallersParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    return params
  }

  protected async read(
    chain: EVMChain,
    params: GetAllAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<GetAllAdvancedPoolHooksAuthorizedCallersResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readAllAuthorizedCallers(chain, hooks)
  }
}
