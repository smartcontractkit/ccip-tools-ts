/**
 * getAllCCVConfigs — reads every configured remote-chain CCV requirement from `AdvancedPoolHooks`,
 * given directly or as the hooks bound to a v2.0.0 pool.
 *
 * @remarks Hooks may be shared, so the result is the configuration of every pool bound to the same
 * hooks, not one specific to `poolAddress`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import {
  type AdvancedPoolHooksTarget,
  type CCVConfigUpdate,
  readAllCCVConfigs,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link GetAllCCVConfigs}: the hooks to read, directly or through a pool. */
export type GetAllCCVConfigsParams = AdvancedPoolHooksTarget

/** Complete CCV configs for configured remote chains, in the contract's enumerable-set order. */
export type GetAllCCVConfigsResult = CCVConfigUpdate[]

/** Lists every configured remote-chain CCV config. */
export class GetAllCCVConfigs extends EVMQuery<GetAllCCVConfigsParams, GetAllCCVConfigsResult> {
  readonly name = 'getAllCCVConfigs'

  /** @throws {@link CCTParamsInvalidError} if the target is invalid */
  protected prepare(params: GetAllCCVConfigsParams): GetAllCCVConfigsParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    return params
  }

  /**
   * Resolves the target hooks, then lists their configs.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`, or the
   * pool's type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound
   */
  protected async read(
    chain: EVMChain,
    params: GetAllCCVConfigsParams,
  ): Promise<GetAllCCVConfigsResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readAllCCVConfigs(chain, hooks)
  }
}
