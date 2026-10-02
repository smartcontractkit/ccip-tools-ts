/**
 * getAllCCVConfigs — reads every configured remote-chain CCV requirement from `AdvancedPoolHooks`.
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

/** Parameters for {@link GetAllCCVConfigs}. */
export type GetAllCCVConfigsParams = AdvancedPoolHooksTarget

/** Complete CCV configs for configured remote chains, in the contract's enumerable-set order. */
export type GetAllCCVConfigsResult = CCVConfigUpdate[]

/** Lists every configured remote-chain CCV config. */
export class GetAllCCVConfigs extends EVMQuery<GetAllCCVConfigsParams, GetAllCCVConfigsResult> {
  readonly name = 'getAllCCVConfigs'

  protected prepare(params: GetAllCCVConfigsParams): GetAllCCVConfigsParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    return params
  }

  protected async read(
    chain: EVMChain,
    params: GetAllCCVConfigsParams,
  ): Promise<GetAllCCVConfigsResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readAllCCVConfigs(chain, hooks)
  }
}
