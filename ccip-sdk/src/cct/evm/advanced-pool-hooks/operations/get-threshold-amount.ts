/**
 * getThresholdAmount — reads the additional-CCV threshold of `AdvancedPoolHooks`, given directly or
 * as the hooks bound to a v2.0.0 pool.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import {
  type AdvancedPoolHooksTarget,
  readThresholdAmount,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link GetThresholdAmount}: the hooks to read, directly or through a pool. */
export type GetThresholdAmountParams = AdvancedPoolHooksTarget
/** Amount at or above which additional CCVs apply; zero means they are disabled. */
export type GetThresholdAmountResult = bigint

/**
 * Reads the additional-CCV threshold amount.
 * @throws {@link CCTParamsInvalidError} if the target is invalid, or the pool has no hooks bound
 * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`, or the
 * pool's type is not supported
 * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
 * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
 */
export class GetThresholdAmount extends EVMQuery<
  GetThresholdAmountParams,
  GetThresholdAmountResult
> {
  readonly name = 'getThresholdAmount'

  protected prepare(params: GetThresholdAmountParams): GetThresholdAmountParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    return params
  }

  protected async read(
    chain: EVMChain,
    params: GetThresholdAmountParams,
  ): Promise<GetThresholdAmountResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readThresholdAmount(chain, hooks)
  }
}
