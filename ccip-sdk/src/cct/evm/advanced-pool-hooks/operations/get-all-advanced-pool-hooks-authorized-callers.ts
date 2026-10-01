/**
 * getAllAdvancedPoolHooksAuthorizedCallers — reads the callers authorized to invoke the checks of
 * the `AdvancedPoolHooks` bound to a v2.0.0 pool.
 *
 * @remarks Hooks may be shared, so the set can list other pools bound to the same hooks. A pool
 * missing from it reverts `UnauthorizedCaller` on every transfer.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readAllAuthorizedCallers, resolveAdvancedPoolHooks } from '../contracts.ts'

/** Parameters for {@link GetAllAdvancedPoolHooksAuthorizedCallers}. */
export type GetAllAdvancedPoolHooksAuthorizedCallersParams = {
  /** v2.0.0 token pool whose bound hooks are read. */
  poolAddress: string
}
/** Authorized callers in the contract's enumerable-set order. */
export type GetAllAdvancedPoolHooksAuthorizedCallersResult = string[]

/**
 * Lists all callers authorized for hooks preflight and postflight checks.
 * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, or the pool has no hooks bound
 * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
 * address is not `AdvancedPoolHooks`
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
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAllAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<GetAllAdvancedPoolHooksAuthorizedCallersResult> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    return readAllAuthorizedCallers(chain, hooks)
  }
}
