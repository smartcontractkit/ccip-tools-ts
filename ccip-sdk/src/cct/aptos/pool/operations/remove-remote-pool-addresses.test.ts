import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RemoveRemotePoolAddresses } from './remove-remote-pool-addresses.ts'
import { POOL, REMOTE_POOL, SELECTOR, SENDER, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool removeRemotePoolAddresses', () => {
  it('builds one transaction per remote pool address', async () => {
    const unsigned = await new RemoveRemotePoolAddresses().generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [REMOTE_POOL],
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 1)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects a zero remoteChainSelector before building', async () => {
    await assert.rejects(
      () =>
        new RemoveRemotePoolAddresses().generate(stubChain(), {
          poolAddress: POOL,
          remoteChainSelector: 0n,
          remotePoolAddresses: [REMOTE_POOL],
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
