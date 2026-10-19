/**
 * getUSDCTokenPoolProxyRequiredCCVs: resolves the CCVs a `USDCTokenPoolProxy` requires for a
 * transfer on one lane. Prefixed with the contract because `getRequiredCCVs` is the
 * `AdvancedPoolHooks` op. Mirrors `advanced-pool-hooks/operations/get-required-ccvs.ts`.
 *
 * @remarks The proxy answers without calling a child pool: `CCV` gets the `cctpVerifier`, every
 * other mechanism `[address(0)]` (the default CCVs).
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { isTokenPoolRevert } from '../../token-pool/contracts.ts'
import { validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import {
  INBOUND_MECHANISM_TAGS,
  assertUSDCTokenPoolProxy,
  readUSDCTokenPoolProxyRequiredCCVs,
} from '../contracts.ts'

/**
 * Parameters for {@link GetUSDCTokenPoolProxyRequiredCCVs}.
 *
 * @remarks Inbound requirements follow the message's source-pool-data tag, not the lane's current
 * mechanism, and the proxy ignores the selector for them: inbound `CCV` always returns the
 * `cctpVerifier` and inbound `LOCK_RELEASE` always `[ZeroAddress]`. `CCTP_V1` and `CCTP_V2` are
 * not accepted, because the proxy reverts `InvalidMessageVersion` on their tags.
 */
export type GetUSDCTokenPoolProxyRequiredCCVsParams = {
  /** The `USDCTokenPoolProxy`, i.e. what the TokenAdminRegistry returns as USDC's pool. */
  usdcTokenPoolProxy: string
  /** Remote CCIP chain selector (`uint64`); outbound reads its mechanism. */
  remoteChainSelector: bigint
} & (
  | {
      /** Resolve the requirements for a transfer leaving this chain. */
      direction: 'outbound'
      inboundMechanism?: never
    }
  | {
      /** Resolve the requirements for a transfer arriving on this chain. */
      direction: 'inbound'
      /** The mechanism the arriving message was sent with. */
      inboundMechanism: keyof typeof INBOUND_MECHANISM_TAGS
    }
)

/** Required CCV addresses; `[ZeroAddress]` means the lane uses the default CCVs. */
export type GetUSDCTokenPoolProxyRequiredCCVsResult = string[]

/**
 * Resolves the CCV set the proxy requires for a transfer.
 * @throws {@link CCTParamsInvalidError} if a param is invalid, nothing at `usdcTokenPoolProxy`
 * answers `typeAndVersion()`, or an outbound lane has no mechanism set
 * @throws {@link CCTContractTypeInvalidError} if it is not a `USDCTokenPoolProxy`
 * @throws {@link CCTContractVersionUnsupportedError} if it is not v2.0.0
 */
export class GetUSDCTokenPoolProxyRequiredCCVs extends EVMQuery<
  GetUSDCTokenPoolProxyRequiredCCVsParams,
  GetUSDCTokenPoolProxyRequiredCCVsResult
> {
  readonly name = 'getUSDCTokenPoolProxyRequiredCCVs'

  protected prepare(
    params: GetUSDCTokenPoolProxyRequiredCCVsParams,
  ): GetUSDCTokenPoolProxyRequiredCCVsParams {
    validateNonZeroAddress(this.name, 'usdcTokenPoolProxy', params.usdcTokenPoolProxy)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    // widened: JS callers can pass anything the union forbids
    const { direction, inboundMechanism }: { direction: unknown; inboundMechanism?: unknown } =
      params
    if (direction !== 'outbound' && direction !== 'inbound')
      throw new CCTParamsInvalidError(this.name, 'direction', 'must be outbound or inbound')
    if (direction === 'outbound' && inboundMechanism !== undefined)
      throw new CCTParamsInvalidError(
        this.name,
        'inboundMechanism',
        "must be omitted for an outbound read, which reads the lane's mechanism on-chain",
      )
    if (
      direction === 'inbound' &&
      (typeof inboundMechanism !== 'string' ||
        !Object.hasOwn(INBOUND_MECHANISM_TAGS, inboundMechanism))
    )
      throw new CCTParamsInvalidError(
        this.name,
        'inboundMechanism',
        `must be one of ${Object.keys(INBOUND_MECHANISM_TAGS).join(', ')} for an inbound read, got ${String(inboundMechanism)}; the proxy reverts InvalidMessageVersion on any other tag`,
      )
    return params
  }

  protected async read(
    chain: EVMChain,
    params: GetUSDCTokenPoolProxyRequiredCCVsParams,
  ): Promise<GetUSDCTokenPoolProxyRequiredCCVsResult> {
    const { usdcTokenPoolProxy, remoteChainSelector } = params
    await assertUSDCTokenPoolProxy(this.name, chain, usdcTokenPoolProxy)
    // IPoolV2.MessageDirection { Outbound, Inbound }; only inbound reads the tag
    const [direction, extraData] =
      params.direction === 'outbound'
        ? [0n, '0x']
        : [1n, INBOUND_MECHANISM_TAGS[params.inboundMechanism]]
    try {
      return await readUSDCTokenPoolProxyRequiredCCVs(
        chain,
        usdcTokenPoolProxy,
        remoteChainSelector,
        direction,
        extraData,
      )
    } catch (err) {
      if (!isTokenPoolRevert(err, 'NoLockOrBurnMechanismSet')) throw err
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        `no lock-or-burn mechanism set for lane ${remoteChainSelector} on proxy ${usdcTokenPoolProxy}; every outbound transfer on it reverts`,
        { cause: err instanceof Error ? err : undefined },
      )
    }
  }
}
