import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { generateUnsignedExecuteReport } from './exec.ts'
import type { ExecutionInput } from '../types.ts'
import { MANUALLY_EXECUTE_OPCODE } from './types.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'

describe('TON exec unit tests', () => {
  describe('TON generateUnsignedExecute', () => {
    const offrampAddress = '0:' + '5'.repeat(64)

    const baseExecReport: ExecutionInput<CCIPMessage_V1_6_EVM> = {
      message: {
        messageId: '0x' + '1'.repeat(64),
        sourceChainSelector: 743186221051783445n,
        destChainSelector: 16015286601757825753n,
        sequenceNumber: 1n,
        nonce: 0n,
        sender: '0x' + '2'.repeat(40),
        receiver: '0:' + '3'.repeat(64),
        data: '0x',
        extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
        feeToken: '0x' + '0'.repeat(40),
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
        tokenAmounts: [],
        gasLimit: 200000n,
        allowOutOfOrderExecution: true,
      },
      proofs: [],
      proofFlagBits: 0n,
      merkleRoot: '0x' + '4'.repeat(64),
      offchainTokenData: [],
    }

    it('should return unsigned transaction data with correct structure', () => {
      const unsigned = generateUnsignedExecuteReport(offrampAddress, baseExecReport)

      assert.equal(unsigned.to, offrampAddress)
      assert.ok(unsigned.body, 'Body should be defined')

      // Parse the body Cell to verify opcode
      const slice = unsigned.body.beginParse()
      const opcode = slice.loadUint(32)
      assert.equal(opcode, MANUALLY_EXECUTE_OPCODE)

      const queryId = slice.loadUint(64)
      assert.equal(queryId, 0)
    })

    it('should include gas override when provided', () => {
      const unsigned = generateUnsignedExecuteReport(offrampAddress, baseExecReport, {
        gasLimit: 1_000_000_000,
      })

      const slice = unsigned.body.beginParse()
      slice.loadUint(32) // opcode
      slice.loadUint(64) // queryID
      // ExecutionReport is stored inline via storeBuilder, skip its contents:
      slice.loadUintBig(64) // sourceChainSelector (use loadUintBig for large values)
      slice.loadRef() // messages
      slice.loadRef() // offchainTokenData
      slice.loadRef() // proofs
      slice.loadUintBig(256) // proofFlagBits

      const gasOverride = slice.loadCoins()
      assert.equal(gasOverride, 1_000_000_000n)
    })

    it('should set gasOverride to 0 when not provided', () => {
      const unsigned = generateUnsignedExecuteReport(offrampAddress, baseExecReport)

      const slice = unsigned.body.beginParse()
      slice.loadUint(32) // opcode
      slice.loadUint(64) // queryID
      slice.loadRef() // execution report reference

      const gasOverride = slice.loadCoins()
      assert.equal(gasOverride, 0n)
    })

    it('should accept TON raw sender and source pool addresses', () => {
      const unsigned = generateUnsignedExecuteReport(offrampAddress, {
        ...baseExecReport,
        message: {
          ...baseExecReport.message,
          sender: '0:358280f2b46935d7470439a34fd234cc8617f2019018545383a74b03b9035174',
          tokenAmounts: [
            {
              amount: 1n,
              sourcePoolAddress:
                '0:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              destTokenAddress: '0:' + '6'.repeat(64),
              destGasAmount: 0n,
              destExecData: '0x',
              extraData: '0x',
            },
          ],
        },
      })

      assert.equal(unsigned.to, offrampAddress)
      assert.ok(unsigned.body, 'Body should be defined')
    })

    it('should accept Solana source sender addresses for TON destination', () => {
      const unsigned = generateUnsignedExecuteReport(offrampAddress, {
        ...baseExecReport,
        message: {
          ...baseExecReport.message,
          sourceChainSelector: 16423721717087811551n,
          destChainSelector: 1399300952838017768n,
          messageId: '0xc9d521e2b4be8d995d7f9ffbde183e12d88ec93794d6b4329c23cb354db406a8',
          sequenceNumber: 4n,
          sender: '9NhaY2AXejCX3c4tXufzWuv52ZG7rjTJDeb1qSo9UV7S',
          receiver: 'EQD4w5mxY0V7Szh2NsZ_BfWuMY6biF42HEjBz1-8_wRO-6gC',
          data: '0x48656c6c6f',
          feeToken: 'So11111111111111111111111111111111111111112',
          feeTokenAmount: 1547524n,
          feeValueJuels: 14388425000000000n,
          gasLimit: 25_000_000n,
          allowOutOfOrderExecution: true,
          tokenAmounts: [],
        },
        merkleRoot: '0x050adeaa0cfe792abbd5e33a3ba6f2d9204052952d091f7624d1a2d23b771ad1',
      })

      assert.equal(unsigned.to, offrampAddress)
      assert.ok(unsigned.body, 'Body should be defined')
    })
  })
})
