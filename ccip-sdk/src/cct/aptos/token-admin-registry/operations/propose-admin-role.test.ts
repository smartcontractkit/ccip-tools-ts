import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ProposeAdminRole } from './propose-admin-role.ts'
import { ADMIN, ROUTER, SENDER, TOKEN, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenAdminRegistry proposeAdminRole', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new ProposeAdminRole().generate(stubChain(), {
      tokenAddress: TOKEN,
      administrator: ADMIN,
      routerAddress: ROUTER,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty tokenAddress before building', async () => {
    await assert.rejects(
      () =>
        new ProposeAdminRole().generate(stubChain(), {
          tokenAddress: '',
          administrator: ADMIN,
          routerAddress: ROUTER,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
