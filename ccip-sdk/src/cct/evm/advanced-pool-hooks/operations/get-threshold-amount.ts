/**
 * getThresholdAmount — reads the additional-CCV threshold of the `AdvancedPoolHooks` bound to a
 * v2.0.0 pool.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readThresholdAmount, resolveAdvancedPoolHooks } from '../contracts.ts'

/** Parameters for {@link GetThresholdAmount}. */
export type GetThresholdAmountParams = {
  /** v2.0.0 token pool whose bound hooks are read. */
  poolAddress: string
}
/** Amount at or above which additional CCVs apply; zero means they are disabled. */
export type GetThresholdAmountResult = bigint

/**
 * Reads the additional-CCV threshold amount.
 * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, or the pool has no hooks bound
 * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
 * address is not `AdvancedPoolHooks`
 * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
 * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
 */
export class GetThresholdAmount extends EVMQuery<
  GetThresholdAmountParams,
  GetThresholdAmountResult
> {
  readonly name = 'getThresholdAmount'

  protected prepare(params: GetThresholdAmountParams): GetThresholdAmountParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  protected async read(
    chain: EVMChain,
    { poolAddress }: GetThresholdAmountParams,
  ): Promise<GetThresholdAmountResult> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    return readThresholdAmount(chain, hooks)
  }
}
