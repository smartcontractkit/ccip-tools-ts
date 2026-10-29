/**
 * getTokenPoolOwner: reads the Ownable2Step owner of a token pool, at every supported version.
 * Mirrors `get-rebalancer.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenPoolOwner, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link GetTokenPoolOwner}. */
export type GetTokenPoolOwnerParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Result of {@link GetTokenPoolOwner}: the pool owner, checksummed. */
export type GetTokenPoolOwnerResult = string

/**
 * Reads a token pool's `owner()`: the account every owner-gated pool write must be signed by.
 * A pending owner is not readable: no pool version exposes a getter for it.
 */
export class GetTokenPoolOwner extends EVMQuery<GetTokenPoolOwnerParams, GetTokenPoolOwnerResult> {
  readonly name = 'getTokenPoolOwner'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetTokenPoolOwnerParams): GetTokenPoolOwnerParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so an address that is not a known pool
   * fails typed instead of answering with an unrelated contract's `owner()`.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetTokenPoolOwnerParams,
  ): Promise<GetTokenPoolOwnerResult> {
    await resolveTokenPool(chain, poolAddress)
    return readTokenPoolOwner(chain, poolAddress)
  }
}
