import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { CCIPApiClientNotAvailableError } from '@chainlink/ccip-sdk/src/index.ts'

import { getLaneLatencyCmd } from './lane-latency.ts'
import { type Ctx, Format } from './types.ts'

const origFetch = globalThis.fetch

describe('lane-latency command', () => {
  // Mock API response (using lowercase chainFamily like SDK convention)
  const mockApiResponse = {
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

  const mockedFetch = mock.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(mockApiResponse) }),
  )

  const mockLog = mock.fn()
  const mockTable = mock.fn()
  const mockLogger = {
    log: mockLog,
    error: mock.fn(),
    debug: mock.fn(),
    table: mockTable,
  }

  const createCtx = (): Ctx => ({
    destroy$: Promise.resolve(),
    logger: mockLogger as unknown as Ctx['logger'],
  })

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockLog.mock.resetCalls()
    mockTable.mock.resetCalls()
    globalThis.fetch = mockedFetch as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('should output JSON format correctly', async () => {
    // Use chain selectors directly (known to work)
    await getLaneLatencyCmd(createCtx(), {
      source: '5009297550715157269',
      dest: '4949039107694359620',
      format: Format.json,
    } as Parameters<typeof getLaneLatencyCmd>[1])

    assert.equal(mockLog.mock.calls.length, 1)
    const output = (mockLog.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    const parsed = JSON.parse(output)
    // SDK now returns only { totalMs } - lane info is no longer included
    assert.equal(parsed.totalMs, 1147000)
    assert.deepEqual(Object.keys(parsed), ['totalMs'])
  })

  it('should resolve chain IDs to chain selectors', async () => {
    // Use chain IDs (1 = ethereum mainnet, 42161 = arbitrum mainnet)
    await getLaneLatencyCmd(createCtx(), {
      source: '1',
      dest: '42161',
      format: Format.json,
    } as Parameters<typeof getLaneLatencyCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
    assert.ok(url.includes('destChainSelector=4949039107694359620'))
  })

  it('should use custom API URL when provided', async () => {
    await getLaneLatencyCmd(createCtx(), {
      source: '1',
      dest: '42161',
      apiUrl: 'https://custom.api.example.com/',
      format: Format.json,
    } as Parameters<typeof getLaneLatencyCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.startsWith('https://custom.api.example.com/'))
  })

  it('should output log format correctly', async () => {
    await getLaneLatencyCmd(createCtx(), {
      source: '5009297550715157269',
      dest: '4949039107694359620',
      format: Format.log,
    } as Parameters<typeof getLaneLatencyCmd>[1])

    assert.equal(mockLog.mock.calls.length, 1)
    const args = (mockLog.mock.calls[0] as unknown as { arguments: unknown[] }).arguments
    assert.equal(args[0], 'Lane Latency:')
    assert.ok(args[1])
  })

  it('should handle chain IDs as input', async () => {
    await getLaneLatencyCmd(createCtx(), {
      source: '1',
      dest: '42161',
      format: Format.json,
    } as Parameters<typeof getLaneLatencyCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    // Chain ID 1 maps to ethereum-mainnet selector
    assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
    // Chain ID 42161 maps to arbitrum-mainnet selector
    assert.ok(url.includes('destChainSelector=4949039107694359620'))
  })

  it('should handle chain selectors as input', async () => {
    await getLaneLatencyCmd(createCtx(), {
      source: '5009297550715157269',
      dest: '4949039107694359620',
      format: Format.json,
    } as Parameters<typeof getLaneLatencyCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
    assert.ok(url.includes('destChainSelector=4949039107694359620'))
  })

  it('should throw CCIPApiClientNotAvailableError when --no-api flag is set', async () => {
    await assert.rejects(
      async () =>
        await getLaneLatencyCmd(createCtx(), {
          source: '5009297550715157269',
          dest: '4949039107694359620',
          format: Format.json,
          api: false, // Simulate --no-api flag
        } as Parameters<typeof getLaneLatencyCmd>[1]),
      (err: unknown) =>
        err instanceof CCIPApiClientNotAvailableError &&
        typeof err.context.reason === 'string' &&
        err.context.reason.includes('lane-latency command requires API access'),
    )

    // Verify fetch was NOT called
    assert.equal(mockedFetch.mock.calls.length, 0)
  })

  it('should work normally when --api flag is true (default)', async () => {
    await getLaneLatencyCmd(createCtx(), {
      source: '5009297550715157269',
      dest: '4949039107694359620',
      format: Format.json,
      api: true, // Explicit true
    } as Parameters<typeof getLaneLatencyCmd>[1])

    // Verify fetch was called (API was used)
    assert.equal(mockedFetch.mock.calls.length, 1)
  })

  describe('CCIP_API environment variable integration', () => {
    it('should respect CCIP_API=false environment variable', async () => {
      const origEnv = process.env.CCIP_API
      try {
        process.env.CCIP_API = 'false'

        // Simulate yargs .env('CCIP') behavior - yargs converts CCIP_API to api
        await assert.rejects(
          async () =>
            await getLaneLatencyCmd(createCtx(), {
              source: '5009297550715157269',
              dest: '4949039107694359620',
              format: Format.json,
              api: process.env.CCIP_API === 'false' ? false : true,
            } as Parameters<typeof getLaneLatencyCmd>[1]),
          (err: unknown) => err instanceof CCIPApiClientNotAvailableError,
        )

        // Verify fetch was NOT called
        assert.equal(mockedFetch.mock.calls.length, 0)
      } finally {
        if (origEnv === undefined) {
          delete process.env.CCIP_API
        } else {
          process.env.CCIP_API = origEnv
        }
      }
    })
  })
})
