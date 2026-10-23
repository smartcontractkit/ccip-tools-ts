/**
 * getRateLimitAdmin: reads the delegated rate-limit admin of a token pool, at every supported
 * version. Mirrors `get-rebalancer.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenPoolRateLimitAdmin, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link GetRateLimitAdmin}. */
export type GetRateLimitAdminParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Result of {@link GetRateLimitAdmin}: the rate-limit admin, checksummed; zero when unset. */
export type GetRateLimitAdminResult = string

/**
 * Reads a token pool's rate-limit admin: the account besides the owner allowed to call
 * `setChainRateLimiterConfigs`. Set with `setRateLimitAdmin` before v2.0.0 and with
 * `setDynamicConfig` on v2.0.0.
 */
export class GetRateLimitAdmin extends EVMQuery<GetRateLimitAdminParams, GetRateLimitAdminResult> {
  readonly name = 'getRateLimitAdmin'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetRateLimitAdminParams): GetRateLimitAdminParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's version to pick the getter: `getRateLimitAdmin()` on v1.5.0 to v1.6.1,
   * `getDynamicConfig()`'s `rateLimitAdmin` on v2.0.0.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetRateLimitAdminParams,
  ): Promise<GetRateLimitAdminResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    return readTokenPoolRateLimitAdmin(chain, poolAddress, version)
  }
}
