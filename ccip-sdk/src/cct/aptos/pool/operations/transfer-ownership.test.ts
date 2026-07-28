import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { NEW_OWNER, POOL, SENDER, stubChain } from './test-helpers.ts'
import { TransferOwnership } from './transfer-ownership.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool transferOwnership', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new TransferOwnership().generate(stubChain(), {
      poolAddress: POOL,
      newOwner: NEW_OWNER,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty newOwner before building', async () => {
    await assert.rejects(
      () =>
        new TransferOwnership().generate(stubChain(), {
          poolAddress: POOL,
          newOwner: '',
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
