import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { DEFAULT_RPC_ENDPOINTS, reachableRpcEndpoint } from '../../../scripts/test-endpoints.ts'

describe('reachableRpcEndpoint', () => {
  const original = process.env.RPC_BASE_SEPOLIA
  afterEach(() => {
    if (original === undefined) delete process.env.RPC_BASE_SEPOLIA
    else process.env.RPC_BASE_SEPOLIA = original
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
})
