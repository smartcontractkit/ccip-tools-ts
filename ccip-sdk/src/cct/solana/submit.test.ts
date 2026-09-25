import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type Connection,
  type VersionedTransaction,
  Keypair,
  PublicKey,
  SendTransactionError,
  TransactionExpiredTimeoutError,
  TransactionInstruction,
} from '@solana/web3.js'

import { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import type { Wallet } from '../../solana/types.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import { createCCTSubmitError, submit } from './submit.ts'

const OP = 'setPool'

describe('Submit error mapping (cct/solana)', () => {
  it('maps post-broadcast confirmation errors with a signature to not-confirmed', () => {
    const cause = Object.assign(new Error('transaction was not confirmed'), {
      signature: 'abc',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxNotConfirmedError)
    assert.equal(err.isTransient, true)
    assert.equal(err.context.txHash, 'abc')
  })

  it('maps web3.js transaction expiry errors to not-confirmed', () => {
    const err = createCCTSubmitError(OP, new TransactionExpiredTimeoutError('def', 30))

    assert.ok(err instanceof CCTTxNotConfirmedError)
    assert.equal(err.context.txHash, 'def')
  })

  it('maps SendTransactionError with a signature to not-confirmed', () => {
    const cause = new SendTransactionError({
      action: 'send',
      signature: 'ghi',
      transactionMessage: 'block height exceeded',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxNotConfirmedError)
    assert.equal(err.context.txHash, 'ghi')
  })

  it('maps signed on-chain failures to permanent tx failed', () => {
    const cause = Object.assign(new Error('custom program error: 0x1'), {
      signature: 'jkl',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, false)
    assert.equal(err.context.txHash, undefined)
  })

  it('maps SendTransactionError with an empty signature to transient tx failed', () => {
    const cause = new SendTransactionError({
      action: 'simulate',
      signature: '',
      transactionMessage: 'blockhash not found',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, true)
  })

  it('maps pre-broadcast transient errors to transient tx failed', () => {
    const err = createCCTSubmitError(OP, new Error('blockhash not found'))

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, true)
  })

  it('maps raw program errors to permanent tx failed', () => {
    const err = createCCTSubmitError(OP, {
      InstructionError: [0, { Custom: 6002 }],
    })

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, false)
    assert.match(err.message, /InstructionError/)
  })

  it('maps a confirmed execution failure and does not return a hash', async () => {
    const payer = Keypair.generate()
    const wallet = {
      publicKey: payer.publicKey,
      signTransaction: async (tx: VersionedTransaction) => {
        tx.sign([payer])
        return tx
      },
    } as unknown as Wallet
    const chain = {
      connection: {
        getLatestBlockhash: async () => ({
          blockhash: PublicKey.default.toBase58(),
          lastValidBlockHeight: 1,
        }),
        simulateTransaction: async () => ({
          value: { err: null, logs: [], unitsConsumed: 1 },
        }),
        sendTransaction: async () => 'failed-signature',
        confirmTransaction: async () => ({
          value: { err: { InstructionError: [0, 'Custom'] } },
        }),
      } as unknown as Connection,
    } as unknown as SolanaChain

    await assert.rejects(
      () =>
        submit(
          chain,
          wallet,
          {
            family: ChainFamily.Solana,
            instructions: [
              new TransactionInstruction({
                keys: [],
                programId: PublicKey.default,
              }),
            ],
            mainIndex: 0,
          },
          OP,
        ),
      (error: unknown) => error instanceof CCTTxFailedError && !error.isTransient,
    )
  })
})
