/**
 * getCCVConfig — reads one remote chain's configured CCV requirements from `AdvancedPoolHooks`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateUint64 } from '../../validate.ts'
import {
  type AdvancedPoolHooksTarget,
  type CCVConfig,
  readCCVConfig,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link GetCCVConfig}. */
export type GetCCVConfigParams = AdvancedPoolHooksTarget & {
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
}

/** CCV lists for one remote chain; empty lists mean no configured requirements. */
export type GetCCVConfigResult = CCVConfig

/** Reads one remote chain's complete CCV config. */
export class GetCCVConfig extends EVMQuery<GetCCVConfigParams, GetCCVConfigResult> {
  readonly name = 'getCCVConfig'

  protected prepare(params: GetCCVConfigParams): GetCCVConfigParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  protected async read(chain: EVMChain, params: GetCCVConfigParams): Promise<GetCCVConfigResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readCCVConfig(chain, hooks, params.remoteChainSelector)
  }
}
