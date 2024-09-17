import { AbiCoder, getAddress, hexlify, id, keccak256, randomBytes } from 'ethers'

import { fetchOffchainTokenData } from './offchain.js'
import type { CCIPRequest } from './types.js'

beforeEach(() => {
  jest.clearAllMocks()
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
