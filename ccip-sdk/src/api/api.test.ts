import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import '../index.ts'
import { getAddress } from 'ethers'

import { CCIPAPIClient, DEFAULT_API_BASE_URL } from './index.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPHttpError,
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageNotFoundInTxError,
  CCIPUnexpectedPaginationError,
  HttpStatus,
} from '../errors/index.ts'
import { EVMChain } from '../evm/index.ts'
import { decodeMessage } from '../requests.ts'
import { CCIPVersion, ChainFamily, NetworkType } from '../types.ts'
import { bigIntReplacer, networkInfo } from '../utils.ts'

const origFetch = globalThis.fetch

describe('CCIPAPIClient', () => {
  const mockResponse = {
    lane: {
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
      routerAddress: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
    },
    totalMs: 1147000,
  }

  const mockedFetchJson = mock.fn(() => Promise.resolve(mockResponse))
  const mockedFetchText = mock.fn(() => Promise.resolve(JSON.stringify(mockResponse)))
  const mockedFetch = mock.fn(() =>
    Promise.resolve({ ok: true, json: mockedFetchJson, text: mockedFetchText }),
  )

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetchJson.mock.resetCalls()
    mockedFetchText.mock.resetCalls()
    globalThis.fetch = mockedFetch as any
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    mockedFetch.mock.restore()
    mockedFetchJson.mock.restore()
    mockedFetchText.mock.restore()
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
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        }),
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
      assert.ok(url.includes('/v2/lanes/latency'))
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
        logger: { log: () => {}, debug: debugFn, warn: () => {} } as any,
      })

      await client.getLaneLatency(1n, 2n)

      // getLaneLatency delegates to getLaneInfo, so logs come from getLaneInfo
      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'getLaneInfo raw response:')
      assert.ok(lastCall.arguments[1]) // Raw response object
    })

    it('should throw CCIPLaneNotFoundError on NOT_FOUND', async () => {
      const errorResponse = { error: 'NOT_FOUND', message: 'Lane not found' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
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
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
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
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
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
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
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
          text: () => Promise.resolve('Not JSON'),
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
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
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

  describe('getLaneInfo', () => {
    it('should fetch with correct URL parameters', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneInfo(5009297550715157269n, 4949039107694359620n)

      assert.equal(mockedFetch.mock.calls.length, 1)
      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
      assert.ok(url.includes('destChainSelector=4949039107694359620'))
    })

    it('should use correct base URL in request', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneInfo(1n, 2n)

      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.startsWith(DEFAULT_API_BASE_URL))
      assert.ok(url.includes('/v2/lanes/latency'))
    })

    it('should return full lane info including routerAddress', async () => {
      const client = new CCIPAPIClient()
      const result = await client.getLaneInfo(5009297550715157269n, 4949039107694359620n)

      assert.equal(result.sourceChainSelector, 5009297550715157269n)
      assert.equal(result.destChainSelector, 4949039107694359620n)
      assert.equal(result.routerAddress, '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D')
      assert.equal(result.totalMs, 1147000)
      assert.equal(result.sourceNetworkInfo.name, 'ethereum-mainnet')
      assert.equal(result.destNetworkInfo.name, 'arbitrum-mainnet')
    })

    it('should log raw response via debug', async () => {
      const debugFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        logger: { log: () => {}, debug: debugFn, warn: () => {} } as any,
      })

      await client.getLaneInfo(1n, 2n)

      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'getLaneInfo raw response:')
      assert.ok(lastCall.arguments[1])
    })

    it('should throw CCIPLaneNotFoundError on NOT_FOUND', async () => {
      const errorResponse = { error: 'NOT_FOUND', message: 'Lane not found' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneInfo(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPLaneNotFoundError &&
          err.context.sourceChainSelector === 1n &&
          err.context.destChainSelector === 2n,
      )
    })

    it('should throw CCIPHttpError on non-ok response', async () => {
      const errorResponse = { error: 'BAD_REQUEST', message: 'Invalid parameters' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.BAD_REQUEST,
          statusText: 'Bad Request',
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.getLaneInfo(1n, 2n),
        (err: unknown) =>
          err instanceof CCIPHttpError && err.context.status === HttpStatus.BAD_REQUEST,
      )
    })
  })

  describe('getMessageById', () => {
    const mockMessageResponse = {
      messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      sender: '0x742d35cc6634c0532925a3b8d5c8c22c5b2d8a3e',
      receiver: '0x893f0bcaa7f325c2b6bbd2133536f4e4b8fea88e',
      status: 'SUCCESS',
      sourceNetworkInfo: {
        name: 'ethereum-mainnet',
        chainSelector: '5009297550715157269',
        chainId: '1',
        chainFamily: 'EVM',
      },
      destNetworkInfo: {
        name: 'ethereum-mainnet-arbitrum-1',
        chainSelector: '4949039107694359620',
        chainId: '42161',
        chainFamily: 'EVM',
      },
      sendTransactionHash: '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
      sendTimestamp: '2023-12-01T10:30:00Z',
      tokenAmounts: [
        {
          sourceTokenAddress: '0xa0b86a8b5b6e8e0a09c4c3dc7de6e69e1e2d3f4a',
          destTokenAddress: '0xb1c97a9c6c7f9f1b10d5e4ec8ef7f70f2f3e4d5c',
          sourcePoolAddress: '0xc2d08b0d7d8a0a2c21e6f5fd9fa8a81a3a4f5e6d',
          amount: '1000000',
        },
      ],
      extraArgs: { gasLimit: '400000', allowOutOfOrderExecution: false },
      readyForManualExecution: false,
      finality: 0,
      fees: {
        fixedFeesDetails: {
          tokenAddress: '0x4cb3c1a50616725bd1793d0ee0c7fc4dc4e05c79',
          totalAmount: '5000000',
        },
      },
      version: '1.6.0',
      onramp: '0x1234567890abcdef1234567890abcdef12345678',
      origin: '0x742d35cc6634c0532925a3b8d5c8c22c5b2d8a3e',
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
          text: () => Promise.resolve(JSON.stringify(mockMessageResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.getMessageById(messageId)

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('/v2/messages/'))
      assert.ok(url.includes(messageId))
    })

    it('should return APICCIPRequest with parsed fields', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockMessageResponse)),
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
      assert.equal(result.lane.onRamp, getAddress(mockMessageResponse.onramp))

      // Message
      assert.equal(result.message.messageId, mockMessageResponse.messageId)
      assert.equal(result.message.sender, getAddress(mockMessageResponse.sender))
      assert.equal(result.message.sequenceNumber, 67890n)
      assert.equal(result.message.nonce, 12345n)

      // TX
      assert.equal(result.tx.hash, mockMessageResponse.sendTransactionHash)
      assert.equal(result.tx.timestamp, 1701426600) // Unix timestamp for 2023-12-01T10:30:00Z
      assert.equal(result.tx.from, getAddress(mockMessageResponse.origin))

      // Log
      assert.equal(result.log.transactionHash, mockMessageResponse.sendTransactionHash)
      assert.equal(result.log.address, getAddress(mockMessageResponse.onramp))

      // Status and extras
      assert.equal(result.status, 'SUCCESS')
      assert.equal(result.readyForManualExecution, false)
      assert.equal(result.deliveryTime, 900000n)
      assert.equal(result.finality, 0n)

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
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
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

    it('should handle missing optional fields gracefully', async () => {
      const minimalResponse = {
        messageId: '0x1234111111111111111111111111111111111111111111111111111111111111',
        sender: '0x742d222222222222222222222222222222222222',
        receiver: '0x893F333333333333333333333333333333333333',
        status: 'SENT',
        sourceNetworkInfo: {
          name: 'ethereum-mainnet',
          chainSelector: '5009297550715157269',
          chainId: '1',
          chainFamily: 'EVM',
        },
        destNetworkInfo: {
          name: 'ethereum-mainnet-arbitrum-1',
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
        fees: {
          fixedFeesDetails: {
            tokenAddress: '0x4269d8a4b138a1c39befc530d3904c150d8eb094',
            totalAmount: '1000',
          },
        },
        // Required fields (as of schema v2.0.0)
        origin: '0xe065e0bfd48878dfd9a2ce8de49e81ba9de57ccd',
        sequenceNumber: '12345',
        onramp: '0xa0fa1aca51c32bb3c8c0e96ddfc3af515578410a',
        // No optional fields: version, nonce, receiptTransactionHash, etc.
      }

      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(minimalResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // Should use defaults for missing optional fields
      assert.equal(result.lane.version, CCIPVersion.V1_6) // Default when version not provided
      assert.equal(result.lane.onRamp, getAddress(minimalResponse.onramp))
      assert.equal(result.message.sequenceNumber, 12345n)
      assert.equal(result.message.nonce, 0n) // nonce is still optional
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
            text: () => Promise.resolve(JSON.stringify(response)),
          }),
        )
        const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
        const result = await client.getMessageById(
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        )

        assert.equal(result.lane.version, expected)
      }
    })

    it('should preserve unknown version as-is', async () => {
      const response = { ...mockMessageResponse, version: '1.7.0' }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // Unknown version is preserved as-is (not silently converted to V1_6)
      assert.equal(result.lane.version, '1.7.0')
    })

    it('should strip -dev suffix from unknown versions', async () => {
      const response = { ...mockMessageResponse, version: '1.7.0-dev' }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // -dev suffix is stripped
      assert.equal(result.lane.version, '1.7.0')
    })

    it('should default to V1_6 when version is null or undefined', async () => {
      for (const version of [null, undefined]) {
        const response = { ...mockMessageResponse, version }
        const customFetch = mock.fn(() =>
          Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify(response)),
          }),
        )
        const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
        const result = await client.getMessageById(
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        )

        // Null/undefined falls back to V1_6
        assert.equal(result.lane.version, CCIPVersion.V1_6)
      }
    })

    it('should be transient error for 5xx', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
          text: () =>
            Promise.resolve(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message: 'Error' })),
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
          text: () => Promise.resolve(JSON.stringify(mockMessageResponse)),
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
          text: () => Promise.resolve(JSON.stringify(response)),
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
        destChainSelector: networkInfo('solana-mainnet').chainSelector,
        extraArgs: {
          computeUnits: 200000,
          accountIsWritableBitmap: '255',
          allowOutOfOrderExecution: false,
          tokenReceiver: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          accounts: [
            'So11111111111111111111111111111111111111113',
            'So11111111111111111111111111111111111111114',
          ],
        },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response, bigIntReplacer)),
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
      assert.deepEqual(msg.accounts, [
        'So11111111111111111111111111111111111111113',
        'So11111111111111111111111111111111111111114',
      ])
    })

    it('should parse tokenAmounts correctly', async () => {
      const response = {
        ...mockMessageResponse,
        tokenAmounts: [
          {
            sourceTokenAddress: '0xdBD5c2b8A83Ac0721Bb75D8ce5B32590Fc70840e',
            destTokenAddress: '0xBb18bf798a37AA8f383EC9F4445189F465935Fb1',
            sourcePoolAddress: '0xC24EE2C843E84dB8504dafe71724f04D5c278029',
            amount: '1000000000000000000',
            extraData: '0xabcd',
            destGasAmount: '50000',
          },
          {
            sourceTokenAddress: '0x60A920731Df0e9626b595F7549593B14A69602e4',
            destTokenAddress: '0xb40A91dD612cf44Ad912e6916CCda3cC189E95DA',
            sourcePoolAddress: '0x4f6A1D47edd2D5FDD50F2CebB2c0A7aBB2AAa7F3',
            amount: '2500000',
          },
        ],
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
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
      // First token with all fields populated
      assert.equal(msg.tokenAmounts[0]!.token, response.tokenAmounts[0]!.sourceTokenAddress)
      assert.equal(msg.tokenAmounts[0]!.amount, 1000000000000000000n)
      assert.equal(
        msg.tokenAmounts[0]!.sourcePoolAddress,
        response.tokenAmounts[0]!.sourcePoolAddress,
      )
      assert.equal(
        msg.tokenAmounts[0]!.destTokenAddress,
        response.tokenAmounts[0]!.destTokenAddress,
      )
      assert.equal(msg.tokenAmounts[0]!.extraData, '0xabcd')
      assert.equal(msg.tokenAmounts[0]!.destGasAmount, 50000n)
      // Second token with optional fields missing (uses defaults)
      assert.equal(msg.tokenAmounts[1]!.token, response.tokenAmounts[1]!.sourceTokenAddress)
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
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      // tokenAmounts is on message
      const msg = result.message as { tokenAmounts: readonly { token: string; amount: bigint }[] }
      assert.equal(msg.tokenAmounts.length, 0)
    })

    it('should produce a message that passes decodeMessage validation', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockMessageResponse)),
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

    it('should handle invalid sendTimestamp gracefully (defaults to 0)', async () => {
      const response = {
        ...mockMessageResponse,
        sendTimestamp: 'not-a-valid-date',
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })

      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      assert.equal(result.tx.timestamp, 0)
    })

    it('should handle invalid receiptTimestamp gracefully (defaults to undefined)', async () => {
      const response = {
        ...mockMessageResponse,
        receiptTimestamp: 'invalid-timestamp',
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })

      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      assert.equal(result.receiptTimestamp, undefined)
    })

    it('should allow missing receiptTimestamp (undefined)', async () => {
      const response = {
        ...mockMessageResponse,
        receiptTimestamp: undefined,
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageById(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )

      assert.equal(result.receiptTimestamp, undefined)
    })
  })

  describe('getMessageIdsInTx', () => {
    const mockMessagesResponse = {
      data: [
        {
          messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          origin: '0x742d35Cc6634C0532925a3b8D5c8C22C5B2D8a3E',
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
          sendTransactionHash: '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
          sendTimestamp: '2023-12-01T10:30:00Z',
        },
      ],
      pagination: {
        limit: 100,
        hasNextPage: false,
      },
    }

    it('should fetch with correct URL and query parameters', async () => {
      const txHash = '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234'
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockMessagesResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.getMessageIdsInTx(txHash)

      assert.equal(customFetch.mock.calls.length, 1)
      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('/v2/messages'))
      assert.ok(url.includes(`sourceTransactionHash=${encodeURIComponent(txHash)}`))
      assert.ok(url.includes('limit=100'))
    })

    it('should return single messageId', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockMessagesResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageIdsInTx(
        '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
      )

      assert.equal(result.length, 1)
      assert.equal(result[0], '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
    })

    it('should return multiple messageIds', async () => {
      const multiResponse = {
        data: [
          { ...mockMessagesResponse.data[0] },
          {
            ...mockMessagesResponse.data[0],
            messageId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          },
        ],
        pagination: { limit: 100, hasNextPage: false },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(multiResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const result = await client.getMessageIdsInTx(
        '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
      )

      assert.equal(result.length, 2)
      assert.equal(result[0], '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
      assert.equal(result[1], '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
    })

    it('should throw CCIPMessageNotFoundInTxError on empty response', async () => {
      const emptyResponse = {
        data: [],
        pagination: { limit: 100, hasNextPage: false },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(emptyResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })

      await assert.rejects(
        async () =>
          await client.getMessageIdsInTx(
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
          ),
        (err: unknown) =>
          err instanceof CCIPMessageNotFoundInTxError &&
          err.context.txHash ===
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
      )
    })

    it('should throw CCIPMessageNotFoundInTxError on 404', async () => {
      const errorResponse = { error: 'NOT_FOUND', message: 'No messages found' }
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          text: () => Promise.resolve(JSON.stringify(errorResponse)),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () =>
          await client.getMessageIdsInTx(
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
          ),
        (err: unknown) =>
          err instanceof CCIPMessageNotFoundInTxError &&
          err.context.apiErrorCode === 'NOT_FOUND' &&
          err.isTransient === true,
      )
    })

    it('should accept valid Solana Base58 txHash', async () => {
      // Valid Solana transaction signature (Base58, 88 chars typical)
      const solanaTxHash =
        '5UfDuX7hXbP9KQvQfYyqDANnxhZeyBXJ9VvM6BuqGhJaS5dwDnBJEwMjDnJKHQJJVn6UvNUWuCy'
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockMessagesResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })

      const result = await client.getMessageIdsInTx(solanaTxHash)

      assert.equal(result.length, 1)
      // Verify fetch was called with the Solana tx hash
      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes(encodeURIComponent(solanaTxHash)))
    })

    it('should throw CCIPHttpError on 5xx with transient flag', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
          text: () =>
            Promise.resolve(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Server error' })),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () =>
          await client.getMessageIdsInTx(
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
          ),
        (err: unknown) => err instanceof CCIPHttpError && err.isTransient === true,
      )
    })

    it('should log raw response via debug', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockMessagesResponse)),
        }),
      )
      const debugFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        logger: { log: () => {}, debug: debugFn } as any,
        fetch: customFetch as any,
      })

      await client.getMessageIdsInTx(
        '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
      )

      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'getMessageIdsInTx raw response:')
      assert.ok(lastCall.arguments[1])
    })

    it('should throw CCIPUnexpectedPaginationError when hasNextPage is true', async () => {
      const paginatedResponse = {
        data: mockMessagesResponse.data,
        pagination: { limit: 100, hasNextPage: true, cursor: 'next-page-token' },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(paginatedResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })

      await assert.rejects(
        async () =>
          await client.getMessageIdsInTx(
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
          ),
        (err: unknown) =>
          err instanceof CCIPUnexpectedPaginationError &&
          err.context.txHash ===
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234' &&
          err.context.messageCount === 1,
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
      family: ChainFamily.EVM,
      networkType: NetworkType.Mainnet,
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
