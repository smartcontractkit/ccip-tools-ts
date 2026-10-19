/**
 * getUSDCTokenPoolProxyState: reads a `USDCTokenPoolProxy`'s owner, static config, child pools and
 * fee aggregator in one round of parallel `eth_call`s. Named after `getTokenPoolState`, since no
 * single getter returns this. Mirrors `token-pool/operations/get-token-pool-state.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  type USDCTokenPoolProxyPools,
  USDC_TOKEN_POOL_PROXY_TYPE,
  assertUSDCTokenPoolProxy,
  readUSDCTokenPoolProxyFeeAggregator,
  readUSDCTokenPoolProxyOwner,
  readUSDCTokenPoolProxyPools,
  readUSDCTokenPoolProxyStaticConfig,
} from '../contracts.ts'

/** Parameters for {@link GetUSDCTokenPoolProxyState}. */
export type GetUSDCTokenPoolProxyStateParams = {
  /** The `USDCTokenPoolProxy`, i.e. what the TokenAdminRegistry returns as USDC's pool. */
  usdcTokenPoolProxy: string
}

/** A v2.0.0 `USDCTokenPoolProxy`'s admin state; every address checksummed. */
export type GetUSDCTokenPoolProxyStateResult = {
  /** Contract type, as `typeAndVersion` reports it. */
  type: typeof USDC_TOKEN_POOL_PROXY_TYPE
  /** Contract version; the only one supported. */
  version: '2.0.0'
  /** Owner every proxy write is gated on. */
  owner: string
  /** USDC token. */
  token: string
  /** CCIP router whose ramps may call the proxy. */
  router: string
  /** CCTP verifier resolver required on `CCV` lanes. */
  cctpVerifier: string
  /** Child pool per mechanism; `ZeroAddress` leaves that mechanism unroutable. */
  pools: USDCTokenPoolProxyPools
  /** Receives withdrawn fee tokens; zero means `withdrawFeeTokens` reverts. */
  feeAggregator: string
}

/**
 * Reads a `USDCTokenPoolProxy`'s admin state.
 * @throws {@link CCTParamsInvalidError} if `usdcTokenPoolProxy` is invalid, or nothing there
 * answers `typeAndVersion()`
 * @throws {@link CCTContractTypeInvalidError} if it is not a `USDCTokenPoolProxy`
 * @throws {@link CCTContractVersionUnsupportedError} if it is not v2.0.0
 */
export class GetUSDCTokenPoolProxyState extends EVMQuery<
  GetUSDCTokenPoolProxyStateParams,
  GetUSDCTokenPoolProxyStateResult
> {
  readonly name = 'getUSDCTokenPoolProxyState'

  protected prepare(params: GetUSDCTokenPoolProxyStateParams): GetUSDCTokenPoolProxyStateParams {
    validateNonZeroAddress(this.name, 'usdcTokenPoolProxy', params.usdcTokenPoolProxy)
    return params
  }

  protected async read(
    chain: EVMChain,
    { usdcTokenPoolProxy }: GetUSDCTokenPoolProxyStateParams,
  ): Promise<GetUSDCTokenPoolProxyStateResult> {
    // Identity first: a child pool or another contract would decode these getters as garbage.
    await assertUSDCTokenPoolProxy(this.name, chain, usdcTokenPoolProxy)
    const [owner, staticConfig, pools, feeAggregator] = await Promise.all([
      readUSDCTokenPoolProxyOwner(chain, usdcTokenPoolProxy),
      readUSDCTokenPoolProxyStaticConfig(chain, usdcTokenPoolProxy),
      readUSDCTokenPoolProxyPools(chain, usdcTokenPoolProxy),
      readUSDCTokenPoolProxyFeeAggregator(chain, usdcTokenPoolProxy),
    ])
    return {
      type: USDC_TOKEN_POOL_PROXY_TYPE,
      version: '2.0.0',
      owner,
      ...staticConfig,
      pools,
      feeAggregator,
    }
  }
}
