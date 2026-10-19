/**
 * getLockOrBurnMechanism: reads how a `USDCTokenPoolProxy` routes one lane. Mirrors
 * `lockbox/operations/get-all-lockbox-authorized-callers.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import {
  type LockOrBurnMechanism,
  assertUSDCTokenPoolProxy,
  readLockOrBurnMechanism,
} from '../contracts.ts'

/** Parameters for {@link GetLockOrBurnMechanism}. */
export type GetLockOrBurnMechanismParams = {
  /** The `USDCTokenPoolProxy`, i.e. what the TokenAdminRegistry returns as USDC's pool. */
  usdcTokenPoolProxy: string
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
}

/** The lane's mechanism; `INVALID_MECHANISM` means the proxy does not serve the lane. */
export type GetLockOrBurnMechanismResult = LockOrBurnMechanism

/**
 * Reads the lane's lock-or-burn mechanism.
 * @throws {@link CCTParamsInvalidError} if a param is invalid, or nothing at
 * `usdcTokenPoolProxy` answers `typeAndVersion()`
 * @throws {@link CCTContractTypeInvalidError} if it is not a `USDCTokenPoolProxy`
 * @throws {@link CCTContractVersionUnsupportedError} if it is not v2.0.0
 */
export class GetLockOrBurnMechanism extends EVMQuery<
  GetLockOrBurnMechanismParams,
  GetLockOrBurnMechanismResult
> {
  readonly name = 'getLockOrBurnMechanism'

  protected prepare(params: GetLockOrBurnMechanismParams): GetLockOrBurnMechanismParams {
    validateNonZeroAddress(this.name, 'usdcTokenPoolProxy', params.usdcTokenPoolProxy)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return params
  }

  protected async read(
    chain: EVMChain,
    { usdcTokenPoolProxy, remoteChainSelector }: GetLockOrBurnMechanismParams,
  ): Promise<GetLockOrBurnMechanismResult> {
    await assertUSDCTokenPoolProxy(this.name, chain, usdcTokenPoolProxy)
    return readLockOrBurnMechanism(chain, usdcTokenPoolProxy, remoteChainSelector)
  }
}
