import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeMessage, normalizeMessageWithFee } from './message-normalizer.ts'
import { message, tokenTransfer } from './message.ts'
import { networkInfo } from './utils.ts'

// Use networkInfo for readable chain selector access
const selector = (name: string) => networkInfo(name).chainSelector

describe('normalizeMessage', () => {
  describe('with FullMessage input', () => {
    it('should return FullMessage unchanged', () => {
      const fullMsg = message({
        receiver: '0x1234567890123456789012345678901234567890',
        data: '0xabcdef',
        extraArgs: { gasLimit: 500_000n, allowOutOfOrderExecution: false },
        tokenAmounts: [{ token: '0xtoken', amount: 100n }],
        feeToken: '0xfeeToken',
      })

      const result = normalizeMessage(fullMsg, selector('ethereum-mainnet'))

      assert.equal(result.kind, 'full')
      assert.equal(result.receiver, fullMsg.receiver)
      assert.equal(result.data, fullMsg.data)
      assert.deepEqual(result.extraArgs, fullMsg.extraArgs)
      assert.deepEqual(result.tokenAmounts, fullMsg.tokenAmounts)
      assert.equal(result.feeToken, fullMsg.feeToken)
    })

    it('should preserve custom extraArgs from FullMessage', () => {
      const customExtraArgs = {
        gasLimit: 1_000_000n,
        allowOutOfOrderExecution: false,
      }
      const fullMsg = message({
        receiver: '0x1234',
        data: '0x',
        extraArgs: customExtraArgs,
      })

      const result = normalizeMessage(fullMsg, selector('ethereum-mainnet'))

      assert.deepEqual(result.extraArgs, customExtraArgs)
    })
  })

  describe('with TokenTransferMessage input', () => {
    const tokenMsg = tokenTransfer({
      receiver: '0x1234567890123456789012345678901234567890',
      token: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_000_000n,
    })

    it('should convert to FullMessage with kind=full', () => {
      const result = normalizeMessage(tokenMsg, selector('ethereum-mainnet'))

      assert.equal(result.kind, 'full')
    })

    it('should set data to empty bytes (0x)', () => {
      const result = normalizeMessage(tokenMsg, selector('ethereum-mainnet'))

      assert.equal(result.data, '0x')
    })

    it('should wrap token in tokenAmounts array', () => {
      const result = normalizeMessage(tokenMsg, selector('ethereum-mainnet'))

      assert.deepEqual(result.tokenAmounts, [{ token: tokenMsg.token, amount: tokenMsg.amount }])
    })

    it('should preserve feeToken if provided', () => {
      const msgWithFee = tokenTransfer({
        receiver: '0x1234',
        token: '0xtoken',
        amount: 100n,
        feeToken: '0xfeeToken',
      })

      const result = normalizeMessage(msgWithFee, selector('ethereum-mainnet'))

      assert.equal(result.feeToken, '0xfeeToken')
    })

    describe('EVM destination', () => {
      it('should apply EVM defaults for extraArgs', () => {
        const result = normalizeMessage(tokenMsg, selector('ethereum-mainnet'))

        assert.equal(result.extraArgs.gasLimit, 0n)
        assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        assert.equal('computeUnits' in result.extraArgs, false)
      })
    })

    describe('Solana destination', () => {
      it('should apply Solana defaults with tokenReceiver', () => {
        const result = normalizeMessage(tokenMsg, selector('solana-mainnet'))

        assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        assert.equal('computeUnits' in result.extraArgs, true)
        assert.equal(
          (result.extraArgs as { tokenReceiver: string }).tokenReceiver,
          tokenMsg.receiver,
        )
      })
    })

    describe('Aptos destination', () => {
      it('should apply Aptos defaults for extraArgs', () => {
        const result = normalizeMessage(tokenMsg, selector('aptos-mainnet'))

        assert.equal(result.extraArgs.gasLimit, 0n)
        assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
      })
    })

    describe('Sui destination', () => {
      it('should apply Sui defaults with tokenReceiver', () => {
        const result = normalizeMessage(tokenMsg, selector('sui-mainnet'))

        assert.equal(result.extraArgs.gasLimit, 0n)
        assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        assert.equal(
          (result.extraArgs as { tokenReceiver: string }).tokenReceiver,
          tokenMsg.receiver,
        )
      })
    })

    describe('TON destination', () => {
      it('should apply TON defaults for extraArgs', () => {
        const result = normalizeMessage(tokenMsg, selector('ton-mainnet'))

        assert.equal(result.extraArgs.gasLimit, 0n)
        assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
      })
    })
  })
})

describe('normalizeMessageWithFee', () => {
  it('should attach fee to normalized message when provided', () => {
    const tokenMsg = tokenTransfer({
      receiver: '0x1234',
      token: '0xtoken',
      amount: 100n,
    })

    const result = normalizeMessageWithFee(
      { ...tokenMsg, fee: 50_000n },
      selector('ethereum-mainnet'),
    )

    assert.equal(result.fee, 50_000n)
  })

  it('should not add fee property when fee is undefined', () => {
    const tokenMsg = tokenTransfer({
      receiver: '0x1234',
      token: '0xtoken',
      amount: 100n,
    })

    const result = normalizeMessageWithFee(tokenMsg, selector('ethereum-mainnet'))

    assert.equal('fee' in result, false)
  })

  it('should preserve fee from FullMessage input', () => {
    const fullMsg = message({
      receiver: '0x1234',
      data: '0x',
      extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
    })

    const result = normalizeMessageWithFee(
      { ...fullMsg, fee: 123_456n },
      selector('ethereum-mainnet'),
    )

    assert.equal(result.fee, 123_456n)
  })

  it('should handle fee=0n correctly', () => {
    const tokenMsg = tokenTransfer({
      receiver: '0x1234',
      token: '0xtoken',
      amount: 100n,
    })

    const result = normalizeMessageWithFee({ ...tokenMsg, fee: 0n }, selector('ethereum-mainnet'))

    assert.equal(result.fee, 0n)
  })
})
