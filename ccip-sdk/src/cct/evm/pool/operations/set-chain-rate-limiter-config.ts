/**
 * setChainRateLimiterConfig — updates per-remote-chain rate limiter buckets on a
 * token pool.
 *
 * Encoding is **version-dispatched** (the pool's `typeAndVersion` decides):
 * - v1.5 / v1.6: `setChainRateLimiterConfig(selector, outbound, inbound)` — one tx
 *   per remote chain (encoded via the cached `TokenPool_v1_6` interface; the tuple
 *   layout is identical to v1.5, so the bytes match either ABI).
 * - v2.0+: `setRateLimitConfig(RateLimitConfigArgs[])` — a single batched tx that
 *   also carries the FTF (`customBlockConfirmations`) flag per entry.
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { EVMOperation } from '../../operation.ts'
import {
  type ChainRateLimiterConfig,
  type RateLimiterConfig,
  validateSetChainRateLimiterConfigParams,
} from '../set-rate-limiter-config-utils.ts'

export type { ChainRateLimiterConfig, RateLimiterConfig }

/** Parameters for `setChainRateLimiterConfig`. */
export type SetChainRateLimiterConfigParams = {
  /** Local pool address whose rate limits are being updated. */
  poolAddress: string
  /** Rate limiter configurations, one per already-configured remote chain. */
  chainConfigs: ChainRateLimiterConfig[]
  sender?: string
}

/** Encodes a rate limiter bucket into the tuple `TokenPool` expects. */
function toBucket(config: RateLimiterConfig): {
  isEnabled: boolean
  capacity: bigint
  rate: bigint
} {
  return {
    isEnabled: config.isEnabled,
    capacity: BigInt(config.capacity),
    rate: BigInt(config.rate),
  }
}

/** Updates rate limiter buckets on a token pool, dispatching on the pool version. */
export class SetChainRateLimiterConfig extends EVMOperation<SetChainRateLimiterConfigParams> {
  readonly name = 'setChainRateLimiterConfig'

  /** Validates the pool address, selectors, and rate limiter amounts before any RPC. */
  protected validate(p: SetChainRateLimiterConfigParams): void {
    validateSetChainRateLimiterConfigParams(this.name, p.poolAddress, p.chainConfigs)
  }

  /** Detects the pool version and builds the matching rate-limiter calldata. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: SetChainRateLimiterConfigParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)

    if (version >= CCIPVersion.V2_0) {
      // v2.0: single batched setRateLimitConfig(RateLimitConfigArgs[]).
      const rateLimitConfigArgs = p.chainConfigs.map((config) => ({
        remoteChainSelector: config.remoteChainSelector,
        customBlockConfirmations: config.customBlockConfirmations ?? false,
        outboundRateLimiterConfig: toBucket(config.outboundRateLimiterConfig),
        inboundRateLimiterConfig: toBucket(config.inboundRateLimiterConfig),
      }))
      const data = interfaces.TokenPool_v2_0.encodeFunctionData('setRateLimitConfig', [
        rateLimitConfigArgs,
      ])
      return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
    }

    // v1.5 / v1.6: one setChainRateLimiterConfig(selector, outbound, inbound) per chain.
    const transactions = p.chainConfigs.map((config) => {
      const data = interfaces.TokenPool_v1_6.encodeFunctionData('setChainRateLimiterConfig', [
        config.remoteChainSelector,
        toBucket(config.outboundRateLimiterConfig),
        toBucket(config.inboundRateLimiterConfig),
      ])
      return { to: p.poolAddress, data }
    })
    return { family: ChainFamily.EVM, transactions }
  }
}
