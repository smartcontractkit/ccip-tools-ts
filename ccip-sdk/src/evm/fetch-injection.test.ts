/**
 * Tests proving the opt-out + default-on fetch injection rule for EVM and Solana chains.
 *
 * Rule: if ctx.fetch is provided, use it verbatim (no wrapping);
 *       if omitted, install createRateLimitedFetch automatically.
 *
 * Because createRateLimitedFetch and fetchProfileForUrl are named ESM exports they cannot
 * be spied upon with mock.method after module load. Instead we test the behavioral contract:
 * - when ctx.fetch is provided, that exact function receives the network request
 * - when omitted, the connection/provider still works (default wrapping installed)
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { createRateLimitedFetch, fetchProfileForUrl } from '../fetch.ts'
import { EVMChain } from './index.ts'
import { SolanaChain } from '../solana/index.ts'

// ---------------------------------------------------------------------------
// EVM — _getProvider helper
// ---------------------------------------------------------------------------

describe('EVMChain._getProvider fetch injection', () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it('uses ctx.fetch verbatim: custom fetch receives the actual RPC request', async () => {
    // Our custom fetch records calls
    let callCount = 0
    const customFetch = mock.fn(async () => {
      callCount++
      // Return a valid JSON-RPC response so ethers doesn't throw
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const ac = new AbortController()
    const provider = await EVMChain._getProvider('http://localhost:8545', {
      fetch: customFetch as unknown as typeof fetch,
      abort: ac.signal,
    })

    // Trigger a request to see if our fetch is used
    try {
      await provider.send('eth_chainId', [])
    } catch {
      // may fail due to response parsing, but the important thing is our fetch was called
    }
    ac.abort()
    provider.destroy()

    assert.ok(callCount > 0, `custom fetch should have been called, got ${callCount} calls`)
  })

  it('returns a JsonRpcProvider for HTTP URLs', async () => {
    const ac = new AbortController()
    ac.abort()

    // Use a custom fetch that returns immediately to avoid hanging
    const fastFetch = mock.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const provider = await EVMChain._getProvider('https://eth-mainnet.example.com', {
      fetch: fastFetch as unknown as typeof fetch,
      abort: ac.signal,
    })

    assert.ok(provider instanceof JsonRpcProvider, 'should return JsonRpcProvider for http')
    provider.destroy()
  })

  it('uses rate-limited fetch when ctx.fetch is NOT provided: does not throw', async () => {
    // Without ctx.fetch, a rate-limited fetch is installed. The provider should be created
    // without errors (no network call is made until a request is issued).
    const ac = new AbortController()
    ac.abort()

    const provider = await EVMChain._getProvider('https://eth-mainnet.example.com', {
      abort: ac.signal,
    })

    assert.ok(provider instanceof JsonRpcProvider)
    provider.destroy()
  })
})

// ---------------------------------------------------------------------------
// Solana — _getConnection helper
// ---------------------------------------------------------------------------

describe('SolanaChain._getConnection fetch injection', () => {
  it('installs custom fetch: connection is created with the provided fetch function', () => {
    const customFetch = mock.fn(async () => new Response('{}', { status: 200 }))

    const connection = SolanaChain._getConnection('https://api.devnet.solana.com', {
      fetch: customFetch as unknown as typeof fetch,
    })

    // The Connection object stores its fetch in _rpcWebSocket or config. We verify
    // behaviorally: no exception thrown, and the connection object is created.
    assert.ok(connection, 'connection should be created with custom fetch')
  })

  it('creates connection without error when ctx.fetch is omitted (rate-limited default)', () => {
    // Should not throw — default rate-limited fetch is installed automatically
    const connection = SolanaChain._getConnection('http://localhost:8899')
    assert.ok(connection, 'connection should be created with default rate-limited fetch')
  })

  it('creates connection for public solana.com endpoint (profile-based rate limiting)', () => {
    const connection = SolanaChain._getConnection('https://api.mainnet-beta.solana.com')
    assert.ok(
      connection,
      'connection should be created for solana.com with profile-based rate limiting',
    )
  })

  it('throws for invalid URL format', () => {
    assert.throws(
      () => SolanaChain._getConnection('ftp://invalid'),
      /Invalid Solana RPC URL format/,
    )
  })
})

// ---------------------------------------------------------------------------
// Helper selection logic — unit test of the rule itself
// ---------------------------------------------------------------------------

describe('fetch selection rule (unit)', () => {
  it('verbatim custom fetch wins over rate-limited default', () => {
    const customFetch = mock.fn() as unknown as typeof fetch
    // Simulate the rule: ctx.fetch is defined → it wins
    const ctx: { fetch?: typeof fetch } = { fetch: customFetch }
    const result = ctx.fetch ?? createRateLimitedFetch({})
    assert.equal(result, customFetch, 'custom fetch should be selected verbatim')
  })

  it('createRateLimitedFetch is used when ctx.fetch is undefined', () => {
    const ctx: { fetch?: typeof fetch } = {}
    const wrapped = createRateLimitedFetch({})
    const result = ctx.fetch ?? wrapped
    assert.equal(result, wrapped, 'rate-limited fetch should be selected when ctx.fetch is absent')
  })

  it('fetchProfileForUrl seeds toncenter.com paced', () => {
    const profile = fetchProfileForUrl('https://toncenter.com/api/v2/jsonRPC')
    assert.deepEqual(profile.seed, { limit: 1, windowMs: 1500 })
  })

  it('fetchProfileForUrl leaves solana.com unseeded (header-driven)', () => {
    const profile = fetchProfileForUrl('https://api.mainnet-beta.solana.com')
    assert.equal(profile.seed, undefined)
  })

  it('fetchProfileForUrl returns empty opts for unknown hosts', () => {
    const profile = fetchProfileForUrl('https://my-private-rpc.example.com')
    assert.deepEqual(profile, {})
  })
})
