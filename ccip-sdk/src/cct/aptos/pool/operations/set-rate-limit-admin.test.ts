import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SetRateLimitAdmin } from './set-rate-limit-admin.ts'
import { NEW_OWNER, POOL, SENDER, stubChain } from './test-helpers.ts'
import { CCIPMethodUnsupportedError } from '../../../../errors/index.ts'

describe('Aptos TokenPool setRateLimitAdmin', () => {
  it('rejects generate as unsupported on Aptos', async () => {
    await assert.rejects(
      () =>
        new SetRateLimitAdmin().generate(stubChain(), {
          poolAddress: POOL,
          rateLimitAdmin: NEW_OWNER,
          sender: SENDER,
        }),
      CCIPMethodUnsupportedError,
    )
  })
})
