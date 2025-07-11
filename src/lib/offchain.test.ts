import { Interface, getAddress, hexlify, id, keccak256, randomBytes } from 'ethers'
import bs58 from 'bs58'

import TokenPoolABI from '../abi/BurnMintTokenPool_1_5_1.ts'
import { type CCIPRequest, defaultAbiCoder } from './types.ts'
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
    const { fetchOffchainTokenData } = await import('./offchain.ts')
    const mockRequest = {
      lane: {
        sourceChainSelector: 16015286601757825753n,
        destChainSelector: 16015286601757825753n,
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
  })

  it('should return default token data if no USDC logs found', async () => {
    const { fetchOffchainTokenData } = await import('./offchain.ts')
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

    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should return correct USDC attestations for multiple transfers', async () => {
    const { fetchOffchainTokenData } = await import('./offchain.ts')
    const otherToken = getAddress(hexlify(randomBytes(20)))
    const mockRequest = {
      lane: {
        sourceChainSelector: 16015286601757825753n,
        destChainSelector: 16015286601757825753n,
      },
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
    const { fetchOffchainTokenData } = await import('./offchain.ts')
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
  })

  it('should return offchain token data', async () => {
    const { LBTC_EVENT, fetchOffchainTokenData } = await import('./offchain.ts')
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
  })

  it('should fallback if attestation is not found', async () => {
    const { LBTC_EVENT, fetchOffchainTokenData } = await import('./offchain.ts')
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
    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should fallback if attestation is not approved', async () => {
    const { LBTC_EVENT, fetchOffchainTokenData } = await import('./offchain.ts')
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
    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should return offchain token data multiple transfers', async () => {
    const { LBTC_EVENT, fetchOffchainTokenData } = await import('./offchain.ts')
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
  })
})

describe('fetchSolanaOffchainTokenData', () => {
  const SOLANA_DEVNET_SELECTOR = 16423721717087811551n
  const EVM_TESTNET_SELECTOR = 16015286601757825753n

  const mockedFetchJson = jest.fn()
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))

  // Mock Solana Web3 to prevent real RPC calls
  const mockConnection = {
    getTransaction: jest.fn(),
  }
  const mockSolanaWeb3 = {
    Connection: jest.fn(() => mockConnection),
    PublicKey: jest.fn((bytes: any) => ({
      toString: () => bs58.encode(Buffer.from(bytes)),
    })),
  }

  beforeAll(() => {
    global.fetch = mockedFetch as any

    // Clear any existing mocks first
    jest.resetModules()

    // Mock the entire @solana/web3.js module
    jest.doMock('@solana/web3.js', () => mockSolanaWeb3)
  })
  afterAll(() => {
    global.fetch = origFetch

    // Clean up mocks
    jest.dontMock('@solana/web3.js')
    jest.resetModules()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset the mock implementation for each test
    mockConnection.getTransaction.mockClear()
  })

  it('should return correctly encoded offchainTokenData for a successful transfer to EVM', async () => {
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [
          // Mock a program data log that will be parsed as a CCTP event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
        ],
        err: null,
      },
    })

    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    // Use real Circle API values from the actual Solana CCTP transaction
    // https://explorer.solana.com/tx/3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY?cluster=devnet
    const expectedMessageHash = '0xcda5c1abd6640256fd2c837447c355fad6ed7fe6a32880076ad32e6f5821ed1a'
    const expectedAttestation =
      '0x6e70be5cacd093bca66e53837c51543d1829ee065dd6dfe085f3b706b16d56b80a01c3564a53f8864f1d4c1990298558ec45a93331d423d1bd8f964232d65fba1c0a65d1c09e05a1c059e7114c56a24dffbe155a86bc9a9377a20d4460be109d547df9a132d46ec632ae8976f6bfe6739bd25cb47a79bf0d77d6860d709aa62cf81b'

    // mock real attestation return
    mockedFetchJson.mockResolvedValueOnce({
      status: 'complete',
      attestation: expectedAttestation,
    })

    const mockRequest = {
      lane: {
        sourceChainSelector: SOLANA_DEVNET_SELECTOR,
        destChainSelector: EVM_TESTNET_SELECTOR,
      },
      message: {
        destinationChainSelector: EVM_TESTNET_SELECTOR,
      },
      log: { transactionHash: 'solana-tx-hash' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)

    // Decode and inspect the ABI-encoded result
    const decoded = defaultAbiCoder.decode(['tuple(bytes message, bytes attestation)'], result[0])

    // Verify the structure
    expect(decoded[0]).toHaveProperty('message')
    expect(decoded[0]).toHaveProperty('attestation')

    // The message should be the hex-encoded CCTP message from the mocked transaction
    expect(decoded[0].message).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(decoded[0].message.length).toBeGreaterThan(2) // More than just "0x"

    // Verify it's the actual message from the real Solana transaction
    const expectedMessageBytes = Buffer.from(
      'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
      'base64',
    )
    const expectedMessageHex = '0x' + expectedMessageBytes.toString('hex')
    expect(decoded[0].message).toBe(expectedMessageHex)

    // The attestation should be the real attestation from Circle API
    expect(decoded[0].attestation).toBe(expectedAttestation)

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })

    // Verify Circle API was called with the correct message hash
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${expectedMessageHash}`,
    )
  })

  it('should return default token data if no CCTP events are found', async () => {
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: Transfer',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          // No "Program data:" logs with CCTP events
        ],
        err: null,
      },
    })

    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: {},
      log: { transactionHash: 'solana-tx-hash-no-cctp' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual(['0x'])

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-no-cctp', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
  })

  it('should throw an error if more than one CCTP event is found', async () => {
    // Mock transaction with multiple CCTP events
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: Transfer',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          // First CCTP event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
          // Second CCTP event (duplicate for testing)
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
        ],
        err: null,
      },
    })

    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: {},
      log: { transactionHash: 'solana-tx-hash-multiple' },
    }

    await expect(fetchSolanaOffchainTokenData(mockRequest as any)).rejects.toThrow(
      'Expected only 1 CcipCctpMessageSentEvent, found 2 in transaction solana-tx-hash-multiple.',
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-multiple', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
  })

  it('should return default token data if attestation fetch fails', async () => {
    // Mock successful CCTP event parsing but failed attestation fetch
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [
          // Mock a program data log that will be parsed as a CCTP event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
        ],
        err: null,
      },
    })

    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Mock fetch to fail for this test
    mockedFetchJson.mockRejectedValueOnce(new Error('API is down'))

    const mockRequest = {
      lane: {
        sourceChainSelector: SOLANA_DEVNET_SELECTOR,
        destChainSelector: EVM_TESTNET_SELECTOR,
      },
      message: {
        destinationChainSelector: EVM_TESTNET_SELECTOR,
      },
      log: { transactionHash: 'solana-tx-hash-fail' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual(['0x'])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '❌ Solana CCTP: Failed to fetch attestation for solana-tx-hash-fail:',
      expect.any(Error),
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-fail', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })

    consoleWarnSpy.mockRestore()
  })

  it('should throw an error if transaction hash is missing', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: {},
      log: { transactionHash: undefined }, // Missing transaction hash
    }

    await expect(fetchSolanaOffchainTokenData(mockRequest as any)).rejects.toThrow(
      'Transaction hash not found for OffchainTokenData parsing',
    )

    // Verify that no Solana RPC call was made since the function should fail early
    expect(mockConnection.getTransaction).not.toHaveBeenCalled()
  })

  it('should handle Circle API returning incomplete status', async () => {
    // Mock successful CCTP event parsing but Circle API returns incomplete status
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [
          // Mock a program data log that will be parsed as a CCTP event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
        ],
        err: null,
      },
    })

    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Mock Circle API to return incomplete status (will cause getUsdcAttestation to throw)
    mockedFetchJson.mockResolvedValueOnce({
      status: 'incomplete',
    })

    const mockRequest = {
      lane: {
        sourceChainSelector: SOLANA_DEVNET_SELECTOR,
        destChainSelector: EVM_TESTNET_SELECTOR,
      },
      message: {
        destinationChainSelector: EVM_TESTNET_SELECTOR,
      },
      log: { transactionHash: 'solana-tx-hash-pending' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual(['0x'])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '❌ Solana CCTP: Failed to fetch attestation for solana-tx-hash-pending:',
      expect.any(Error),
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-pending', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })

    consoleWarnSpy.mockRestore()
  })
})

describe('parseCcipCctpEvents', () => {
  const SOLANA_DEVNET_SELECTOR = 16423721717087811551n

  const mockConnection = {
    getTransaction: jest.fn(),
  }

  const mockSolanaWeb3 = {
    Connection: jest.fn(() => mockConnection),
    PublicKey: jest.fn((bytes: any) => ({
      toString: () => bs58.encode(Buffer.from(bytes)),
    })),
  }

  // Real tx logs from https://explorer.solana.com/tx/3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY?cluster=devnet
  const realSolanaLogMessages = [
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
    'Program log: Instruction: ApproveChecked',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4456 of 400000 compute units',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
    'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P invoke [1]',
    'Program log: Instruction: CcipSend',
    'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [2]',
    'Program log: Instruction: VerifyNotCursed',
    'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 334355 compute units',
    'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
    'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P invoke [2]',
    'Program log: Instruction: GetFee',
    'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P consumed 42625 of 283953 compute units',
    'Program return: FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAARAAAAOgDAAAVAAAAGB3PEEANAwAAAAAAAAAAAAAAAAAAQA0DAAAAAAAAAAAAAAAAAAAA',
    'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P success',
    'Program 11111111111111111111111111111111 invoke [2]',
    'Program 11111111111111111111111111111111 success',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
    'Program log: Instruction: SyncNative',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 236593 compute units',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
    'Program log: Instruction: TransferChecked',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6290 of 229827 compute units',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
    'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj invoke [2]',
    'Program log: Instruction: LockOrBurnTokens',
    'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [3]',
    'Program log: Instruction: VerifyNotCursed',
    'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 141854 compute units',
    'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
    'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [3]',
    'Program log: Instruction: DepositForBurnWithCaller',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [4]',
    'Program log: Instruction: Burn',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4753 of 99677 compute units',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
    'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd invoke [4]',
    'Program log: Instruction: SendMessageWithCaller',
    'Program 11111111111111111111111111111111 invoke [5]',
    'Program 11111111111111111111111111111111 success',
    'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd consumed 16752 of 89165 compute units',
    'Program return: CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd u3IAAAAAAAA=',
    'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd success',
    'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [4]',
    'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 3632 of 68445 compute units',
    'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
    'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 61831 of 124597 compute units',
    'Program return: CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 u3IAAAAAAAA=',
    'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
    'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
    'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=',
    'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj consumed 147198 of 207001 compute units',
    'Program return: CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj IAAAAAAAAAAAAAAAAAAAABx9SxlssMewHXQ/vGEWqQI3nHI4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=',
    'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj success',
    'Program data: F01Jt3u5cznZGtnJT7pB3hAAAAAAAAAAo8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRHfN+OU4sfs49ka2clPukHeEAAAAAAAAAAKAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8QQA0DAAAAAAAAAAAAAAAAAAAGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAByuwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P consumed 341826 of 395544 compute units',
    'Program return: CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P o8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRE=',
    'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P success',
  ]

  const mockSolanaTransaction = {
    meta: {
      logMessages: realSolanaLogMessages,
      err: null,
    },
  }

  beforeAll(() => {
    jest.doMock('@solana/web3.js', () => mockSolanaWeb3)
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockConnection.getTransaction.mockResolvedValue(mockSolanaTransaction)
  })

  it('should successfully parse single CCTP event from real Solana transaction', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const result = await parseCcipCctpEvents(
      '3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY',
      SOLANA_DEVNET_SELECTOR,
    )

    expect(result).toHaveLength(1) // Should find exactly 1 CCTP event
    expect(result[0]).toMatchObject({
      remoteChainSelector: 16015286601757825753n,
      msgTotalNonce: 10n,
      cctpNonce: 29371n,
      originalSender: 'AdCPLpAoBYtbpRJaDDm6MFrLCykKpYUXNJ2tkoPv1X1P',
      eventAddress: 'C68qsUiKJyGD3SxWjN6pSkH9jwVJfrDvQDaGeGBzPueG',
      messageSentBytes: Buffer.from(
        'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
        'base64',
      ),
    })

    // Verify RPC call
    expect(mockConnection.getTransaction).toHaveBeenCalledWith(
      '3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY',
      {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      },
    )
  })

  it('should throw an error when transaction not found', async () => {
    mockConnection.getTransaction.mockResolvedValueOnce(null)
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    await expect(
      parseCcipCctpEvents('invalid-tx-signature', SOLANA_DEVNET_SELECTOR),
    ).rejects.toThrow('Transaction not found: invalid-tx-signature')
  })

  it('should return empty array when no program data logs found', async () => {
    const transactionWithoutProgramData = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: Transfer',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          // No "Program data:" logs
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithoutProgramData)
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const result = await parseCcipCctpEvents('tx-without-program-data', SOLANA_DEVNET_SELECTOR)
    expect(result).toEqual([])
  })

  it('should return empty array when no CCTP events found', async () => {
    const transactionWithoutCCTP = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=', // Non-CCTP event
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithoutCCTP)
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const result = await parseCcipCctpEvents('tx-without-cctp', SOLANA_DEVNET_SELECTOR)
    expect(result).toEqual([])
  })

  it('should handle multiple CCTP events', async () => {
    const transactionWithMultipleCCTP = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          ...realSolanaLogMessages,
          // Add another CCTP event (duplicate original one for testing purposes)
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithMultipleCCTP)
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const result = await parseCcipCctpEvents('tx-with-multiple-cctp', SOLANA_DEVNET_SELECTOR)
    expect(result).toHaveLength(2) // Should find same CCTP event two times

    const expectedCctpEvent = {
      remoteChainSelector: 16015286601757825753n,
      msgTotalNonce: 10n,
      cctpNonce: 29371n,
      originalSender: 'AdCPLpAoBYtbpRJaDDm6MFrLCykKpYUXNJ2tkoPv1X1P',
      eventAddress: 'C68qsUiKJyGD3SxWjN6pSkH9jwVJfrDvQDaGeGBzPueG',
      messageSentBytes: Buffer.from(
        'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
        'base64',
      ),
    }

    // Assert that both found events match the expected object
    expect(result[0]).toMatchObject(expectedCctpEvent)
    expect(result[1]).toMatchObject(expectedCctpEvent)
  })

  it('should handle malformed data gracefully', async () => {
    const transactionWithMalformedData = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          // This will fail Base64 decoding
          'Program data: invalid_base64_data!!!',
          // This is valid Base64 but not a CCTP event (wrong discriminator)
          'Program data: AQIDBAUGBwgJCg==',
          // This is 4 bytes, less than 8 needed for discriminator
          'Program data: VGVzdA==',
          // This is the actual, valid CCTP event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithMalformedData)
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const result = await parseCcipCctpEvents('tx-with-malformed-data', SOLANA_DEVNET_SELECTOR)

    // It should successfully parse the one valid event and skipped invalid ones silently.
    expect(result).toHaveLength(1)
  })

  it('should handle transaction with no meta', async () => {
    const transactionWithoutMeta = {
      meta: null,
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithoutMeta)
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    await expect(parseCcipCctpEvents('tx-without-meta', SOLANA_DEVNET_SELECTOR)).rejects.toThrow(
      'Transaction not found: tx-without-meta',
    )
  })
})

describe('getUsdcAttestation', () => {
  const mockedFetchJson = jest.fn()
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))

  beforeAll(() => {
    global.fetch = mockedFetch as any
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    global.fetch = origFetch
  })

  it('should call the mainnet Circle API when isTestnet is false', async () => {
    const { getUsdcAttestation } = await import('./offchain.ts')
    const messageHex = '0x123456'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabc' }
    mockedFetchJson.mockResolvedValue(completeResponse)

    await getUsdcAttestation(messageHex, false)
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api.circle.com/v1/attestations/${msgHash}`,
    )
  })

  it('should call the testnet Circle API when isTestnet is true', async () => {
    const { getUsdcAttestation } = await import('./offchain.ts')
    const messageHex = '0x123456'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabc' }
    mockedFetchJson.mockResolvedValue(completeResponse)

    await getUsdcAttestation(messageHex, true)
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${msgHash}`,
    )
  })

  it('should correctly fetch complete attestation for a real Solana CCTP message', async () => {
    const { getUsdcAttestation } = await import('./offchain.ts')

    // Use MessageSent data from real tx logs https://explorer.solana.com/tx/3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY?cluster=devnet
    const messageBytes = Buffer.from(
      'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
      'base64',
    )
    const messageHex = '0x' + messageBytes.toString('hex')
    const expectedMessageHash = '0xcda5c1abd6640256fd2c837447c355fad6ed7fe6a32880076ad32e6f5821ed1a'
    const expectedAttestation =
      '0x6e70be5cacd093bca66e53837c51543d1829ee065dd6dfe085f3b706b16d56b80a01c3564a53f8864f1d4c1990298558ec45a93331d423d1bd8f964232d65fba1c0a65d1c09e05a1c059e7114c56a24dffbe155a86bc9a9377a20d4460be109d547df9a132d46ec632ae8976f6bfe6739bd25cb47a79bf0d77d6860d709aa62cf81b'

    mockedFetchJson.mockResolvedValue({
      status: 'complete',
      attestation: expectedAttestation,
    })

    // Call the function with isTestnet = true for the sandbox URL
    // Verify the correct URL was called and the correct attestation was returned
    const result = await getUsdcAttestation(messageHex, true)
    expect(keccak256(messageHex)).toBe(expectedMessageHash)
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${expectedMessageHash}`,
    )
    expect(result).toBe(expectedAttestation)
  })

  it('should throw an error if the Circle API response for a Solana CCTP message is not "complete"', async () => {
    const { getUsdcAttestation } = await import('./offchain.ts')
    const messageBytes = Buffer.from(
      'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
      'base64',
    )
    const messageHex = '0x' + messageBytes.toString('hex')
    const pendingResponse = { status: 'not_complete', attestation: null }
    mockedFetchJson.mockResolvedValue(pendingResponse)

    await expect(getUsdcAttestation(messageHex, true)).rejects.toThrow(
      'Could not fetch USDC attestation. Response: ' + JSON.stringify(pendingResponse, null, 2),
    )
  })
})

describe('encodeOffchainTokenData', () => {
  const EVM_TESTNET_SELECTOR = 16015286601757825753n // Ethereum Sepolia
  const SOLANA_DEVNET_SELECTOR = 16423721717087811551n // Solana Devnet

  const mockMessage = '0x000000000000000000050000000000000000000072bba65fc943419a5ad59004'
  const mockAttestation = '0x6e70be5cacd093bca66e53837c51543d1829ee065dd6dfe085f3b706b16d56b8'

  it('should use ABI encoding for EVM destinations', async () => {
    const { encodeOffchainTokenData } = await import('./offchain.ts')

    const result = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, mockMessage, mockAttestation)

    // Should return ABI-encoded tuple
    expect(result).toMatch(/^0x[0-9a-fA-F]+$/)

    // Decode and verify structure
    const decoded = defaultAbiCoder.decode(['tuple(bytes message, bytes attestation)'], result)

    expect(decoded[0]).toHaveProperty('message', mockMessage)
    expect(decoded[0]).toHaveProperty('attestation', mockAttestation)
  })

  it('should use Borsh encoding for Solana destinations', async () => {
    const { encodeOffchainTokenData } = await import('./offchain.ts')

    const result = encodeOffchainTokenData(SOLANA_DEVNET_SELECTOR, mockMessage, mockAttestation)

    // Should return hex string
    expect(result).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(result.length).toBeGreaterThan(2) // More than just "0x"

    // Test that it's different from ABI encoding (same inputs, different outputs)
    const evmResult = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, mockMessage, mockAttestation)
    expect(result).not.toBe(evmResult)

    // Verify the result is valid Borsh-encoded data by attempting to decode it
    const { deserialize } = await import('borsh')
    const resultBuffer = Buffer.from(result.slice(2), 'hex')

    // Define the same schema used in encoding
    const schema = {
      struct: {
        message: {
          struct: {
            data: { array: { type: 'u8' } },
          },
        },
        attestation: { array: { type: 'u8' } },
      },
    }

    // Should be able to deserialize without throwing
    const decoded = deserialize(schema, resultBuffer)

    // Check that decoded is not null
    expect(decoded).not.toBeNull()
    expect(decoded).toBeDefined()

    // Type assertion to tell TypeScript about the structure
    const typedDecoded = decoded as {
      message: { data: number[] }
      attestation: number[]
    }

    // Verify the decoded data matches our input
    const expectedMessageArray = Array.from(Buffer.from(mockMessage.slice(2), 'hex'))
    const expectedAttestationArray = Array.from(Buffer.from(mockAttestation.slice(2), 'hex'))
    expect(typedDecoded.message.data).toEqual(expectedMessageArray)
    expect(typedDecoded.attestation).toEqual(expectedAttestationArray)
  })

  it('should handle empty message and attestation for EVM', async () => {
    const { encodeOffchainTokenData } = await import('./offchain.ts')

    const result = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, '0x', '0x')

    const decoded = defaultAbiCoder.decode(['tuple(bytes message, bytes attestation)'], result)

    expect(decoded[0].message).toBe('0x')
    expect(decoded[0].attestation).toBe('0x')
  })

  it('should handle empty message and attestation for Solana', async () => {
    const { encodeOffchainTokenData } = await import('./offchain.ts')

    const result = encodeOffchainTokenData(SOLANA_DEVNET_SELECTOR, '0x', '0x')

    // Should return hex string
    expect(result).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(result.length).toBeGreaterThan(2) // More than just "0x"

    // Test that it's different from ABI encoding
    const evmResult = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, '0x', '0x')
    expect(result).not.toBe(evmResult)

    // Verify it can be decoded back with real Borsh
    const { deserialize } = await import('borsh')
    const resultBuffer = Buffer.from(result.slice(2), 'hex')

    const schema = {
      struct: {
        message: {
          struct: {
            data: { array: { type: 'u8' } },
          },
        },
        attestation: { array: { type: 'u8' } },
      },
    }

    const decoded = deserialize(schema, resultBuffer)
    expect(decoded).not.toBeNull()
    expect(decoded).toBeDefined()

    const typedDecoded = decoded as {
      message: { data: number[] }
      attestation: number[]
    }

    // Should decode to empty arrays
    expect(typedDecoded.message.data).toEqual([])
    expect(typedDecoded.attestation).toEqual([])
  })

  it('should throw error for invalid hex strings', async () => {
    const { encodeOffchainTokenData } = await import('./offchain.ts')
    // Test invalid hex for EVM destination
    expect(() => {
      encodeOffchainTokenData(EVM_TESTNET_SELECTOR, '0xZZZ', '0x123')
    }).toThrow()

    expect(() => {
      encodeOffchainTokenData(SOLANA_DEVNET_SELECTOR, '0x123', '0xZZZ')
    }).toThrow()
  })
})
