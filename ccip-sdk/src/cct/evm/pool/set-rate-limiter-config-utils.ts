/**
 * Shared validation for the EVM `setChainRateLimiterConfig` pool op.
 * Kept separate from the operation class so the (non-trivial) rate-limiter
 * parsing rules live in one place and stay easy to test.
 *
 * @packageDocumentation
 */

import type { RateLimiterConfig } from './apply-chain-updates-utils.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import { validateAddress } from '../validate.ts'

export type { RateLimiterConfig }

/** Rate limiter configuration for one already-configured remote chain. */
export type ChainRateLimiterConfig = {
  /** Remote chain selector (uint64). */
  remoteChainSelector: bigint
  /** Outbound rate limiter (local → remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote → local). */
  inboundRateLimiterConfig: RateLimiterConfig
  /**
   * Sets the FTF (Faster-Than-Finality) bucket instead of the default one.
   * Only applies to EVM v2.0+ pools; ignored on v1.5/v1.6.
   */
  customBlockConfirmations?: boolean
}

/**
 * Parses a decimal bigint string, asserting it is present and non-negative.
 * @throws {@link CCTParamsInvalidError} if the value is empty, unparseable, or negative
 */
function validateAmount(operation: string, param: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CCTParamsInvalidError(operation, param, 'must be a non-empty integer string')
  }
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid integer string, got ${value}`,
    )
  }
  if (parsed < 0n) throw new CCTParamsInvalidError(operation, param, 'must be non-negative')
}

/**
 * Validates every field of `setChainRateLimiterConfig` params before any RPC.
 * @throws {@link CCTParamsInvalidError} if pool address, selectors, or amounts are invalid
 */
export function validateSetChainRateLimiterConfigParams(
  operation: string,
  poolAddress: string,
  chainConfigs: readonly ChainRateLimiterConfig[],
): void {
  validateAddress(operation, 'poolAddress', poolAddress)
  if (chainConfigs.length === 0) {
    throw new CCTParamsInvalidError(operation, 'chainConfigs', 'must have at least one entry')
  }
  for (let i = 0; i < chainConfigs.length; i++) {
    const config = chainConfigs[i]!
    if (config.remoteChainSelector == null || config.remoteChainSelector === 0n) {
      throw new CCTParamsInvalidError(
        operation,
        `chainConfigs[${i}].remoteChainSelector`,
        'must be non-zero',
      )
    }
    const out = config.outboundRateLimiterConfig
    const inb = config.inboundRateLimiterConfig
    validateAmount(operation, `chainConfigs[${i}].outboundRateLimiterConfig.capacity`, out.capacity)
    validateAmount(operation, `chainConfigs[${i}].outboundRateLimiterConfig.rate`, out.rate)
    validateAmount(operation, `chainConfigs[${i}].inboundRateLimiterConfig.capacity`, inb.capacity)
    validateAmount(operation, `chainConfigs[${i}].inboundRateLimiterConfig.rate`, inb.rate)
  }
}
