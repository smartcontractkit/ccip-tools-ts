/**
 * Unit tests for createCantonClient fetch-adapter threading.
 *
 * Verifies that:
 * - When `fetch` is supplied in config, HTTP traffic is routed through it.
 * - The shared createAxiosFetchAdapter helper is used (same underlying helper as TON).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createCantonClient } from './client.ts'
import { createAxiosFetchAdapter } from '../../fetch.ts'

const BASE_URL = 'http://localhost:7575'
const JWT = 'test-jwt'

/**
 * Build a spy fetch that returns a 200 JSON response.
 */
function makeFetchSpy(body: unknown = {}): {
  spy: typeof fetch
  calls: Array<{ url: string }>
} {
  const calls: Array<{ url: string }> = []
  const spy: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push({ url })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { spy, calls }
}

describe('canton/client — custom fetch threading', () => {
  it('createAxiosFetchAdapter produces a callable adapter from a fetch spy', () => {
    // Verify the shared helper is importable and returns an adapter function
    const { spy } = makeFetchSpy()
    const adapter = createAxiosFetchAdapter(spy)
    assert.equal(typeof adapter, 'function')
  })

  it('routes requests through custom fetch when provided (isAlive → GET /livez)', async () => {
    const { spy, calls } = makeFetchSpy()

    const client = createCantonClient({ baseUrl: BASE_URL, jwt: JWT, fetch: spy })
    // isAlive() issues GET /livez through get2 → request → adapter
    const alive = await client.isAlive()

    assert.ok(alive, 'expected isAlive() to return true with spy fetch returning 200')
    assert.ok(calls.length >= 1, `expected at least 1 call to spy fetch, got ${calls.length}`)
    assert.ok(
      calls[0]!.url.includes('/livez'),
      `expected /livez to be fetched, got: ${calls[0]!.url}`,
    )
  })

  it('custom fetch with abort signal is routed through spy', async () => {
    const ac = new AbortController()
    const { spy, calls } = makeFetchSpy()

    const client = createCantonClient({
      baseUrl: BASE_URL,
      jwt: JWT,
      fetch: spy,
      signal: ac.signal,
    })
    await client.isAlive()

    assert.ok(calls.length >= 1, 'expected fetch spy to be called when abort signal is set')
    void spy
  })

  it('fetch is optional — omitting it does not break createCantonClient()', () => {
    // No fetch → no fetchAdapter; the client falls back to cantonHttp (HTTP/2).
    // We only assert construction succeeds; network calls are not made here.
    const client = createCantonClient({ baseUrl: BASE_URL, jwt: JWT })
    assert.equal(typeof client.isAlive, 'function', 'client should expose isAlive method')
    assert.equal(typeof client.isReady, 'function', 'client should expose isReady method')
  })
})
