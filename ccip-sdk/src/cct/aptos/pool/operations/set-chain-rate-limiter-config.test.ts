import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SetChainRateLimiterConfig } from './set-chain-rate-limiter-config.ts'
import { DISABLED_RATE_LIMITER, POOL, SELECTOR, SENDER, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool setChainRateLimiterConfig', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new SetChainRateLimiterConfig().generate(stubChain(), {
      poolAddress: POOL,
      chainConfigs: [
        {
          remoteChainSelector: SELECTOR,
          outboundRateLimiterConfig: DISABLED_RATE_LIMITER,
          inboundRateLimiterConfig: DISABLED_RATE_LIMITER,
        },
      ],
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty chainConfigs before building', async () => {
    await assert.rejects(
      () =>
        new SetChainRateLimiterConfig().generate(stubChain(), {
          poolAddress: POOL,
          chainConfigs: [],
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
