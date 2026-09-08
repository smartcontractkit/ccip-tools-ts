/**
 * The write-side rate-limit shape every EVM lane-config op shares, and its validation.
 *
 * @remarks Pulled out of `contracts.ts` (which is pool *contract metadata* — type/version
 * resolution, cached interfaces, deploy artifacts) and out of the individual ops, so the
 * caller-facing {@link RateLimitConfig} shape and the version-conditional enabled-bucket bound
 * have exactly one definition. `applyChainUpdates` and `setChainRateLimiterConfigs` both build on
 * this; each keeps its own parsed output shape.
 *
 * @packageDocumentation
 */

import { CCTParamsInvalidError } from '../../errors.ts'
import { parseRecord, validateBoolean, validateUint128 } from '../validate.ts'
import { TokenPoolVersion } from './contracts.ts'

/**
 * Configuration for one direction of a token pool rate limiter, as CCT callers write it.
 *
 * @remarks Field-for-field identical to the Solana `RateLimitConfig` in
 * `cct/solana/token-pool/operations/set-chain-rate-limit.ts`, so cross-family callers write one
 * shape; only the bound differs (EVM `uint128` here, Solana `u64` there).
 *
 * The discriminant is spelled **`enabled`**, not the ABI's `isEnabled`: matching the Solana op's
 * public field name matters more than matching the ABI, because callers write cross-family code
 * against the SDK. Ops map `enabled` → `isEnabled` when building the on-chain
 * `RateLimiter.Config` tuple.
 *
 * Distinct from the read-side `RateLimiterState` in `chain.ts`, which additionally carries
 * the live `tokens` bucket balance — that is what a pool *reports*, this is what a caller *sets*.
 *
 * For a token with 6 decimals, pass `1_000_000n` to represent one token.
 */
export type RateLimitConfig =
  | {
      /** Whether this directional rate limit is enforced. */
      enabled: true
      /**
       * Maximum token amount in the bucket (`uint128`). Must be at least `rate` on v1.6.1/v2.0.0
       * pools, and strictly greater than `rate` on v1.5.0/v1.5.1 — see {@link RateLimitConfig.rate}.
       */
      capacity: bigint
      /**
       * Token amount restored to the bucket per second (`uint128`).
       *
       * The bound the contracts enforce is **version-dependent**, so this is checked against the
       * resolved pool version rather than one global rule:
       * - **v1.6.1 / v2.0.0** — `rate <= capacity`. `rate === capacity` and `rate === 0n` are both
       *   legal (`RateLimiter._validateTokenBucketConfig` only reverts `InvalidRateLimitRate` when
       *   `rate > capacity`).
       * - **v1.5.0 / v1.5.1** — stricter: `0n < rate < capacity`. Those versions revert when
       *   `rate >= capacity || rate == 0`, so a config that is fine on a newer pool is rejected here.
       */
      rate: bigint
    }
  | {
      /** Whether this directional rate limit is enforced. */
      enabled: false
      /** Must be zero when provided; defaults to zero. */
      capacity?: bigint
      /** Must be zero when provided; defaults to zero. */
      rate?: bigint
    }

/**
 * A {@link RateLimitConfig} with its optional amounts resolved to concrete `bigint`s, still keyed
 * `enabled`. Ops that encode the ABI's `isEnabled` re-key at the tuple boundary.
 */
export type ParsedRateLimitConfig = {
  enabled: boolean
  capacity: bigint
  rate: bigint
}

/**
 * The versions whose `RateLimiter._validateTokenBucketConfig` rejects an enabled bucket unless
 * `0 < rate < capacity`:
 *
 * ```solidity
 * if (config.isEnabled) { if (config.rate >= config.capacity || config.rate == 0) revert InvalidRateLimitRate(config); }
 * ```
 *
 * v1.6.1 and v2.0.0 relaxed that to `if (config.rate > config.capacity) revert ...`, so on those
 * versions `rate === capacity` and `rate === 0n` are legitimate and must NOT be rejected.
 */
const STRICT_RATE_BOUND_VERSIONS: readonly TokenPoolVersion[] = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
]

/**
 * Validates one direction of a rate limiter and fills in its omitted amounts, mirroring the Solana
 * `parseRateLimitConfig` with `uint128` bounds.
 *
 * @remarks `version` is required-and-nullable (not optional) so each call site states explicitly
 * whether the version-specific bound applies: pre-RPC `validate()` passes `null` (version-independent
 * checks only, so bad params still fail before the first `eth_call`), while version-specific
 * encoders pass the resolved {@link TokenPoolVersion} and get the tightening. The bound changed
 * between pool generations — see {@link STRICT_RATE_BOUND_VERSIONS}.
 * @param operation - Operation name, for the error context.
 * @param direction - Param path of this direction (e.g. `inboundRateLimiterConfig`); nested
 * failures report as `${direction}.capacity` / `${direction}.rate` / `${direction}.enabled`.
 * @param config - The caller-supplied value, unvalidated.
 * @param version - Resolved pool version, or `null` when it is not known yet (pre-RPC validation),
 * which applies the version-independent checks alone.
 * @returns The direction with `capacity`/`rate` defaulted to `0n` when disabled and omitted.
 * @throws {@link CCTParamsInvalidError} if `config` is not an object, `enabled` is not a boolean,
 * either amount is not a `uint128`, `rate` exceeds `capacity` while enabled, `rate` is zero or
 * equal to `capacity` while enabled on a v1.5.0/v1.5.1 pool, or either amount is non-zero while
 * disabled
 */
export function parseRateLimitConfig(
  operation: string,
  direction: string,
  config: unknown,
  version: TokenPoolVersion | null,
): ParsedRateLimitConfig {
  const input = parseRecord(operation, direction, config, 'rate-limit configuration')
  const { enabled } = input
  validateBoolean(operation, `${direction}.enabled`, enabled)

  // Only a disabled direction defaults: an enabled one must state both amounts, so an omitted
  // amount stays `undefined` and is rejected by the uint128 check below, under its own path.
  const capacity = !enabled && input.capacity === undefined ? 0n : input.capacity
  const rate = !enabled && input.rate === undefined ? 0n : input.rate
  validateUint128(operation, `${direction}.capacity`, capacity)
  validateUint128(operation, `${direction}.rate`, rate)

  if (enabled && rate > capacity) {
    throw new CCTParamsInvalidError(
      operation,
      `${direction}.rate`,
      'must not exceed capacity when enabled',
    )
  }
  // Version-specific tightening, applied ONLY where the contract itself is stricter: v1.5.0 and
  // v1.5.1 revert `InvalidRateLimitRate` for an enabled bucket unless `0 < rate < capacity`.
  if (enabled && version !== null && STRICT_RATE_BOUND_VERSIONS.includes(version)) {
    if (rate === 0n) {
      throw new CCTParamsInvalidError(
        operation,
        `${direction}.rate`,
        `must be greater than zero when enabled on a v${version} pool, which reverts InvalidRateLimitRate on a zero rate`,
      )
    }
    if (rate === capacity) {
      throw new CCTParamsInvalidError(
        operation,
        `${direction}.rate`,
        `must be strictly less than capacity when enabled on a v${version} pool, which reverts InvalidRateLimitRate on rate == capacity (v1.6.1 and later allow it)`,
      )
    }
  }
  if (!enabled && (capacity !== 0n || rate !== 0n)) {
    throw new CCTParamsInvalidError(
      operation,
      direction,
      'must have zero capacity and rate when disabled',
    )
  }
  return { enabled, capacity, rate }
}
