import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import {
  DEFAULT_RPC_ENDPOINTS,
  raceRpcEndpoint,
  reachableRpcEndpoint,
} from '../../../scripts/test-endpoints.ts'

describe('reachableRpcEndpoint', () => {
  const original = process.env.RPC_BASE_SEPOLIA
  const originalTimings = process.env.NETWORK_TEST_TIMINGS
  afterEach(() => {
    if (original === undefined) delete process.env.RPC_BASE_SEPOLIA
    else process.env.RPC_BASE_SEPOLIA = original
    if (originalTimings === undefined) delete process.env.NETWORK_TEST_TIMINGS
    else process.env.NETWORK_TEST_TIMINGS = originalTimings
    mock.restoreAll()
  })

  it('returns the first candidate that answers eth_chainId, in configured order', async () => {
    process.env.RPC_BASE_SEPOLIA =
      'https://down.test,https://throttled.test,https://quota.test,https://blocked.test,https://ok.test,https://later.test'
    const fetchMock = mock.method(globalThis, 'fetch', async (url: string) => {
      if (url === 'https://down.test') throw new Error('EPROTO')
      if (url === 'https://throttled.test') return new Response('', { status: 429 })
      if (url === 'https://quota.test') return Response.json({ error: { code: -32007 } })
      if (url === 'https://blocked.test') return new Response('<html>Blocked</html>')
      return Response.json({ result: '0x14a34' })
    })
    assert.equal(await reachableRpcEndpoint('RPC_BASE_SEPOLIA'), 'https://ok.test')
    assert.equal(fetchMock.mock.callCount(), 5)
  })

  it('tries public defaults after unavailable configured entries', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://unavailable.test'
    const publicUrl = DEFAULT_RPC_ENDPOINTS.RPC_BASE_SEPOLIA.split(',')[0]!
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (url === publicUrl) return Response.json({ result: '0x14a34' })
      throw new Error('offline')
    })
    assert.equal(await reachableRpcEndpoint('RPC_BASE_SEPOLIA'), publicUrl)
  })

  it('falls back to the first entry when no candidate answers', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://a.test,https://b.test'
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline')
    })
    assert.equal(await reachableRpcEndpoint('RPC_BASE_SEPOLIA'), 'https://a.test')
  })

  it('reports a probe timeout and the public selection without exposing configured URLs', async () => {
    process.env.NETWORK_TEST_TIMINGS = '1'
    const privateUrl = 'https://private-key.test/path?token=secret'
    process.env.RPC_BASE_SEPOLIA = privateUrl
    const log = mock.method(console, 'error', () => {})
    const selected = await raceRpcEndpoint(
      'RPC_BASE_SEPOLIA',
      (url) => (url === privateUrl ? new Promise<boolean>(() => {}) : Promise.resolve(true)),
      { ordered: true, attempts: 1, timeoutMs: 10 },
    )
    assert.equal(selected, DEFAULT_RPC_ENDPOINTS.RPC_BASE_SEPOLIA.split(',')[0])
    const output = log.mock.calls.map(({ arguments: args }) => args.join(' ')).join('\n')
    assert.match(output, /rpc-probe .*endpoint=configured-1 .*result=timeout duration_ms=\d+/)
    assert.match(output, /rpc-select .*endpoint=gateway\.tenderly\.co result=selected/)
    assert.doesNotMatch(output, /private-key|token=secret/)
  })
})
