/** Reads one remote chain's configured CCV requirements from `AdvancedPoolHooks`. */

import type { EVMChain } from '../../../../evm/index.ts'
import { resultToObject } from '../../../../evm/types.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import {
  type CCVConfig,
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
} from '../contracts.ts'

/** Parameters for {@link GetCCVConfig}. */
export type GetCCVConfigParams = {
  /** Hooks contract to read. */
  advancedPoolHooks: string
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
}

/** CCV lists for one remote chain; empty lists mean no configured requirements. */
export type GetCCVConfigResult = CCVConfig

/** Reads one remote chain's complete CCV config. */
export class GetCCVConfig extends EVMQuery<GetCCVConfigParams, GetCCVConfigResult> {
  readonly name = 'getCCVConfig'

  protected prepare(params: GetCCVConfigParams): GetCCVConfigParams {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  protected async read(
    chain: EVMChain,
    { advancedPoolHooks, remoteChainSelector }: GetCCVConfigParams,
  ): Promise<GetCCVConfigResult> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    const data = ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('getCCVConfig', [
      remoteChainSelector,
    ])
    const result = await chain.provider.call({ to: advancedPoolHooks, data })
    return resultToObject(
      ADVANCED_POOL_HOOKS_INTERFACE.decodeFunctionResult('getCCVConfig', result)[0],
    ) as GetCCVConfigResult
  }
}
