import type { Provider, TransactionReceipt } from 'ethers'
import { AbiCoder, Contract, getAddress, hexlify, id, keccak256, randomBytes } from 'ethers'

import {
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchOffchainTokenData,
  fetchRequestsForSender,
  getOnRampStaticConfig,
} from './requests.js'
import type { CCIPRequest } from './types.js'
import { CCIPContractTypeOffRamp, CCIPContractTypeOnRamp, CCIPVersion_1_2 } from './types.js'

const mockedContract = {
  typeAndVersion: jest.fn(() => `${CCIPContractTypeOnRamp} ${CCIPVersion_1_2}`),
  getStaticConfig: jest.fn(() => ({ chainSelector: 1 })),
}

function mockedMessage(seqNum: number) {
  return {
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
  parseLog: jest.fn(() => ({
    name: 'CCIPSendRequested',
    args: [mockedMessage(1)],
  })),
  getEvent: jest.fn(() => ({
    topicHash: '0xCcipSendRequestedTopic0',
  })),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn(() => mockedContract),
  Interface: jest.fn(() => mockedInterface),
}))

const mockProvider = {
  getBlockNumber: jest.fn(() => 15_000),
  getLogs: jest.fn<any, [], any>(() => [{}]),
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getOnRampStaticConfig', () => {
  it('should return static config and contract', async () => {
    const rampAddress = getAddress(hexlify(randomBytes(20)))
    await expect(
      getOnRampStaticConfig(mockProvider as unknown as Provider, rampAddress),
    ).resolves.toEqual([expect.objectContaining({ chainSelector: 1 }), mockedContract])
    expect(Contract).toHaveBeenCalledWith(rampAddress, expect.anything(), mockProvider)
  })

  it('should throw an error if not an OnRamp', async () => {
    const rampAddress = getAddress(hexlify(randomBytes(20)))
    mockedContract.typeAndVersion.mockReturnValueOnce(
      `${CCIPContractTypeOffRamp} ${CCIPVersion_1_2}`,
    )

    await expect(
      getOnRampStaticConfig(mockProvider as unknown as Provider, rampAddress),
    ).rejects.toThrow(
      `Not an OnRamp: ${rampAddress} is "${CCIPContractTypeOffRamp} ${CCIPVersion_1_2}"`,
    )
  })
})

describe('fetchCCIPMessagesInTx', () => {
  it('should return CCIP requests', async () => {
    const rampAddress = getAddress(hexlify(randomBytes(20)))
    const mockTx = {
      provider: mockProvider,
      hash: '0x123',
      logs: [{ address: rampAddress }],
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
      version: CCIPVersion_1_2,
      tx: mockTx,
    })
  })

  it('should throw an error if no CCIPSendRequested message found', async () => {
    const mockTx = {
      provider: mockProvider,
      hash: '0x123',
      logs: [
        { address: getAddress(hexlify(randomBytes(20))) },
        { address: getAddress(hexlify(randomBytes(20))) },
        { address: getAddress(hexlify(randomBytes(20))) },
        { address: getAddress(hexlify(randomBytes(20))) },
      ],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    mockedInterface.parseLog.mockReturnValueOnce({ name: 'Unknown', args: [] })
    mockedContract.typeAndVersion.mockReturnValueOnce(`UnknownContract ${CCIPVersion_1_2}`)
    mockedContract.typeAndVersion.mockReturnValueOnce(`${CCIPContractTypeOffRamp} 1.0.0`)
    mockedContract.typeAndVersion.mockReturnValueOnce(
      `${CCIPContractTypeOffRamp} ${CCIPVersion_1_2}`,
    )
    await expect(fetchCCIPMessagesInTx(mockTx)).rejects.toThrow(
      'Could not find any CCIPSendRequested message in tx: 0x123',
    )
  })
})

describe('fetchCCIPMessageInLog', () => {
  const rampAddress = getAddress(hexlify(randomBytes(20)))
  it('should return a CCIP request for a specific log index', async () => {
    const mockTx = {
      provider: mockProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1 }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    const result = await fetchCCIPMessageInLog(mockTx, 1)
    expect(result).toMatchObject({
      log: { index: 1 },
      message: {},
      timestamp: 1234567890,
      version: CCIPVersion_1_2,
      tx: mockTx,
    })
  })

  it('should throw an error if no request found for the log index', async () => {
    const mockTx = {
      provider: mockProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1 }],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt

    await expect(fetchCCIPMessageInLog(mockTx, 2)).rejects.toThrow(
      'Could not find a CCIPSendRequested message in tx 0x123 with logIndex=2',
    )
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
      mockProvider as unknown as Provider,
      { address: '0xOnRamp', blockNumber: 12_000 },
      { min: 8, max: 10 },
    )
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      message: { sequenceNumber: 8n },
    })
    expect(result[2]).toMatchObject({
      message: { sequenceNumber: 10n },
    })
    expect(mockProvider.getLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fromBlock: 9501, toBlock: 14500 }),
    )
    expect(mockProvider.getLogs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fromBlock: 4501, toBlock: 9500 }),
    )
    // last call should stop in latest block
    expect(mockProvider.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromBlock: 14501, toBlock: 15000 }),
    )
  })

  it('should throw an error if not all expected events are found', async () => {
    await expect(
      fetchAllMessagesInBatch(
        mockProvider as unknown as Provider,
        { address: '0xOnRamp', blockNumber: 1 },
        { min: 1, max: 10 },
      ),
    ).rejects.toThrow('Could not find all expected CCIPSendRequested events')
  })
})

describe('fetchOffchainTokenData', () => {
  const MESSAGE_SENT_TOPIC0 = id('MessageSent(bytes)')
  const TRANSFER_TOPIC0 = id('Transfer(address,address,uint256)')
  const defaultAbiCoder = AbiCoder.defaultAbiCoder()
  const usdcToken = getAddress(hexlify(randomBytes(20)))

  const origFetch = global.fetch
  const mockedFetchJson = jest.fn<any, [], any>(() => ({
    status: 'complete',
    attestation: '0xa77e57a71090',
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  global.fetch = mockedFetch as any
  afterAll(() => {
    global.fetch = origFetch
  })

  it('should return offchain token data', async () => {
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: usdcToken, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 5, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*1337.*a77e57a71090/)
  })

  it('should return default token data if no USDC logs found', async () => {
    const usdcToken = getAddress(hexlify(randomBytes(20)))
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: usdcToken, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 5, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          },
        ],
      },
    }
    mockedFetchJson.mockResolvedValueOnce({ error: 'Invalid message hash' })

    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should return correct USDC attestations for multiple transfers', async () => {
    const otherToken = getAddress(hexlify(randomBytes(20)))
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: usdcToken, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 1, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef01']),
          },
          // another CCIPSendRequested event, indicating multiple messages in the same tx
          { topics: ['0x123'], index: 2, address: usdcToken },
          // our transfer
          { topics: [TRANSFER_TOPIC0], index: 3, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 4,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef02']),
          },
          // another "USDC-like"" transfer in request, unrelated token
          { topics: [TRANSFER_TOPIC0], index: 5, address: otherToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef03']),
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*beef02.*a77e57a71090/)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining(keccak256('0xbeef02')))
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
      version: CCIPVersion_1_2 as CCIPVersion_1_2,
    }
    mockProvider.getLogs.mockResolvedValue([])
    mockProvider.getLogs.mockResolvedValueOnce([{}, {}])
    mockProvider.getLogs.mockResolvedValueOnce([{}])
    const someMessage = mockedMessage(18)
    someMessage.toObject.mockReturnValue({
      sender: '0xUnknownSender',
      sequenceNumber: 18n,
      tokenAmounts: [],
      sourceTokenData: [],
    })
    mockedInterface.parseLog.mockReturnValueOnce({ name: 'CCIPSendRequested', args: [someMessage] })

    const res = []
    const generator = fetchRequestsForSender(mockProvider as unknown as Provider, mockRequest)
    for await (const req of generator) {
      res.push(req)
    }
    expect(res).toHaveLength(2)
    expect(mockProvider.getLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fromBlock: 11 }),
    )
    expect(mockProvider.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ toBlock: 15000 }),
    )
  })
})
