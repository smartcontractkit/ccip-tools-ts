import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getDefaultExtraArgs } from './message-defaults.ts'
import { ChainFamily } from './types.ts'

describe('getDefaultExtraArgs', () => {
  const receiver = '0x1234567890123456789012345678901234567890'

  describe('EVM defaults', () => {
    it('should return EVMExtraArgsV2 with gasLimit=0 and allowOutOfOrderExecution=true', () => {
      const result = getDefaultExtraArgs(ChainFamily.EVM, receiver)

      assert.equal(result.gasLimit, 0n)
      assert.equal(result.allowOutOfOrderExecution, true)
      assert.equal('computeUnits' in result, false)
      assert.equal('tokenReceiver' in result, false)
    })
  })

  describe('Solana defaults', () => {
    it('should return SVMExtraArgsV1 with tokenReceiver set to receiver', () => {
      const result = getDefaultExtraArgs(ChainFamily.Solana, receiver)

      assert.equal(result.allowOutOfOrderExecution, true)
      assert.equal('computeUnits' in result, true)
      assert.equal((result as { computeUnits: bigint }).computeUnits, 0n)
      assert.equal((result as { accountIsWritableBitmap: bigint }).accountIsWritableBitmap, 0n)
      assert.equal((result as { tokenReceiver: string }).tokenReceiver, receiver)
      assert.deepEqual((result as { accounts: string[] }).accounts, [])
    })

    it('should convert BytesLike receiver to hex string for tokenReceiver', () => {
      const bytesReceiver = new Uint8Array([0x12, 0x34, 0x56, 0x78])
      const result = getDefaultExtraArgs(ChainFamily.Solana, bytesReceiver)

      assert.equal((result as { tokenReceiver: string }).tokenReceiver, '0x12345678')
    })
  })

  describe('Aptos defaults', () => {
    it('should return EVMExtraArgsV2 with gasLimit=0 and allowOutOfOrderExecution=true', () => {
      const result = getDefaultExtraArgs(ChainFamily.Aptos, receiver)

      assert.equal(result.gasLimit, 0n)
      assert.equal(result.allowOutOfOrderExecution, true)
      assert.equal('computeUnits' in result, false)
      assert.equal('tokenReceiver' in result, false)
    })
  })

  describe('Sui defaults', () => {
    it('should return SuiExtraArgsV1 with tokenReceiver set to receiver', () => {
      const result = getDefaultExtraArgs(ChainFamily.Sui, receiver)

      assert.equal(result.gasLimit, 0n)
      assert.equal(result.allowOutOfOrderExecution, true)
      assert.equal((result as { tokenReceiver: string }).tokenReceiver, receiver)
      assert.deepEqual((result as { receiverObjectIds: string[] }).receiverObjectIds, [])
    })

    it('should convert BytesLike receiver to hex string for tokenReceiver', () => {
      const bytesReceiver = new Uint8Array([0xab, 0xcd, 0xef])
      const result = getDefaultExtraArgs(ChainFamily.Sui, bytesReceiver)

      assert.equal((result as { tokenReceiver: string }).tokenReceiver, '0xabcdef')
    })
  })

  describe('TON defaults', () => {
    it('should return EVMExtraArgsV2 with gasLimit=0 and allowOutOfOrderExecution=true', () => {
      const result = getDefaultExtraArgs(ChainFamily.TON, receiver)

      assert.equal(result.gasLimit, 0n)
      assert.equal(result.allowOutOfOrderExecution, true)
      assert.equal('computeUnits' in result, false)
      assert.equal('tokenReceiver' in result, false)
    })
  })

  describe('immutability', () => {
    it('should return a new object each time (no shared state)', () => {
      const result1 = getDefaultExtraArgs(ChainFamily.EVM, receiver)
      const result2 = getDefaultExtraArgs(ChainFamily.EVM, receiver)

      assert.notEqual(result1, result2)
      assert.deepEqual(result1, result2)
    })
  })
})
