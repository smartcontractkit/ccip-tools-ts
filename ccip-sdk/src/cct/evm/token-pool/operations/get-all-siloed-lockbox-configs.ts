/**
 * getAllSiloedLockboxConfigs: reads every lane → lockbox binding of a v2.0.0
 * `SiloedLockReleaseTokenPool`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  type LockboxConfig,
  TokenPoolVersion,
  assertSiloedLockReleasePool,
  readTokenPoolLockboxConfigs,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetAllSiloedLockboxConfigs}. */
export type GetAllSiloedLockboxConfigsParams = {
  /** v2.0.0 `SiloedLockReleaseTokenPool` to read. */
  poolAddress: string
}

/**
 * Result of {@link GetAllSiloedLockboxConfigs}: every bound lane in the contract's enumeration order,
 * lockboxes checksummed; `[]` when none is bound.
 */
export type GetAllSiloedLockboxConfigsResult = LockboxConfig[]

/**
 * Reads every lane → lockbox binding of a v2.0.0 siloed pool, the audit view: which lanes are
 * bound, and which share a lockbox (and so share liquidity). A lane missing here reverts
 * `LockBoxNotConfigured` on every transfer. One lane's lockbox is `getSiloedLockbox`.
 */
export class GetAllSiloedLockboxConfigs extends EVMQuery<
  GetAllSiloedLockboxConfigsParams,
  GetAllSiloedLockboxConfigsResult
> {
  readonly name = 'getAllSiloedLockboxConfigs'

  /**
   * Validates the pool address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   */
  protected prepare(params: GetAllSiloedLockboxConfigsParams): GetAllSiloedLockboxConfigsParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so a pool without the getter reports which
   * of the two reasons applies rather than a bare call failure.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} below v2.0.0, where a siloed pool holds its silos
   * itself (see `isSiloed` / `getAvailableTokens`)
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAllSiloedLockboxConfigsParams,
  ): Promise<GetAllSiloedLockboxConfigsResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    if (version !== TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolLockboxConfigs(chain, poolAddress)
  }
}
