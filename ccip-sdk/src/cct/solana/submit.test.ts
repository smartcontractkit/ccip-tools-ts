import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SendTransactionError, TransactionExpiredTimeoutError } from '@solana/web3.js'

import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import { createCCTSubmitError } from './submit.ts'

const OP = 'setPool'

describe('cct/solana submit error mapping', () => {
  it('maps post-broadcast errors with a signature to not-confirmed', () => {
    const cause = Object.assign(new Error('blockhash not found'), { signature: 'abc' })
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

  it('maps program errors to permanent tx failed', () => {
    const err = createCCTSubmitError(OP, new Error('custom program error: 0x1'))

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, false)
  })
})
