import { getAddress, hexlify, id, keccak256, randomBytes } from 'ethers'

import { LBTC_EVENT, fetchOffchainTokenData } from './offchain.js'
import { type CCIPRequest, defaultAbiCoder, encodeSourceTokenData } from './types.js'

const orig_fetch = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
})

describe('fetchOffchainTokenData', () => {
  const MESSAGE_SENT_TOPIC0 = id('MessageSent(bytes)')
  const TRANSFER_TOPIC0 = id('Transfer(address,address,uint256)')
  const usdcToken = getAddress(hexlify(randomBytes(20)))

  const mockedFetchJson = jest.fn<any, [], any>(() => ({
    status: 'complete',
    attestation: '0xa77e57a71090',
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  beforeAll(() => {
    global.fetch = mockedFetch as any
  })
  afterAll(() => {
    global.fetch = orig_fetch
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

describe('fetchLbtcOffchainTokenData', () => {
  const lbtcToken = getAddress(hexlify(randomBytes(20)))
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
    global.fetch = orig_fetch
  })

  it('should skip if has no LBTC Deposit Event', async () => {
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: lbtcToken, amount: 100n }],
        sourceTokenData: [
          encodeSourceTokenData({
            sourcePoolAddress: '0x',
            destTokenAddress: '0x',
            extraData: approvedPayloadHash1,
            destGasAmount: 0,
          }),
        ],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('0x')
  })

  it('should return offchain token data', async () => {
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: lbtcToken, amount: 100n }],
        sourceTokenData: [
          encodeSourceTokenData({
            sourcePoolAddress: '0x',
            destTokenAddress: '0x',
            extraData: approvedPayloadHash1,
            destGasAmount: 0,
          }),
        ],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', approvedPayloadHash1, '0x'],
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
  })

  it('should throw error if attestation is not found', async () => {
    const randomExtraData = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: lbtcToken, amount: 100n }],
        sourceTokenData: [
          encodeSourceTokenData({
            sourcePoolAddress: '0x1234',
            destTokenAddress: '0x5678',
            extraData: randomExtraData,
            destGasAmount: 100,
          }),
        ],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', randomExtraData, '0x'],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    await expect(async () => {
      await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    }).rejects.toThrow()
  })

  it('should throw if attestation is not approved', async () => {
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [{ token: lbtcToken, amount: 100n }],
        sourceTokenData: [
          encodeSourceTokenData({
            sourcePoolAddress: '0x1234',
            destTokenAddress: '0x5678',
            extraData: pendingPayloadHash,
            destGasAmount: 100,
          }),
        ],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', pendingPayloadHash, '0x'],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    await expect(async () => {
      await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    }).rejects.toThrow()
  })

  it('should return offchain token data multiple transfers', async () => {
    const mockRequest = {
      message: {
        sourceChainSelector: 16015286601757825753n,
        tokenAmounts: [
          { token: lbtcToken, amount: 100n },
          { token: lbtcToken, amount: 200n },
        ],
        sourceTokenData: [
          encodeSourceTokenData({
            sourcePoolAddress: '0x',
            destTokenAddress: '0x',
            extraData: approvedPayloadHash1,
            destGasAmount: 100,
          }),
          encodeSourceTokenData({
            sourcePoolAddress: '0x',
            destTokenAddress: '0x',
            extraData: approvedPayloadHash2,
            destGasAmount: 100,
          }),
        ],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', approvedPayloadHash1, '0x'],
            index: 6,
            data: '0x',
          },
          {
            topics: [LBTC_EVENT.topicHash, '0x', approvedPayloadHash2, '0x'],
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
  })
})
