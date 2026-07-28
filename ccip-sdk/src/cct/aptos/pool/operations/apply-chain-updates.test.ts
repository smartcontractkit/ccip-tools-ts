import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApplyChainUpdates } from './apply-chain-updates.ts'
import {
  DISABLED_RATE_LIMITER,
  POOL,
  REMOTE_POOL,
  REMOTE_TOKEN,
  SELECTOR,
  SENDER,
  stubChain,
} from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool applyChainUpdates', () => {
  it('builds apply + rate-limiter transactions when adding a chain', async () => {
    const unsigned = await new ApplyChainUpdates().generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: [
        {
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [REMOTE_POOL],
          remoteTokenAddress: REMOTE_TOKEN,
          outboundRateLimiterConfig: DISABLED_RATE_LIMITER,
          inboundRateLimiterConfig: DISABLED_RATE_LIMITER,
        },
      ],
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 2)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty poolAddress before building', async () => {
    await assert.rejects(
      () =>
        new ApplyChainUpdates().generate(stubChain(), {
          poolAddress: '',
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [],
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
