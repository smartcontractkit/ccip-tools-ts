/**
 * getUSDCTokenPoolProxyRemotePools: reads the remote pools of the child pool a
 * `USDCTokenPoolProxy` routes one lane to, decoded in the remote chain's address format. Prefixed
 * with the contract because pools answer `getRemotePools` too. Resolves the remote family as
 * `remote-address.ts` does, via {@link resolveRemoteFamily}.
 *
 * @packageDocumentation
 */

import { isError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { ChainFamily } from '../../../../networks.ts'
import { decodeAddress } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { resolveRemoteFamily } from '../../../remote-address.ts'
import { EVMQuery } from '../../query.ts'
import { isTokenPoolRevert } from '../../token-pool/contracts.ts'
import { validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import {
  LOCK_OR_BURN_MECHANISMS,
  assertUSDCTokenPoolProxy,
  readUSDCTokenPoolProxyRemotePools,
} from '../contracts.ts'

/** Parameters for {@link GetUSDCTokenPoolProxyRemotePools}. */
export type GetUSDCTokenPoolProxyRemotePoolsParams = {
  /** The `USDCTokenPoolProxy`, i.e. what the TokenAdminRegistry returns as USDC's pool. */
  usdcTokenPoolProxy: string
  /** Remote CCIP chain selector (`uint64`); also picks the address format to decode. */
  remoteChainSelector: bigint
}

/** Remote pools, in the remote chain's address format (checksummed for EVM, base58 for Solana). */
export type GetUSDCTokenPoolProxyRemotePoolsResult = string[]

/** {@link GetUSDCTokenPoolProxyRemotePoolsParams} plus the remote family, resolved once. */
type ParsedParams = GetUSDCTokenPoolProxyRemotePoolsParams & { family: ChainFamily }

/**
 * Reads the remote pools of the child pool serving a lane under its current mechanism.
 * @throws {@link CCTParamsInvalidError} if a param is invalid, the selector is not a known CCIP
 * chain selector or its chain family is not registered, nothing at `usdcTokenPoolProxy` answers
 * `typeAndVersion()`, or the lane has no mechanism or no pool for it
 * @throws {@link CCTContractTypeInvalidError} if it is not a `USDCTokenPoolProxy`
 * @throws {@link CCTContractVersionUnsupportedError} if it is not v2.0.0
 */
export class GetUSDCTokenPoolProxyRemotePools extends EVMQuery<
  GetUSDCTokenPoolProxyRemotePoolsParams,
  GetUSDCTokenPoolProxyRemotePoolsResult,
  ParsedParams
> {
  readonly name = 'getUSDCTokenPoolProxyRemotePools'

  protected prepare(params: GetUSDCTokenPoolProxyRemotePoolsParams): ParsedParams {
    validateNonZeroAddress(this.name, 'usdcTokenPoolProxy', params.usdcTokenPoolProxy)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    const family = resolveRemoteFamily(this.name, 'remoteChainSelector', params.remoteChainSelector)
    return { ...params, family }
  }

  protected async read(
    chain: EVMChain,
    { usdcTokenPoolProxy, remoteChainSelector, family }: ParsedParams,
  ): Promise<GetUSDCTokenPoolProxyRemotePoolsResult> {
    await assertUSDCTokenPoolProxy(this.name, chain, usdcTokenPoolProxy)
    let pools: string[]
    try {
      pools = await readUSDCTokenPoolProxyRemotePools(
        chain,
        usdcTokenPoolProxy,
        remoteChainSelector,
      )
    } catch (err) {
      if (isTokenPoolRevert(err, 'InvalidLockOrBurnMechanism'))
        throw new CCTParamsInvalidError(
          this.name,
          'remoteChainSelector',
          `no lock-or-burn mechanism set for lane ${remoteChainSelector} on proxy ${usdcTokenPoolProxy}`,
          { cause: err instanceof Error ? err : undefined },
        )
      if (isTokenPoolRevert(err, 'MustSetPoolForMechanism')) {
        // MustSetPoolForMechanism(uint64 remoteChainSelector, uint8 mechanism)
        const ordinal: unknown = isError(err, 'CALL_EXCEPTION') ? err.revert?.args[1] : undefined
        const mechanism = LOCK_OR_BURN_MECHANISMS[Number(ordinal)] ?? 'a mechanism'
        throw new CCTParamsInvalidError(
          this.name,
          'remoteChainSelector',
          `lane ${remoteChainSelector} routes to ${mechanism} but proxy ${usdcTokenPoolProxy} has no pool for it; check its pools with getUSDCTokenPoolProxyState`,
          { cause: err instanceof Error ? err : undefined },
        )
      }
      throw err
    }
    return pools.map((pool) => decodeAddress(pool, family))
  }
}
