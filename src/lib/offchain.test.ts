import { Interface, getAddress, hexlify, id, keccak256, randomBytes } from 'ethers'

import TokenPoolABI from '../abi/BurnMintTokenPool_1_5_1.ts'
import { toChainEventFromEVM } from './events/index.ts'
import {
  type FetchOffchainTokenDataInput,
  LBTC_EVENT,
  fetchOffchainTokenData,
  fetchOffchainTokenDataV2,
} from './offchain.ts'
import { type CCIPMessage, type CCIPRequest, defaultAbiCoder } from './types.ts'
import { lazyCached } from './utils.ts'

const origFetch = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
})

const TokenPoolInterface = lazyCached(
  `Interface BurnMintTokenPool 1.5.1`,
  () => new Interface(TokenPoolABI),
)
const BURNED_EVENT = TokenPoolInterface.getEvent('Burned')!

describe('fetchOffchainTokenData', () => {
  const MESSAGE_SENT_TOPIC0 = id('MessageSent(bytes)')
  const TRANSFER_TOPIC0 = id('Transfer(address,address,uint256)')
  const usdcToken = getAddress(hexlify(randomBytes(20)))
  const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))

  const mockedFetchJson = jest.fn<any, [], any>(() => ({
    status: 'complete',
    attestation: '0xa77e57a71090',
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  beforeAll(() => {
    global.fetch = mockedFetch as any
  })
  afterAll(() => {
    global.fetch = origFetch
  })

  it('should return offchain token data', async () => {
    const mockRequest = {
      lane: {
        sourceChainSelector: 16015286601757825753n,
      },
      message: {
        tokenAmounts: [{ token: usdcToken, sourcePoolAddress, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 9 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 5, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          },
          { topics: [], index: 7 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: sourcePoolAddress,
            index: 8,
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*1337.*a77e57a71090/)

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(v2Result).toHaveLength(1)
    expect(v2Result[0]).toMatch(/^0x.*1337.*a77e57a71090/)
  })

  it('should return default token data if no USDC logs found', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ token: usdcToken, sourcePoolAddress, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 9 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 5, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          },
          { topics: [], index: 7 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: sourcePoolAddress,
            index: 8,
          },
        ],
      },
    }
    mockedFetchJson.mockResolvedValueOnce({ error: 'Invalid message hash' })

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toEqual(['0x'])

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(v2Result).toEqual(['0x'])
  })

  it('should return correct USDC attestations for multiple transfers', async () => {
    const otherToken = getAddress(hexlify(randomBytes(20)))
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ token: usdcToken, sourcePoolAddress, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 11 },
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
          { topics: [], index: 5 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: sourcePoolAddress,
            index: 6,
          },
          // another "USDC-like" transfer in request, unrelated token
          { topics: [TRANSFER_TOPIC0], index: 7, address: otherToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 8,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef03']),
          },
          { topics: [], index: 9 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: getAddress(hexlify(randomBytes(20))),
            index: 10,
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*beef02.*a77e57a71090/)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining(keccak256('0xbeef02')))

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(v2Result).toHaveLength(1)
    expect(v2Result[0]).toMatch(/^0x.*beef02.*a77e57a71090/)
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining(keccak256('0xbeef02')))
  })
})

describe('fetchLbtcOffchainTokenData', () => {
  const approvedPayloadHash1 = '0x111114eb42fd24b59b6edf6c5aa6b9357be7dcaf91f1d62da303f1fad100762e'
  const approvedPayloadAttestation1 = hexlify(randomBytes(20))
  const approvedPayloadHash2 = '0x222224eb42fd24b59b6edf6c5aa6b9357be7dcaf91f1d62da303f1fad100762e'
  const approvedPayloadAttestation2 = hexlify(randomBytes(20))
  const pendingPayloadHash = '0x333334eb42fd24b59b6edf6c5aa6b9357be7dcaf91f1d62da303f1fad100762e'

  const mockedFetchJson = jest.fn<any, [], any>(() => ({
    attestations: [
      {
        message_hash: approvedPayloadHash1,
        status: 'NOTARIZATION_STATUS_SESSION_APPROVED',
        attestation: approvedPayloadAttestation1,
      },
      {
        message_hash: approvedPayloadHash2,
        status: 'NOTARIZATION_STATUS_SESSION_APPROVED',
        attestation: approvedPayloadAttestation2,
      },
      { message_hash: pendingPayloadHash, status: 'NOTARIZATION_STATUS_SESSION_PENDING' },
    ],
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  beforeAll(() => {
    global.fetch = mockedFetch as any
  })
  afterAll(() => {
    global.fetch = origFetch
  })

  it('should skip if has no LBTC Deposit Event', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: approvedPayloadHash1 }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('0x')

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(v2Result).toHaveLength(1)
    expect(v2Result[0]).toBe('0x')
  })

  it('should return offchain token data', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: approvedPayloadHash1 }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', approvedPayloadHash1],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(approvedPayloadAttestation1)

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(v2Result).toHaveLength(1)
    expect(v2Result[0]).toBe(approvedPayloadAttestation1)
  })

  it('should fallback if attestation is not found', async () => {
    const randomExtraData = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: randomExtraData }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', randomExtraData],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('0x')

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(v2Result).toEqual(['0x'])
  })

  it('should fallback if attestation is not approved', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: pendingPayloadHash }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', pendingPayloadHash],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result).toEqual(['0x'])

    const v2Result = await fetchOffchainTokenDataV2(
      toV2Request(mockRequest as unknown as CCIPRequest),
    )
    expect(v2Result).toEqual(['0x'])
  })

  it('should return offchain token data multiple transfers', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: approvedPayloadHash1 }, { extraData: approvedPayloadHash2 }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', approvedPayloadHash1],
            index: 6,
            data: '0x',
          },
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', approvedPayloadHash2],
            index: 7,
            data: '0x',
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(approvedPayloadAttestation1)
    expect(result[1]).toBe(approvedPayloadAttestation2)

    const v2Request = toV2Request(mockRequest as unknown as CCIPRequest)
    const v2Result = await fetchOffchainTokenDataV2(v2Request)
    expect(v2Result).toHaveLength(2)
    expect(v2Result[0]).toBe(approvedPayloadAttestation1)
    expect(v2Result[1]).toBe(approvedPayloadAttestation2)
  })
})

describe('fetchOffchainTokenData with v2', () => {
  const MESSAGE_SENT_TOPIC0 = id('MessageSent(bytes)')
  const TRANSFER_TOPIC0 = id('Transfer(address,address,uint256)')
  const usdcToken = getAddress(hexlify(randomBytes(20)))
  const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))

  const mockedFetchJson = jest.fn<any, [], any>(() => ({
    status: 'complete',
    attestation: '0xa77e57a71090',
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  beforeAll(() => {
    global.fetch = mockedFetch as any
  })
  afterAll(() => {
    global.fetch = origFetch
  })

  it('should return offchain token data', async () => {
    const v2Request: FetchOffchainTokenDataInput = {
      sourceChainSelector: 16015286601757825753n,
      sourceTokenDatas: [
        { destTokenAddress: usdcToken, sourcePoolAddress, extraData: '', destGasAmount: 0n },
      ],
      ccipLog: {
        id: '0x123',
        index: 9,
      },
      txLogs: [
        {
          id: TRANSFER_TOPIC0,
          index: 5,
          address: usdcToken,
          data: '',
          indexedArgs: [],
        },
        {
          id: MESSAGE_SENT_TOPIC0,
          index: 6,
          data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          address: '',
          indexedArgs: [],
        },
        { id: '', index: 7, address: '', data: '', indexedArgs: [] },
        {
          id: BURNED_EVENT.topicHash,
          address: sourcePoolAddress,
          index: 8,
          data: '',
          indexedArgs: [],
        },
      ],
    }

    const result = await fetchOffchainTokenDataV2(v2Request)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*1337.*a77e57a71090/)
  })
})

type FetchOffchainTokenDataInputV1 = Pick<CCIPRequest, 'tx' | 'lane'> & {
  message: CCIPMessage
  log: Pick<CCIPRequest['log'], 'topics' | 'index'>
}
const toV2Request = (input: FetchOffchainTokenDataInputV1): FetchOffchainTokenDataInput => {
  return {
    sourceChainSelector: input.lane.sourceChainSelector,
    sourceTokenDatas: input.message.tokenAmounts.map((tokenAmount) => ({
      destTokenAddress: 'token' in tokenAmount ? tokenAmount.token : tokenAmount.destTokenAddress,
      sourcePoolAddress:
        'sourcePoolAddress' in input.message
          ? (input.message.sourcePoolAddress as string)
          : (tokenAmount.sourcePoolAddress as string),
      extraData: tokenAmount.extraData as string,
      destGasAmount: tokenAmount.amount,
    })),
    ccipLog: toChainEventFromEVM({ data: '0x', address: '', ...input.log }),
    txLogs: input.tx.logs.map((log) => toChainEventFromEVM(log)),
  }
}
