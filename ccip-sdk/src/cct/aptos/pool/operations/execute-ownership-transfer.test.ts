import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ExecuteOwnershipTransfer } from './execute-ownership-transfer.ts'
import { NEW_OWNER, POOL, SENDER, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool executeOwnershipTransfer', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new ExecuteOwnershipTransfer().generate(stubChain(), {
      poolAddress: POOL,
      newOwner: NEW_OWNER,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty poolAddress before building', async () => {
    await assert.rejects(
      () =>
        new ExecuteOwnershipTransfer().generate(stubChain(), {
          poolAddress: '',
          newOwner: NEW_OWNER,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
