/**
 * isSiloed: reads whether a lane of a v1.6.x `SiloedLockReleaseTokenPool` has its own silo.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertSiloedLockReleasePool,
  readTokenPoolIsSiloed,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link IsSiloed}. */
export type IsSiloedParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` to read. */
  poolAddress: string
  /** Lane to ask about (`uint64`). */
  remoteChainSelector: bigint
}

/**
 * Result of {@link IsSiloed}: whether the lane has its own silo. `false` for lane 0 and for any
 * lane the pool has never heard of.
 */
export type IsSiloedResult = boolean

/**
 * Reads whether a lane is siloed: if so its liquidity, rebalancer and balance are its own
 * (`provideSiloedLiquidity` / `withdrawSiloedLiquidity`); if not it shares the unsiloed bucket
 * (`provideLiquidity` / `withdrawLiquidity`). Silos are set with `updateSiloDesignations`.
 */
export class IsSiloed extends EVMQuery<IsSiloedParams, IsSiloedResult> {
  readonly name = 'isSiloed'

  /**
   * Validates the pool address and lane; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is not a `uint64`
   */
  protected prepare(params: IsSiloedParams): IsSiloedParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which isolates lanes by binding
   * them to separate lockboxes instead (see `getAllLockBoxConfigs`)
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector }: IsSiloedParams,
  ): Promise<IsSiloedResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    if (version === TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolIsSiloed(chain, poolAddress, remoteChainSelector)
  }
}
