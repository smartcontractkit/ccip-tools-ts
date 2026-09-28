/**
 * getThresholdAmount — reads an `AdvancedPoolHooks` additional-CCV threshold.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { assertAdvancedPoolHooksContract, readThresholdAmount } from '../contracts.ts'

/** Parameters for {@link GetThresholdAmount}. */
export type GetThresholdAmountParams = { advancedPoolHooks: string }
/** Amount at or above which additional CCVs apply; zero means they are disabled. */
export type GetThresholdAmountResult = bigint

/**
 * Reads the additional-CCV threshold amount.
 * @throws {@link CCTParamsInvalidError} if `advancedPoolHooks` is invalid
 * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
 */
export class GetThresholdAmount extends EVMQuery<
  GetThresholdAmountParams,
  GetThresholdAmountResult
> {
  readonly name = 'getThresholdAmount'

  protected prepare(params: GetThresholdAmountParams): GetThresholdAmountParams {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    return params
  }

  protected async read(
    chain: EVMChain,
    { advancedPoolHooks }: GetThresholdAmountParams,
  ): Promise<GetThresholdAmountResult> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    return readThresholdAmount(chain, advancedPoolHooks)
  }
}
