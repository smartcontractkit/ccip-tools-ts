import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TokenPoolVersion } from './contracts.ts'
import { parseRateLimitConfig } from './rate-limit.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

describe('parseRateLimitConfig', () => {
  const UINT128_MAX = 2n ** 128n - 1n

  it('returns an enabled config unchanged', () => {
    assert.deepEqual(
      parseRateLimitConfig(
        'op',
        'inboundRateLimiterConfig',
        { enabled: true, capacity: 100n, rate: 10n },
        null,
      ),
      { enabled: true, capacity: 100n, rate: 10n },
    )
  })

  it('allows rate to equal capacity when enabled, where the version permits it', () => {
    // `null` (version not yet resolved) and the two relaxed versions; the strict ones are
    // covered in `version-specific enabled-bucket bounds` below
    for (const version of [null, TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0] as const) {
      assert.deepEqual(
        parseRateLimitConfig(
          'op',
          'inboundRateLimiterConfig',
          { enabled: true, capacity: 10n, rate: 10n },
          version,
        ),
        { enabled: true, capacity: 10n, rate: 10n },
        `version ${String(version)}`,
      )
    }
  })

  it('accepts uint128 max for both amounts', () => {
    assert.deepEqual(
      parseRateLimitConfig(
        'op',
        'inboundRateLimiterConfig',
        { enabled: true, capacity: UINT128_MAX, rate: UINT128_MAX },
        null,
      ),
      { enabled: true, capacity: UINT128_MAX, rate: UINT128_MAX },
    )
  })

  it('defaults omitted amounts to zero when disabled', () => {
    assert.deepEqual(
      parseRateLimitConfig('op', 'outboundRateLimiterConfig', { enabled: false }, null),
      { enabled: false, capacity: 0n, rate: 0n },
    )
  })

  it('accepts explicit zeros when disabled', () => {
    assert.deepEqual(
      parseRateLimitConfig(
        'op',
        'outboundRateLimiterConfig',
        { enabled: false, capacity: 0n, rate: 0n },
        null,
      ),
      { enabled: false, capacity: 0n, rate: 0n },
    )
  })

  it('reports failures with dotted param paths under the direction', () => {
    const cases: Array<[unknown, string]> = [
      [undefined, 'inboundRateLimiterConfig'],
      [null, 'inboundRateLimiterConfig'],
      ['enabled', 'inboundRateLimiterConfig'],
      [{}, 'inboundRateLimiterConfig.enabled'],
      [{ enabled: 'yes' }, 'inboundRateLimiterConfig.enabled'],
      // enabled with a missing amount: no defaulting applies, so the bound check reports it
      [{ enabled: true, rate: 1n }, 'inboundRateLimiterConfig.capacity'],
      [{ enabled: true, capacity: 1n }, 'inboundRateLimiterConfig.rate'],
      [{ enabled: true, capacity: 1, rate: 1n }, 'inboundRateLimiterConfig.capacity'],
      [{ enabled: true, capacity: -1n, rate: 0n }, 'inboundRateLimiterConfig.capacity'],
      [
        { enabled: true, capacity: UINT128_MAX + 1n, rate: 0n },
        'inboundRateLimiterConfig.capacity',
      ],
      [{ enabled: true, capacity: 0n, rate: -1n }, 'inboundRateLimiterConfig.rate'],
      // rate above capacity is only an error while enabled
      [{ enabled: true, capacity: 10n, rate: 11n }, 'inboundRateLimiterConfig.rate'],
      // disabled must be all-zero, and the whole direction is blamed
      [{ enabled: false, capacity: 1n }, 'inboundRateLimiterConfig'],
      [{ enabled: false, rate: 1n }, 'inboundRateLimiterConfig'],
    ]

    for (const [config, param] of cases) {
      assert.throws(
        () => parseRateLimitConfig('op', 'inboundRateLimiterConfig', config, null),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError &&
          error.context.operation === 'op' &&
          error.context.param === param,
        `expected ${JSON.stringify(String(param))} for ${String(JSON.stringify(config, (_k, v) => (typeof v === 'bigint' ? String(v) : v)))}`,
      )
    }
  })

  /**
   * The enabled-bucket bound is version-dependent, and getting this wrong in either direction is a
   * bug:
   *
   * - v1.5.0/v1.5.1 `RateLimiter._validateTokenBucketConfig` reverts `InvalidRateLimitRate` when
   *   `config.rate >= config.capacity || config.rate == 0`, so an enabled config needs
   *   `0 < rate < capacity` — calldata that violates it always reverts, and must fail locally.
   * - v1.6.1/v2.0.0 relaxed that to `config.rate > config.capacity`, so `rate === capacity` and
   *   `rate === 0n` are *legitimate* there. Tightening the rule globally would be a new bug, which
   *   is what the accept-side cases below pin.
   */
  describe('version-specific enabled-bucket bounds', () => {
    const STRICT = [TokenPoolVersion.V1_5_0, TokenPoolVersion.V1_5_1] as const
    const RELAXED = [TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0] as const

    for (const version of STRICT) {
      it(`rejects rate === capacity when enabled on v${version}`, () => {
        assert.throws(
          () =>
            parseRateLimitConfig(
              'op',
              'outboundRateLimiterConfig',
              { enabled: true, capacity: 10n, rate: 10n },
              version,
            ),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError &&
            error.context.operation === 'op' &&
            error.context.param === 'outboundRateLimiterConfig.rate',
        )
      })

      it(`rejects a zero rate when enabled on v${version}`, () => {
        assert.throws(
          () =>
            parseRateLimitConfig(
              'op',
              'inboundRateLimiterConfig',
              { enabled: true, capacity: 10n, rate: 0n },
              version,
            ),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError &&
            error.context.operation === 'op' &&
            error.context.param === 'inboundRateLimiterConfig.rate',
        )
      })

      it(`still accepts 0 < rate < capacity on v${version}`, () => {
        assert.deepEqual(
          parseRateLimitConfig(
            'op',
            'inboundRateLimiterConfig',
            { enabled: true, capacity: 10n, rate: 9n },
            version,
          ),
          { enabled: true, capacity: 10n, rate: 9n },
        )
      })

      /**
       * The version-independent `rate > capacity` bound must survive the strict tightening. If a
       * refactor ever made the strict branch *replace* the base check rather than follow it,
       * `rate > capacity` would become accepted on exactly the two versions that revert hardest
       * on it — so this asserts both that it still throws and that it is the *base* message doing
       * the throwing, which is what proves the order.
       */
      it(`still rejects rate > capacity when enabled on v${version}`, () => {
        assert.throws(
          () =>
            parseRateLimitConfig(
              'op',
              'outboundRateLimiterConfig',
              { enabled: true, capacity: 10n, rate: 11n },
              version,
            ),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError &&
            error.context.operation === 'op' &&
            error.context.param === 'outboundRateLimiterConfig.rate' &&
            error.message.includes('must not exceed capacity when enabled'),
        )
      })

      it(`does not apply the strict rule to a disabled config on v${version}`, () => {
        assert.deepEqual(
          parseRateLimitConfig('op', 'inboundRateLimiterConfig', { enabled: false }, version),
          { enabled: false, capacity: 0n, rate: 0n },
        )
      })
    }

    for (const version of RELAXED) {
      it(`accepts rate === capacity when enabled on v${version}`, () => {
        assert.deepEqual(
          parseRateLimitConfig(
            'op',
            'outboundRateLimiterConfig',
            { enabled: true, capacity: 10n, rate: 10n },
            version,
          ),
          { enabled: true, capacity: 10n, rate: 10n },
        )
      })

      it(`accepts a zero rate when enabled on v${version}`, () => {
        assert.deepEqual(
          parseRateLimitConfig(
            'op',
            'inboundRateLimiterConfig',
            { enabled: true, capacity: 10n, rate: 0n },
            version,
          ),
          { enabled: true, capacity: 10n, rate: 0n },
        )
      })

      it(`still rejects rate > capacity when enabled on v${version}`, () => {
        assert.throws(
          () =>
            parseRateLimitConfig(
              'op',
              'inboundRateLimiterConfig',
              { enabled: true, capacity: 10n, rate: 11n },
              version,
            ),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError &&
            error.context.param === 'inboundRateLimiterConfig.rate',
        )
      })
    }
  })
})
