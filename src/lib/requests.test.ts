import {
  type Provider,
  type TransactionReceipt,
  Contract,
  Interface,
  getAddress,
  getBytes,
  hexlify,
  randomBytes,
} from 'ethers'

let rampAddress: string

function mockedMessage(seqNum: number) {
  return {
    messageId: `0xMessageId${seqNum}`,
    sender: '0xSender',
    sequenceNumber: BigInt(seqNum),
    tokenAmounts: [{ token: '0xtoken', amount: 123n }],
    sourceTokenData: [
      '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000005a51fc6c00000000000000000000000000000000000000000000000000000000000000200000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000cc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee0000000000000000000000000000000000000000000000000000000000000020d8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4',
    ],
    gasLimit: 100n,
  }
}

const mockedProvider = {
  get provider() {
    return mockedProvider
  },
  getBlockNumber: jest.fn(() => 15_000),
  getLogs: jest.fn<any, [{ address?: string; topics: string[] }], any>(({ address, topics }) => [
    {
      address: address ?? rampAddress,
      index: 1,
      topics: [topics[0]],
      data: mockedMessage(1),
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

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn((address) => ({ ...mockedContract, getAddress: jest.fn(() => address) })),
}))

import {
  fetchAllMessagesInBatch,
  fetchCCIPMessageById,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchRequestsForSender,
  getOnRampLane,
} from './requests.js'
import { type Lane, CCIPContractType, CCIPVersion, CCIP_ABIs } from './types.js'
import { bigIntReplacer, lazyCached } from './utils.js'

const topic0 = lazyCached(
  `Interface ${CCIPContractType.OnRamp} ${CCIPVersion.V1_6}`,
  () => new Interface(CCIP_ABIs[CCIPContractType.OnRamp][CCIPVersion.V1_6]),
).getEvent('CCIPMessageSent')!.topicHash

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
  afterEach(() => {
    jest.restoreAllMocks()
  })
  it('should return CCIP requests', async () => {
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [
        {
          address: rampAddress,
          topics: [topic0],
          data: mockedMessage(1),
        },
      ],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
    const result = await fetchCCIPMessagesInTx(mockTx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      message: {
        header: { sequenceNumber: 1n },
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
        {
          address: getAddress(hexlify(randomBytes(20))),
          topics: [topic0],
          data: JSON.stringify(mockedMessage(1), bigIntReplacer), // test decodeMessage(jsonString)
        },
        {
          address: getAddress(hexlify(randomBytes(20))),
          topics: [topic0],
          data: mockedMessage(2),
        },
        {
          address: getAddress(hexlify(randomBytes(20))),
          topics: [topic0],
          // test decodeMessage(bytea -> Result)
          data: getBytes(
            '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de41ba4fc9d91ad900000000000000000000000071a15b42cb572143d4fd1e0b92b75540599186ee00000000000000000000000071a15b42cb572143d4fd1e0b92b75540599186ee000000000000000000000000000000000000000000000000000000000000037a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000097d90c9d3e0b50ca60e1ae45f6a81010f9fb53400000000000000000000000000000000000000000000000000006c5ed0f44c8a00000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000022084b48c836761eacb479e721b6f575d129629e97486fb8f6ad42c446429a0ac4f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c723800000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000002bf200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000aff3fe524ea94118ef09dadbe3c77ba6aa0005ec0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000036cbd53842c5426634e7929541ec2318f3dcf7e000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000415450000000000000000000000000000000000000000000000000000000000000000',
          ),
        },
      ],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt
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
      logs: [{ address: rampAddress, index: 1, topics: [topic0], data: mockedMessage(1) }],
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
      logs: [
        {
          address: rampAddress,
          index: 1,
          topics: [topic0],
          data: '0x00000000000000000000000000000000000000000000000000000000000000202283f3e1c4e16e36dd0f8507c7c22294bf905f185873b243a159d59247ea1d7f000000000000000000000000000000000000000000000000de41ba4fc9d91ad9000000000000000000000000000000000000000000000000e1f4423f1bf587cd00000000000000000000000000000000000000000000000000000000000001d700000000000000000000000000000000000000000000000000000000000001b200000000000000000000000079de45bbbbbbd1bd179352aa5e7836a32285e8bd00000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000097d90c9d3e0b50ca60e1ae45f6a81010f9fb534000000000000000000000000000000000000000000000000000006f37661d7bf000000000000000000000000000000000000000000000000000410cc98e1402f00000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000000568656c6c6f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000095b9e79a732c0e03d04a41c30c9df7852a3d8da40000000000000000000000000000000000000000000000000000000000000044181dcf100000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000001b4284a86cc0f3ac975980dd5d951b8456fa7c3600000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000a4c9e2108ca478de0b91c7d9ba034bbc93c22ecc000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000001e848',
        },
      ],
      getBlock: jest.fn().mockResolvedValue({ timestamp: 1234567890 }),
    } as unknown as TransactionReceipt

    await expect(fetchCCIPMessageInLog(mockTx, 2)).rejects.toThrow(
      'Could not find a CCIPSendRequested message in tx 0x123 with logIndex=2',
    )
  })
})

describe('fetchCCIPMessageById', () => {
  it('should return a CCIP request by messageId', async () => {
    const msg = mockedMessage(1)
    mockedProvider.getLogs.mockResolvedValueOnce([
      {
        index: 1,
        topics: [topic0],
        data: msg,
      },
    ])
    const mockTx = {
      provider: mockedProvider,
      hash: '0x123',
      logs: [{ address: rampAddress, index: 1, topics: [topic0], data: msg }],
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
  const destChainSelector = 10n
  it('should return all messages in a batch', async () => {
    // first getLogs will get the "middle" message
    mockedProvider.getLogs.mockReturnValueOnce([
      { data: { ...mockedMessage(7), gasLimit: null } },
      { data: mockedMessage(9) },
    ])
    mockedProvider.getLogs.mockReturnValueOnce([{ data: mockedMessage(8) }])
    mockedProvider.getLogs.mockReturnValueOnce([
      { data: mockedMessage(10) },
      { data: mockedMessage(11) },
    ])
    // then need to go 1 page back
    const result = await fetchAllMessagesInBatch(
      mockedProvider as unknown as Provider,
      destChainSelector,
      { address: '0xOnRamp', blockNumber: 12_000, topics: [topic0] },
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
        destChainSelector,
        { address: '0xOnRamp', blockNumber: 1, topics: [topic0] },
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
    mockedProvider.getLogs.mockResolvedValue([])
    const someMessage = mockedMessage(18)
    someMessage.sender = '0xUnknownSender'
    mockedProvider.getLogs.mockResolvedValueOnce([
      { data: mockedMessage(2) },
      { data: someMessage },
    ])
    mockedProvider.getLogs.mockResolvedValueOnce([{ data: mockedMessage(3) }])

    const mockRequest = {
      log: { address: '0xOnRamp', topics: [topic0], blockNumber: 11 },
      message: { sender: '0xSender' },
      lane: {
        version: CCIPVersion.V1_5,
      } as Lane,
    }
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
