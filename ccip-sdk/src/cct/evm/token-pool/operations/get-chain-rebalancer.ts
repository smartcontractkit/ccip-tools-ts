/**
 * getChainRebalancer: reads the account a v1.6.x `SiloedLockReleaseTokenPool` accepts liquidity
 * calls from for one lane.
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
  readTokenPoolChainRebalancer,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetChainRebalancer}. */
export type GetChainRebalancerParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` to read. */
  poolAddress: string
  /** Lane to read (`uint64`). */
  remoteChainSelector: bigint
}

/** Result of {@link GetChainRebalancer}: the rebalancer address, checksummed; zero when unset. */
export type GetChainRebalancerResult = string

/**
 * Reads a lane's rebalancer: the silo's own on a siloed lane, and on any other the pool's unsiloed
 * rebalancer (what `getRebalancer` returns). The zero address means the lane accepts liquidity
 * calls from nobody. Informational, for audit and UX; the per-lane liquidity ops gate on this same
 * read themselves.
 */
export class GetChainRebalancer extends EVMQuery<
  GetChainRebalancerParams,
  GetChainRebalancerResult
> {
  readonly name = 'getChainRebalancer'

  /**
   * Validates the pool address and lane; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is not a `uint64`
   */
  protected prepare(params: GetChainRebalancerParams): GetChainRebalancerParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which has no rebalancer: its
   * lanes escrow through lockboxes, which authorize their own callers
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector }: GetChainRebalancerParams,
  ): Promise<GetChainRebalancerResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    if (version === TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolChainRebalancer(chain, poolAddress, remoteChainSelector)
  }
}
