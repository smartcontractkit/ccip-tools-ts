import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AcceptAdminRole } from './accept-admin-role.ts'
import { ROUTER, SENDER, TOKEN, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenAdminRegistry acceptAdminRole', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new AcceptAdminRole().generate(stubChain(), {
      tokenAddress: TOKEN,
      routerAddress: ROUTER,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty routerAddress before building', async () => {
    await assert.rejects(
      () =>
        new AcceptAdminRole().generate(stubChain(), {
          tokenAddress: TOKEN,
          routerAddress: '',
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
