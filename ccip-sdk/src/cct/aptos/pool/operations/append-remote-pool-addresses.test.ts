import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AppendRemotePoolAddresses } from './append-remote-pool-addresses.ts'
import { POOL, REMOTE_POOL, SELECTOR, SENDER, stubChain } from './test-helpers.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos TokenPool appendRemotePoolAddresses', () => {
  it('builds one transaction per remote pool address', async () => {
    const unsigned = await new AppendRemotePoolAddresses().generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [REMOTE_POOL, REMOTE_POOL],
      sender: SENDER,
    })

    assert.equal(unsigned.family, ChainFamily.Aptos)
    assert.equal(unsigned.transactions.length, 2)
    assert.ok(unsigned.transactions[0] instanceof Uint8Array)
  })

  it('rejects an empty remotePoolAddresses before building', async () => {
    await assert.rejects(
      () =>
        new AppendRemotePoolAddresses().generate(stubChain(), {
          poolAddress: POOL,
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [],
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
