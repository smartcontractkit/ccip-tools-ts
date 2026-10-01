/**
 * getAllCCVConfigs — reads every configured remote-chain CCV requirement from the
 * `AdvancedPoolHooks` bound to a v2.0.0 pool.
 *
 * @remarks Hooks may be shared, so the result is the configuration of every pool bound to the same
 * hooks, not one specific to `poolAddress`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { type CCVConfigUpdate, readAllCCVConfigs, resolveAdvancedPoolHooks } from '../contracts.ts'

/** Parameters for {@link GetAllCCVConfigs}. */
export type GetAllCCVConfigsParams = {
  /** v2.0.0 token pool whose bound hooks are read. */
  poolAddress: string
}

/** Complete CCV configs for configured remote chains, in the contract's enumerable-set order. */
export type GetAllCCVConfigsResult = CCVConfigUpdate[]

/** Lists every configured remote-chain CCV config. */
export class GetAllCCVConfigs extends EVMQuery<GetAllCCVConfigsParams, GetAllCCVConfigsResult> {
  readonly name = 'getAllCCVConfigs'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid or zero */
  protected prepare(params: GetAllCCVConfigsParams): GetAllCCVConfigsParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's bound hooks, then lists their configs.
   * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
   * address is not `AdvancedPoolHooks`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAllCCVConfigsParams,
  ): Promise<GetAllCCVConfigsResult> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    return readAllCCVConfigs(chain, hooks)
  }
}
