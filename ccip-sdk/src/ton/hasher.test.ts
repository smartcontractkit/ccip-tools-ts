import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getTONLeafHasher, hashTONMetadata } from './hasher.ts'

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const TON_RECEIVER = '0:' + '3'.repeat(64)

describe('TON hasher', () => {
  const sourceChainSelector = 743186221051783445n
  const destChainSelector = 16015286601757825753n
  const onRamp = '0x1234567890123456789012345678901234567890'

  describe('hashTONMetadata', () => {
    it('should create consistent metadata hash', () => {
      const hash1 = hashTONMetadata(sourceChainSelector, destChainSelector, onRamp)
      const hash2 = hashTONMetadata(sourceChainSelector, destChainSelector, onRamp)

      assert.equal(hash1, hash2)
      assert.match(hash1, /^0x[a-f0-9]{64}$/)
    })

    it('should create different hashes for different parameters', () => {
      const hash1 = hashTONMetadata(sourceChainSelector, destChainSelector, onRamp)
      const hash2 = hashTONMetadata(sourceChainSelector + 1n, destChainSelector, onRamp)

      assert.notEqual(hash1, hash2)
    })
  })

  describe('getTONLeafHasher', () => {
    it('should throw error for unsupported version', () => {
      assert.throws(() => {
        getTONLeafHasher({
          sourceChainSelector,
          destChainSelector,
          onRamp,
          version: CCIPVersion.V1_2,
        })
      }, /TON only supports CCIP v1.6/)
    })

    it('should create hasher for v1.6', () => {
      const hasher = getTONLeafHasher({
        sourceChainSelector,
        destChainSelector,
        onRamp,
        version: CCIPVersion.V1_6,
      })

      assert.equal(typeof hasher, 'function')
    })
  })

  describe('message hashing', () => {
    const hasher = getTONLeafHasher({
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_6,
    })

    it('should hash basic message', () => {
      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sequenceNumber: 123n,
          nonce: 456n,
          sourceChainSelector,
          destChainSelector,
        },
        sender: '0x' + '2'.repeat(40),
        receiver: TON_RECEIVER,
        data: '0x1234',
        extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
        gasLimit: 0n,
        allowOutOfOrderExecution: true,
        tokenAmounts: [] as CCIPMessage_V1_6['tokenAmounts'],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[a-f0-9]{64}$/)
    })

    it('should hash message with tokens', () => {
      const tokenAmounts: CCIPMessage_V1_6['tokenAmounts'] = [
        {
          sourcePoolAddress: '0:' + '4'.repeat(64),
          destTokenAddress: '0:' + '5'.repeat(64),
          extraData: '0x',
          destGasAmount: 1000n,
          amount: 1000n,
          destExecData: '0x',
        },
      ]

      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sequenceNumber: 123n,
          nonce: 456n,
          sourceChainSelector,
          destChainSelector,
        },
        sender: '0x' + '2'.repeat(40),
        receiver: TON_RECEIVER,
        data: '0x1234',
        extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
        gasLimit: 0n,
        allowOutOfOrderExecution: true,
        tokenAmounts,
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[a-f0-9]{64}$/)
    })

    it('should handle embedded gasLimit', () => {
      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sequenceNumber: 123n,
          nonce: 456n,
          sourceChainSelector,
          destChainSelector,
        },
        sender: '0x' + '2'.repeat(40),
        receiver: TON_RECEIVER,
        data: '0x1234',
        extraArgs: '0x',
        gasLimit: 500000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [] as CCIPMessage_V1_6['tokenAmounts'],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[a-f0-9]{64}$/)
    })
  })
})
