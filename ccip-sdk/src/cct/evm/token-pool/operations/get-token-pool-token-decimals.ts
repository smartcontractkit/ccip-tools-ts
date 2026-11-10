/**
 * getTokenPoolTokenDecimals: reads the local token decimals a v1.5.1+ token pool was deployed
 * with. Mirrors `get-rebalancer.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { TokenPoolVersion, readTokenPoolTokenDecimals, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link GetTokenPoolTokenDecimals}. */
export type GetTokenPoolTokenDecimalsParams = {
  /** v1.5.1+ token pool to read. */
  poolAddress: string
}

/** Result of {@link GetTokenPoolTokenDecimals}: the pool's configured token decimals. */
export type GetTokenPoolTokenDecimalsResult = number

/**
 * Reads a token pool's `getTokenDecimals()`: the decimals set in its constructor, which it scales
 * cross-chain amounts by. One call, without the full `getTokenPoolState` read.
 */
export class GetTokenPoolTokenDecimals extends EVMQuery<
  GetTokenPoolTokenDecimalsParams,
  GetTokenPoolTokenDecimalsResult
> {
  readonly name = 'getTokenPoolTokenDecimals'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetTokenPoolTokenDecimalsParams): GetTokenPoolTokenDecimalsParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's version before the read, so a v1.5.0 pool reports the missing getter
   * rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a v1.5.0 pool, which does not declare
   * `getTokenDecimals()`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetTokenPoolTokenDecimalsParams,
  ): Promise<GetTokenPoolTokenDecimalsResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    if (version === TokenPoolVersion.V1_5_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolTokenDecimals(chain, poolAddress)
  }
}
