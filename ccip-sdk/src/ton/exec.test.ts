import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Cell, Address, toNano } from '@ton/core'
import type { KeyPair } from '@ton/crypto'
import type { WalletContractV4 } from '@ton/ton'

import { executeReport } from './exec.ts'
import type { ExecutionReport } from '../types.ts'
import type { CCIPMessage_V1_6_TON, TONWallet } from './types.ts'

describe('TON executeReport', () => {
  const offrampAddress = '0:' + '5'.repeat(64)

  // Mock KeyPair (64-byte secret key = 32 seed + 32 public)
  const mockKeyPair: KeyPair = {
    publicKey: Buffer.alloc(32, 0x01),
    secretKey: Buffer.alloc(64, 0x02),
  }

  // Mock wallet address
  const mockWalletAddress = Address.parse('0:' + 'a'.repeat(64))

  /**
   * Creates a mock TonClient and TONWallet that captures sendTransfer calls
   * and simulates transaction confirmation
   */
  function createMockClientAndWallet(opts?: {
    seqno?: number
    shouldFail?: boolean
    txLt?: string
    txHash?: string
  }) {
    let capturedTransfer: {
      seqno: number
      secretKey: Buffer
      messages: Array<{ to: Address; value: bigint; body: Cell }>
    } | null = null

    const mockTxLt = opts?.txLt ?? '12345678'
    const mockTxHash = opts?.txHash ?? 'abcdef1234567890'

    const mockOpenedWallet = {
      getSeqno: async () => opts?.seqno ?? 0,
      sendTransfer: async (params: {
        seqno: number
        secretKey: Buffer
        messages: Array<{ info: { dest: Address; value: { coins: bigint } }; body: Cell }>
      }) => {
        if (opts?.shouldFail) {
          throw new Error('Transaction failed')
        }
        capturedTransfer = {
          seqno: params.seqno,
          secretKey: params.secretKey,
          messages: params.messages.map((m) => ({
            to: m.info.dest,
            value: m.info.value.coins,
            body: m.body,
          })),
        }
      },
    }

    // Create mock outgoing message matching the offramp destination
    const mockOutMessage = {
      info: {
        type: 'internal' as const,
        dest: Address.parse(offrampAddress),
      },
    }

    const mockClient = {
      open: (_contract: WalletContractV4) => mockOpenedWallet,
      // Mock runMethod for seqno check in waitForTransaction
      runMethod: async (_address: Address, method: string) => {
        if (method === 'seqno') {
          return {
            stack: {
              // Return seqno + 1 to simulate transaction was confirmed
              readNumber: () => (opts?.seqno ?? 0) + 1,
            },
          }
        }
        throw new Error(`Unknown method: ${method}`)
      },
      // Mock getTransactions for waitForTransaction
      getTransactions: async (_address: Address, _opts: { limit: number }) => [
        {
          lt: BigInt(mockTxLt),
          hash: () => Buffer.from(mockTxHash, 'hex'),
          now: Math.floor(Date.now() / 1000),
          outMessages: {
            values: () => [mockOutMessage],
          },
        },
      ],
    }

    const mockWallet: TONWallet = {
      contract: { address: mockWalletAddress } as WalletContractV4,
      keyPair: mockKeyPair,
    }

    return {
      client: mockClient as any,
      wallet: mockWallet,
      getCapturedTransfer: () => capturedTransfer,
      mockTxLt,
      mockTxHash,
    }
  }

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
    const { client, wallet, getCapturedTransfer, mockTxLt, mockTxHash } = createMockClientAndWallet(
      { seqno: 42 },
    )

    const execReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
      ...baseExecReport,
      message: {
        ...baseExecReport.message,
        data: '0x1234',
        gasLimit: 500000n,
      },
      proofs: ['0x' + '0'.repeat(63) + '1'],
    }

    const result = await executeReport(client, wallet, offrampAddress, execReport)

    const captured = getCapturedTransfer()
    assert.ok(captured, 'Transfer should be captured')

    // Verify seqno was used
    assert.equal(captured.seqno, 42)

    // Verify message destination
    assert.equal(captured.messages.length, 1)
    assert.equal(captured.messages[0].to.toString(), Address.parse(offrampAddress).toString())
    assert.equal(captured.messages[0].value, toNano('0.5'))

    // Parse the body Cell to verify opcode
    const body = captured.messages[0].body
    const slice = body.beginParse()

    // Verify opcode (0xa00785cf for manuallyExecute)
    const opcode = slice.loadUint(32)
    assert.equal(opcode, 0xa00785cf)

    // Verify queryID is 0
    const queryId = slice.loadUint(64)
    assert.equal(queryId, 0)

    // Verify hash is in format "workchain:address:lt:hash"
    const parts = result.hash.split(':')
    assert.equal(parts.length, 4, 'Hash should have 4 parts (workchain:address:lt:hash)')
    assert.equal(parts[0], '0', 'Workchain should be 0')
    assert.equal(parts[2], mockTxLt, 'LT should match')
    assert.equal(parts[3], mockTxHash, 'Hash should match')
  })

  it('should handle gas override correctly in transaction', async () => {
    const { client, wallet, getCapturedTransfer } = createMockClientAndWallet()

    await executeReport(client, wallet, offrampAddress, baseExecReport, {
      gasLimit: 1_000_000_000,
    })

    const captured = getCapturedTransfer()
    assert.ok(captured, 'Transfer should be captured')

    // Parse body to verify gas override is included
    const body = captured.messages[0].body
    const slice = body.beginParse()

    slice.loadUint(32) // opcode
    slice.loadUint(64) // queryID
    slice.loadRef() // execution report reference

    // Verify gas override
    const gasOverride = slice.loadCoins()
    assert.equal(gasOverride, 1_000_000_000n)
  })

  it('should set gasOverride to 0 when not provided', async () => {
    const { client, wallet, getCapturedTransfer } = createMockClientAndWallet()

    await executeReport(client, wallet, offrampAddress, baseExecReport)

    const captured = getCapturedTransfer()
    assert.ok(captured, 'Transfer should be captured')

    // Parse body to verify gas override is 0
    const body = captured.messages[0].body
    const slice = body.beginParse()

    slice.loadUint(32) // opcode
    slice.loadUint(64) // queryID
    slice.loadRef() // execution report reference

    // Verify gas override is 0
    const gasOverride = slice.loadCoins()
    assert.equal(gasOverride, 0n)
  })

  it('should throw error for invalid execution report', async () => {
    const { client, wallet } = createMockClientAndWallet()

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
      executeReport(client, wallet, offrampAddress, invalidReport as any),
      /Cannot convert undefined to a BigInt/,
    )
  })

  it('should handle wallet sendTransfer failure', async () => {
    const { client, wallet } = createMockClientAndWallet({ shouldFail: true })

    await assert.rejects(
      executeReport(client, wallet, offrampAddress, baseExecReport),
      /Transaction failed/,
    )
  })
  it('should return hash in workchain:address:lt:hash format', async () => {
    const { client, wallet, mockTxLt, mockTxHash } = createMockClientAndWallet({
      seqno: 123,
      txLt: '9999999',
      txHash: 'deadbeef12345678',
    })

    const result = await executeReport(client, wallet, offrampAddress, baseExecReport)

    // Verify hash format
    const parts = result.hash.split(':')
    assert.equal(parts.length, 4, 'Hash should have 4 parts')
    assert.equal(parts[0], '0', 'Workchain should be 0')
    assert.ok(parts[1].length === 64, 'Address should be 64 hex chars')
    assert.equal(parts[2], mockTxLt, 'LT should match')
    assert.equal(parts[3], mockTxHash, 'Transaction hash should match')

    // Verify the full address can be parsed
    const fullAddress = `${parts[0]}:${parts[1]}`
    assert.doesNotThrow(() => Address.parse(fullAddress), 'Address should be parseable')
  })
})
