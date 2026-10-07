/**
 * getThresholdAmount — reads an `AdvancedPoolHooks` additional-CCV threshold.
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

/** Parameters for {@link GetThresholdAmount}. */
export type GetThresholdAmountParams = AdvancedPoolHooksTarget
/** Amount at or above which additional CCVs apply; zero means they are disabled. */
export type GetThresholdAmountResult = bigint

/**
 * Reads the additional-CCV threshold amount.
 * @throws {@link CCTParamsInvalidError} if the target is invalid
 * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
 * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
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
