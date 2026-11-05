/**
 * getAvailableTokens: reads the liquidity a v1.6.x `SiloedLockReleaseTokenPool` holds for one
 * lane.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertSiloedLockReleasePool,
  isTokenPoolRevert,
  readTokenPoolAvailableTokens,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetAvailableTokens}. */
export type GetAvailableTokensParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` to read. */
  poolAddress: string
  /** Lane to read (`uint64`); must be a supported chain of the pool. */
  remoteChainSelector: bigint
}

/** Result of {@link GetAvailableTokens}: the lane's liquidity, in the token's smallest unit. */
export type GetAvailableTokensResult = bigint

/**
 * Reads what a lane can release: the silo's own balance on a siloed lane, and on any other the
 * shared unsiloed bucket (the same value as `getUnsiloedLiquidity()`, which every unsiloed lane
 * draws on). Informational, for audit and UX; `withdrawSiloedLiquidity` pre-flights this itself.
 */
export class GetAvailableTokens extends EVMQuery<
  GetAvailableTokensParams,
  GetAvailableTokensResult
> {
  readonly name = 'getAvailableTokens'

  /**
   * Validates the pool address and lane; nothing to convert for {@link read}. Lane 0 is left to
   * the pool, which reports it as unsupported.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is not a `uint64`
   */
  protected prepare(params: GetAvailableTokensParams): GetAvailableTokensParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, whose lanes escrow through
   * lockboxes; read a lockbox's token balance instead
   * @throws {@link CCTParamsInvalidError} if the pool does not support the lane (its
   * `InvalidChainSelector` revert)
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector }: GetAvailableTokensParams,
  ): Promise<GetAvailableTokensResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    if (version === TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    try {
      return await readTokenPoolAvailableTokens(chain, poolAddress, remoteChainSelector)
    } catch (err) {
      if (!isTokenPoolRevert(err, 'InvalidChainSelector')) throw err
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        `lane ${remoteChainSelector} is not a supported lane on ${poolAddress}`,
        { cause: err instanceof Error ? err : undefined },
      )
    }
  }
}
