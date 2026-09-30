/**
 * getLockbox — reads the `ERC20LockBox` a v2.0.0 LockRelease pool escrows through.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertNonSiloedLockReleasePool,
  readTokenPoolLockbox,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetLockbox}. */
export type GetLockboxParams = {
  /** Non-siloed v2.0.0 LockRelease pool to read. */
  poolAddress: string
}

/**
 * Result of {@link GetLockbox}: the lockbox address, checksummed. Zero only if the pool was
 * somehow deployed without one, which its constructor rejects.
 */
export type GetLockboxResult = string

/**
 * Reads the lockbox a v2.0.0 LockRelease pool escrows through — fixed in its constructor and
 * immutable thereafter.
 *
 * The address the lockbox liquidity ops need: a v2.0.0 pool cannot release until someone deposits
 * into this lockbox, and depositing needs the lockbox's own address rather than the pool's. Also
 * the check behind "is this pool wired to the lockbox I authorized", which is where a
 * `deployLockbox` → `deployTokenPool` sequence goes wrong silently.
 */
export class GetLockbox extends EVMQuery<GetLockboxParams, GetLockboxResult> {
  readonly name = 'getLockbox'

  /**
   * Validates the pool address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   */
  protected prepare(params: GetLockboxParams): GetLockboxParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the three reasons applies rather than a bare call failure. Type first, then version: a
   * BurnMint or siloed pool has no single lockbox at *any* version, while the version check is
   * the narrower "this shape of pool, but too old".
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool, or a
   * `SiloedLockReleaseTokenPool` — see {@link assertNonSiloedLockReleasePool}
   * @throws {@link CCTOperationUnsupportedError} below v2.0.0, where a LockRelease pool holds its
   * liquidity itself — see `getRebalancer` / `provideLiquidity` for those versions
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetLockboxParams,
  ): Promise<GetLockboxResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertNonSiloedLockReleasePool(this.name, poolAddress, type)
    if (version !== TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolLockbox(chain, poolAddress)
  }
}
