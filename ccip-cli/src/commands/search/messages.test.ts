import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { CCIPApiClientNotAvailableError } from '@chainlink/ccip-sdk/src/index.ts'

import { type Ctx, Format } from '../types.ts'
import { searchMessages } from './messages.ts'

const origFetch = globalThis.fetch

// Realistic mock data for a search result
const mockMessage = {
  messageId: '0xabc123def456789012345678901234567890123456789012345678901234abcd',
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
  sender: '0x0000000000000000000000009d087fC03ae39b088326b67fA3C788236645b717',
  receiver: '0x000000000000000000000000B5a1EFC0DCA3D2dEf5FCcd61e0F13d1bF500C834',
  origin: '0x0000000000000000000000009d087fC03ae39b088326b67fA3C788236645b717',
  sendTransactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  sendTimestamp: '2025-01-01T00:00:00Z',
}

const mockSearchResponse = {
  data: [mockMessage],
  pagination: { hasNextPage: false, cursor: null },
}

describe('search messages command', () => {
  const mockedFetch = mock.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
    }),
  )

  const mockLog = mock.fn()
  const mockWarn = mock.fn()
  const mockInfo = mock.fn()
  const mockLogger = {
    log: mockLog,
    warn: mockWarn,
    info: mockInfo,
    error: mock.fn(),
    debug: mock.fn(),
    table: mock.fn(),
  }

  const createCtx = (): Ctx => ({
    destroy$: Promise.resolve(),
    logger: mockLogger as unknown as Ctx['logger'],
  })

  const createArgv = (overrides: Record<string, unknown> = {}) =>
    ({
      format: Format.json,
      api: true,
      ...overrides,
    }) as Parameters<typeof searchMessages>[1]

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockSearchResponse)),
      }),
    )
    mockLog.mock.resetCalls()
    mockWarn.mock.resetCalls()
    mockInfo.mock.resetCalls()
    globalThis.fetch = mockedFetch as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('should throw CCIPApiClientNotAvailableError when --no-api flag is set', async () => {
    await assert.rejects(
      () => searchMessages(createCtx(), createArgv({ api: false })),
      (err: unknown) =>
        err instanceof CCIPApiClientNotAvailableError &&
        typeof err.context.reason === 'string' &&
        err.context.reason.includes('search command requires API access'),
    )
    assert.equal(mockedFetch.mock.calls.length, 0)
  })

  it('should output JSON format correctly', async () => {
    await searchMessages(createCtx(), createArgv({ format: Format.json }))

    assert.equal(mockLog.mock.calls.length, 1)
    const output = (mockLog.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    const parsed = JSON.parse(output)
    assert.ok(Array.isArray(parsed))
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].messageId, mockMessage.messageId)
  })

  it('should pass sender filter to API', async () => {
    const sender = '0x9d087fC03ae39b088326b67fA3C788236645b717'
    await searchMessages(createCtx(), createArgv({ sender }))

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(
      url.includes(`sender=${encodeURIComponent(sender)}`),
      `URL should contain sender: ${url}`,
    )
  })

  it('should pass receiver filter to API', async () => {
    const receiver = '0xB5a1EFC0DCA3D2dEf5FCcd61e0F13d1bF500C834'
    await searchMessages(createCtx(), createArgv({ receiver }))

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(
      url.includes(`receiver=${encodeURIComponent(receiver)}`),
      `URL should contain receiver: ${url}`,
    )
  })

  it('should resolve source chain to selector', async () => {
    await searchMessages(createCtx(), createArgv({ source: '1' }))

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes('sourceChainSelector=5009297550715157269'))
  })

  it('should resolve dest chain to selector', async () => {
    await searchMessages(createCtx(), createArgv({ dest: '42161' }))

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes('destChainSelector=4949039107694359620'))
  })

  it('should pass manual-exec-only filter to API', async () => {
    await searchMessages(createCtx(), createArgv({ manualExecOnly: true }))

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes('readyForManualExecOnly=true'))
  })

  it('should treat limit 0 as unlimited', async () => {
    const mockMessage2 = {
      ...mockMessage,
      messageId: '0xdef456789012345678901234567890123456789012345678901234567890abcd',
    }
    const multiMsgResponse = {
      data: [mockMessage, mockMessage2],
      pagination: { hasNextPage: false, cursor: null },
    }
    mockedFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(multiMsgResponse)),
      }),
    )

    await searchMessages(createCtx(), createArgv({ limit: 0 }))

    assert.equal(mockLog.mock.calls.length, 1)
    const parsed = JSON.parse(
      (mockLog.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!,
    )
    assert.equal(parsed.length, 2)
  })

  it('should respect limit parameter', async () => {
    const mockMessage2 = {
      ...mockMessage,
      messageId: '0xdef456789012345678901234567890123456789012345678901234567890abcd',
    }
    const mockMessage3 = {
      ...mockMessage,
      messageId: '0x789abc789012345678901234567890123456789012345678901234567890abcd',
    }
    const multiMsgResponse = {
      data: [mockMessage, mockMessage2, mockMessage3],
      pagination: { hasNextPage: false, cursor: null },
    }
    mockedFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(multiMsgResponse)),
      }),
    )

    await searchMessages(createCtx(), createArgv({ limit: 1 }))

    assert.equal(mockLog.mock.calls.length, 1)
    const parsed = JSON.parse(
      (mockLog.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!,
    )
    assert.equal(parsed.length, 1)
  })

  it('should warn when no results found', async () => {
    const emptyResponse = { data: [], pagination: { hasNextPage: false, cursor: null } }
    mockedFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(emptyResponse)),
      }),
    )

    await searchMessages(createCtx(), createArgv())

    assert.equal(mockWarn.mock.calls.length, 1)
    const warnMsg = (mockWarn.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(warnMsg.includes('No messages found'))
  })

  it('should use custom API URL when provided', async () => {
    await searchMessages(createCtx(), createArgv({ api: 'https://custom.api.example.com/' }))

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.startsWith('https://custom.api.example.com/'))
  })

  it('should warn on negative limit and fall back to default', async () => {
    await searchMessages(createCtx(), createArgv({ limit: -5 }))

    // Should warn about invalid limit
    assert.equal(mockWarn.mock.calls.length, 1)
    const warnMsg = (mockWarn.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(warnMsg.includes('Invalid --limit'))

    // Should still return results (falls back to default 20)
    assert.equal(mockLog.mock.calls.length, 1)
  })

  it('should output log format', async () => {
    await searchMessages(createCtx(), createArgv({ format: Format.log }))

    assert.equal(mockLog.mock.calls.length, 1)
    // Log format outputs each message object directly
    const args = (mockLog.mock.calls[0] as unknown as { arguments: unknown[] }).arguments
    assert.ok(args[0] && typeof args[0] === 'object')
  })
})
