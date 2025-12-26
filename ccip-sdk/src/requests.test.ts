import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import './index.ts' // Import to ensure chains are loaded
import type { Chain, LogFilter } from './chain.ts'
import {
  decodeMessage,
  getMessageById,
  getMessagesForSender,
  getMessagesInBatch,
  getMessagesInTx,
} from './requests.ts'
import {
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type Lane,
  type Log_,
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
    const logs: Log_[] = [
      {
        address: opts.address ?? rampAddress,
        index: 1,
        topics: Array.isArray(opts.topics?.[0]) ? opts.topics[0] : [topic0],
        data: mockedMessage(1),
        blockNumber: 12000,
        transactionHash: '0x123',
      } as Log_,
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

describe('fetchCCIPMessagesInTx', () => {
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
        } as Log_,
      ],
      timestamp: 1234567890,
      blockNumber: 12000,
      from: '0x0000000000000000000000000000000000000001',
    }

    const result = await getMessagesInTx(mockedChain as unknown as Chain, mockTx)
    assert.equal(result.length, 1)
    assert.equal(result[0].message.sequenceNumber, 1n)
    assert.equal(result[0].tx, mockTx)
    assert.equal(result[0].lane.version, CCIPVersion.V1_2)
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
        } as Log_,
        {
          address: getAddress(hexlify(randomBytes(20))),
          topics: [topic0],
          data: mockedMessage(2),
          blockNumber: 12000,
          transactionHash: '0x123',
          index: 1,
        } as Log_,
      ],
      timestamp: 1234567890,
      blockNumber: 12000,
      from: '0x0000000000000000000000000000000000000001',
    }

    await assert.rejects(
      async () => await getMessagesInTx(mockedChain as unknown as Chain, mockTx),
      /Could not find any CCIPSendRequested message in tx: 0x123/,
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

describe('fetchCCIPMessageById', () => {
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
        } as Log_
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
        } as Log_
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
      } as Log_,
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
    assert.equal(result[0].sequenceNumber, 9n)
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
      } as Log_,
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
        } as Log_
        yield {
          address: rampAddress,
          topics: [topic0],
          data: someOtherMessage,
          blockNumber: 12001,
          transactionHash: '0x124',
          index: 0,
        } as Log_
        yield {
          address: rampAddress,
          topics: [topic0],
          data: mockedMessage(3),
          blockNumber: 12002,
          transactionHash: '0x125',
          index: 0,
        } as Log_
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
    const tokenAmount = msg.tokenAmounts[0]

    assert.ok('token' in msg.tokenAmounts[0])
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
    const tokenAmount = msg.tokenAmounts[0]

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
})
