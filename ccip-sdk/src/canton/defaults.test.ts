import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_CANTON_SEND_GAS_LIMIT,
  resolveCantonSendGasLimit,
  resolveFeeTransferFactoryAmount,
  resolveSenderInstanceId,
} from './defaults.ts'

describe('canton defaults resolvers', () => {
  it('resolveCantonSendGasLimit prefers explicit extraArgs', () => {
    assert.equal(resolveCantonSendGasLimit(99n, false), 99n)
  })

  it('resolveCantonSendGasLimit uses 0 for token-only sends', () => {
    assert.equal(resolveCantonSendGasLimit(undefined, true), 0n)
  })

  it('resolveCantonSendGasLimit reads canton-config defaultSendGasLimit', () => {
    assert.equal(
      resolveCantonSendGasLimit(undefined, false, { defaultSendGasLimit: 75_000 }),
      75_000n,
    )
  })

  it('resolveCantonSendGasLimit falls back to SDK default', () => {
    assert.equal(resolveCantonSendGasLimit(undefined, false), DEFAULT_CANTON_SEND_GAS_LIMIT)
  })

  it('resolveFeeTransferFactoryAmount reads canton-config', () => {
    assert.equal(resolveFeeTransferFactoryAmount({ feeTransferFactoryAmount: '2.5' }), '2.5')
  })

  it('resolveSenderInstanceId reads canton-config', () => {
    assert.equal(
      resolveSenderInstanceId({ senderInstanceId: 'prod-ccipsender' }),
      'prod-ccipsender',
    )
  })
})
