/**
 * getAllCCVConfigs — reads every configured remote-chain CCV requirement from `AdvancedPoolHooks`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  type CCVConfigUpdate,
  assertAdvancedPoolHooksContract,
  readAllCCVConfigs,
} from '../contracts.ts'

/** Parameters for {@link GetAllCCVConfigs}. */
export type GetAllCCVConfigsParams = {
  /** Hooks contract to read. */
  advancedPoolHooks: string
}

/** Complete CCV configs for configured remote chains, in the contract's enumerable-set order. */
export type GetAllCCVConfigsResult = CCVConfigUpdate[]

/** Lists every configured remote-chain CCV config. */
export class GetAllCCVConfigs extends EVMQuery<GetAllCCVConfigsParams, GetAllCCVConfigsResult> {
  readonly name = 'getAllCCVConfigs'

  protected prepare(params: GetAllCCVConfigsParams): GetAllCCVConfigsParams {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    return params
  }

  protected async read(
    chain: EVMChain,
    { advancedPoolHooks }: GetAllCCVConfigsParams,
  ): Promise<GetAllCCVConfigsResult> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    return readAllCCVConfigs(chain, advancedPoolHooks)
  }
}
