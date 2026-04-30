import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'
import { hexlify, randomBytes } from 'ethers'

import { estimateExecComputeUnits } from './gas.ts'

const randomPublicKey = () => Keypair.generate().publicKey.toBase58()

describe('estimateExecComputeUnits', () => {
  it('simulates a standard Solana ccip_receive callback', async () => {
    const simulateTransaction = mock.fn(async () => ({
      value: {
        err: null,
        logs: [],
        unitsConsumed: 123_456,
      },
    }))
    const connection = { simulateTransaction } as unknown as Connection

    const estimated = await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      message: {
        sourceChainSelector: 1n,
        messageId: hexlify(randomBytes(32)),
        receiver: randomPublicKey(),
        sender: '0x0000000000000000000000000000000000000001',
        data: '0x1234',
        accounts: [randomPublicKey(), randomPublicKey()],
        accountIsWritableBitmap: 2n,
        destTokenAmounts: [{ token: randomPublicKey(), amount: 100n }],
      },
    })

    assert.equal(estimated, 123_456)
    assert.equal(simulateTransaction.mock.calls.length, 1)
  })

  it('returns zero without simulation when there is no receiver callback', async () => {
    const simulateTransaction = mock.fn()
    const connection = { simulateTransaction } as unknown as Connection

    const estimated = await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      message: {
        sourceChainSelector: 1n,
        messageId: hexlify(randomBytes(32)),
        receiver: PublicKey.default.toBase58(),
      },
    })

    assert.equal(estimated, 0)
    assert.equal(simulateTransaction.mock.calls.length, 0)
  })
})
