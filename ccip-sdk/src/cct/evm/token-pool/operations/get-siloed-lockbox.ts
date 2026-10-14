/**
 * getSiloedLockbox: reads the `ERC20LockBox` one lane of a v2.0.0 `SiloedLockReleaseTokenPool`
 * escrows through: the pool's `getLockBox(uint64)`.
 *
 * @remarks Not named `getLockbox`: that op wraps the non-siloed pool's no-arg `getLockBox()`, and
 * folding both into it would need an optional `remoteChainSelector` papering over the two
 * signatures. The `Siloed` infix borrows the 1.6.x per-lane naming (`provideLiquidity` →
 * `provideSiloedLiquidity`); v2.0.0 itself keeps the name `getLockBox` and adds the `uint64`.
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
  readTokenPoolSiloedLockbox,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetSiloedLockbox}. */
export type GetSiloedLockboxParams = {
  /** v2.0.0 `SiloedLockReleaseTokenPool` to read. */
  poolAddress: string
  /** Lane to read (`uint64`); must have a lockbox bound. */
  remoteChainSelector: bigint
}

/** Result of {@link GetSiloedLockbox}: the lane's lockbox, checksummed. */
export type GetSiloedLockboxResult = string

/**
 * Reads the lockbox a lane escrows through: the exact lookup the pool makes on every transfer on
 * that lane, and the address `depositToLockbox` / `withdrawFromLockbox` need to fund it.
 * `getAllSiloedLockboxConfigs` is the non-throwing way to see every lane at once.
 */
export class GetSiloedLockbox extends EVMQuery<GetSiloedLockboxParams, GetSiloedLockboxResult> {
  readonly name = 'getSiloedLockbox'

  /**
   * Validates the pool address and lane; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address, or
   * `remoteChainSelector` is not a `uint64`
   */
  protected prepare(params: GetSiloedLockboxParams): GetSiloedLockboxParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * (a non-siloed pool's single lockbox is `getLockbox`)
   * @throws {@link CCTOperationUnsupportedError} below v2.0.0, where a siloed pool holds its silos
   * itself
   * @throws {@link CCTParamsInvalidError} if no lockbox is bound to the lane (the pool's
   * `LockBoxNotConfigured` revert)
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector }: GetSiloedLockboxParams,
  ): Promise<GetSiloedLockboxResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    if (version !== TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    try {
      return await readTokenPoolSiloedLockbox(chain, poolAddress, remoteChainSelector)
    } catch (err) {
      if (!isTokenPoolRevert(err, 'LockBoxNotConfigured')) throw err
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        `no lockbox is configured for lane ${remoteChainSelector} on ${poolAddress}; every transfer on it reverts LockBoxNotConfigured; bind one with configureSiloedLockboxes`,
        { cause: err instanceof Error ? err : undefined },
      )
    }
  }
}
