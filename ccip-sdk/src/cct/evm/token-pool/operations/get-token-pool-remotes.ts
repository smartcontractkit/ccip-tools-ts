/**
 * getTokenPoolRemotes — reads a token pool's per-lane remote configuration
 * Delegates to {@link EVMChain.getTokenPoolRemotes}.
 *
 * @packageDocumentation
 */

import type { TokenPoolRemote } from '../../../../chain.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateUint64 } from '../../validate.ts'

/** Parameters for {@link GetTokenPoolRemotes}. */
export type GetTokenPoolRemotesParams = {
  /**
   * Token pool contract address to read.
   * @remarks Spelled `poolAddress` for consistency with every other CCT pool op, even though
   * {@link EVMChain.getTokenPoolRemotes} names the same argument `tokenPool`.
   */
  poolAddress: string
  /**
   * CCIP selector of a single remote chain to read (`uint64`). Omit to scan every lane the pool
   * reports through `getSupportedChains()`.
   */
  remoteChainSelector?: bigint
}

/** Result of {@link GetTokenPoolRemotes}: remote-lane configurations keyed by network name. */
export type GetTokenPoolRemotesResult = Record<string, TokenPoolRemote>

/**
 * Reads all, or one selected, remote-chain configurations of an EVM token pool.
 *
 * @remarks Delegates decoding wholesale to {@link EVMChain.getTokenPoolRemotes}; this class only
 * validates params (no RPC) and forwards them.
 */
export class GetTokenPoolRemotes extends EVMQuery<
  GetTokenPoolRemotesParams,
  GetTokenPoolRemotesResult
> {
  readonly name = 'getTokenPoolRemotes'

  /**
   * Validates the pool address and, when given, the remote-chain selector; nothing to convert for
   * {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is given and is not a `uint64`
   */
  protected prepare(params: GetTokenPoolRemotesParams): GetTokenPoolRemotesParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    if (params.remoteChainSelector !== undefined)
      validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /** Delegates remote-lane decoding to the shared chain reader, which owns the version branches. */
  protected read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector }: GetTokenPoolRemotesParams,
  ): Promise<GetTokenPoolRemotesResult> {
    return chain.getTokenPoolRemotes(poolAddress, remoteChainSelector)
  }
}
