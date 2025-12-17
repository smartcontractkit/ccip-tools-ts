import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { generateUnsignedExecuteReport } from './exec.ts'
import type { ExecutionReport } from '../types.ts'
import { type CCIPMessage_V1_6_TON, MANUALLY_EXECUTE_OPCODE } from './types.ts'

describe('TON exec unit tests', () => {
  describe('TON generateUnsignedExecuteReport', () => {
    const offrampAddress = '0:' + '5'.repeat(64)

    const baseExecReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
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
  })
})
