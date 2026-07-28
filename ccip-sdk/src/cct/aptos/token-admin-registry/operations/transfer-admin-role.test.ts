import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ADMIN, ROUTER, SENDER, TOKEN, stubChain } from './test-helpers.ts'
import { TransferAdminRole } from './transfer-admin-role.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenAdminRegistry transferAdminRole', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new TransferAdminRole().generate(stubChain(), {
      tokenAddress: TOKEN,
      newAdmin: ADMIN,
      routerAddress: ROUTER,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty newAdmin before building', async () => {
    await assert.rejects(
      () =>
        new TransferAdminRole().generate(stubChain(), {
          tokenAddress: TOKEN,
          newAdmin: '',
          routerAddress: ROUTER,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
