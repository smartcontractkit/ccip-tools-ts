import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SetPool } from './set-pool.ts'
import { POOL, ROUTER, SENDER, TOKEN, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenAdminRegistry setPool', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new SetPool().generate(stubChain(), {
      tokenAddress: TOKEN,
      poolAddress: POOL,
      routerAddress: ROUTER,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty poolAddress before building', async () => {
    await assert.rejects(
      () =>
        new SetPool().generate(stubChain(), {
          tokenAddress: TOKEN,
          poolAddress: '',
          routerAddress: ROUTER,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
