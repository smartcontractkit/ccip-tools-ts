import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Cell, Address, toNano } from '@ton/core'
import type { KeyPair } from '@ton/crypto'
import type { TonClient, WalletContractV4 } from '@ton/ton'

import { type ExecutionReport, ChainFamily } from '../types.ts'
import { TONChain } from './index.ts'
import { type CCIPMessage_V1_6_TON, type TONWallet, MANUALLY_EXECUTE_OPCODE } from './types.ts'

// Test constants from chainlink-ton test suite
const CHAINSEL_EVM_TEST_90000001 = 909606746561742123n
const CHAINSEL_TON = 13879075125137744094n
const EVM_SENDER_ADDRESS_TEST = '0x1a5fdbc891c5d4e6ad68064ae45d43146d4f9f3a'
const TON_OFFRAMP_ADDRESS_TEST =
  '0:9f2e995aebceb97ae094dbe4cf973cbc8a402b4f0ac5287a00be8aca042d51b9'

// Shared test data
const baseExecReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
  message: {
    header: {
      messageId: '0x' + '0'.repeat(63) + '1',
      sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
      destChainSelector: CHAINSEL_TON,
      sequenceNumber: 1n,
      nonce: 0n,
    },
    sender: EVM_SENDER_ADDRESS_TEST,
    receiver: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
    data: '0x',
    extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
    feeToken: '0x0000000000000000000000000000000000000000',
    feeTokenAmount: 0n,
    feeValueJuels: 0n,
    tokenAmounts: [],
    gasLimit: 200000n,
    allowOutOfOrderExecution: true,
  },
  proofs: [],
  proofFlagBits: 0n,
  merkleRoot: '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
  offchainTokenData: [],
}

const mockNetworkInfo = {
  family: ChainFamily.TON,
  chainSelector: CHAINSEL_TON,
  chainId: 'ton-testnet',
  name: 'TON Testnet',
  isTestnet: true,
}

describe('TONChain.executeReport', () => {
  const mockKeyPair: KeyPair = {
    publicKey: Buffer.alloc(32, 0x01),
    secretKey: Buffer.alloc(64, 0x02),
  }
  const mockWalletAddress = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

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

    const mockOutMessage = {
      info: {
        type: 'internal' as const,
        dest: Address.parse(TON_OFFRAMP_ADDRESS_TEST),
      },
    }

    const mockClient = {
      open: () => mockOpenedWallet,
      runMethod: async (_address: Address, method: string) => {
        if (method === 'seqno') {
          return { stack: { readNumber: () => (opts?.seqno ?? 0) + 1 } }
        }
        throw new Error(`Unknown method: ${method}`)
      },
      getTransaction: async () => ({
        lt: BigInt(mockTxLt),
        hash: () => Buffer.from(mockTxHash, 'hex'),
        now: Math.floor(Date.now() / 1000),
        outMessages: { values: () => [mockOutMessage] },
        inMessage: { info: { type: 'internal', src: mockWalletAddress } },
      }),
      getTransactions: async () => [
        {
          lt: BigInt(mockTxLt),
          hash: () => Buffer.from(mockTxHash, 'hex'),
          now: Math.floor(Date.now() / 1000),
          outMessages: { values: () => [mockOutMessage] },
          inMessage: { info: { type: 'internal', src: mockWalletAddress } },
        },
      ],
    } as unknown as TonClient

    const mockWallet: TONWallet = {
      contract: { address: mockWalletAddress } as WalletContractV4,
      keyPair: mockKeyPair,
    }

    return {
      client: mockClient,
      wallet: mockWallet,
      getCapturedTransfer: () => capturedTransfer,
      mockTxLt,
      mockTxHash,
    }
  }

  it('should send to offRamp with 0.5 TON value and correct seqno', async () => {
    const { client, wallet, getCapturedTransfer } = createMockClientAndWallet({ seqno: 42 })
    const tonChain = new TONChain(client, mockNetworkInfo as any)

    await tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, { wallet })

    const captured = getCapturedTransfer()
    assert.ok(captured, 'sendTransfer should be called')
    assert.equal(captured.seqno, 42, 'should use wallet seqno')
    assert.equal(captured.messages.length, 1, 'should send single message')
    assert.equal(
      captured.messages[0].to.toRawString(),
      TON_OFFRAMP_ADDRESS_TEST,
      'should send to offRamp address',
    )
    assert.equal(captured.messages[0].value, toNano('0.5'), 'should send 0.5 TON for gas')
  })

  it('should build Cell body with MANUALLY_EXECUTE_OPCODE', async () => {
    const { client, wallet, getCapturedTransfer } = createMockClientAndWallet()
    const tonChain = new TONChain(client, mockNetworkInfo as any)

    await tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, { wallet })

    const captured = getCapturedTransfer()!
    const slice = captured.messages[0].body.beginParse()

    assert.equal(
      slice.loadUint(32),
      MANUALLY_EXECUTE_OPCODE,
      'opcode should be MANUALLY_EXECUTE_OPCODE',
    )
    assert.equal(slice.loadUint(64), 0, 'queryId should be 0')
  })

  it('should return tx hash in workchain:address:lt:hash format', async () => {
    const { client, wallet } = createMockClientAndWallet({
      txLt: '42317062000001',
      txHash: 'bb94e574159e19660ab558347f59f80fd005b44c544417df38d0dfb08f2bd395',
    })
    const tonChain = new TONChain(client, mockNetworkInfo as any)

    const result = await tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, {
      wallet,
    })

    const [workchain, address, lt, hash] = result.hash.split(':')
    assert.equal(workchain, '0', 'workchain should be 0')
    assert.equal(address.length, 64, 'address should be 64 hex chars')
    assert.equal(lt, '42317062000001', 'lt should match transaction lt')
    assert.equal(
      hash,
      'bb94e574159e19660ab558347f59f80fd005b44c544417df38d0dfb08f2bd395',
      'hash should match transaction hash',
    )
  })

  it('should reject non-TON wallet', async () => {
    const { client } = createMockClientAndWallet()
    const tonChain = new TONChain(client, mockNetworkInfo as any)

    await assert.rejects(
      tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, {
        wallet: { invalid: true },
      }),
      /requires a TON wallet/,
    )
  })

  it('should reject non-V1.6 execution report', async () => {
    const { client, wallet } = createMockClientAndWallet()
    const tonChain = new TONChain(client, mockNetworkInfo as any)

    const v1_5Report = {
      message: { header: { messageId: '0x' + '1'.repeat(64) }, strict: false },
      proofs: [],
      proofFlagBits: 0n,
      merkleRoot: '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
      offchainTokenData: [],
    }

    await assert.rejects(
      tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, v1_5Report as any, { wallet }),
      /TON expects EVMExtraArgsV2/,
    )
  })

  it('should propagate sendTransfer errors', async () => {
    const { client, wallet } = createMockClientAndWallet({ shouldFail: true })
    const tonChain = new TONChain(client, mockNetworkInfo as any)

    await assert.rejects(
      tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, { wallet }),
      /Transaction failed/,
    )
  })
})

describe('TONChain.generateUnsignedExecuteReport', () => {
  it('should return UnsignedTONTx with family=ton', async () => {
    const tonChain = new TONChain({} as TonClient, mockNetworkInfo as any)

    const unsigned = await tonChain.generateUnsignedExecuteReport(
      '0:' + 'b'.repeat(64),
      TON_OFFRAMP_ADDRESS_TEST,
      baseExecReport,
    )

    assert.equal(unsigned.family, 'ton')
    assert.equal(unsigned.to, TON_OFFRAMP_ADDRESS_TEST)
    assert.ok(unsigned.body instanceof Object, 'body should be a Cell')
  })

  it('should reject non-V1.6 message format', () => {
    const tonChain = new TONChain({} as TonClient, mockNetworkInfo as any)

    const v1_5Report = {
      message: { header: { messageId: '0x' + '1'.repeat(64) }, strict: false },
      proofs: [],
      proofFlagBits: 0n,
      merkleRoot: '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
      offchainTokenData: [],
    }

    assert.throws(
      () =>
        tonChain.generateUnsignedExecuteReport(
          '0:' + 'b'.repeat(64),
          TON_OFFRAMP_ADDRESS_TEST,
          v1_5Report as any,
        ),
      /TON expects EVMExtraArgsV2/,
    )
  })
})
