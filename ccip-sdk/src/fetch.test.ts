import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import {
  createAxiosFetchAdapter,
  createRateLimitedFetch,
  endpointKey,
  fetchProfileForUrl,
  getEndpointLogRange,
  getEndpointTopicLimit,
  originKey,
  parseLogRangeError,
  registerEndpointBase,
  parseRateLimitHeaders,
  parseRetryAfter,
  parseTopicLimitError,
  setEndpointLogRange,
  setEndpointTopicLimit,
} from './fetch.ts'

function withMockedPerformanceNow<T>(now: number, fn: () => T): T {
  const performanceNow = mock.method(performance, 'now', () => now)
  try {
    return fn()
  } finally {
    performanceNow.mock.restore()
  }
}

// ---------------------------------------------------------------------------
// parseRetryAfter
// ---------------------------------------------------------------------------

describe('parseRetryAfter', () => {
  it('returns null for null input', () => {
    assert.equal(parseRetryAfter(null), null)
  })

  it('handles delta-seconds integer', () => {
    withMockedPerformanceNow(1_000, () => {
      const result = parseRetryAfter('30')
      assert.equal(result, 31_000)
    })
  })

  it('handles delta-seconds zero', () => {
    withMockedPerformanceNow(1_000, () => {
      const result = parseRetryAfter('0')
      assert.equal(result, 1_000)
    })
  })

  it('handles HTTP-date format', () => {
    // A future date
    const future = new Date(Date.now() + 60_000)
    const result = parseRetryAfter(future.toUTCString())
    assert.ok(result !== null)
    // Within 1s tolerance
    assert.ok(Math.abs(result - future.getTime()) < 1000)
  })

  it('returns null for garbage input', () => {
    assert.equal(parseRetryAfter('not-a-date'), null)
  })
})

// ---------------------------------------------------------------------------
// parseRateLimitHeaders
// ---------------------------------------------------------------------------

function makeHeaders(pairs: Record<string, string>): Headers {
  const h = new Headers()
  for (const [k, v] of Object.entries(pairs)) h.set(k, v)
  return h
}

describe('parseRateLimitHeaders', () => {
  it('returns empty object for no headers', () => {
    const result = parseRateLimitHeaders(new Headers())
    assert.deepEqual(result, {})
  })

  it('parses Retry-After delta-seconds', () => {
    withMockedPerformanceNow(1_000, () => {
      const result = parseRateLimitHeaders(makeHeaders({ 'Retry-After': '10' }))
      assert.equal(result.retryAfterAt, 11_000)
    })
  })

  it('parses IETF draft individual headers (reset = delta-seconds)', () => {
    withMockedPerformanceNow(1_000, () => {
      const result = parseRateLimitHeaders(
        makeHeaders({
          'RateLimit-Limit': '100',
          'RateLimit-Remaining': '50',
          'RateLimit-Reset': '60',
        }),
      )
      assert.equal(result.limit, 100)
      assert.equal(result.remaining, 50)
      assert.equal(result.resetAt, 61_000)
    })
  })

  it('parses combined RateLimit header', () => {
    withMockedPerformanceNow(1_000, () => {
      const result = parseRateLimitHeaders(
        makeHeaders({ RateLimit: 'limit=100, remaining=20, reset=30' }),
      )
      assert.equal(result.limit, 100)
      assert.equal(result.remaining, 20)
      assert.equal(result.resetAt, 31_000)
    })
  })

  it('parses X-RateLimit-* de-facto headers (reset as delta-seconds)', () => {
    withMockedPerformanceNow(1_000, () => {
      const result = parseRateLimitHeaders(
        makeHeaders({
          'X-RateLimit-Limit': '200',
          'X-RateLimit-Remaining': '100',
          'X-RateLimit-Reset': '45',
        }),
      )
      assert.equal(result.limit, 200)
      assert.equal(result.remaining, 100)
      assert.equal(result.resetAt, 46_000)
    })
  })

  it('parses X-RateLimit-Reset as epoch-seconds when > 1e9', () => {
    // Use a Unix epoch value well in the future
    const epochSeconds = Math.floor(Date.now() / 1000) + 100
    const result = parseRateLimitHeaders(makeHeaders({ 'X-RateLimit-Reset': String(epochSeconds) }))
    assert.ok(result.resetAt !== undefined)
    // Should be within 1s of the epoch value
    assert.ok(Math.abs(result.resetAt - epochSeconds * 1000) < 1000)
  })

  it('X-RateLimit overrides IETF headers when both present', () => {
    const result = parseRateLimitHeaders(
      makeHeaders({
        'RateLimit-Limit': '100',
        'RateLimit-Remaining': '50',
        'X-RateLimit-Limit': '200',
        'X-RateLimit-Remaining': '80',
      }),
    )
    assert.equal(result.limit, 200)
    assert.equal(result.remaining, 80)
  })
})

// ---------------------------------------------------------------------------
// endpointKey
// ---------------------------------------------------------------------------

describe('endpointKey', () => {
  it('falls back to origin when no base is registered', () => {
    assert.equal(endpointKey('https://api.example.com/v1/rpc'), 'https://api.example.com')
    assert.equal(
      endpointKey('https://api.example.com/v1/rpc?key=secret&foo=bar'),
      'https://api.example.com',
    )
    assert.equal(endpointKey('https://api.example.com/v1/rpc#fragment'), 'https://api.example.com')
    assert.equal(
      endpointKey(new URL('https://api.example.com/rpc?foo=bar')),
      'https://api.example.com',
    )
    assert.equal(
      endpointKey(new Request('https://api.example.com/rpc?foo=bar')),
      'https://api.example.com',
    )
  })

  it('resolves to the longest registered base prefix', () => {
    registerEndpointBase('https://rpc.example.com/aptos/mainnet/alchemy1')
    registerEndpointBase('https://rpc.example.com/aptos/mainnet/archive/alchemy1')
    const base = endpointKey('https://rpc.example.com/aptos/mainnet/alchemy1')
    assert.equal(base, 'https://rpc.example.com/aptos/mainnet/alchemy1')
    const k1 = endpointKey(
      'https://rpc.example.com/aptos/mainnet/alchemy1/transactions/by_version/6934979110',
    )
    const k2 = endpointKey(
      'https://rpc.example.com/aptos/mainnet/alchemy1/transactions/by_version/6934980851',
    )
    assert.equal(k1, base)
    assert.equal(k1, k2)
    // matching is boundary-aware: /alchemy1x must NOT resolve to /alchemy1 → origin fallback
    assert.equal(
      endpointKey('https://rpc.example.com/aptos/mainnet/alchemy1x/transactions'),
      'https://rpc.example.com',
    )
    // the archive variant resolves to its own registered base
    assert.equal(
      endpointKey(
        'https://rpc.example.com/aptos/mainnet/archive/alchemy1/transactions/by_version/1',
      ),
      'https://rpc.example.com/aptos/mainnet/archive/alchemy1',
    )
  })

  it('register is idempotent and longest-prefix wins over shorter bases', () => {
    registerEndpointBase('https://rpc.example.com/aptos/mainnet/alchemy1')
    registerEndpointBase('https://rpc.example.com')
    assert.equal(
      endpointKey('https://rpc.example.com/aptos/mainnet/alchemy1/x'),
      'https://rpc.example.com/aptos/mainnet/alchemy1',
    )
  })
})

describe('originKey', () => {
  it('merges every path of a host into one key', () => {
    const k1 = originKey('https://testnet.toncenter.com/api/v3/messages?source=x')
    const k2 = originKey('https://testnet.toncenter.com/api/v3/transactions')
    const k3 = originKey('https://testnet.toncenter.com/api/v3/masterchainInfo')
    assert.equal(k1, 'https://testnet.toncenter.com')
    assert.equal(k2, k1)
    assert.equal(k3, k1)
  })

  it('keeps distinct hosts (and proxy paths) separate', () => {
    assert.notEqual(
      originKey('https://testnet.toncenter.com/api/v3/messages'),
      originKey('https://toncenter.com/api/v3/messages'),
    )
    // Distinct backends behind one proxy host stay separate under endpointKey
    // once their base URLs are registered (as chain constructors do via
    // fetchProfileForUrl); unregistered paths fall back to origin.
    registerEndpointBase('https://gateway.example/ton/testnet/node1/jsonRPC')
    assert.equal(
      endpointKey('https://gateway.example/ton/testnet/node1/jsonRPC'),
      'https://gateway.example/ton/testnet/node1/jsonRPC',
    )
    assert.notEqual(
      endpointKey('https://gateway.example/ton/testnet/node1/jsonRPC'),
      endpointKey('https://gateway.example/ton/testnet/node2/jsonRPC'),
    )
  })
})

// ---------------------------------------------------------------------------
// getEndpointLogRange / setEndpointLogRange
// ---------------------------------------------------------------------------

describe('getEndpointLogRange / setEndpointLogRange', () => {
  it('returns undefined when not set', () => {
    assert.equal(getEndpointLogRange('https://unregistered.example.com/rpc'), undefined)
  })

  it('round-trips an error-learned range', () => {
    const url = 'https://alchemy.example.com/v2/test'
    setEndpointLogRange(url, 10_000, 'error')
    assert.equal(getEndpointLogRange(url), 10_000)
  })

  it('round-trips a success-learned range', () => {
    const url = 'https://infura.example.com/v3/test'
    setEndpointLogRange(url, 5_000, 'success')
    assert.equal(getEndpointLogRange(url), 5_000)
  })

  it('query params are stripped (same key)', () => {
    const base = 'https://quicknode.example.com/rpc'
    setEndpointLogRange(base + '?key=abc', 2_000, 'error')
    assert.equal(getEndpointLogRange(base + '?key=xyz'), 2_000)
  })
})

// ---------------------------------------------------------------------------
// fetchProfileForUrl
// ---------------------------------------------------------------------------

describe('fetchProfileForUrl', () => {
  it('leaves public Solana with no proactive seed (header-driven adaptation)', () => {
    const profile = fetchProfileForUrl('https://api.mainnet-beta.solana.com')
    assert.equal(profile.seed, undefined)
  })

  it('seeds TON public (toncenter.com) paced, still adaptive', () => {
    const profile = fetchProfileForUrl('https://toncenter.com/api/v2/jsonRPC')
    assert.deepEqual(profile.seed, { limit: 1, windowMs: 1500 })
  })

  it('seeds TON public (tonapi.io) paced', () => {
    const profile = fetchProfileForUrl('https://tonapi.io/v2/something')
    assert.deepEqual(profile.seed, { limit: 1, windowMs: 1500 })
  })

  it('no seed for unknown hosts (start at full speed)', () => {
    const profile = fetchProfileForUrl('https://api.example.com/rpc')
    assert.equal(profile.seed, undefined)
  })

  it('no seed on invalid URL', () => {
    const profile = fetchProfileForUrl('not-a-url')
    assert.equal(profile.seed, undefined)
  })
})

// ---------------------------------------------------------------------------
// parseLogRangeError
// ---------------------------------------------------------------------------

describe('parseLogRangeError', () => {
  it('returns null for null/undefined', () => {
    assert.equal(parseLogRangeError(null), null)
    assert.equal(parseLogRangeError(undefined), null)
  })

  it('returns null for unrelated error', () => {
    assert.equal(parseLogRangeError(new Error('something went wrong')), null)
  })

  it('parses Alchemy "up to a 10000 block range"', () => {
    const err = new Error(
      'Log response size exceeded. You can make eth_getLogs requests with up to a 10000 block range and no greater than 10000 logs in the response.',
    )
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
    assert.equal(result.maxRange, 10000)
  })

  it('parses Alchemy suggested range [0x..., 0x...]', () => {
    const err = new Error('Try with this block range [0x12AB1C, 0x12B9FC].')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
    assert.ok(result.suggestedRange !== undefined)
    assert.equal(result.suggestedRange[0], 0x12ab1c)
    assert.equal(result.suggestedRange[1], 0x12b9fc)
  })

  it('parses Infura "query returned more than 10000 results"', () => {
    const err = new Error('query returned more than 10000 results')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
    assert.equal(result.maxRange, 10000)
  })

  it('parses QuickNode "eth_getLogs is limited to a 10000 range"', () => {
    const err = new Error('eth_getLogs is limited to a 10000 range')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
    assert.equal(result.maxRange, 10000)
  })

  it('parses QuickNode "exceeds the range"', () => {
    const err = new Error('Your request exceeds the range limit allowed by the provider')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
    assert.equal(result.maxRange, undefined) // no number captured
  })

  it('parses generic "block range is too wide"', () => {
    const err = new Error('block range is too wide')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
  })

  it('parses generic "range too large"', () => {
    const err = new Error('The range too large for this RPC')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
  })

  it('handles JSON-RPC error code -32005', () => {
    const rpcErr = { code: -32005, message: 'block range is too large' }
    const result = parseLogRangeError(rpcErr)
    assert.ok(result !== null)
  })

  it('handles JSON-RPC error code -32012 as range error', () => {
    const rpcErr = { code: -32012, message: 'upstream exhausted' }
    assert.deepEqual(parseLogRangeError(rpcErr), {})
  })

  it('handles nested error.error.message', () => {
    const nested = { error: { message: 'query returned more than 10000 results', code: -32000 } }
    const result = parseLogRangeError(nested)
    assert.ok(result !== null)
    assert.equal(result.maxRange, 10000)
  })

  it('returns {} (non-null) for range error with no number', () => {
    const err = new Error('block range is too wide')
    const result = parseLogRangeError(err)
    assert.ok(result !== null)
    assert.equal(result.maxRange, undefined)
    assert.equal(result.suggestedRange, undefined)
  })

  it('extracts the limit from any number in a block-range message (Astar/erpc -32603)', () => {
    const err = { error: { code: -32603, message: 'block range is too wide (maximum 1024)' } }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 1024 })
  })

  it('extracts the limit from a deeply-nested erpc range error (-32012)', () => {
    const err = {
      error: {
        code: -32012,
        message:
          'getLogs request exceeded max allowed range: block range is too wide (maximum 1024)',
        data: { code: 'ErrUpstreamsExhausted', details: { durationMs: 96, method: 'eth_getLogs' } },
      },
    }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 1024 })
  })

  it('does NOT treat "invalid block range" (-32602) as a range-too-large error', () => {
    // Happens e.g. when endBlock is in the future; should surface as-is, not be wrapped.
    const err = { code: 'UNKNOWN_ERROR', error: { code: -32602, message: 'invalid block range' } }
    assert.equal(parseLogRangeError(err), null)
  })

  it('does NOT extract -32602 code as maxRange from serialised JSON body', () => {
    const err = {
      code: 'UNKNOWN_ERROR',
      body: '{"error":{"code":-32602,"message":"invalid block range"}}',
    }
    assert.equal(parseLogRangeError(err), null)
  })

  it('handles erpc/hyperliquid 413 with responseBody containing max block range', () => {
    // Ethers SERVER_ERROR shape: string code, info.responseBody is a JSON string,
    // info.responseStatus carries the HTTP status.
    const err = {
      code: 'SERVER_ERROR',
      message: 'server response 413 Request Entity Too Large',
      info: {
        requestUrl: 'https://rpcs.chain.link/hyperevm/testnet',
        responseStatus: '413 Request Entity Too Large',
        responseBody: JSON.stringify({
          jsonrpc: '2.0',
          id: 32,
          error: {
            code: -32012,
            message: 'query exceeds max block range 1000',
            data: {
              code: 'ErrUpstreamsExhausted',
              message: 'all upstream attempts failed',
              details: { method: 'eth_getLogs' },
            },
          },
        }),
      },
    }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 1000 })
  })

  it('extracts maxRange from "Exceeded maximum block range: 1000" (hedera/other)', () => {
    const err = {
      code: 'SERVER_ERROR',
      message: 'server response 413 Request Entity Too Large',
      info: {
        responseStatus: '413 Request Entity Too Large',
        responseBody: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32012,
            message:
              'getLogs request exceeded max allowed range: [Request ID: ea947e85-7032-4c9e-a021-35e5a83763e3] Exceeded maximum block range: 1000',
          },
        }),
      },
    }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 1000 })
  })

  it('does NOT use HTTP 413 status code as maxRange when message carries the real limit', () => {
    // Regression: ethers err.message embeds all inner JSON; if treated as a message
    // string, BLOCK_RANGE_RE matches and FIRST_NUMBER_RE grabs 413, not 1000.
    const err = {
      code: 'SERVER_ERROR',
      message:
        'server response 413 Request Entity Too Large (request={}, response={}, error=null, info={"responseBody":"{\\"error\\":{\\"code\\":-32012,\\"message\\":\\"query exceeds max block range 1000\\"}}","responseStatus":"413 Request Entity Too Large"})',
      info: {
        requestUrl: 'https://rpcs.chain.link/hyperevm/testnet',
        responseStatus: '413 Request Entity Too Large',
        responseBody: JSON.stringify({
          error: { code: -32012, message: 'query exceeds max block range 1000' },
        }),
      },
    }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 1000 })
  })

  it('picks the LAST number as the limit, not the requested span', () => {
    // "block range too large (10000), maximum allowed is 2000 blocks":
    // first number (10000) is the rejected span, last (2000) is the real max.
    const err = {
      code: 'UNKNOWN_ERROR',
      error: {
        code: -32000,
        message: 'block range too large (10000), maximum allowed is 2000 blocks',
      },
    }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 2000 })
  })

  it('extracts maxRange from "Cannot request logs over more than 100 blocks"', () => {
    const err = {
      code: 'UNKNOWN_ERROR',
      error: {
        code: -32603,
        message: 'Error:\n  Cannot request logs over more than 100 blocks\n',
      },
    }
    assert.deepEqual(parseLogRangeError(err), { maxRange: 100 })
  })
})

// ---------------------------------------------------------------------------
// createRateLimitedFetch (migrated from utils.test.ts)
// ---------------------------------------------------------------------------

describe('createRateLimitedFetch', () => {
  let originalFetch: typeof fetch

  let mockedFetch: any

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockedFetch = undefined
  })

  it('should create a rate-limited fetch function', () => {
    const rateLimitedFetch = createRateLimitedFetch({})
    assert.equal(typeof rateLimitedFetch, 'function')
  })

  it('should allow requests within rate limit', async () => {
    globalThis.fetch = mockedFetch = mock.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({})

    const promise1 = rateLimitedFetch('https://rl-test-allow.example.com')
    const promise2 = rateLimitedFetch('https://rl-test-allow.example.com')

    await Promise.all([promise1, promise2])

    assert.equal(mockedFetch.mock.calls.length, 2)
  })

  it('should retry on 429 rate limit errors', async () => {
    let callCount = 0
    globalThis.fetch = mockedFetch = mock.fn(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      } as Response)
    })

    const rateLimitedFetch = createRateLimitedFetch({})

    const result = await rateLimitedFetch('https://rl-test-retry.example.com')
    assert.equal(result.ok, true)
    assert.equal(mockedFetch.mock.calls.length, 2)
  })

  it('should return non-retryable responses (e.g. 404) without throwing', async () => {
    globalThis.fetch = mockedFetch = mock.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({})

    const result = await rateLimitedFetch('https://rl-test-404.example.com')
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
    assert.equal(mockedFetch.mock.calls.length, 1) // no retries for non-transient
  })

  it('should respect maxRetries parameter and return transient response after exhaustion', async () => {
    globalThis.fetch = mockedFetch = mock.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers(),
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({ maxRetries: 2 })

    const result = await rateLimitedFetch('https://rl-test-retries.example.com')
    assert.equal(result.ok, false)
    assert.equal(result.status, 429)
    assert.equal(mockedFetch.mock.calls.length, 3) // Initial + 2 retries
  })

  it('should use default parameters when none provided', () => {
    const rateLimitedFetch = createRateLimitedFetch()
    assert.equal(typeof rateLimitedFetch, 'function')
  })

  it('should retry transient network aborts (slow RPC) unless caller cancelled', async () => {
    const abortError = Object.assign(
      new Error(
        'Request was aborted. This is usually intentional (e.g. user cancellation or component unmount).',
      ),
      { name: 'AbortError' },
    )

    // A slow RPC that aborts once, then responds → retried to success.
    let callCount = 0
    globalThis.fetch = mockedFetch = mock.fn(() => {
      callCount++
      if (callCount === 1) return Promise.reject(abortError)
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      } as Response)
    })
    const result = await createRateLimitedFetch({ maxRetries: 3 })(
      'https://rl-test-abort.example.com',
    )
    assert.equal(result.ok, true)
    assert.equal(mockedFetch.mock.calls.length, 2)

    // A caller-aborted signal must NOT be retried.
    const aborted = AbortSignal.abort()
    globalThis.fetch = mockedFetch = mock.fn(() => Promise.reject(abortError))
    await assert.rejects(
      createRateLimitedFetch({ maxRetries: 3 })('https://rl-test-abort2.example.com', {
        signal: aborted,
      }),
      /aborted/i,
    )
    assert.equal(mockedFetch.mock.calls.length, 1)
  })

  it('should handle network errors with retry logic', async () => {
    let callCount = 0
    globalThis.fetch = mockedFetch = mock.fn(() => {
      callCount++
      if (callCount === 1) {
        return Promise.reject(new Error('429 rate limit exceeded'))
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      } as Response)
    })

    const rateLimitedFetch = createRateLimitedFetch({})

    const result = await rateLimitedFetch('https://rl-test-network.example.com')
    assert.equal(result.ok, true)
  })
})

// ---------------------------------------------------------------------------
// Retry on transient status
// ---------------------------------------------------------------------------

describe('transient retry', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('retries a 429 then returns the eventual success', async () => {
    // Use a unique URL so endpoint state is fresh
    const url = 'https://transient-retry.example.com/rpc'
    let callCount = 0

    globalThis.fetch = mock.fn(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
      } as Response)
    })

    const rateLimitedFetch = createRateLimitedFetch({ maxRetries: 3 })
    // Should succeed after retry
    const result = await rateLimitedFetch(url)
    assert.equal(result.ok, true)
  })
})

// ---------------------------------------------------------------------------
// Proactive throttle (knownLimit.remaining === 0)
// ---------------------------------------------------------------------------

describe('proactive throttle', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('waits when remaining=0 before request completes', async () => {
    const url = 'https://proactive-throttle.example.com/rpc'
    let callCount = 0
    const requestTimes: number[] = []

    // First call returns remaining=0 with a reset 200ms away
    globalThis.fetch = mock.fn(() => {
      callCount++
      requestTimes.push(Date.now())
      const headers = new Headers()
      if (callCount === 1) {
        // Return remaining=0, reset=0 (already reset — short wait)
        headers.set('X-RateLimit-Remaining', '0')
        headers.set('X-RateLimit-Reset', '0') // delta=0s, resetAt = now
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers } as Response)
    })

    const rateLimitedFetch = createRateLimitedFetch({})
    await rateLimitedFetch(url)
    // Second call: remaining=0 but resetAt is in the past (already expired), so no hang
    await rateLimitedFetch(url)
    assert.equal(callCount, 2)
  })
})

// ---------------------------------------------------------------------------
// Adaptive limiting (full speed by default; learn + pace on contact)
// ---------------------------------------------------------------------------

describe('adaptive limiting', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const ok = (headers = new Headers()) =>
    ({ ok: true, status: 200, statusText: 'OK', headers }) as Response
  const methodHeaders = (limit: number, remaining: number) => {
    const h = new Headers()
    h.set('x-ratelimit-method-limit', String(limit))
    h.set('x-ratelimit-method-remaining', String(remaining))
    return h
  }
  const rpc = (method: string, id = 0) => ({
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id, method }),
  })

  it('runs at full speed when nothing rate-limits it (no pacing overhead)', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve(ok()))
    const f = createRateLimitedFetch({})
    const url = 'https://adapt-fullspeed.example.com/rpc'
    const t0 = Date.now()
    for (let i = 0; i < 10; i++) await f(url, rpc('getThing', i))
    assert.ok(Date.now() - t0 < 300, `expected no pacing, took ${Date.now() - t0}ms`)
  })

  it('an occasional 429 is just retried at full speed (no pacing)', async () => {
    let calls = 0
    globalThis.fetch = mock.fn(() => {
      calls++
      // A single, isolated 429 (no reset window) — bursts are tolerated, so we
      // must NOT start pacing; just retry quickly.
      if (calls === 2) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: methodHeaders(1, 0),
        } as Response)
      }
      return Promise.resolve(ok(methodHeaders(1, 1)))
    })
    const f = createRateLimitedFetch({})
    const url = 'https://adapt-occasional.example.com/rpc'
    const t0 = Date.now()
    for (let i = 0; i < 4; i++) await f(url, rpc('getSignaturesForAddress', i))
    // One backoff (~250ms) at most, no per-second pacing.
    assert.ok(Date.now() - t0 < 1000, `expected full-speed retry, took ${Date.now() - t0}ms`)
  })

  it('paces precisely when the server gives an explicit reset window', async () => {
    let calls = 0
    const h = () =>
      makeHeaders({ 'RateLimit-Limit': '1', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '1' })
    globalThis.fetch = mock.fn(() => {
      calls++
      if (calls === 2) {
        return Promise.resolve({ ok: false, status: 429, statusText: '', headers: h() } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: h() } as Response)
    })
    const f = createRateLimitedFetch({})
    const url = 'https://adapt-window.example.com/rpc'
    const t0 = Date.now()
    for (let i = 0; i < 3; i++) await f(url, rpc('m', i))
    // Explicit 1s reset window → activate and pace ~1s.
    assert.ok(Date.now() - t0 >= 800, `expected ~1s pacing, took ${Date.now() - t0}ms`)
  })

  it('does not pace burst-tolerant 429s (count header, no reset window) — retries fast', async () => {
    let calls = 0
    globalThis.fetch = mock.fn(() => {
      calls++
      // Every 3rd call 429s with a method-limit count but NO reset window
      // (Solana-style). Such 429s must be retried, not paced.
      if (calls % 3 === 0) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: methodHeaders(1, 0),
        } as Response)
      }
      return Promise.resolve(ok(methodHeaders(1, 1)))
    })
    const f = createRateLimitedFetch({})
    const url = 'https://adapt-burst.example.com/rpc'
    const t0 = Date.now()
    for (let i = 0; i < 12; i++) await f(url, rpc('m', i))
    // Header-less 429s never activate pacing → only cheap retry backoffs.
    assert.ok(Date.now() - t0 < 4000, `expected burst+retry (no pacing), took ${Date.now() - t0}ms`)
  })

  it('drains an over-cap pacing backlog instead of failing the requests', async () => {
    let calls = 0
    globalThis.fetch = mock.fn(async () => {
      calls++
      return ok()
    })
    // 1 request per 250ms pacer with a small (test-only) backlog ceiling: the
    // concurrent burst reserves ~750ms of slots, so the tail requests exceed
    // the cap and fail fast in acquire(). They must then sleep off the
    // already-reserved backlog and still go out — no hard failure, no retry
    // storm (calls stays at the request count).
    const f = createRateLimitedFetch({
      seed: { limit: 1, windowMs: 250 },
      maxPacingBacklogMs: 300,
    })
    const url = 'https://drain-backlog.example.com/rpc'
    const t0 = Date.now()
    await Promise.all(Array.from({ length: 4 }, (_, i) => f(url, rpc('m', i))))
    const elapsed = Date.now() - t0
    assert.equal(calls, 4)
    // The second request's slot is the only hard timing guarantee of the run: the
    // tail requests fail fast, then re-enter after draining the already-reserved
    // backlog at whatever backlog the scheduler observes — the exact slot count is
    // non-deterministic on loaded runners (CI saw ~300ms of scheduler-dependent
    // drain). Pacing missing entirely would finish in milliseconds, so one slot
    // (windowMs) discriminates paced drain from full speed.
    assert.ok(elapsed >= 250, `expected at least one paced slot, took ${elapsed}ms`)
    assert.ok(elapsed < 10_000, `took suspiciously long: ${elapsed}ms`)
  })

  it('seeded (TON-like) limiter doubles window on consecutive header-less 429s', async () => {
    let calls = 0
    globalThis.fetch = mock.fn(() => {
      calls++
      if (calls <= 3) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
        } as Response)
      }
      return Promise.resolve(ok())
    })
    // seed at 10ms (simulates TON's 1.5s but fast enough for a unit test)
    const f = createRateLimitedFetch({ seed: { limit: 1, windowMs: 10 } })
    const url = 'https://ton-backoff.example.com/rpc'
    const t0 = Date.now()
    await f(url, rpc('m', 0))
    const elapsed = Date.now() - t0
    // window doubles each 429: 10→20→40→80ms. Total pacing wait ≥ 70ms.
    // Without doubling: only 3×10ms = 30ms. So ≥ 50ms distinguishes the two.
    assert.ok(elapsed >= 50, `expected exponential window doubling, took ${elapsed}ms`)
    assert.equal(calls, 4)
  })

  it('caps concurrent in-flight requests per endpoint, flushing as each completes', async () => {
    let inFlight = 0
    let maxObserved = 0
    globalThis.fetch = mock.fn(async () => {
      inFlight++
      maxObserved = Math.max(maxObserved, inFlight)
      await new Promise((r) => setTimeout(r, 40))
      inFlight--
      return ok()
    })
    const f = createRateLimitedFetch({ maxInFlight: 2 })
    const url = 'https://concurrency-cap.example.com/rpc'
    await Promise.all(Array.from({ length: 6 }, (_, i) => f(url, rpc('m', i))))
    assert.ok(maxObserved <= 2, `max in-flight was ${maxObserved}, expected <= 2`)
    assert.equal(
      (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
      6,
    )
  })

  it('collapses concurrency toward 1 under sustained 429s, then completes', async () => {
    let inFlight = 0
    let served = 0
    const inflightAtServe: number[] = []
    globalThis.fetch = mock.fn(async () => {
      inFlight++
      const idx = ++served
      inflightAtServe.push(inFlight)
      await new Promise((r) => setTimeout(r, 15))
      inFlight--
      // First 12 served responses 429 (no reset window); then succeed.
      if (idx <= 12) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: methodHeaders(1, 0),
        } as Response
      }
      return ok()
    })
    const f = createRateLimitedFetch({ maxInFlight: 5, maxRetries: 12 })
    const url = 'https://aimd-sem.example.com/rpc'
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => f(url, rpc('m', i))))
    // All complete successfully (the "sometimes doesn't complete" bug).
    assert.equal(results.filter((r) => r.ok).length, 5)
    // After the initial burst of 5, the 429s halve the cap → later sends run at
    // ≤2 in flight (collapsing toward 1).
    const afterBurst = inflightAtServe.slice(5)
    const peak = Math.max(...afterBurst)
    assert.ok(peak <= 2, `expected collapse to ≤2 in-flight after burst, saw ${peak}`)
  })
})

// ---------------------------------------------------------------------------
// createAxiosFetchAdapter
// ---------------------------------------------------------------------------

describe('createAxiosFetchAdapter', () => {
  it('returns a function (the adapter)', () => {
    const adapter = createAxiosFetchAdapter(globalThis.fetch)
    assert.equal(typeof adapter, 'function')
  })

  it('returns a function when abort is provided', () => {
    const abort = new AbortController().signal
    const adapter = createAxiosFetchAdapter(globalThis.fetch, abort)
    assert.equal(typeof adapter, 'function')
  })

  it('without abort, same adapter reference behavior (returns function)', () => {
    const adapter1 = createAxiosFetchAdapter(globalThis.fetch)
    const adapter2 = createAxiosFetchAdapter(globalThis.fetch)
    assert.equal(typeof adapter1, 'function')
    assert.equal(typeof adapter2, 'function')
  })
})

describe('parseTopicLimitError', () => {
  it('recognises common phrasings and extracts the cap when stated', () => {
    for (const [msg, want] of [
      ['too many topics in filter', undefined],
      ['requested too many topics', undefined],
      ['eth_getLogs is limited to 5 topics', 5],
      ['limited to a maximum of 4 topics', 4],
      ['maximum number of topics is 5', 5],
      ['max topics: 3', 3],
      ['topics limit exceeded', undefined],
    ] as const) {
      const info = parseTopicLimitError({ code: -32602, message: msg })
      assert.notEqual(info, null, `should match: ${msg}`)
      assert.equal(info?.maxTopics, want, `cap for: ${msg}`)
    }
  })

  it('does NOT match a block-range error', () => {
    // Confusing the two would shrink the wrong dimension forever: a range error
    // would teach a bogus topic cap and split every filter for no reason.
    for (const msg of [
      'query returned more than 10000 results',
      'block range too large (maximum 2000)',
      'up to a 10000 block range',
      'Exceeded maximum block range: 1000',
    ]) {
      assert.equal(parseTopicLimitError({ code: -32005, message: msg }), null, msg)
      assert.notEqual(parseLogRangeError({ code: -32005, message: msg }), null, msg)
    }
  })

  it('returns null for unrelated errors and nullish input', () => {
    assert.equal(parseTopicLimitError(null), null)
    assert.equal(parseTopicLimitError(undefined), null)
    assert.equal(parseTopicLimitError(new Error('execution reverted')), null)
    assert.equal(parseTopicLimitError({ code: -32000, message: 'header not found' }), null)
  })

  it('finds the message nested in a JSON-RPC error body', () => {
    const info = parseTopicLimitError({
      code: 'SERVER_ERROR',
      info: { error: { code: -32602, message: 'eth_getLogs is limited to 5 topics' } },
    })
    assert.deepEqual(info, { maxTopics: 5 })
  })
})

describe('endpoint topic limit', () => {
  it('stores and reads back per endpoint, keyed like the log range', () => {
    const a = 'https://topiclimit-a.example/rpc'
    const b = 'https://topiclimit-b.example/rpc'
    assert.equal(getEndpointTopicLimit(a), undefined)

    setEndpointTopicLimit(a, 5, 'error')
    assert.equal(getEndpointTopicLimit(a), 5)
    // A cap learned for one provider must not leak to another: the whole point of
    // storing it per endpoint is that a round-robin spans several providers.
    assert.equal(getEndpointTopicLimit(b), undefined)

    // Independent of the log-range slot on the same endpoint.
    setEndpointLogRange(a, 1000, 'error')
    assert.equal(getEndpointTopicLimit(a), 5)
    assert.equal(getEndpointLogRange(a), 1000)
  })
})
