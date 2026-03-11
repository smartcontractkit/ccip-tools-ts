import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import '../index.ts'
import { getAddress } from 'ethers'

import { CCIPAPIClient, DEFAULT_API_BASE_URL, SDK_VERSION, SDK_VERSION_HEADER } from './index.ts'
import type { MessageSearchResult } from './types.ts'
import {
  CCIPAbortError,
  CCIPApiClientNotAvailableError,
  CCIPHttpError,
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageNotFoundInTxError,
  CCIPTimeoutError,
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

    it('should include SDK version header in requests', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.getLaneLatency(1n, 2n)

      const call = customFetch.mock.calls[0] as unknown as { arguments: [string, RequestInit] }
      const options = call.arguments[1]
      assert.ok(options.headers)
      assert.equal(
        (options.headers as Record<string, string>)[SDK_VERSION_HEADER],
        `CCIP SDK v${SDK_VERSION}`,
      )
      assert.equal((options.headers as Record<string, string>)['Content-Type'], 'application/json')
    })

    it('should use provided logger', () => {
      const customLogger = { log: mock.fn(), debug: mock.fn() }
      const client = new CCIPAPIClient(undefined, { logger: customLogger as any })

      assert.equal(client.logger, customLogger)
    })
  })

  describe('fromUrl', () => {
    it('should create client instance', async () => {
      const client = CCIPAPIClient.fromUrl()
      assert.ok(client instanceof CCIPAPIClient)
    })

    it('should create client with custom URL', async () => {
      const client = CCIPAPIClient.fromUrl('https://custom.api/')
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

    it('should include numOfBlocks param when numberOfBlocks > 0', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneLatency(1n, 2n, 5)

      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('numOfBlocks=5'))
    })

    it('should not include numOfBlocks param when numberOfBlocks is 0', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneLatency(1n, 2n, 0)

      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(!url.includes('numOfBlocks'))
    })

    it('should not include numOfBlocks param when numberOfBlocks is omitted', async () => {
      const client = new CCIPAPIClient()
      await client.getLaneLatency(1n, 2n)

      const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(!url.includes('numOfBlocks'))
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
      assert.ok('nonce' in result.message)
      assert.equal(result.message.nonce, 12345n)

      // TX
      assert.equal(result.tx.hash, mockMessageResponse.sendTransactionHash)
      assert.equal(result.tx.timestamp, 1701426600) // Unix timestamp for 2023-12-01T10:30:00Z
      assert.equal(result.tx.from, getAddress(mockMessageResponse.origin))

      // Log
      assert.equal(result.log.transactionHash, mockMessageResponse.sendTransactionHash)
      assert.equal(result.log.address, getAddress(mockMessageResponse.onramp))

      // Metadata (API-specific fields)
      assert.ok(result.metadata, 'metadata should be defined')
      assert.equal(result.metadata.status, 'SUCCESS')
      assert.equal(result.metadata.readyForManualExecution, false)
      assert.equal(result.metadata.deliveryTime, 900000n)
      assert.ok('finality' in result.message)
      assert.equal(result.message.finality, 0n)

      // Network info - uses SDK's networkInfo() which has canonical names
      assert.equal(result.metadata.sourceNetworkInfo.name, 'ethereum-mainnet')
      assert.equal(result.metadata.sourceNetworkInfo.chainSelector, 5009297550715157269n)
      assert.equal(result.metadata.destNetworkInfo.name, 'ethereum-mainnet-arbitrum-1')
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
      assert.ok(result.metadata, 'metadata should be defined')
      assert.equal(result.metadata.receiptTransactionHash, undefined)
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

      assert.ok(result.metadata, 'metadata should be defined')
      assert.equal(result.metadata.receiptTimestamp, undefined)
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

      assert.ok(result.metadata, 'metadata should be defined')
      assert.equal(result.metadata.receiptTimestamp, undefined)
    })
  })

  describe('searchMessages', () => {
    const mockSearchResponse = {
      data: [
        {
          messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          origin: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
          sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
          receiver: '0x893f0bcAa7F325C2B6BbD2133536f4E4B8feA88e',
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
        limit: 10,
        hasNextPage: false,
      },
    }

    it('should set sender filter as query parameter', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.searchMessages({ sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E' })

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('/v2/messages'))
      assert.ok(url.includes('sender=0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E'))
    })

    it('should set all filters as query parameters', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.searchMessages({
        sender: '0xSender',
        receiver: '0xReceiver',
        sourceChainSelector: 5009297550715157269n,
        destChainSelector: 4949039107694359620n,
        sourceTransactionHash: '0xTxHash',
        readyForManualExecOnly: true,
      })

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('sender=0xSender'))
      assert.ok(url.includes('receiver=0xReceiver'))
      assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
      assert.ok(url.includes('destChainSelector=4949039107694359620'))
      assert.ok(url.includes(`sourceTransactionHash=${encodeURIComponent('0xTxHash')}`))
      assert.ok(url.includes('readyForManualExecOnly=true'))
    })

    it('should send readyForManualExecOnly=false when explicitly set', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.searchMessages({ readyForManualExecOnly: false })

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('readyForManualExecOnly=false'))
    })

    it('should set limit query parameter', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.searchMessages({ sender: '0xSender' }, { limit: 25 })

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('limit=25'))
    })

    it('should use cursor instead of filters when cursor is provided', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.searchMessages({ sender: '0xShouldBeIgnored' }, { cursor: 'abc123cursor' })

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('cursor=abc123cursor'))
      assert.ok(!url.includes('sender='))
    })

    it('should return transformed search results', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const page = await client.searchMessages({ sender: '0xSender' })

      assert.equal(page.data.length, 1)
      assert.equal(
        page.data[0]!.messageId,
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )
      assert.equal(page.data[0]!.status, 'SUCCESS')
      assert.equal(page.data[0]!.sourceNetworkInfo.chainSelector, 5009297550715157269n)
      assert.equal(page.data[0]!.destNetworkInfo.chainSelector, 4949039107694359620n)
      assert.equal(page.hasNextPage, false)
      assert.equal(page.cursor, undefined)
    })

    it('should return cursor when hasNextPage is true', async () => {
      const paginatedResponse = {
        ...mockSearchResponse,
        pagination: { limit: 10, hasNextPage: true, cursor: 'nextPageCursor123' },
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(paginatedResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const page = await client.searchMessages({ sender: '0xSender' })

      assert.equal(page.hasNextPage, true)
      assert.equal(page.cursor, 'nextPageCursor123')
    })

    it('should return empty data on 404 (no results)', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          statusText: 'Not Found',
          text: () =>
            Promise.resolve(JSON.stringify({ error: 'NOT_FOUND', message: 'No messages' })),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      const page = await client.searchMessages({ sender: '0xNonExistent' })

      assert.equal(page.data.length, 0)
      assert.equal(page.hasNextPage, false)
    })

    it('should throw CCIPHttpError on non-404 errors', async () => {
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
        async () => await client.searchMessages({ sender: '0xBad' }),
        (err: unknown) =>
          err instanceof CCIPHttpError &&
          err.context.status === HttpStatus.BAD_REQUEST &&
          err.context.apiErrorCode === 'BAD_REQUEST',
      )
    })

    it('should throw CCIPHttpError with transient flag on 5xx', async () => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: false,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve(JSON.stringify({ error: 'INTERNAL', message: 'Error' })),
        })) as unknown as typeof fetch

      const client = new CCIPAPIClient()
      await assert.rejects(
        async () => await client.searchMessages({ sender: '0x...' }),
        (err: unknown) => err instanceof CCIPHttpError && err.isTransient === true,
      )
    })

    it('should validate message status from API', async () => {
      const responseWithUnknownStatus = {
        ...mockSearchResponse,
        data: [{ ...mockSearchResponse.data[0], status: 'BRAND_NEW_STATUS' }],
      }
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(responseWithUnknownStatus)),
        }),
      )
      const warnFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        fetch: customFetch as any,
        logger: { log: () => {}, debug: () => {}, warn: warnFn } as any,
      })
      const page = await client.searchMessages({ sender: '0xSender' })

      assert.equal(page.data[0]!.status, 'UNKNOWN')
      assert.ok(warnFn.mock.calls.length > 0)
    })

    it('should log raw response via debug', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const debugFn = mock.fn()
      const client = new CCIPAPIClient(undefined, {
        logger: { log: () => {}, debug: debugFn } as any,
        fetch: customFetch as any,
      })

      await client.searchMessages({ sender: '0xSender' })

      assert.equal(debugFn.mock.calls.length, 2) // Once for URL, once for raw response
      const lastCall = debugFn.mock.calls[1] as unknown as { arguments: unknown[] }
      assert.equal(lastCall.arguments[0], 'searchMessages raw response:')
    })

    it('should omit undefined filters from query parameters', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await client.searchMessages({ sender: '0xOnly' })

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('sender=0xOnly'))
      assert.ok(!url.includes('receiver='))
      assert.ok(!url.includes('sourceChainSelector='))
      assert.ok(!url.includes('destChainSelector='))
      assert.ok(!url.includes('sourceTransactionHash='))
      assert.ok(!url.includes('readyForManualExecOnly='))
    })

    it('should work with no filters and no options', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const page = await client.searchMessages()

      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.endsWith('/v2/messages'))
      assert.equal(page.data.length, 1)
    })
  })

  describe('searchAllMessages', () => {
    const makeMockResponse = (
      messages: Array<{ messageId: string }>,
      hasNextPage: boolean,
      cursor?: string,
    ) => ({
      data: messages.map((m) => ({
        ...m,
        origin: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
        sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
        receiver: '0x893f0bcAa7F325C2B6BbD2133536f4E4B8feA88e',
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
      })),
      pagination: { limit: 10, hasNextPage, cursor },
    })

    it('should yield all results from a single page', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(
                makeMockResponse(
                  [{ messageId: '0x' + 'aa'.repeat(32) }, { messageId: '0x' + 'bb'.repeat(32) }],
                  false,
                ),
              ),
            ),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const results: MessageSearchResult[] = []
      for await (const msg of client.searchAllMessages({
        sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
      })) {
        results.push(msg)
      }
      assert.equal(results.length, 2)
      assert.equal(results[0]!.messageId, '0x' + 'aa'.repeat(32))
      assert.equal(results[1]!.messageId, '0x' + 'bb'.repeat(32))
      assert.equal(customFetch.mock.callCount(), 1)
    })

    it('should yield all results across multiple pages', async () => {
      let callCount = 0
      const customFetch = mock.fn(() => {
        callCount++
        const response =
          callCount === 1
            ? makeMockResponse([{ messageId: '0x' + 'aa'.repeat(32) }], true, 'cursor-page2')
            : makeMockResponse([{ messageId: '0x' + 'bb'.repeat(32) }], false)
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        })
      })
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const results: MessageSearchResult[] = []
      for await (const msg of client.searchAllMessages({
        sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
      })) {
        results.push(msg)
      }
      assert.equal(results.length, 2)
      assert.equal(results[0]!.messageId, '0x' + 'aa'.repeat(32))
      assert.equal(results[1]!.messageId, '0x' + 'bb'.repeat(32))
      assert.equal(customFetch.mock.callCount(), 2)
    })

    it('should stop when no more pages', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(makeMockResponse([{ messageId: '0x' + 'aa'.repeat(32) }], false)),
            ),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const results: MessageSearchResult[] = []
      for await (const msg of client.searchAllMessages()) {
        results.push(msg)
      }
      assert.equal(results.length, 1)
      assert.equal(customFetch.mock.callCount(), 1)
    })

    it('should pass limit as per-page fetch size', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(makeMockResponse([{ messageId: '0x' + 'aa'.repeat(32) }], false)),
            ),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      for await (const _ of client.searchAllMessages(
        { sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E' },
        { limit: 5 },
      )) {
        // consume
      }
      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('limit=5'))
    })

    it('should pass filters to searchMessages', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(makeMockResponse([{ messageId: '0x' + 'aa'.repeat(32) }], false)),
            ),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      for await (const _ of client.searchAllMessages({
        sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
        sourceChainSelector: 5009297550715157269n,
      })) {
        // consume
      }
      const url = (customFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
      assert.ok(url.includes('sender=0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E'))
      assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
    })

    it('should yield nothing on empty results', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const results: MessageSearchResult[] = []
      for await (const msg of client.searchAllMessages({ sender: '0xnonexistent' })) {
        results.push(msg)
      }
      assert.equal(results.length, 0)
    })

    it('should stop fetching pages on early break', async () => {
      let callCount = 0
      const customFetch = mock.fn(() => {
        callCount++
        const response = makeMockResponse(
          [{ messageId: `0x${String(callCount).padStart(64, '0')}` }],
          true,
          `cursor-page${callCount + 1}`,
        )
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(response)),
        })
      })
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      for await (const _ of client.searchAllMessages()) {
        break // stop after first result
      }
      // Only one page fetched — generator did not continue to page 2
      assert.equal(customFetch.mock.callCount(), 1)
    })

    it('should propagate errors from searchMessages', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve(''),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await assert.rejects(
        async () => {
          for await (const _ of client.searchAllMessages()) {
            // should not reach here
          }
        },
        (err: any) => err.name === 'CCIPHttpError',
      )
    })
  })

  describe('getMessageIdsInTx', () => {
    const mockMessagesResponse = {
      data: [
        {
          messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          origin: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
          sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
          receiver: '0x893f0bcAa7F325C2B6BbD2133536f4E4B8feA88e',
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
          err.context.txHash ===
            '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
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

    it('should log raw response via debug (via searchMessages)', async () => {
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
      assert.equal(lastCall.arguments[0], 'searchMessages raw response:')
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

  describe('AbortSignal support', () => {
    it('should throw CCIPTimeoutError when request times out', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            // Simulate real fetch: reject when signal aborts (timeout or user)
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, {
        fetch: customFetch as any,
        timeoutMs: 50,
      })
      await assert.rejects(
        () => client.getLaneLatency(1n, 2n),
        (err: any) => err instanceof CCIPTimeoutError && err.context.operation === 'getLaneLatency',
      )
    })

    it('should throw CCIPAbortError when signal is aborted', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 10)
      await assert.rejects(
        () => client.getLaneLatency(1n, 2n, undefined, { signal: controller.signal }),
        (err: any) => err instanceof CCIPAbortError && err.context.operation === 'getLaneLatency',
      )
    })

    it('should throw CCIPAbortError when signal is already aborted', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init.signal?.aborted) {
              reject(new DOMException('The operation was aborted', 'AbortError'))
              return
            }
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      await assert.rejects(
        () => client.getLaneLatency(1n, 2n, undefined, { signal: AbortSignal.abort() }),
        (err: any) => err instanceof CCIPAbortError,
      )
    })

    it('should forward signal to searchMessages', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 10)
      await assert.rejects(
        () => client.searchMessages({ sender: '0x' }, { signal: controller.signal }),
        (err: any) => err instanceof CCIPAbortError && err.context.operation === 'searchMessages',
      )
    })

    it('should forward signal to getMessageById', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 10)
      await assert.rejects(
        () => client.getMessageById('0x' + 'aa'.repeat(32), { signal: controller.signal }),
        (err: any) => err instanceof CCIPAbortError && err.context.operation === 'getMessageById',
      )
    })

    it('should forward signal to getExecutionInput', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 10)
      await assert.rejects(
        () => client.getExecutionInput('0x' + 'aa'.repeat(32), { signal: controller.signal }),
        (err: any) =>
          err instanceof CCIPAbortError && err.context.operation === 'getExecutionInput',
      )
    })

    it('should forward signal to getMessageIdsInTx', async () => {
      const customFetch = mock.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 10)
      await assert.rejects(
        () => client.getMessageIdsInTx('0x' + 'aa'.repeat(32), { signal: controller.signal }),
        (err: any) => err instanceof CCIPAbortError,
      )
    })

    it('should abort searchAllMessages mid-pagination', async () => {
      const controller = new AbortController()
      let callCount = 0
      const customFetch = mock.fn((_url: string, init: RequestInit) => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  data: [
                    {
                      messageId: '0x' + 'aa'.repeat(32),
                      origin: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
                      sender: '0x742D35cc6634C0532925A3B8D5c8c22c5b2D8A3E',
                      receiver: '0x893f0bcAa7F325C2B6BbD2133536f4E4B8feA88e',
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
                      sendTransactionHash:
                        '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
                      sendTimestamp: '2023-12-01T10:30:00Z',
                    },
                  ],
                  pagination: { limit: 10, hasNextPage: true, cursor: 'cursor-page2' },
                }),
              ),
          })
        }
        // Second call: signal is already aborted
        return new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'))
            return
          }
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          )
        })
      })
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      const results: MessageSearchResult[] = []

      // Abort after consuming first page
      await assert.rejects(
        async () => {
          for await (const msg of client.searchAllMessages(undefined, {
            signal: controller.signal,
          })) {
            results.push(msg)
            // Abort after getting first result — next page fetch will fail
            controller.abort()
          }
        },
        (err: any) => err instanceof CCIPAbortError,
      )
      assert.equal(results.length, 1)
    })

    it('should not affect normal operation when signal is not provided', async () => {
      const customFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
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
              }),
            ),
        }),
      )
      const client = new CCIPAPIClient(undefined, { fetch: customFetch as any })
      // Should work fine without signal
      const result = await client.getLaneLatency(1n, 2n)
      assert.equal(result.totalMs, 1147000)
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
