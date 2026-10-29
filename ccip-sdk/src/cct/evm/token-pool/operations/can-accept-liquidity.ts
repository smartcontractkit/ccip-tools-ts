/**
 * canAcceptLiquidity: reads whether a v1.5.x LockRelease pool accepts liquidity deposits at all.
 * Mirrors `get-rebalancer.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLockReleasePool,
  readTokenPoolAcceptsLiquidity,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link CanAcceptLiquidity}. */
export type CanAcceptLiquidityParams = {
  /** v1.5.0 or v1.5.1 `LockReleaseTokenPool` to read. */
  poolAddress: string
}

/** Result of {@link CanAcceptLiquidity}: whether the pool accepts `provideLiquidity` deposits. */
export type CanAcceptLiquidityResult = boolean

/**
 * Reads a v1.5.x LockRelease pool's `canAcceptLiquidity()`: the immutable `i_acceptLiquidity` its
 * constructor fixed. A pool deployed with it `false` reverts every deposit with
 * `LiquidityNotAccepted` for its whole lifetime. `provideLiquidity` pre-flights this itself.
 */
export class CanAcceptLiquidity extends EVMQuery<
  CanAcceptLiquidityParams,
  CanAcceptLiquidityResult
> {
  readonly name = 'canAcceptLiquidity'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: CanAcceptLiquidityParams): CanAcceptLiquidityParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v1.6.x or v2.0.0 pool (siloed included),
   * which declares no flag: v1.6.x always accepts, v2.0.0 escrows through an `ERC20LockBox`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: CanAcceptLiquidityParams,
  ): Promise<CanAcceptLiquidityResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertLockReleasePool(this.name, poolAddress, type)
    if (version !== TokenPoolVersion.V1_5_0 && version !== TokenPoolVersion.V1_5_1)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolAcceptsLiquidity(chain, poolAddress)
  }
}
