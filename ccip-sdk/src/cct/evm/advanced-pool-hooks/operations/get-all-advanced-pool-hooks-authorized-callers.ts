/**
 * getAllAdvancedPoolHooksAuthorizedCallers — reads the callers authorized to invoke the checks of
 * `AdvancedPoolHooks`, given directly or as the hooks bound to a v2.0.0 pool.
 *
 * @remarks Hooks may be shared, so the set can list other pools bound to the same hooks. A pool
 * missing from it reverts `UnauthorizedCaller` on every transfer.
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

/**
 * Parameters for {@link GetAllAdvancedPoolHooksAuthorizedCallers}: the hooks to read, directly or
 * through a pool.
 */
export type GetAllAdvancedPoolHooksAuthorizedCallersParams = AdvancedPoolHooksTarget
/** Authorized callers in the contract's enumerable-set order. */
export type GetAllAdvancedPoolHooksAuthorizedCallersResult = string[]

/**
 * Lists all callers authorized for hooks preflight and postflight checks.
 * @throws {@link CCTParamsInvalidError} if the target is invalid, or the pool has no hooks bound
 * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`, or the
 * pool's type is not supported
 * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
 * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
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
