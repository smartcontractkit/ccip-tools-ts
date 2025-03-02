import {
  type Provider,
  type TransactionReceipt,
  Contract,
  getAddress,
  hexlify,
  randomBytes,
} from 'ethers'

let rampAddress: string

const mockedProvider = {
  get provider() {
    return mockedProvider
  },
  getBlockNumber: jest.fn(() => 15_000),
  getLogs: jest.fn<any, [], any>(() => [
    {
      address: rampAddress,
      index: 1,
      topics: ['0xCcipSendRequestedTopic0'],
    },
  ]),
  getTransactionReceipt: jest.fn(),
  getNetwork: jest.fn(() => ({ chainId: 11155111 })),
}

const mockedContract = {
  runner: mockedProvider,
  typeAndVersion: jest.fn(() => `${CCIPContractType.OnRamp} ${CCIPVersion.V1_2}`),
  getStaticConfig: jest.fn(() => ({ chainSelector: 1, destChainSelector: 2 })),
  getAddress: jest.fn(),
}

function mockedMessage(seqNum: number) {
  return {
    messageId: `0xMessageId${seqNum}`,
    sender: '0xSender',
    sequenceNumber: BigInt(seqNum),
    tokenAmounts: [{ toObject: jest.fn(() => ({ token: '0xtoken', amount: 123n })) }],
    sourceTokenData: { toArray: jest.fn(() => []) },
    toObject: jest.fn(() => ({
      sender: '0xSender',
      sequenceNumber: BigInt(seqNum),
      tokenAmounts: [{ token: '0xtoken', amount: 123n }],
      sourceTokenData: [],
    })),
  }
}

const mockedInterface = {
  parseLog: jest.fn(() => {
    const message = mockedMessage(1)
    return {
      name: 'CCIPSendRequested',
      args: Object.assign([message], { message }) as any[],
    }
  }),
  getEvent: jest.fn(() => ({
    topicHash: '0xCcipSendRequestedTopic0',
  })),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn((address) => ({ ...mockedContract, getAddress: jest.fn(() => address) })),
  Interface: jest.fn(() => mockedInterface),
}))

import {
  fetchAllMessagesInBatch,
  fetchCCIPMessageById,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchRequestsForSender,
  getOnRampLane,
} from './requests.js'
import { type Lane, CCIPContractType, CCIPVersion } from './types.js'

beforeEach(() => {
  jest.clearAllMocks()
  rampAddress = getAddress(hexlify(randomBytes(20)))
  mockedContract.getAddress.mockReturnValue(rampAddress)
})

describe('getOnRampLane', () => {
  it('should return static config and contract', async () => {
    await expect(
      getOnRampLane(mockedProvider as unknown as Provider, rampAddress),
    ).resolves.toEqual([
      {
        sourceChainSelector: 1,
        destChainSelector: 2,
        onRamp: rampAddress,
        version: CCIPVersion.V1_2,
      },
      expect.objectContaining({ runner: mockedProvider }),
    ])
    expect(Contract).toHaveBeenCalledWith(rampAddress, expect.anything(), mockedProvider)
  })

  it('should throw an error if not an OnRamp', async () => {
    mockedContract.typeAndVersion.mockReturnValueOnce(
      `${CCIPContractType.OffRamp} ${CCIPVersion.V1_2}`,
    )

    await expect(getOnRampLane(mockedProvider as unknown as Provider, rampAddress)).rejects.toThrow(
      `Not an OnRamp: ${rampAddress} is "${CCIPContractType.OffRamp} ${CCIPVersion.V1_2}"`,
    )
  })
})

describe('fetchCCIPMessagesInTx', () => {
  it('should return CCIP requests', async () => {
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, topics: ['0xCcipSendRequestedTopic0'] }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    const result = await fetchCCIPMessagesInTx(mockTx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      message: {
        tokenAmounts: [{ token: '0xtoken', amount: 123n }],
        sourceTokenData: [],
      },
      timestamp: 1234567890,
      tx: mockTx,
      lane: { version: CCIPVersion.V1_2 },
    })
  })

  it('should throw an error if no CCIPSendRequested message found', async () => {
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [
        { address: getAddress(hexlify(randomBytes(20))), topics: ['0xCcipSendRequestedTopic0'] },
        { address: getAddress(hexlify(randomBytes(20))), topics: ['0xCcipSendRequestedTopic0'] },
        { address: getAddress(hexlify(randomBytes(20))), topics: ['0xCcipSendRequestedTopic0'] },
        { address: getAddress(hexlify(randomBytes(20))), topics: ['0xCcipSendRequestedTopic0'] },
      ],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    mockedInterface.parseLog.mockReturnValueOnce({ name: 'Unknown', args: [] })
    mockedContract.typeAndVersion.mockReturnValueOnce(`UnknownContract ${CCIPVersion.V1_2}`)
    mockedContract.typeAndVersion.mockReturnValueOnce(`${CCIPContractType.OffRamp} 1.0.0`)
    mockedContract.typeAndVersion.mockReturnValueOnce(
      `${CCIPContractType.OffRamp} ${CCIPVersion.V1_2}`,
    )
    await expect(fetchCCIPMessagesInTx(mockTx)).rejects.toThrow(
      'Could not find any CCIPSendRequested message in tx: 0x123',
    )
  })
})

describe('fetchCCIPMessageInLog', () => {
  it('should return a CCIP request for a specific log index', async () => {
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1, topics: ['0xCcipSendRequestedTopic0'] }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    const result = await fetchCCIPMessageInLog(mockTx, 1)
    expect(result).toMatchObject({
      log: { index: 1 },
      message: {},
      timestamp: 1234567890,
      tx: mockTx,
      lane: { version: CCIPVersion.V1_2 },
    })
  })

  it('should throw an error if no request found for the log index', async () => {
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1, topics: ['0xCcipSendRequestedTopic0'] }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt

    await expect(fetchCCIPMessageInLog(mockTx, 2)).rejects.toThrow(
      'Could not find a CCIPSendRequested message in tx 0x123 with logIndex=2',
    )
  })
})

describe('fetchCCIPMessageById', () => {
  it('should return a CCIP request by messageId', async () => {
    mockedProvider.getLogs.mockResolvedValueOnce([{ index: 1 }])
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1, topics: ['0xCcipSendRequestedTopic0'] }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    mockedProvider.getTransactionReceipt.mockResolvedValueOnce(mockTx)
    const result = await fetchCCIPMessageById(mockedProvider as unknown as Provider, '0xMessageId1')
    expect(result).toMatchObject({
      log: { index: 1 },
      message: {},
      timestamp: 1234567890,
      tx: mockTx,
      lane: { version: CCIPVersion.V1_2 },
    })
  })

  it('should throw an error if no request found for the log index', async () => {
    mockedProvider.getLogs.mockResolvedValueOnce([{ index: 1 }])
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1, topics: ['0xCcipSendRequestedTopic0'] }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    mockedProvider.getTransactionReceipt.mockResolvedValueOnce(mockTx)

    await expect(
      fetchCCIPMessageById(mockedProvider as unknown as Provider, '0xMessageId2'),
    ).rejects.toThrow('Could not find a CCIPSendRequested message with messageId: 0xMessageId2')
  })
})

describe('fetchAllMessagesInBatch', () => {
  it('should return all messages in a batch', async () => {
    // first getLogs will get the "middle" message
    mockedInterface.parseLog.mockReturnValueOnce({
      name: 'CCIPSendRequested',
      args: [mockedMessage(9)],
    })
    // then need to go 1 page back
    mockedInterface.parseLog.mockReturnValueOnce({
      name: 'CCIPSendRequested',
      args: [mockedMessage(8)],
    })
    // and 1 page forward
    mockedInterface.parseLog.mockReturnValueOnce({
      name: 'CCIPSendRequested',
      args: [mockedMessage(10)],
    })
    const result = await fetchAllMessagesInBatch(
      mockedProvider as unknown as Provider,
      { address: '0xOnRamp', blockNumber: 12_000 },
      { minSeqNr: 8, maxSeqNr: 10 },
    )
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      message: { sequenceNumber: 8n },
    })
    expect(result[2]).toMatchObject({
      message: { sequenceNumber: 10n },
    })
    expect(mockedProvider.getLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fromBlock: 9501, toBlock: 14500 }),
    )
    expect(mockedProvider.getLogs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fromBlock: 4501, toBlock: 9500 }),
    )
    // last call should stop in latest block
    expect(mockedProvider.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromBlock: 14501, toBlock: 15000 }),
    )
  })

  it('should throw an error if not all expected events are found', async () => {
    await expect(
      fetchAllMessagesInBatch(
        mockedProvider as unknown as Provider,
        { address: '0xOnRamp', blockNumber: 1 },
        { minSeqNr: 1, maxSeqNr: 10 },
      ),
    ).rejects.toThrow('Could not find all expected CCIPSendRequested events')
  })
})

describe('fetchRequestsForSender', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })
  it('should yield requests for a sender', async () => {
    const mockRequest = {
      log: { address: '0xOnRamp', topics: ['0x123'], blockNumber: 11 },
      message: { sender: '0xSender' },
      version: CCIPVersion.V1_2,
      lane: {} as Lane,
    }
    mockedProvider.getLogs.mockResolvedValue([])
    mockedProvider.getLogs.mockResolvedValueOnce([{}, {}])
    mockedProvider.getLogs.mockResolvedValueOnce([{}])
    const someMessage = mockedMessage(18)
    someMessage.toObject.mockReturnValue({
      sender: '0xUnknownSender',
      sequenceNumber: 18n,
      tokenAmounts: [],
      sourceTokenData: [],
    })
    mockedInterface.parseLog.mockReturnValueOnce({ name: 'CCIPSendRequested', args: [someMessage] })

    const res = []
    const generator = fetchRequestsForSender(mockedProvider as unknown as Provider, mockRequest)
    for await (const req of generator) {
      res.push(req)
    }
    expect(res).toHaveLength(2)
    expect(mockedProvider.getLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fromBlock: 11 }),
    )
    expect(mockedProvider.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ toBlock: 15000 }),
    )
  })
})
