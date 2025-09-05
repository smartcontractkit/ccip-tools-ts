import {
  type Provider,
  type TransactionReceipt,
  Contract,
  Interface,
  getAddress,
  getBytes,
  hexlify,
  randomBytes,
  toBeHex,
} from 'ethers'

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
  decodeMessage,
  fetchAllMessagesInBatch,
  fetchCCIPMessageById,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchRequestsForSender,
  getOnRampLane,
  parseCCIPMessageSentEvent,
} from './requests.ts'
import { type Lane, CCIPContractType, CCIPVersion, CCIP_ABIs } from './types.ts'
import { bigIntReplacer, lazyCached } from './utils.ts'

const topic0 = lazyCached(
  `Interface ${CCIPContractType.OnRamp} ${CCIPVersion.V1_6}`,
  () => new Interface(CCIP_ABIs[CCIPContractType.OnRamp][CCIPVersion.V1_6]),
).getEvent('CCIPMessageSent')!.topicHash

beforeEach(() => {
  jest.clearAllMocks()
  rampAddress = getAddress(hexlify(randomBytes(20)))
  mockedContract.getAddress.mockReturnValue(rampAddress)
})
afterEach(() => {
  jest.restoreAllMocks()
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
    // Add a third mock to make sure the third log also fails validation
    mockedContract.typeAndVersion.mockReturnValueOnce(`${CCIPContractType.OffRamp} 1.0.0`)

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
    ).rejects.toThrow('Could not find all expected')
  })
})

describe('fetchRequestsForSender', () => {
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
      message: { sender: '0x0000000000000000000000000000000000000045' },
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

describe('decodeMessage', () => {
  it('should decode 1.5 message with tokenAmounts', () => {
    const msgInfoString =
      '{"data": "0x", "nonce": 10, "sender": "0xc70070c9c8fe7866449edbf4ba3918c5936fe639", "strict": false, "feeToken": "0xd00ae08403b9bbb9124bb305c09058e32c39a48c", "gasLimit": 0, "receiver": "0xc70070c9c8fe7866449edbf4ba3918c5936fe639", "messageId": "0xe9d9d03588f0b3fca80bc43b2194d314aec8ebbea67f6390ef63b095b11e6f80", "tokenAmounts": [{"token": "0xd21341536c5cf5eb1bcb58f6723ce26e8d8e90e4", "amount": 100000000000000000}], "feeTokenAmount": 31933333333333333, "sequenceNumber": 40944, "sourceTokenData": ["0x"], "sourceChainSelector": 14767482510784806043}'

    expect(() => decodeMessage(msgInfoString)).not.toThrow()

    const msg = decodeMessage(msgInfoString)
    expect(msg.tokenAmounts.length).toBe(1)
    const tokenAmount = msg.tokenAmounts[0]

    expect('token' in msg.tokenAmounts[0]).toBe(true)
    expect(msg.feeTokenAmount).toBe(31933333333333333n)

    if ('token' in tokenAmount) {
      expect(tokenAmount.token).toBe('0xd21341536c5cf5eb1bcb58f6723ce26e8d8e90e4')
      expect(tokenAmount.amount).toBe(100000000000000000n)
    }
  })

  it('should decode 1.6 message from Aptos with snake case formats', () => {
    const msgInfoString =
      '{"data": "0x12345678", "header": {"nonce": "2", "messageId": "0xab3fbecd2bd0eee8c384c3c5665681bfc932072201d3fb959a54c2d73b5aa2e9", "sequenceNumber": "3", "destChainSelector": "16015286601757825753", "sourceChainSelector": "743186221051783445"}, "sender": "0xccccc17bdf9f47952c2207e683f1c716058b455220641ce5efaa5062a237509e", "feeToken": "0x8873d0d9aa0e1d7bf7a42de620906d51f535314c72f27032bcaaf5519a22fec9", "gasLimit": 200000, "receiver": "0x90392a1e8a941098a3c75e0bdb172cfde7e4f1f4", "extraArgs": "0x181dcf10400d03000000000000000000000000000000000000000000000000000000000000", "tokenAmounts": [{"amount": "100000000", "extra_data": "0x0000000000000000000000000000000000000000000000000000000000000008", "dest_exec_data": "0x905f0100", "dest_token_address": "0x000000000000000000000000316496c5da67d052235b9952bc42db498d6c520b", "source_pool_address": "0x65ad4cb3142cab5100a4eeed34e2005cbb1fcae42fc688e3c96b0c33ae16e6b9"}], "feeValueJuels": "52761740000000000", "feeTokenAmount": "5322165", "allowOutOfOrderExecution": false}'

    expect(() => decodeMessage(msgInfoString)).not.toThrow()

    const msg = decodeMessage(msgInfoString)

    expect(msg.tokenAmounts.length).toBe(1)
    const tokenAmount = msg.tokenAmounts[0]

    expect(tokenAmount.destTokenAddress).toBe('0x316496C5dA67D052235B9952bc42db498d6c520b')
    expect(tokenAmount.sourcePoolAddress).toBe(
      '0x65ad4cb3142cab5100a4eeed34e2005cbb1fcae42fc688e3c96b0c33ae16e6b9',
    )
  })
})

describe('Solana CCIP Message Parsing', () => {
  it('should correctly parse CCIPMessageSent event from Solana', () => {
    // Mock transaction signature and slot
    const signature =
      '4PJ8xD1ip6Limj49cdH6kqQHK2yGbqFj3ZgyySuNDHx2xppBVMDdFth9ArJwWb6GN5GFxZyWFDJiN8rKqRuXsA84'
    const slot = 394771365
    const routerAddress = 'Ccip8ZTcM2qHjVt8FYHtuCAqjc637yLKnsJ5q5r2e6eL'

    // Parse the event from real tx program data log.
    // https://ccip.chain.link/#/side-drawer/msg/0xc8cad4f80de5b5c436c102beedfb2bef0797169730c340c1c2147c70ea7e05c0
    // https://explorer.solana.com/tx/4PJ8xD1ip6Limj49cdH6kqQHK2yGbqFj3ZgyySuNDHx2xppBVMDdFth9ArJwWb6GN5GFxZyWFDJiN8rKqRuXsA84?cluster=devnet
    const programData =
      'F01Jt3u5cznZGtnJT7pB3mcIAAAAAAAAyMrU+A3ltcQ2wQK+7fsr7weXFpcww0DBwhR8cOp+BcDfN+OU4sfs49ka2clPukHeZwgAAAAAAAAAAAAAAAAAAFYj5CcDWSru4rkavfS0b24pHEzu18G5iTPcau9cy94HAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8Qf8kSAAAAAAAAAAAAAAAAAAEGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkWwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFECcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAMNQEigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOq+HeV/AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const parsedRequest = parseCCIPMessageSentEvent(
      Buffer.from(programData, 'base64'),
      signature,
      slot,
      routerAddress,
    )

    expect(parsedRequest.lane.onRamp).toBe(routerAddress)
    expect(parsedRequest.log.address).toBe(routerAddress)

    // ----- MESSAGE HEADER -----
    expect(parsedRequest.message.header.messageId.toLowerCase()).toBe(
      '0xc8cad4f80de5b5c436c102beedfb2bef0797169730c340c1c2147c70ea7e05c0',
    )
    expect(parsedRequest.message.header.sourceChainSelector).toBe(16423721717087811551n) // Solana Devnet
    if ('destChainSelector' in parsedRequest.message.header) {
      expect(parsedRequest.message.header.destChainSelector).toBe(16015286601757825753n) // Ethereum Sepolia
    }
    expect(parsedRequest.message.header.sequenceNumber).toBe(2151n)
    expect(parsedRequest.message.header.nonce).toBe(0n)

    // ----- MESSAGE -----
    expect(parsedRequest.message.sender).toBe('6oFoex6ZdFuMcb7X3HHBKpqZUkEAyFAjwjTD8swn8iWA')
    expect(parsedRequest.message.receiver.toLowerCase()).toBe(
      '0x000000000000000000000000bd27cdab5c9109b3390b25b4dff7d970918cc550',
    )
    expect(parsedRequest.message.data).toBe('0x')

    // ----- TOKEN AMOUNTS -----
    expect(parsedRequest.message.tokenAmounts.length).toBe(1)
    const tokenAmount = parsedRequest.message.tokenAmounts[0]

    if (tokenAmount.sourcePoolAddress) {
      expect(tokenAmount.sourcePoolAddress).toBe('D22aGkYvJiFJ9tpxUV1RUWkNUy4FSUBk2NAvwQQD2G9Y')
    }

    if (tokenAmount.destTokenAddress) {
      expect(tokenAmount.destTokenAddress.toLowerCase()).toBe(
        '0x0000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c7238',
      )
    }

    expect(tokenAmount.amount).toBe(10000n)

    if (tokenAmount.extraData) {
      expect(tokenAmount.extraData.toLowerCase()).toBe(
        '0x000000000000000000000000000000000000000000000000000000000000a45b0000000000000000000000000000000000000000000000000000000000000005',
      )
    }

    if ('destExecData' in tokenAmount) {
      expect(tokenAmount.destExecData.toLowerCase()).toBe('0x00030d40')
    }

    if ('destGasAmount' in tokenAmount) {
      expect(tokenAmount.destGasAmount).toBe(1074594560n)
    }

    // ----- FEE FIELDS -----
    expect(parsedRequest.message.feeToken).toBe('So11111111111111111111111111111111111111112')

    expect(parsedRequest.message.feeTokenAmount).toBe(41032n)

    if ('feeValueJuels' in parsedRequest.message) {
      expect(parsedRequest.message.feeValueJuels).toBe(422097000000000n)
    }

    // ----- EXTRA ARGS -----
    if ('extraArgs' in parsedRequest.message) {
      expect(parsedRequest.message.extraArgs.toLowerCase()).toBe(
        '0x181dcf107fc9120000000000000000000000000001',
      )
    }

    if ('gasLimit' in parsedRequest.message) {
      expect(parsedRequest.message.gasLimit).toBe(1231231n)
    }
  })
})
