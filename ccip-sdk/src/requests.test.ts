import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import './index.ts' // Import to ensure chains are loaded
import { type LogFilter, Chain } from './chain.ts'
import type { GenericExtraArgsV3, SVMExtraArgsV1 } from './extra-args.ts'
import {
  decodeMessage,
  getMessageById,
  getMessagesForSender,
  getMessagesInBatch,
  getMessagesInTx,
} from './requests.ts'
import { SolanaChain } from './solana/index.ts'
import { SuiChain } from './sui/index.ts'
import {
  type CCIPMessage,
  type CCIPRequest,
  type ChainLog,
  type ChainTransaction,
  type Lane,
  CCIPVersion,
} from './types.ts'
import { bigIntReplacer, networkInfo } from './utils.ts'

let rampAddress: string

function mockedMessage(seqNum: number) {
  return {
    messageId: `0xMessageId${seqNum}`,
    sender: '0x0000000000000000000000000000000000000045',
    feeToken: '0x0000000000000000000000000000000000008916',
    receiver: toBeHex(456, 32),
    sequenceNumber: BigInt(seqNum),
    tokenAmounts: [{ token: '0xtoken', amount: 123n }],
    sourceChainSelector: 16015286601757825753n,
    sourceTokenData: [
      '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000005a51fc6c00000000000000000000000000000000000000000000000000000000000000200000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000cc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee0000000000000000000000000000000000000000000000000000000000000020d8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4',
    ],
    gasLimit: 100n,
  }
}

const topic0 = '0x35c02761bcd3ef995c6a601a1981f4ed3934dcbe5041e24e286c89f5531d17e4' // CCIPMessageSent for CCIP 1.6

const mockNetwork = networkInfo('ethereum-testnet-sepolia')

class MockChain {
  network = mockNetwork
  typeAndVersion = mock.fn(() =>
    Promise.resolve(['OnRamp', CCIPVersion.V1_2, `OnRamp ${CCIPVersion.V1_2}`]),
  )
  getLogs = mock.fn((opts: LogFilter) => {
    const logs: ChainLog[] = [
      {
        address: opts.address ?? rampAddress,
        index: 1,
        topics: Array.isArray(opts.topics?.[0]) ? opts.topics[0] : [topic0],
        data: mockedMessage(1),
        blockNumber: 12000,
        transactionHash: '0x123',
      } as ChainLog,
    ]
    return (async function* () {
      for (const log of logs) {
        yield log
      }
    })()
  })
  getTransaction = mock.fn((hash: string) =>
    Promise.resolve({
      chain: this as unknown as Chain,
      hash,
      logs: [],
      blockNumber: 12000,
      timestamp: 1234567890,
      from: '0x0000000000000000000000000000000000000001',
    } as ChainTransaction),
  )
  getBlockTimestamp = mock.fn(() => Promise.resolve(1234567890))
  static decodeMessage = mock.fn(
    (log: { topics: readonly string[]; data: unknown }): CCIPMessage | undefined => {
      if (typeof log.data === 'object' && log.data && 'messageId' in log.data) {
        const dataObj = log.data as {
          messageId: string
          sourceChainSelector?: bigint
          sequenceNumber?: bigint
          sender?: string
          receiver?: string
          tokenAmounts?: unknown[]
          sourceTokenData?: unknown[]
          gasLimit?: bigint
          feeToken?: string
        }
        return {
          messageId: dataObj.messageId,
          sourceChainSelector: dataObj.sourceChainSelector ?? 16015286601757825753n,
          sequenceNumber: dataObj.sequenceNumber ?? 1n,
          nonce: 0n,
          sender: dataObj.sender ?? '0x0000000000000000000000000000000000000045',
          receiver: dataObj.receiver ?? toBeHex(456, 32),
          data: '0x',
          tokenAmounts: dataObj.tokenAmounts ?? [],
          sourceTokenData: dataObj.sourceTokenData ?? [],
          gasLimit: dataObj.gasLimit ?? 100n,
          strict: false,
          feeToken: dataObj.feeToken ?? '0x0000000000000000000000000000000000008916',
          feeTokenAmount: 0n,
        } as CCIPMessage
      }
      return undefined
    },
  )
  getLaneForOnRamp = mock.fn((onRamp: string) =>
    Promise.resolve({
      sourceChainSelector: 16015286601757825753n,
      destChainSelector: 1n,
      onRamp,
      version: CCIPVersion.V1_2,
    } as Lane),
  )
}

const mockedChain = new MockChain()

beforeEach(() => {
  mockedChain.typeAndVersion.mock.resetCalls()
  mockedChain.getLogs.mock.resetCalls()
  mockedChain.getTransaction.mock.resetCalls()
  mockedChain.getBlockTimestamp.mock.resetCalls()
  MockChain.decodeMessage.mock.resetCalls()
  mockedChain.getLaneForOnRamp.mock.resetCalls()

  rampAddress = getAddress(hexlify(randomBytes(20)))
  mockedChain.typeAndVersion.mock.mockImplementation(() =>
    Promise.resolve(['OnRamp', CCIPVersion.V1_2, `OnRamp ${CCIPVersion.V1_2}`]),
  )
})

afterEach(() => {
  mockedChain.typeAndVersion.mock.restore()
  mockedChain.getLogs.mock.restore()
  mockedChain.getTransaction.mock.restore()
  mockedChain.getBlockTimestamp.mock.restore()
  MockChain.decodeMessage.mock.restore()
  mockedChain.getLaneForOnRamp.mock.restore()
})

describe('getMessagesInTx', () => {
  it('should return CCIP requests', async () => {
    const mockTx: ChainTransaction = {
      hash: '0x123',
      logs: [
        {
          address: rampAddress,
          topics: [topic0],
          data: mockedMessage(1),
          blockNumber: 12000,
          transactionHash: '0x123',
          index: 0,
        } as ChainLog,
      ],
      timestamp: 1234567890,
      blockNumber: 12000,
      from: '0x0000000000000000000000000000000000000001',
    }

    const result = await getMessagesInTx(mockedChain as unknown as Chain, mockTx)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.message.sequenceNumber, 1n)
    assert.equal(result[0]!.tx, mockTx)
    assert.equal(result[0]!.lane.version, CCIPVersion.V1_2)
  })

  it('should throw an error if no CCIPSendRequested message found', async () => {
    MockChain.decodeMessage.mock.mockImplementation(() => undefined)

    const mockTx: ChainTransaction = {
      hash: '0x123',
      logs: [
        {
          address: getAddress(hexlify(randomBytes(20))),
          topics: [topic0],
          data: JSON.stringify(mockedMessage(1), bigIntReplacer),
          blockNumber: 12000,
          transactionHash: '0x123',
          index: 0,
        } as ChainLog,
        {
          address: getAddress(hexlify(randomBytes(20))),
          topics: [topic0],
          data: mockedMessage(2),
          blockNumber: 12000,
          transactionHash: '0x123',
          index: 1,
        } as ChainLog,
      ],
      timestamp: 1234567890,
      blockNumber: 12000,
      from: '0x0000000000000000000000000000000000000001',
    }

    await assert.rejects(
      async () => await getMessagesInTx(mockedChain as unknown as Chain, mockTx),
      /Could not find any CCIP request event in tx/,
    )

    // Restore mock
    MockChain.decodeMessage.mock.mockImplementation(
      (log: { topics: readonly string[]; data: unknown }) => {
        if (typeof log.data === 'object' && log.data && 'messageId' in log.data) {
          const dataObj = log.data as {
            messageId: string
            sourceChainSelector?: bigint
            sequenceNumber?: bigint
            sender?: string
            receiver?: string
            tokenAmounts?: unknown[]
            sourceTokenData?: unknown[]
            gasLimit?: bigint
            feeToken?: string
          }
          return {
            messageId: dataObj.messageId,
            sourceChainSelector: dataObj.sourceChainSelector ?? 16015286601757825753n,
            sequenceNumber: dataObj.sequenceNumber ?? 1n,
            nonce: 0n,
            sender: dataObj.sender ?? '0x0000000000000000000000000000000000000045',
            receiver: dataObj.receiver ?? toBeHex(456, 32),
            data: '0x',
            tokenAmounts: dataObj.tokenAmounts ?? [],
            sourceTokenData: dataObj.sourceTokenData ?? [],
            gasLimit: dataObj.gasLimit ?? 100n,
            strict: false,
            feeToken: dataObj.feeToken ?? '0x0000000000000000000000000000000000008916',
            feeTokenAmount: 0n,
          } as CCIPMessage
        }
        return undefined
      },
    )
  })
})

describe('getMessageById', () => {
  it('should return a CCIP request by messageId', async () => {
    const msg = mockedMessage(1)
    mockedChain.getLogs.mock.mockImplementationOnce(() =>
      (async function* () {
        yield {
          address: rampAddress,
          index: 1,
          topics: [topic0],
          data: msg,
          blockNumber: 12000,
          transactionHash: '0x123',
        } as ChainLog
      })(),
    )

    const result = await getMessageById(mockedChain as unknown as Chain, '0xMessageId1')
    assert.equal(result.log.index, 1)
    assert.ok(result.message)
    assert.equal(result.tx.timestamp, 1234567890)
    assert.equal(result.lane.version, CCIPVersion.V1_2)
  })

  it('should throw an error if no request found for the messageId', async () => {
    MockChain.decodeMessage.mock.mockImplementation(() => undefined)

    mockedChain.getLogs.mock.mockImplementationOnce(() =>
      (async function* () {
        yield {
          address: rampAddress,
          index: 1,
          topics: [topic0],
          data: mockedMessage(2),
          blockNumber: 12000,
          transactionHash: '0x123',
        } as ChainLog
      })(),
    )

    await assert.rejects(
      async () => await getMessageById(mockedChain as unknown as Chain, '0xMessageId1'),
      /Could not find a CCIPSendRequested message with messageId: 0xMessageId1/,
    )

    // Restore mock
    MockChain.decodeMessage.mock.mockImplementation(
      (log: { topics: readonly string[]; data: unknown }) => {
        if (typeof log.data === 'object' && log.data && 'messageId' in log.data) {
          const dataObj = log.data as {
            messageId: string
            sourceChainSelector?: bigint
            sequenceNumber?: bigint
            sender?: string
            receiver?: string
            tokenAmounts?: unknown[]
            sourceTokenData?: unknown[]
            gasLimit?: bigint
            feeToken?: string
          }
          return {
            messageId: dataObj.messageId,
            sourceChainSelector: dataObj.sourceChainSelector ?? 16015286601757825753n,
            sequenceNumber: dataObj.sequenceNumber ?? 1n,
            nonce: 0n,
            sender: dataObj.sender ?? '0x0000000000000000000000000000000000000045',
            receiver: dataObj.receiver ?? toBeHex(456, 32),
            data: '0x',
            tokenAmounts: dataObj.tokenAmounts ?? [],
            sourceTokenData: dataObj.sourceTokenData ?? [],
            gasLimit: dataObj.gasLimit ?? 100n,
            strict: false,
            feeToken: dataObj.feeToken ?? '0x0000000000000000000000000000000000008916',
            feeTokenAmount: 0n,
          } as CCIPMessage
        }
        return undefined
      },
    )
  })
})

describe('getMessagesInBatch', () => {
  it('should return all messages in a batch', async () => {
    const mockRequest: Omit<CCIPRequest, 'tx' | 'timestamp'> = {
      log: {
        address: rampAddress,
        topics: [topic0],
        blockNumber: 12000,
        transactionHash: '0x123',
        index: 0,
        data: mockedMessage(9),
      } as ChainLog,
      message: {
        messageId: '0xMessageId9',
        sourceChainSelector: 16015286601757825753n,
        sequenceNumber: 9n,
        nonce: 0n,
        sender: '0x0000000000000000000000000000000000000045',
        receiver: toBeHex(456, 32),
        data: '0x',
        tokenAmounts: [],
        sourceTokenData: [],
        gasLimit: 100n,
        strict: false,
        feeToken: '0x0000000000000000000000000000000000008916',
        feeTokenAmount: 0n,
      } as CCIPMessage,
      lane: {
        sourceChainSelector: 16015286601757825753n,
        destChainSelector: 10n,
        onRamp: rampAddress,
        version: CCIPVersion.V1_2,
      },
    }

    // When minSeqNr === maxSeqNr, it should just return the request message
    const result = await getMessagesInBatch(mockedChain as unknown as Chain, mockRequest, {
      minSeqNr: 9n,
      maxSeqNr: 9n,
    })

    assert.equal(result.length, 1)
    assert.equal(result[0]!.sequenceNumber, 9n)
  })

  it('should throw an error if not all expected events are found', async () => {
    const mockRequest: Omit<CCIPRequest, 'tx' | 'timestamp'> = {
      log: {
        address: rampAddress,
        topics: [topic0],
        blockNumber: 1,
        transactionHash: '0x123',
        index: 0,
        data: mockedMessage(5),
      } as ChainLog,
      message: {
        messageId: '0xMessageId5',
        sourceChainSelector: 16015286601757825753n,
        sequenceNumber: 5n,
        nonce: 0n,
        sender: '0x0000000000000000000000000000000000000045',
        receiver: toBeHex(456, 32),
        data: '0x',
        tokenAmounts: [],
        sourceTokenData: [],
        gasLimit: 100n,
        strict: false,
        feeToken: '0x0000000000000000000000000000000000008916',
        feeTokenAmount: 0n,
      } as CCIPMessage,
      lane: {
        sourceChainSelector: 16015286601757825753n,
        destChainSelector: 10n,
        onRamp: rampAddress,
        version: CCIPVersion.V1_2,
      },
    }

    mockedChain.getLogs.mock.mockImplementation((_opts: LogFilter) =>
      (async function* () {
        // Return empty to trigger error
      })(),
    )

    await assert.rejects(
      async () =>
        await getMessagesInBatch(mockedChain as unknown as Chain, mockRequest, {
          minSeqNr: 1n,
          maxSeqNr: 10n,
        }),
      /Could not find all messages in batch/,
    )
  })
})

describe('getMessagesForSender', () => {
  it('should yield requests for a sender', async () => {
    const sender = '0x0000000000000000000000000000000000000045'
    const someOtherMessage = mockedMessage(18)
    someOtherMessage.sender = '0xUnknownSender'

    mockedChain.getLogs.mock.mockImplementationOnce((_opts: LogFilter) =>
      (async function* () {
        yield {
          address: rampAddress,
          topics: [topic0],
          data: mockedMessage(2),
          blockNumber: 12000,
          transactionHash: '0x123',
          index: 0,
        } as ChainLog
        yield {
          address: rampAddress,
          topics: [topic0],
          data: someOtherMessage,
          blockNumber: 12001,
          transactionHash: '0x124',
          index: 0,
        } as ChainLog
        yield {
          address: rampAddress,
          topics: [topic0],
          data: mockedMessage(3),
          blockNumber: 12002,
          transactionHash: '0x125',
          index: 0,
        } as ChainLog
      })(),
    )

    const res: Omit<CCIPRequest, 'tx' | 'timestamp'>[] = []
    const generator = getMessagesForSender(mockedChain as unknown as Chain, sender, {
      address: rampAddress,
      startBlock: 11,
    })

    for await (const req of generator) {
      res.push(req)
    }

    assert.equal(res.length, 2) // Only messages with matching sender
  })
})

describe('decodeMessage', () => {
  it('should decode 1.5 message with tokenAmounts', () => {
    const msgInfoString =
      '{"data": "0x", "nonce": 10, "sender": "0xc70070c9c8fe7866449edbf4ba3918c5936fe639", "strict": false, "feeToken": "0xd00ae08403b9bbb9124bb305c09058e32c39a48c", "gasLimit": 0, "receiver": "0xc70070c9c8fe7866449edbf4ba3918c5936fe639", "messageId": "0xe9d9d03588f0b3fca80bc43b2194d314aec8ebbea67f6390ef63b095b11e6f80", "tokenAmounts": [{"token": "0xd21341536c5cf5eb1bcb58f6723ce26e8d8e90e4", "amount": 100000000000000000}], "feeTokenAmount": 31933333333333333, "sequenceNumber": 40944, "sourceTokenData": ["0x"], "sourceChainSelector": 14767482510784806043, "header": {"messageId": "0xe9d9d03588f0b3fca80bc43b2194d314aec8ebbea67f6390ef63b095b11e6f80", "sourceChainSelector": 14767482510784806043, "sequenceNumber": 40944, "nonce": 10}}'

    assert.doesNotThrow(() => decodeMessage(msgInfoString))

    const msg = decodeMessage(msgInfoString)
    assert.equal(msg.tokenAmounts.length, 1)
    const tokenAmount = msg.tokenAmounts[0]!

    assert.ok('token' in msg.tokenAmounts[0]!)
    assert.equal(msg.feeTokenAmount, 31933333333333333n)

    if ('token' in tokenAmount) {
      assert.equal(tokenAmount.token.toLowerCase(), '0xd21341536c5cf5eb1bcb58f6723ce26e8d8e90e4')
      assert.equal(tokenAmount.amount, 100000000000000000n)
    }
  })

  it('should decode 1.6 message from Aptos with snake case formats', () => {
    const msgInfoString =
      '{"message": {"data": "0x12345678", "header": {"nonce": "2", "messageId": "0xab3fbecd2bd0eee8c384c3c5665681bfc932072201d3fb959a54c2d73b5aa2e9", "sequenceNumber": "3", "dest_chain_selector": "16015286601757825753", "sourceChainSelector": "743186221051783445"}, "sender": "0xccccc17bdf9f47952c2207e683f1c716058b455220641ce5efaa5062a237509e", "feeToken": "0x8873d0d9aa0e1d7bf7a42de620906d51f535314c72f27032bcaaf5519a22fec9", "gasLimit": 200000, "receiver": "0x90392a1e8a941098a3c75e0bdb172cfde7e4f1f4", "extraArgs": "0x181dcf10400d03000000000000000000000000000000000000000000000000000000000000", "tokenAmounts": [{"amount": "100000000", "extra_data": "0x0000000000000000000000000000000000000000000000000000000000000008", "dest_exec_data": "0x905f0100", "dest_token_address": "0x000000000000000000000000316496c5da67d052235b9952bc42db498d6c520b", "source_pool_address": "0x65ad4cb3142cab5100a4eeed34e2005cbb1fcae42fc688e3c96b0c33ae16e6b9"}], "feeValueJuels": "52761740000000000", "feeTokenAmount": "5322165", "allowOutOfOrderExecution": false}}'

    assert.doesNotThrow(() => decodeMessage(msgInfoString))

    const msg = decodeMessage(msgInfoString)

    assert.equal(msg.tokenAmounts.length, 1)
    const tokenAmount = msg.tokenAmounts[0]!

    if ('destTokenAddress' in tokenAmount) {
      assert.equal(tokenAmount.destTokenAddress, '0x316496C5dA67D052235B9952bc42db498d6c520b')
    }
    if ('sourcePoolAddress' in tokenAmount) {
      assert.equal(
        tokenAmount.sourcePoolAddress,
        '0x65ad4cb3142cab5100a4eeed34e2005cbb1fcae42fc688e3c96b0c33ae16e6b9',
      )
    }
  })

  describe('buildMessageForDest', () => {
    describe('Chain (base implementation)', () => {
      it('should populate default extraArgs for EVM with data', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
        }

        const result = Chain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        assert.equal(typeof result.extraArgs, 'object')
        assert.ok('gasLimit' in result.extraArgs)
        if ('allowOutOfOrderExecution' in result.extraArgs) {
          assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        }
        if ('gasLimit' in result.extraArgs) {
          assert.equal(result.extraArgs.gasLimit, 200000n) // DEFAULT_GAS_LIMIT
        }
        assert.equal(result.receiver, message.receiver)
        assert.equal(result.data, message.data)
      })

      it('should populate gasLimit as 0 when no data', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
        }

        const result = Chain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        assert.ok('gasLimit' in result.extraArgs)
        if ('gasLimit' in result.extraArgs) {
          assert.equal(result.extraArgs.gasLimit, 0n)
        }
        if ('allowOutOfOrderExecution' in result.extraArgs) {
          assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        }
      })

      it('should preserve existing extraArgs values', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          extraArgs: {
            gasLimit: 500000n,
            allowOutOfOrderExecution: false,
          },
        }

        const result = Chain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        assert.ok('gasLimit' in result.extraArgs)
        if ('gasLimit' in result.extraArgs) {
          assert.equal(result.extraArgs.gasLimit, 500000n)
        }
        if ('allowOutOfOrderExecution' in result.extraArgs) {
          assert.equal(result.extraArgs.allowOutOfOrderExecution, false)
        }
      })

      it('should merge partial extraArgs with defaults', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          extraArgs: {
            gasLimit: 300000n,
          },
        }

        const result = Chain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        if ('gasLimit' in result.extraArgs) {
          assert.equal(result.extraArgs.gasLimit, 300000n)
        }
        if ('allowOutOfOrderExecution' in result.extraArgs) {
          assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        }
      })

      it('should handle empty data string as no data', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x',
        }

        const result = Chain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        assert.ok('gasLimit' in result.extraArgs)
        assert.equal(result.extraArgs.gasLimit, 0n)
      })

      it('should preserve tokenAmounts and feeToken', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          tokenAmounts: [{ token: '0xTokenAddress', amount: 1000n }],
          feeToken: '0xFeeTokenAddress',
        }

        const result = Chain.buildMessageForDest(message)

        assert.deepEqual(result.tokenAmounts, message.tokenAmounts)
        assert.equal(result.feeToken, message.feeToken)
      })
    })

    describe('V3 extraArgs detection', () => {
      it('should detect V3 when blockConfirmations is provided', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          extraArgs: {
            blockConfirmations: 5,
          } as any,
        }

        const result = Chain.buildMessageForDest(message)
        const extraArgs = result.extraArgs as GenericExtraArgsV3

        assert.ok('blockConfirmations' in result.extraArgs)
        assert.equal(extraArgs.blockConfirmations, 5)
        assert.equal(extraArgs.gasLimit, 200000n)
        assert.deepEqual(extraArgs.ccvs, [])
        assert.equal(extraArgs.executor, '')
      })

      it('should detect V3 when executor is provided', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          extraArgs: {
            executor: '0xExecutorAddress1234567890123456789012',
          } as any,
        }

        const result = Chain.buildMessageForDest(message)
        const extraArgs = result.extraArgs as GenericExtraArgsV3

        assert.ok('executor' in result.extraArgs)
        assert.equal(extraArgs.executor, '0xExecutorAddress1234567890123456789012')
        assert.equal(extraArgs.blockConfirmations, 0)
      })

      it('should apply V3 defaults for all fields when any V3 field is present', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          extraArgs: {
            ccvs: ['0xCCVAddress123456789012345678901234567890'],
          } as any,
        }

        const result = Chain.buildMessageForDest(message)
        const extraArgs = result.extraArgs as GenericExtraArgsV3

        // Verify all V3 fields have proper defaults
        assert.deepEqual(extraArgs.ccvs, ['0xCCVAddress123456789012345678901234567890'])
        assert.deepEqual(extraArgs.ccvArgs, [])
        assert.equal(extraArgs.blockConfirmations, 0)
        assert.equal(extraArgs.executor, '')
        assert.equal(extraArgs.executorArgs, '0x')
        assert.equal(extraArgs.tokenReceiver, '')
        assert.equal(extraArgs.tokenArgs, '0x')
      })

      it('should use V2 when only V2 fields are provided', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          extraArgs: {
            gasLimit: 300000n,
            allowOutOfOrderExecution: false,
          },
        }

        const result = Chain.buildMessageForDest(message)

        // Should be V2, not V3
        assert.ok(!('blockConfirmations' in result.extraArgs))
        assert.ok(!('executor' in result.extraArgs))
        if ('gasLimit' in result.extraArgs) {
          assert.equal(result.extraArgs.gasLimit, 300000n)
        }
        if ('allowOutOfOrderExecution' in result.extraArgs) {
          assert.equal(result.extraArgs.allowOutOfOrderExecution, false)
        }
      })

      it('should set V3 gasLimit to 0 when no data', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          extraArgs: {
            blockConfirmations: 10,
          } as any,
        }

        const result = Chain.buildMessageForDest(message)
        const extraArgs = result.extraArgs as GenericExtraArgsV3

        assert.equal(extraArgs.gasLimit, 0n)
        assert.equal(extraArgs.blockConfirmations, 10)
      })

      it('should allow user to override V3 defaults', () => {
        const customExecutorArgs = new Uint8Array([1, 2, 3])
        const message = {
          receiver: '0x1234567890123456789012345678901234567890',
          data: '0x1234',
          extraArgs: {
            blockConfirmations: 3,
            gasLimit: 500000n,
            executor: '0xCustomExecutor12345678901234567890123',
            executorArgs: customExecutorArgs,
            ccvs: ['0xCCV1', '0xCCV2'],
          } as any,
        }

        const result = Chain.buildMessageForDest(message)
        const extraArgs = result.extraArgs as GenericExtraArgsV3

        assert.equal(extraArgs.gasLimit, 500000n)
        assert.equal(extraArgs.blockConfirmations, 3)
        assert.equal(extraArgs.executor, '0xCustomExecutor12345678901234567890123')
        assert.deepEqual(extraArgs.executorArgs, customExecutorArgs)
        assert.deepEqual(extraArgs.ccvs, ['0xCCV1', '0xCCV2'])
        // ccvArgs should still be default
        assert.deepEqual(extraArgs.ccvArgs, [])
      })
    })

    describe('SolanaChain', () => {
      it('should populate SVMExtraArgsV1 with computeUnits from gasLimit', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            gasLimit: 100000n,
          },
        }

        const result = SolanaChain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.computeUnits, 100000n)
        assert.equal(extraArgs.allowOutOfOrderExecution, true)
        assert.equal(extraArgs.tokenReceiver, '11111111111111111111111111111111')
        assert.deepEqual(extraArgs.accounts, [])
        assert.equal(extraArgs.accountIsWritableBitmap, 0n)
      })

      it('should use computeUnits if provided directly', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            computeUnits: 250000n,
          } as any,
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.computeUnits, 250000n)
      })

      it('should prefer computeUnits over gasLimit if both provided', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            computeUnits: 150000n,
            gasLimit: 100000n,
          },
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.computeUnits, 150000n)
      })

      it('should use DEFAULT_GAS_LIMIT for computeUnits when data present and no gas specified', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0xabcd',
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.computeUnits, 200000n) // DEFAULT_GAS_LIMIT
      })

      it('should set computeUnits to 0 when no data', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.computeUnits, 0n)
      })

      it('should output only strict SVMExtraArgsV1 variables', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            gasLimit: 100000n,
            someOtherField: 'should not appear',
          },
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.ok('computeUnits' in extraArgs)
        assert.ok('allowOutOfOrderExecution' in extraArgs)
        assert.ok('tokenReceiver' in extraArgs)
        assert.ok('accounts' in extraArgs)
        assert.ok('accountIsWritableBitmap' in extraArgs)
        assert.ok(!('gasLimit' in extraArgs))
        assert.ok(!('someOtherField' in extraArgs))
        assert.equal(Object.keys(extraArgs).length, 5)
      })

      it('should use custom tokenReceiver when provided', () => {
        const customReceiver = 'CustomReceiverAddress123456789012345678901'
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            tokenReceiver: customReceiver,
          } as any,
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.tokenReceiver, customReceiver)
      })

      it('should set tokenReceiver to receiver when tokenAmounts present', () => {
        const receiverAddr = '11111111111111111111111111111112' // Valid base58 Solana address
        const message = {
          receiver: receiverAddr,
          tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.tokenReceiver, receiverAddr)
        assert.equal(result.receiver, '11111111111111111111111111111111') // default PublicKey when tokens
      })

      it('should throw error when sending tokens with data but no tokenReceiver', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
        }

        assert.throws(
          () => SolanaChain.buildMessageForDest(message),
          /tokenReceiver.*required when sending tokens with data to Solana/i,
        )
      })

      it('should accept accounts array', () => {
        const accounts = [
          'Account1111111111111111111111111111111111',
          'Account2222222222222222222222222222222222',
        ]
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            accounts,
          } as any,
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.deepEqual(extraArgs.accounts, accounts)
      })

      it('should accept accountIsWritableBitmap', () => {
        const bitmap = 0b1010n
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            accountIsWritableBitmap: bitmap,
          } as any,
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.accountIsWritableBitmap, bitmap)
      })

      it('should override receiver to default when tokenAmounts present', () => {
        const message = {
          receiver: 'CustomReceiverAddress1234567890123456789012',
          tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
          extraArgs: {
            tokenReceiver: 'TokenReceiverAddress12345678901234567890',
          } as any,
        }

        const result = SolanaChain.buildMessageForDest(message)

        assert.equal(result.receiver, '11111111111111111111111111111111')
      })

      it('should allow custom allowOutOfOrderExecution', () => {
        const message = {
          receiver: 'DummyReceiverAddress1234567890123456789012',
          data: '0x1234',
          extraArgs: {
            allowOutOfOrderExecution: false,
          } as any,
        }

        const result = SolanaChain.buildMessageForDest(message)

        const extraArgs = result.extraArgs as SVMExtraArgsV1
        assert.equal(extraArgs.allowOutOfOrderExecution, false)
      })
    })

    describe('SuiChain', () => {
      it('should populate SuiExtraArgsV1 with gasLimit', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            gasLimit: 100000n,
          },
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.ok(result.extraArgs)
        assert.equal(result.extraArgs.gasLimit, 100000n)
        assert.equal(result.extraArgs.allowOutOfOrderExecution, true)
        assert.equal(
          result.extraArgs.tokenReceiver,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        )
        assert.deepEqual(result.extraArgs.receiverObjectIds, [])
      })

      it('should use DEFAULT_GAS_LIMIT when data present and no gasLimit specified', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0xabcd',
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(result.extraArgs.gasLimit, 1000000n) // DEFAULT_GAS_LIMIT for Sui
      })

      it('should set gasLimit to 0 when no data', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(result.extraArgs.gasLimit, 0n)
      })

      it('should use custom tokenReceiver when provided', () => {
        const customReceiver = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd'
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            tokenReceiver: customReceiver,
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(result.extraArgs.tokenReceiver, customReceiver)
      })

      it('should set tokenReceiver to receiver when tokenAmounts present', () => {
        const receiverAddr = '0x1234567890123456789012345678901234567890123456789012345678901234'
        const message = {
          receiver: receiverAddr,
          tokenAmounts: [{ token: '0xToken123', amount: 100n }],
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(result.extraArgs.tokenReceiver, receiverAddr)
        assert.equal(
          result.receiver,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        )
      })

      it('should populate receiverObjectIds from accounts', () => {
        const accounts = [
          '0xobj1111111111111111111111111111111111111111111111111111111111111',
          '0xobj2222222222222222222222222222222222222222222222222222222222222',
        ]
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            accounts,
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.deepEqual(result.extraArgs.receiverObjectIds, accounts)
      })

      it('should use receiverObjectIds directly when provided', () => {
        const objectIds = ['0xobj3333333333333333333333333333333333333333333333333333333333333']
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            receiverObjectIds: objectIds,
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.deepEqual(result.extraArgs.receiverObjectIds, objectIds)
      })

      it('should prefer receiverObjectIds over accounts', () => {
        const objectIds = ['0xobj1111111111111111111111111111111111111111111111111111111111111']
        const accounts = ['0xacc2222222222222222222222222222222222222222222222222222222222222']
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            receiverObjectIds: objectIds,
            accounts,
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.deepEqual(result.extraArgs.receiverObjectIds, objectIds)
      })

      it('should handle empty receiverObjectIds array', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            receiverObjectIds: [],
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.deepEqual(result.extraArgs.receiverObjectIds, [])
      })

      it('should fall back to accounts if receiverObjectIds is empty array', () => {
        const accounts = ['0xacc1111111111111111111111111111111111111111111111111111111111111']
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            receiverObjectIds: [],
            accounts,
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.deepEqual(result.extraArgs.receiverObjectIds, accounts)
      })

      it('should override receiver to zero address when tokenAmounts present', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          tokenAmounts: [{ token: '0xToken123', amount: 100n }],
          extraArgs: {
            tokenReceiver: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(
          result.receiver,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        )
      })

      it('should allow custom allowOutOfOrderExecution', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            allowOutOfOrderExecution: false,
          } as any,
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(result.extraArgs.allowOutOfOrderExecution, false)
      })

      it('should preserve other message fields', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0xdeadbeef',
          tokenAmounts: [{ token: '0xToken123', amount: 500n }],
          feeToken: '0xFeeToken456',
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.equal(result.data, message.data)
        assert.deepEqual(result.tokenAmounts, message.tokenAmounts)
        assert.equal(result.feeToken, message.feeToken)
      })

      it('should output only SuiExtraArgsV1 variables', () => {
        const message = {
          receiver: '0x1234567890123456789012345678901234567890123456789012345678901234',
          data: '0x1234',
          extraArgs: {
            gasLimit: 100000n,
            unknownField: 'should not appear',
          },
        }

        const result = SuiChain.buildMessageForDest(message)

        assert.ok('gasLimit' in result.extraArgs)
        assert.ok('allowOutOfOrderExecution' in result.extraArgs)
        assert.ok('tokenReceiver' in result.extraArgs)
        assert.ok('receiverObjectIds' in result.extraArgs)
        assert.ok(!('unknownField' in result.extraArgs))
        assert.equal(Object.keys(result.extraArgs).length, 4)
      })
    })
  })
})
