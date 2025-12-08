import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Cell, beginCell, toNano } from '@ton/core'
import { executeReport } from './exec.ts'
import type { ExecutionReport } from '../types.ts'
import type { CCIPMessage_V1_6_TON } from './types.ts'

describe('TON executeReport', () => {
  const mockTonConnect = {
    sendTransaction: async (_tx: unknown) => ({ boc: '0x123' }),
  }

  const offrampAddress = '0:' + '5'.repeat(64)

  const baseExecReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
    message: {
      header: {
        messageId: '0x' + '1'.repeat(64),
        sourceChainSelector: 743186221051783445n,
        destChainSelector: 16015286601757825753n,
        sequenceNumber: 1n,
        nonce: 0n,
      },
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

  it('should construct valid manuallyExecute transaction with correct structure', async () => {
    const execReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
      ...baseExecReport,
      message: {
        ...baseExecReport.message,
        data: '0x1234',
        gasLimit: 500000n,
      },
      proofs: ['0x' + '0'.repeat(63) + '1'],
    }

    let capturedTx: any
    const tonConnectWithCapture = {
      sendTransaction: async (tx: unknown) => {
        capturedTx = tx
        return { boc: '0x123' }
      },
    }

    const result = await executeReport(tonConnectWithCapture as any, offrampAddress, execReport)

    // Verify transaction structure
    assert.equal(capturedTx.messages[0].address, offrampAddress)
    assert.equal(capturedTx.messages[0].amount, toNano('0.5').toString())

    // Verify BOC payload contains correct opcode
    const payload = capturedTx.messages[0].payload
    assert.match(payload, /^0x/)

    // Parse BOC using Cell.fromBoc() instead of storeBuffer
    const bocBytes = Buffer.from(payload.slice(2), 'hex')
    const [cell] = Cell.fromBoc(bocBytes)
    const slice = cell.beginParse()

    // Verify opcode (0xa00785cf for manuallyExecute)
    const opcode = slice.loadUint(32)
    assert.equal(opcode, 0xa00785cf)

    // Verify queryID is 0
    const queryId = slice.loadUint(64)
    assert.equal(queryId, 0)

    assert.match(result.hash, /^0x/)
  })

  it('should handle gas override correctly in transaction', async () => {
    let capturedTx: any
    const tonConnectWithCapture = {
      sendTransaction: async (tx: unknown) => {
        capturedTx = tx
        return { boc: '0x123' }
      },
    }

    const result = await executeReport(
      tonConnectWithCapture as any,
      offrampAddress,
      baseExecReport,
      { gasLimit: 1_000_000_000 },
    )

    // Parse BOC to verify gas override is included
    const payload = capturedTx.messages[0].payload
    const bocBytes = Buffer.from(payload.slice(2), 'hex')
    const [cell] = Cell.fromBoc(bocBytes)
    const slice = cell.beginParse()

    slice.loadUint(32) // opcode
    slice.loadUint(64) // queryID
    slice.loadRef() // execution report reference

    // Verify gas override
    const gasOverride = slice.loadCoins()
    assert.equal(gasOverride, 1_000_000_000n)

    assert.match(result.hash, /^0x/)
  })

  it('should throw error for invalid execution report', async () => {
    const invalidReport = {
      message: {
        // Missing required fields
        header: {
          messageId: '0x' + '1'.repeat(64),
        },
      },
      proofs: [],
      proofFlagBits: 0n,
      merkleRoot: '0x' + '4'.repeat(64),
      offchainTokenData: [],
    }

    await assert.rejects(
      executeReport(mockTonConnect as any, offrampAddress, invalidReport as any),
      /Cannot convert undefined to a BigInt/,
    )
  })

  it('should handle TonConnect transaction failure', async () => {
    const failingTonConnect = {
      sendTransaction: async (_tx: unknown) => {
        throw new Error('Transaction failed')
      },
    }

    await assert.rejects(
      executeReport(failingTonConnect as any, offrampAddress, baseExecReport),
      /Transaction failed/,
    )
  })

  it('should use correct transaction validity period', async () => {
    const execReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
      message: {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sourceChainSelector: 743186221051783445n,
          destChainSelector: 16015286601757825753n,
          sequenceNumber: 1n,
          nonce: 0n,
        },
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

    let capturedTx: any
    const tonConnectWithCapture = {
      sendTransaction: async (tx: unknown) => {
        capturedTx = tx
        return { boc: '0x123' }
      },
    }

    const beforeTime = Math.floor(Date.now() / 1000)
    await executeReport(tonConnectWithCapture as any, offrampAddress, execReport)
    const afterTime = Math.floor(Date.now() / 1000)

    // Verify validUntil is set to current time + 300 seconds (5 minutes)
    assert.ok(capturedTx.validUntil >= beforeTime + 300)
    assert.ok(capturedTx.validUntil <= afterTime + 300)
  })
})
