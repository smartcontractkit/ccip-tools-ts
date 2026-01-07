import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { CCIPApiClientNotAvailableError } from '@chainlink/ccip-sdk/src/index.ts'

import { getMessageIdCmd } from './get-message-id.ts'
import { type Ctx, Format } from './types.ts'

const origFetch = globalThis.fetch

describe('get-message-id command', () => {
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

  const mockedFetch = mock.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(mockMessagesResponse) }),
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

  it('should fetch message IDs with correct URL', async () => {
    const txHash = '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12'
    await getMessageIdCmd(createCtx(), {
      txHash,
      format: Format.json,
    } as Parameters<typeof getMessageIdCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes('/v1/messages'))
    assert.ok(url.includes(`sourceTransactionHash=${encodeURIComponent(txHash)}`))
  })

  it('should output JSON format correctly for single message', async () => {
    await getMessageIdCmd(createCtx(), {
      txHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      format: Format.json,
    } as Parameters<typeof getMessageIdCmd>[1])

    assert.equal(mockLog.mock.calls.length, 1)
    const output = (mockLog.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    const parsed = JSON.parse(output)
    assert.deepEqual(parsed, ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'])
  })

  it('should output JSON format correctly for multiple messages', async () => {
    const multiMessageResponse = {
      data: [
        { ...mockMessagesResponse.data[0] },
        {
          ...mockMessagesResponse.data[0],
          messageId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        },
      ],
      pagination: { limit: 100, hasNextPage: false, cursor: null },
    }
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(multiMessageResponse) }),
    ) as unknown as typeof fetch

    await getMessageIdCmd(createCtx(), {
      txHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      format: Format.json,
    } as Parameters<typeof getMessageIdCmd>[1])

    assert.equal(mockLog.mock.calls.length, 1)
    const output = (mockLog.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    const parsed = JSON.parse(output)
    assert.equal(parsed.length, 2)
    assert.deepEqual(parsed, [
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    ])
  })

  it('should output log format correctly', async () => {
    await getMessageIdCmd(createCtx(), {
      txHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      format: Format.log,
    } as Parameters<typeof getMessageIdCmd>[1])

    assert.equal(mockLog.mock.calls.length, 1)
    const args = (mockLog.mock.calls[0] as unknown as { arguments: unknown[] }).arguments
    assert.equal(args[0], 'Message IDs:')
    assert.ok(Array.isArray(args[1]))
  })

  it('should use custom API URL when provided', async () => {
    await getMessageIdCmd(createCtx(), {
      txHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      apiUrl: 'https://custom.api.example.com/',
      format: Format.json,
    } as Parameters<typeof getMessageIdCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.startsWith('https://custom.api.example.com/'))
  })

  it('should throw CCIPApiClientNotAvailableError when --no-api flag is set', async () => {
    await assert.rejects(
      async () =>
        await getMessageIdCmd(createCtx(), {
          txHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
          format: Format.json,
          noApi: true,
        } as Parameters<typeof getMessageIdCmd>[1]),
      (err: unknown) =>
        err instanceof CCIPApiClientNotAvailableError &&
        typeof err.context.reason === 'string' &&
        err.context.reason.includes('get-message-id command requires API access'),
    )

    // Verify fetch was NOT called
    assert.equal(mockedFetch.mock.calls.length, 0)
  })

  it('should work normally when --no-api flag is false', async () => {
    await getMessageIdCmd(createCtx(), {
      txHash: '0x9428debf5e5f01234567890abcdef1234567890abcdef1234567890abcdef12',
      format: Format.json,
      noApi: false,
    } as Parameters<typeof getMessageIdCmd>[1])

    // Verify fetch was called (API was used)
    assert.equal(mockedFetch.mock.calls.length, 1)
  })

  it('should accept Solana Base58 transaction hash', async () => {
    const solanaTxHash =
      '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'

    await getMessageIdCmd(createCtx(), {
      txHash: solanaTxHash,
      format: Format.json,
    } as Parameters<typeof getMessageIdCmd>[1])

    const url = (mockedFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.ok(url.includes(encodeURIComponent(solanaTxHash)))
  })
})
