/**
 * isSupportedToken: reads whether a token pool serves a given token, at every supported version.
 * Mirrors `get-token-pool-token.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenPoolIsSupportedToken, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link IsSupportedToken}. */
export type IsSupportedTokenParams = {
  /** Token pool to read. */
  poolAddress: string
  /** Token to ask about. */
  tokenAddress: string
}

/** Result of {@link IsSupportedToken}: whether `tokenAddress` is the pool's token. */
export type IsSupportedTokenResult = boolean

/**
 * Reads a token pool's `isSupportedToken(token)`: `true` only for the one token set in its
 * constructor (see `getTokenPoolToken`).
 */
export class IsSupportedToken extends EVMQuery<IsSupportedTokenParams, IsSupportedTokenResult> {
  readonly name = 'isSupportedToken'

  /**
   * Validates both addresses; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` or `tokenAddress` is not a valid
   * address
   */
  protected prepare(params: IsSupportedTokenParams): IsSupportedTokenParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateAddress(this.name, 'tokenAddress', params.tokenAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so an address that is not a known pool
   * fails typed instead of answering with an unrelated contract's `isSupportedToken`.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, tokenAddress }: IsSupportedTokenParams,
  ): Promise<IsSupportedTokenResult> {
    await resolveTokenPool(chain, poolAddress)
    return readTokenPoolIsSupportedToken(chain, poolAddress, tokenAddress)
  }
}
