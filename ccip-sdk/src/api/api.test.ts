import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { CCIPAPIClient, DEFAULT_API_BASE_URL } from './index.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPHttpError,
  CCIPLaneNotFoundError,
  HttpStatus,
} from '../errors/index.ts'
import { EVMChain } from '../evm/index.ts'

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
