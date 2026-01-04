import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isFullMessage, isTokenTransfer, message, tokenTransfer } from './message.ts'

describe('tokenTransfer factory', () => {
  it('should create TokenTransferMessage with kind=token', () => {
    const msg = tokenTransfer({
      receiver: '0x1234567890123456789012345678901234567890',
      token: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_000_000n,
    })

    assert.equal(msg.kind, 'token')
    assert.equal(msg.receiver, '0x1234567890123456789012345678901234567890')
    assert.equal(msg.token, '0xabcdef1234567890abcdef1234567890abcdef12')
    assert.equal(msg.amount, 1_000_000n)
    assert.equal(msg.feeToken, undefined)
  })

  it('should create TokenTransferMessage with feeToken', () => {
    const msg = tokenTransfer({
      receiver: '0x1234567890123456789012345678901234567890',
      token: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 500_000n,
      feeToken: '0xfeeToken0000000000000000000000000000000',
    })

    assert.equal(msg.kind, 'token')
    assert.equal(msg.feeToken, '0xfeeToken0000000000000000000000000000000')
  })

  it('should create immutable message (Object.freeze)', () => {
    const msg = tokenTransfer({
      receiver: '0x1234567890123456789012345678901234567890',
      token: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_000_000n,
    })

    assert.ok(Object.isFrozen(msg))
  })
})

describe('message factory', () => {
  it('should create FullMessage with kind=full', () => {
    const msg = message({
      receiver: '0x1234567890123456789012345678901234567890',
      data: '0x1234abcd',
      extraArgs: { gasLimit: 500_000n, allowOutOfOrderExecution: true },
    })

    assert.equal(msg.kind, 'full')
    assert.equal(msg.receiver, '0x1234567890123456789012345678901234567890')
    assert.equal(msg.data, '0x1234abcd')
    assert.deepEqual(msg.extraArgs, { gasLimit: 500_000n, allowOutOfOrderExecution: true })
    assert.equal(msg.tokenAmounts, undefined)
    assert.equal(msg.feeToken, undefined)
  })

  it('should create FullMessage with tokenAmounts', () => {
    const msg = message({
      receiver: '0x1234567890123456789012345678901234567890',
      data: '0x',
      extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: false },
      tokenAmounts: [
        { token: '0xtoken1', amount: 100n },
        { token: '0xtoken2', amount: 200n },
      ],
    })

    assert.equal(msg.kind, 'full')
    assert.deepEqual(msg.tokenAmounts, [
      { token: '0xtoken1', amount: 100n },
      { token: '0xtoken2', amount: 200n },
    ])
  })

  it('should create immutable message (Object.freeze)', () => {
    const msg = message({
      receiver: '0x1234567890123456789012345678901234567890',
      data: '0x',
      extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
    })

    assert.ok(Object.isFrozen(msg))
  })
})

describe('isTokenTransfer type guard', () => {
  it('should return true for TokenTransferMessage', () => {
    const msg = tokenTransfer({
      receiver: '0x1234567890123456789012345678901234567890',
      token: '0xtoken',
      amount: 100n,
    })

    assert.ok(isTokenTransfer(msg))
  })

  it('should return false for FullMessage', () => {
    const msg = message({
      receiver: '0x1234567890123456789012345678901234567890',
      data: '0x',
      extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
    })

    assert.ok(!isTokenTransfer(msg))
  })
})

describe('isFullMessage type guard', () => {
  it('should return true for FullMessage', () => {
    const msg = message({
      receiver: '0x1234567890123456789012345678901234567890',
      data: '0x',
      extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
    })

    assert.ok(isFullMessage(msg))
  })

  it('should return false for TokenTransferMessage', () => {
    const msg = tokenTransfer({
      receiver: '0x1234567890123456789012345678901234567890',
      token: '0xtoken',
      amount: 100n,
    })

    assert.ok(!isFullMessage(msg))
  })
})

describe('type discrimination', () => {
  it('should narrow types correctly with kind check', () => {
    // Create messages as union type to test discrimination
    const messages = [
      tokenTransfer({
        receiver: '0x123',
        token: '0xtoken',
        amount: 100n,
      }),
      message({
        receiver: '0x123',
        data: '0x',
        extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
      }),
    ]

    // Type narrowing with kind property on union
    for (const msg of messages) {
      if (msg.kind === 'token') {
        // TypeScript narrows to TokenTransferMessage
        assert.equal(typeof msg.token, 'string')
        assert.equal(typeof msg.amount, 'bigint')
      } else {
        // TypeScript narrows to FullMessage
        assert.equal(typeof msg.data, 'string')
        assert.ok('extraArgs' in msg)
      }
    }
  })
})
