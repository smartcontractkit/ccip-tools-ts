import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RevokeMintBurnAccess } from './revoke-mint-burn-access.ts'
import { AUTHORITY, SENDER, TOKEN, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos token revokeMintBurnAccess', () => {
  it('builds a single Aptos transaction for a managed pool', async () => {
    const unsigned = await new RevokeMintBurnAccess().generate(stubChain(), {
      tokenAddress: TOKEN,
      authority: AUTHORITY,
      role: 'mint',
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty authority before any RPC', async () => {
    await assert.rejects(
      () =>
        new RevokeMintBurnAccess().generate(stubChain(), {
          tokenAddress: TOKEN,
          authority: '',
          role: 'mint',
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
