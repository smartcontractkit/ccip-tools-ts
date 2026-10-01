/**
 * getCCVConfig — reads one remote chain's configured CCV requirements from `AdvancedPoolHooks`,
 * given directly or as the hooks bound to a v2.0.0 pool.
 *
 * @remarks Hooks may be shared, so the result is the configuration of every pool bound to the same
 * hooks, not one specific to `poolAddress`.
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

/** Parameters for {@link GetCCVConfig}; the hooks are given directly or through a pool. */
export type GetCCVConfigParams = AdvancedPoolHooksTarget & {
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
}

/** CCV lists for one remote chain; empty lists mean no configured requirements. */
export type GetCCVConfigResult = CCVConfig

/** Reads one remote chain's complete CCV config. */
export class GetCCVConfig extends EVMQuery<GetCCVConfigParams, GetCCVConfigResult> {
  readonly name = 'getCCVConfig'

  /** @throws {@link CCTParamsInvalidError} if the target or `remoteChainSelector` is invalid */
  protected prepare(params: GetCCVConfigParams): GetCCVConfigParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /**
   * Resolves the target hooks, then reads the selector's config from them.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`, or the
   * pool's type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound
   */
  protected async read(chain: EVMChain, params: GetCCVConfigParams): Promise<GetCCVConfigResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readCCVConfig(chain, hooks, params.remoteChainSelector)
  }
}
