import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GrantMintBurnAccess } from './grant-mint-burn-access.ts'
import { AUTHORITY, SENDER, TOKEN, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos token grantMintBurnAccess', () => {
  it('builds Aptos transaction(s) for a managed pool', async () => {
    const unsigned = await new GrantMintBurnAccess().generate(stubChain(), {
      tokenAddress: TOKEN,
      authority: AUTHORITY,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    // Default role is mintAndBurn → managed token produces two transactions.
    assert.equal(unsigned.transactions.length, 2)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty tokenAddress before any RPC', async () => {
    await assert.rejects(
      () =>
        new GrantMintBurnAccess().generate(stubChain(), {
          tokenAddress: '',
          authority: AUTHORITY,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
