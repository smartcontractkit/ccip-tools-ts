import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AcceptOwnership } from './accept-ownership.ts'
import { POOL, SENDER, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool acceptOwnership', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new AcceptOwnership().generate(stubChain(), {
      poolAddress: POOL,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty poolAddress before building', async () => {
    await assert.rejects(
      () =>
        new AcceptOwnership().generate(stubChain(), {
          poolAddress: '',
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
