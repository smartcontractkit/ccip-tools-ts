/**
 * Shared utilities for setChainRateLimiterConfig across all chain families.
 *
 * Contains validation logic used by EVM, Solana, and Aptos implementations.
 *
 * @packageDocumentation
 */

import type { RateLimiterConfig, SetChainRateLimiterConfigParams } from './types.ts'
import { CCIPSetRateLimiterConfigParamsInvalidError } from '../errors/index.ts'

/**
 * Validates a single rate limiter config object.
 *
 * @param config - Rate limiter config to validate
 * @param prefix - Parameter path prefix for error messages (e.g., "chainConfigs[0].outboundRateLimiterConfig")
 * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} on invalid config
 */
function validateRateLimiterConfig(config: RateLimiterConfig, prefix: string): void {
  if (config.capacity.trim().length === 0) {
    throw new CCIPSetRateLimiterConfigParamsInvalidError(`${prefix}.capacity`, 'must be non-empty')
  }
  if (config.rate.trim().length === 0) {
    throw new CCIPSetRateLimiterConfigParamsInvalidError(`${prefix}.rate`, 'must be non-empty')
  }
  // Validate they parse as non-negative bigints
  try {
    const cap = BigInt(config.capacity)
    if (cap < 0n) {
      throw new CCIPSetRateLimiterConfigParamsInvalidError(
        `${prefix}.capacity`,
        'must be non-negative',
      )
    }
  } catch (e) {
    if (e instanceof CCIPSetRateLimiterConfigParamsInvalidError) throw e
    throw new CCIPSetRateLimiterConfigParamsInvalidError(
      `${prefix}.capacity`,
      'must be a valid integer string',
    )
  }
  try {
    const r = BigInt(config.rate)
    if (r < 0n) {
      throw new CCIPSetRateLimiterConfigParamsInvalidError(`${prefix}.rate`, 'must be non-negative')
    }
  } catch (e) {
    if (e instanceof CCIPSetRateLimiterConfigParamsInvalidError) throw e
    throw new CCIPSetRateLimiterConfigParamsInvalidError(
      `${prefix}.rate`,
      'must be a valid integer string',
    )
  }
}

/**
 * Validates setChainRateLimiterConfig parameters.
 *
 * Checks that poolAddress is non-empty, chainConfigs is non-empty, and each
 * config entry has a valid remoteChainSelector and rate limiter configs.
 *
 * @param params - Set chain rate limiter config parameters to validate
 * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} on invalid params
 */
export function validateSetChainRateLimiterConfigParams(
  params: SetChainRateLimiterConfigParams,
): void {
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPSetRateLimiterConfigParamsInvalidError('poolAddress', 'must be non-empty')
  }
  if (params.chainConfigs.length === 0) {
    throw new CCIPSetRateLimiterConfigParamsInvalidError(
      'chainConfigs',
      'must have at least one entry',
    )
  }
  for (let i = 0; i < params.chainConfigs.length; i++) {
    const config = params.chainConfigs[i]!
    if (config.remoteChainSelector == null || config.remoteChainSelector === 0n) {
      throw new CCIPSetRateLimiterConfigParamsInvalidError(
        `chainConfigs[${i}].remoteChainSelector`,
        'must be non-zero',
      )
    }
    validateRateLimiterConfig(
      config.outboundRateLimiterConfig,
      `chainConfigs[${i}].outboundRateLimiterConfig`,
    )
    validateRateLimiterConfig(
      config.inboundRateLimiterConfig,
      `chainConfigs[${i}].inboundRateLimiterConfig`,
    )
  }
}
