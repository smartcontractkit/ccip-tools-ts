/**
 * getCCVConfig — reads one remote chain's configured CCV requirements from the `AdvancedPoolHooks`
 * bound to a v2.0.0 pool.
 *
 * @remarks Hooks may be shared, so the result is the configuration of every pool bound to the same
 * hooks, not one specific to `poolAddress`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import { type CCVConfig, readCCVConfig, resolveAdvancedPoolHooks } from '../contracts.ts'

/** Parameters for {@link GetCCVConfig}. */
export type GetCCVConfigParams = {
  /** v2.0.0 token pool whose bound hooks are read. */
  poolAddress: string
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
}

/** CCV lists for one remote chain; empty lists mean no configured requirements. */
export type GetCCVConfigResult = CCVConfig

/** Reads one remote chain's complete CCV config. */
export class GetCCVConfig extends EVMQuery<GetCCVConfigParams, GetCCVConfigResult> {
  readonly name = 'getCCVConfig'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` or `remoteChainSelector` is invalid */
  protected prepare(params: GetCCVConfigParams): GetCCVConfigParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /**
   * Resolves the pool's bound hooks, then reads the selector's config from them.
   * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
   * address is not `AdvancedPoolHooks`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector }: GetCCVConfigParams,
  ): Promise<GetCCVConfigResult> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    return readCCVConfig(chain, hooks, remoteChainSelector)
  }
}
