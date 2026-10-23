/**
 * getTokenPoolToken: reads the token a token pool was deployed for, at every supported version.
 * Mirrors `get-token-pool-owner.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenPoolToken, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link GetTokenPoolToken}. */
export type GetTokenPoolTokenParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Result of {@link GetTokenPoolToken}: the pool's token, checksummed. */
export type GetTokenPoolTokenResult = string

/** Reads a token pool's `getToken()`: the token set in its constructor, immutable thereafter. */
export class GetTokenPoolToken extends EVMQuery<GetTokenPoolTokenParams, GetTokenPoolTokenResult> {
  readonly name = 'getTokenPoolToken'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetTokenPoolTokenParams): GetTokenPoolTokenParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so an address that is not a known pool
   * fails typed instead of answering with an unrelated contract's `getToken()`.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetTokenPoolTokenParams,
  ): Promise<GetTokenPoolTokenResult> {
    await resolveTokenPool(chain, poolAddress)
    return (await readTokenPoolToken(chain, poolAddress)).token
  }
}
