import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { CCIPAPIClient, DEFAULT_API_BASE_URL } from './index.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPArgumentInvalidError,
  CCIPHttpError,
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageIdValidationError,
  CCIPMessageNotFoundInTxError,
  CCIPUnexpectedPaginationError,
  HttpStatus,
} from '../errors/index.ts'
import { EVMChain } from '../evm/index.ts'
import { decodeMessage } from '../requests.ts'
import { CCIPVersion } from '../types.ts'

const origFetch = globalThis.fetch

describe('CCIPAPIClient', () => {
  const mockResponse = {
    lane: {
      sourceNetworkInfo: {
        name: 'ethereum-mainnet',
        chainSelector: '5009297550715157269',
        chainId: '1',
        chainFamily: 'evm',
      },
      destNetworkInfo: {
        name: 'arbitrum-mainnet',
        chainSelector: '4949039107694359620',
        chainId: '42161',
        chainFamily: 'evm',
      },
      routerAddress: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
    },
    totalMs: 1147000,
  }

  const mockedFetchJson = mock.fn(() => Promise.resolve(mockResponse))
  const mockedFetch = mock.fn(() => Promise.resolve({ ok: true, json: mockedFetchJson }))

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetchJson.mock.resetCalls()
    globalThis.fetch = mockedFetch as any
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    mockedFetch.mock.restore()
    mockedFetchJson.mock.restore()
  })

  describe('constructor', () => {
    it('should use default base URL', () => {
      const client = new CCIPAPIClient()
      assert.equal(client.baseUrl, DEFAULT_API_BASE_URL)
    })

    it('should use custom base URL', () => {
      const client = new CCIPAPIClient('https://custom.api/')
      assert.equal(client.baseUrl, 'https://custom.api/')
    })

    it('should use provided fetch function', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })

      await client.getLaneLatency(1n, 2n)
      assert.equal(customFetch.mock.calls.length, 1)
    })

    it('should use provided logger', () => {
      const customLogger = { log: mock.fn(), debug: mock.fn() }
      const client = new CCIPAPIClient(undefined, { logger: customLogger as any })

      assert.equal(client.logger, customLogger)
    })
  })

  describe('fromUrl', () => {
    it('should create client instance', async () => {
      const client = await CCIPAPIClient.fromUrl()
      assert.ok(client instanceof CCIPAPIClient)
    })

    it('should create client with custom URL', async () => {
      const client = await CCIPAPIClient.fromUrl('https://custom.api/')
      assert.equal(client.baseUrl, 'https://custom.api/')
    })
  })

  describe('getLaneLatency', () => {
    it('should fetch with correct URL parameters', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneLatency(5009297550715157269n, 4949039107694359620n)

      assert.equal(mockedFetch.mock.calls.length, 1)
      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
      assert.ok(url.includes('destChainSelector=4949039107694359620'))
    })

    it('should use correct base URL in request', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneLatency(1n, 2n)

      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.startsWith(DEFAULT_API_BASE_URL))
      assert.ok(url.includes('/v1/lanes/latency'))
    })

    it('should return only totalMs', async () => {
      const client = new CCIPAPIClient()
      const result = await client.getLaneLatency(1n, 2n)

      assert.deepEqual(Object.keys(result), ['totalMs'])
      assert.equal(result.totalMs, 1147000)
    })

    it('should log raw response via debug', async () => {
      const debugFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        logger: { log: () => {}, debug: debugFn } as any,
      })

      await client.getLaneLatency(1n, 2n)

      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'getLaneLatency raw response:')
      assert.ok(lastCall.arguments[1]) // Raw response object
    })

    it('should throw CCIPLaneNotFoundError on NOT_FOUND', async () => {
      const errorResponse = { error: 'NOT_FOUND', message: 'Lane not found' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneLatency(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPLaneNotFoundError &&
          err.context.sourceChainSelector === 1n &&
          err.context.destChainSelector === 2n &&
          err.recovery?.includes('CCIP Directory'),
      )
    })

    it('should throw CCIPHttpError on non-ok response (non-404)', async () => {
      const errorResponse = { error: 'BAD_REQUEST', message: 'Invalid parameters' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.BAD_REQUEST,
          statusText: 'Bad Request',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneLatency(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPHttpError && err.context.status === HttpStatus.BAD_REQUEST,
      )
    })

    it('should throw transient error on 5xx', async () => {
      const errorResponse = { error: 'INTERNAL_SERVER_ERROR', message: 'Internal error' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneLatency(1n, 2n),
        (err: unknown) => err instanceof CCIPHttpError && err.isTransient === true,
      )
    })

    it('should include API error details in CCIPLaneNotFoundError', async () => {
      const errorResponse = {
        error: 'LANE_NOT_FOUND',
        message: 'Lane not found for the given chain selectors',
      }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneLatency(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPLaneNotFoundError &&
          err.context.apiErrorCode === 'LANE_NOT_FOUND' &&
          err.context.apiErrorMessage === 'Lane not found for the given chain selectors',
      )
    })

    it('should handle non-JSON error responses gracefully', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.SERVICE_UNAVAILABLE,
          statusText: 'Service Unavailable',
          json: () => Promise.reject(new Error('Not JSON')),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneLatency(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPHttpError &&
          err.context.status === HttpStatus.SERVICE_UNAVAILABLE &&
          err.context.apiErrorCode === undefined,
      )
    })

    it('should include INVALID_PARAMETERS error details', async () => {
      const errorResponse = {
        error: 'INVALID_PARAMETERS',
        message: 'Invalid chain selector format',
      }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.BAD_REQUEST,
          statusText: 'Bad Request',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneLatency(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPHttpError &&
          err.context.status === HttpStatus.BAD_REQUEST &&
          err.context.apiErrorCode === 'INVALID_PARAMETERS',
      )
    })
  })

  describe('getMessageById', () => {
    const mockMessageResponse = {
      messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      sender: '0x742d35Cc6634C0532925a3b8D5c8C22C5B2D8a3E',
      receiver: '0x893F0bCaa7F325c2b6bBd2133536f4e4b8fea88e',
      status: 'SUCCESS',
      sourceNetworkInfo: {
        name: 'ethereum-mainnet',
        chainSelector: '5009297550715157269',
        chainId: '1',
        chainFamily: 'EVM',
      },
      destNetworkInfo: {
        name: 'arbitrum-mainnet',
        chainSelector: '4949039107694359620',
        chainId: '42161',
        chainFamily: 'EVM',
      },
      sendTransactionHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      sendTimestamp: '2023-12-01T10:30:00Z',
      tokenAmounts: [
        { tokenAddress: '0xA0b86a8B5b6E8e0A09C4c3Dc7dE6e69e1e2d3f4a', amount: '1000000' },
      ],
      extraArgs: { gasLimit: '400000', allowOutOfOrderExecution: false },
      readyForManualExecution: false,
      finality: 0,
      fees: { tokenAddress: '0xFeeTokenAddress', totalAmount: '5000000' },
      version: '1.6.0',
      onramp: '0x1234567890abcdef1234567890abcdef12345678',
      origin: '0x742d35Cc6634C0532925a3b8D5c8C22C5B2D8a3E',
      sequenceNumber: '67890',
      nonce: '12345',
      receiptTransactionHash: '0xReceipt1234567890abcdef1234567890abcdef1234567890abcdef12345678',
      receiptTimestamp: '2023-12-01T10:45:00Z',
      deliveryTime: 900000,
      data: '0xabcdef',
    }

    it('should fetch message by ID with correct URL', async () => {
      const messageId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessageResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.getMessageById(messageId)

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('/v1/messages/'))
      assert.ok(url.includes(messageId))
    })

    it('should return APICCIPRequest with parsed fields', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessageResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // Lane
      assert.equal(result.lane.sourceChainSelector, 5009297550715157269n)
      assert.equal(result.lane.destChainSelector, 4949039107694359620n)
      assert.equal(result.lane.version, CCIPVersion.V1_6)
      assert.equal(result.lane.onRamp, mockMessageResponse.onramp)

      // Message
      assert.equal(result.message.messageId, mockMessageResponse.messageId)
      assert.equal(result.message.sender, mockMessageResponse.sender)
      assert.equal(result.message.sequenceNumber, 67890n)
      assert.equal(result.message.nonce, 12345n)

      // TX
      assert.equal(result.tx.hash, mockMessageResponse.sendTransactionHash)
      assert.equal(result.tx.timestamp, 1701426600) // Unix timestamp for 2023-12-01T10:30:00Z
      assert.equal(result.tx.from, mockMessageResponse.origin)

      // Log
      assert.equal(result.log.transactionHash, mockMessageResponse.sendTransactionHash)
      assert.equal(result.log.address, mockMessageResponse.onramp)

      // Status and extras
      assert.equal(result.status, 'SUCCESS')
      assert.equal(result.readyForManualExecution, false)
      assert.equal(result.deliveryTime, 900000)
      assert.equal(result.finality, 0)

      // Network info - uses SDK's networkInfo() which has canonical names
      assert.equal(result.sourceNetworkInfo.name, 'ethereum-mainnet')
      assert.equal(result.sourceNetworkInfo.chainSelector, 5009297550715157269n)
      assert.equal(result.destNetworkInfo.name, 'ethereum-mainnet-arbitrum-1')
    })

    it('should throw CCIPMessageIdNotFoundError on 404', async () => {
      const errorResponse = { error: 'NOT_FOUND', message: 'Message not found' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () =>
          await client.getMessageById(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          ),
        (err: unknown) =>
          err instanceof CCIPMessageIdNotFoundError &&
          err.context.messageId ===
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' &&
          err.isTransient === true,
      )
    })

    it('should throw CCIPMessageIdValidationError on invalid format', async () => {
      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getMessageById('invalid'),
        (err: unknown) =>
          err instanceof CCIPMessageIdValidationError &&
          err.message.includes('Invalid messageId format'),
      )
    })

    it('should handle missing optional fields gracefully', async () => {
      const minimalResponse = {
        messageId: '0x1234...',
        sender: '0x742d...',
        receiver: '0x893F...',
        status: 'SENT',
        sourceNetworkInfo: {
          name: 'ethereum-mainnet',
          chainSelector: '5009297550715157269',
          chainId: '1',
          chainFamily: 'EVM',
        },
        destNetworkInfo: {
          name: 'arbitrum-mainnet',
          chainSelector: '4949039107694359620',
          chainId: '42161',
          chainFamily: 'EVM',
        },
        sendTransactionHash: '0x9428...',
        sendTimestamp: '2023-12-01T10:30:00Z',
        tokenAmounts: [],
        extraArgs: { gasLimit: '200000', allowOutOfOrderExecution: false },
        readyForManualExecution: false,
        finality: 0,
        fees: {},
        // No optional fields: version, onramp, nonce, sequenceNumber, etc.
      }

      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(minimalResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // Should use defaults for missing fields
      assert.equal(result.lane.version, CCIPVersion.V1_6) // Default
      assert.equal(result.lane.onRamp, '')
      assert.equal(result.message.sequenceNumber, 0n)
      assert.equal(result.message.nonce, 0n)
      assert.equal(result.receiptTransactionHash, undefined)
    })

    it('should parse version string to CCIPVersion enum', async () => {
      for (const [versionStr, expected] of [
        ['1.2.0', CCIPVersion.V1_2],
        ['1.5.0', CCIPVersion.V1_5],
        ['1.6.0', CCIPVersion.V1_6],
        ['1.2.0-dev', CCIPVersion.V1_2],
        ['1.5.0-dev', CCIPVersion.V1_5],
        ['1.6.0-dev', CCIPVersion.V1_6],
      ] as const) {
        const response = { ...mockMessageResponse, version: versionStr }
        const customFetch = mock.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve(response),
          }),
        )
        const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
        const result = await client.getMessageById(
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        )

        assert.equal(result.lane.version, expected)
      }
    })

    it('should handle unknown version gracefully', async () => {
      const response = { ...mockMessageResponse, version: '2.0.0' }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // Unknown version defaults to V1_6
      assert.equal(result.lane.version, CCIPVersion.V1_6)
    })

    it('should be transient error for 5xx', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ error: 'INTERNAL_SERVER_ERROR', message: 'Error' }),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () =>
          await client.getMessageById(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          ),
        (err: unknown) => err instanceof CCIPHttpError && err.isTransient === true,
      )
    })

    it('should log raw response via debug', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessageResponse),
        }),
      )
      const debugFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        logger: { log: () => {}, debug: debugFn } as any,
        fetch: customFetch as any,
      })

      await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'getMessageById raw response:')
      assert.ok(lastCall.arguments[1])
    })

    it('should parse EVM extraArgs correctly', async () => {
      const response = {
        ...mockMessageResponse,
        extraArgs: { gasLimit: '500000', allowOutOfOrderExecution: true },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // ExtraArgs fields are spread onto message
      const msg = result.message as Record<string, unknown>
      assert.ok(!('computeUnits' in msg))
      assert.ok('gasLimit' in msg)
      assert.equal(msg.gasLimit, 500000n)
      assert.equal(msg.allowOutOfOrderExecution, true)
    })

    it('should parse SVM extraArgs correctly', async () => {
      const response = {
        ...mockMessageResponse,
        extraArgs: {
          computeUnits: 200000,
          accountIsWritableBitmap: '255',
          allowOutOfOrderExecution: false,
          tokenReceiver: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          accounts: ['Account1', 'Account2'],
        },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // SVM extraArgs fields are spread onto message
      const msg = result.message as Record<string, unknown>
      assert.ok('computeUnits' in msg)
      assert.equal(msg.computeUnits, 200000n)
      assert.equal(msg.accountIsWritableBitmap, 255n)
      assert.equal(msg.allowOutOfOrderExecution, false)
      assert.equal(msg.tokenReceiver, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      assert.deepEqual(msg.accounts, ['Account1', 'Account2'])
    })

    it('should parse tokenAmounts correctly', async () => {
      const response = {
        ...mockMessageResponse,
        tokenAmounts: [
          { tokenAddress: '0xToken1', amount: '1000000000000000000' },
          { tokenAddress: '0xToken2', amount: '2500000' },
        ],
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // tokenAmounts is on message with SourceTokenData fields
      const msg = result.message as unknown as {
        tokenAmounts: {
          token: string
          amount: bigint
          sourcePoolAddress: string
          destTokenAddress: string
          extraData: string
          destGasAmount: bigint
        }[]
      }
      assert.equal(msg.tokenAmounts.length, 2)
      assert.equal(msg.tokenAmounts[0]!.token, '0xToken1')
      assert.equal(msg.tokenAmounts[0]!.amount, 1000000000000000000n)
      // SourceTokenData placeholder fields (zero address since API doesn't provide pool data)
      assert.equal(
        msg.tokenAmounts[0]!.sourcePoolAddress,
        '0x0000000000000000000000000000000000000000',
      )
      assert.equal(
        msg.tokenAmounts[0]!.destTokenAddress,
        '0x0000000000000000000000000000000000000000',
      )
      assert.equal(msg.tokenAmounts[0]!.extraData, '0x')
      assert.equal(msg.tokenAmounts[0]!.destGasAmount, 0n)
      assert.equal(msg.tokenAmounts[1]!.token, '0xToken2')
      assert.equal(msg.tokenAmounts[1]!.amount, 2500000n)
    })

    it('should handle empty tokenAmounts', async () => {
      const response = {
        ...mockMessageResponse,
        tokenAmounts: [],
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // tokenAmounts is on message
      const msg = result.message as unknown as { tokenAmounts: { token: string; amount: bigint }[] }
      assert.equal(msg.tokenAmounts.length, 0)
    })

    it('should produce a message that passes decodeMessage validation', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessageResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // The message should have sourceChainSelector which decodeMessage requires
      const message = result.message as unknown as Record<string, unknown>

      // Validate: decodeMessage should be able to process the message
      // decodeMessage expects sourceChainSelector in the message for JSON objects
      const decoded = decodeMessage(message)

      // Assert key fields match
      assert.equal(decoded.messageId, result.message.messageId)
      assert.equal(decoded.sourceChainSelector, result.lane.sourceChainSelector)
      assert.equal(decoded.sender, result.message.sender)
      // Addresses may be checksummed differently after decoding, compare case-insensitively
      assert.equal(decoded.receiver.toLowerCase(), result.message.receiver.toLowerCase())
    })
  })

  describe('getMessageIdsFromTransaction', () => {
    const mockMessagesResponse = {
      data: [
        {
          messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          sender: '0x742d35Cc6634C0532925a3b8D5c8C22C5B2D8a3E',
          receiver: '0x893F0bCaa7F325c2b6bBd2133536f4e4b8fea88e',
          status: 'SUCCESS',
          sourceNetworkInfo: {
            name: 'ethereum-mainnet',
            chainSelector: '5009297550715157269',
            chainId: '1',
            chainFamily: 'EVM',
          },
          destNetworkInfo: {
            name: 'arbitrum-mainnet',
            chainSelector: '4949039107694359620',
            chainId: '42161',
            chainFamily: 'EVM',
          },
          sendTransactionHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
          sendTimestamp: '2023-12-01T10:30:00Z',
        },
      ],
      pagination: {
        limit: 100,
        hasNextPage: false,
        cursor: null,
      },
    }

    it('should fetch messages by transaction hash with correct URL', async () => {
      const txHash = '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12'
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessagesResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.getMessageIdsFromTransaction(txHash)

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('/v1/messages'))
      assert.ok(url.includes(`sourceTransactionHash=${encodeURIComponent(txHash)}`))
      assert.ok(url.includes('limit=100'))
    })

    it('should return array of messageIds for single message', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessagesResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageIdsFromTransaction(
        '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      )

      assert.deepEqual(result, [
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      ])
    })

    it('should return array of messageIds for multiple messages', async () => {
      const multiMessageResponse = {
        data: [
          { ...mockMessagesResponse.data[0] },
          {
            ...mockMessagesResponse.data[0],
            messageId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          },
          {
            ...mockMessagesResponse.data[0],
            messageId: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
          },
        ],
        pagination: { limit: 100, hasNextPage: false, cursor: null },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(multiMessageResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageIdsFromTransaction(
        '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      )

      assert.equal(result.length, 3)
      assert.deepEqual(result, [
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      ])
    })

    it('should throw CCIPMessageNotFoundInTxError on empty response', async () => {
      const emptyResponse = { data: [], pagination: { limit: 100, hasNextPage: false } }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(emptyResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const txHash = '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12'

      await assert.rejects(
        async () => await client.getMessageIdsFromTransaction(txHash),
        (err: unknown) =>
          err instanceof CCIPMessageNotFoundInTxError &&
          err.context.txHash === txHash &&
          err.isTransient === true,
      )
    })

    it('should throw CCIPMessageNotFoundInTxError on 404', async () => {
      const errorResponse = { error: 'NOT_FOUND', message: 'No messages found' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          json: () => Promise.resolve(errorResponse),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      const txHash = '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12'

      await assert.rejects(
        async () => await client.getMessageIdsFromTransaction(txHash),
        (err: unknown) =>
          err instanceof CCIPMessageNotFoundInTxError &&
          err.context.txHash === txHash &&
          err.context.apiErrorCode === 'NOT_FOUND',
      )
    })

    it('should throw CCIPArgumentInvalidError on invalid EVM txHash format', async () => {
      const client = new CCIPAPIClient()

      // Missing 0x prefix
      await assert.rejects(
        async () => await client.getMessageIdsFromTransaction('1234567890abcdef'),
        (err: unknown) =>
          err instanceof CCIPArgumentInvalidError &&
          err.message.includes('Invalid argument "txHash"'),
      )

      // Invalid characters
      await assert.rejects(
        async () => await client.getMessageIdsFromTransaction('0xGGGG'),
        (err: unknown) => err instanceof CCIPArgumentInvalidError,
      )
    })

    it('should accept valid Solana Base58 transaction hash', async () => {
      // Valid Solana signature (Base58 encoded, 88 characters)
      const solanaTxHash =
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessagesResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageIdsFromTransaction(solanaTxHash)

      assert.equal(result.length, 1)
      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes(encodeURIComponent(solanaTxHash)))
    })

    it('should throw CCIPHttpError on 5xx with transient flag', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ error: 'INTERNAL_SERVER_ERROR', message: 'Error' }),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () =>
          await client.getMessageIdsFromTransaction(
            '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
          ),
        (err: unknown) => err instanceof CCIPHttpError && err.isTransient === true,
      )
    })

    it('should log raw response via debug', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMessagesResponse),
        }),
      )
      const debugFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        logger: { log: () => {}, debug: debugFn } as any,
        fetch: customFetch as any,
      })

      await client.getMessageIdsFromTransaction(
        '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      )

      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'getMessageIdsFromTransaction raw response:')
      assert.ok(lastCall.arguments[1])
    })

    it('should throw CCIPUnexpectedPaginationError when hasNextPage is true', async () => {
      const paginatedResponse = {
        data: Array(100)
          .fill(null)
          .map((_, i) => ({
            ...mockMessagesResponse.data[0],
            messageId: `0x${i.toString(16).padStart(64, '0')}`,
          })),
        pagination: { limit: 100, hasNextPage: true, cursor: 'next-page-cursor' },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(paginatedResponse),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const txHash = '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12'

      await assert.rejects(
        async () => await client.getMessageIdsFromTransaction(txHash),
        (err: unknown) =>
          err instanceof CCIPUnexpectedPaginationError &&
          err.context.txHash === txHash &&
          err.context.messageCount === 100,
      )
    })
  })
})

describe('Chain with apiClient: null', () => {
  it('should throw CCIPApiClientNotAvailableError when getLaneLatency is called', async () => {
    // Create a minimal mock provider
    const mockProvider = {
      getBlock: mock.fn(() => Promise.resolve({ timestamp: 1234567890 })),
      destroy: mock.fn(),
    } as any

    // Network info for ethereum-mainnet
    const network = {
      chainId: 1,
      chainSelector: 5009297550715157269n,
      name: 'ethereum-mainnet',
      family: 'evm' as const,
      isTestnet: false,
    }

    // Create EVMChain with apiClient: null (decentralized mode)
    const chain = new EVMChain(mockProvider, network, { apiClient: null })

    // Verify apiClient is null
    assert.equal(chain.apiClient, null)

    // Call getLaneLatency should throw CCIPApiClientNotAvailableError
    await assert.rejects(
      async () => await chain.getLaneLatency(4949039107694359620n),
      (err: unknown) => {
        assert.ok(err instanceof CCIPApiClientNotAvailableError)
        assert.equal(err.name, 'CCIPApiClientNotAvailableError')
        assert.equal(err.isTransient, false)
        assert.ok(err.recovery?.includes('API'))
        return true
      },
    )
  })
})
