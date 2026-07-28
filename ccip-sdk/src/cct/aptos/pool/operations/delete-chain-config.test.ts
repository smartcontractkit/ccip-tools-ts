import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DeleteChainConfig } from './delete-chain-config.ts'
import { POOL, SELECTOR, SENDER, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool deleteChainConfig', () => {
  it('builds a single Aptos transaction', async () => {
    const unsigned = await new DeleteChainConfig().generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects a zero remoteChainSelector before building', async () => {
    await assert.rejects(
      () =>
        new DeleteChainConfig().generate(stubChain(), {
          poolAddress: POOL,
          remoteChainSelector: 0n,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
