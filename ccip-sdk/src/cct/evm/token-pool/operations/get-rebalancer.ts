/**
 * getRebalancer — reads the account a LockRelease pool accepts liquidity calls from
 * (v1.5.0–v1.6.1).
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
  readTokenPoolRebalancer,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetRebalancer}. */
export type GetRebalancerParams = {
  /** LockRelease pool to read. */
  poolAddress: string
}

/** Result of {@link GetRebalancer}: the rebalancer address, checksummed; zero when unset. */
export type GetRebalancerResult = string

/**
 * Reads a LockRelease pool's rebalancer — informational, for audit and UX. The liquidity write
 * ops gate on this same read themselves, so nothing needs to call this first.
 */
export class GetRebalancer extends EVMQuery<GetRebalancerParams, GetRebalancerResult> {
  readonly name = 'getRebalancer'

  /**
   * Validates the pool address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   */
  protected prepare(params: GetRebalancerParams): GetRebalancerParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which has no rebalancer: it
   * escrows through an external `ERC20LockBox`, which authorizes its own callers
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetRebalancerParams,
  ): Promise<GetRebalancerResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertLockReleasePool(this.name, poolAddress, type)
    if (version === TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolRebalancer(chain, poolAddress)
  }
}
