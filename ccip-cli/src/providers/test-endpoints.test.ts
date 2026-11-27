import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import {
  DEFAULT_RPC_ENDPOINTS,
  evmForkProbe,
  healthyEvmRpcEndpoints,
  raceRpcEndpoint,
  reachableEvmForkEndpoint,
  reachableRpcEndpoint,
  rpcCandidates,
} from '../../../scripts/test-endpoints.ts'

describe('healthyEvmRpcEndpoints', () => {
  const original = process.env.RPC_BASE_SEPOLIA
  afterEach(() => {
    if (original === undefined) delete process.env.RPC_BASE_SEPOLIA
    else process.env.RPC_BASE_SEPOLIA = original
    mock.restoreAll()
  })

  it('keeps only endpoints that answer a head block read, in configured order', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://chain-id-only.test,https://ok.test'
    const fetchMock = mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      const { method } = JSON.parse(init?.body as string) as { method: string }
      if (url === 'https://chain-id-only.test') {
        return method === 'eth_chainId'
          ? Response.json({ result: '0x14a34' })
          : new Response('', { status: 429 })
      }
      if (method === 'eth_blockNumber') return Response.json({ result: '0x10' })
      if (method === 'eth_getBlockByNumber') return Response.json({ result: { number: '0x10' } })
      return Response.json({ result: '0x14a34' })
    })
    assert.deepEqual(await healthyEvmRpcEndpoints('RPC_BASE_SEPOLIA'), ['https://ok.test'])
    assert.equal(fetchMock.mock.callCount(), 4, 'the failed endpoint gets one retry')
  })

  it('keeps every fallback when no endpoint answers a block', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://a.test,https://b.test'
    mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }))
    assert.deepEqual(
      await healthyEvmRpcEndpoints('RPC_BASE_SEPOLIA'),
      rpcCandidates('RPC_BASE_SEPOLIA'),
    )
  })

  it('falls back to public defaults when every configured endpoint is down', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://down.test'
    const publicUrl = DEFAULT_RPC_ENDPOINTS.RPC_BASE_SEPOLIA.split(',')[0]!
    mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      if (url !== publicUrl) return new Response('', { status: 429 })
      const { method } = JSON.parse(init?.body as string) as { method: string }
      if (method === 'eth_blockNumber') return Response.json({ result: '0x10' })
      if (method === 'eth_getBlockByNumber') return Response.json({ result: { number: '0x10' } })
      return Response.json({ result: '0x14a34' })
    })
    assert.deepEqual(await healthyEvmRpcEndpoints('RPC_BASE_SEPOLIA'), [publicUrl])
  })
})

describe('evmForkProbe', () => {
  afterEach(() => mock.restoreAll())

  it('accepts an endpoint that answers the chain id, a head block and a state read', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
      const { method } = JSON.parse(init?.body as string) as { method: string }
      if (method === 'eth_chainId') return Response.json({ result: '0x14a34' })
      if (method === 'eth_blockNumber') return Response.json({ result: '0x10' })
      if (method === 'eth_getBlockByNumber') return Response.json({ result: { number: '0x10' } })
      return Response.json({ result: '0x00' })
    })
    assert.equal(await evmForkProbe(84532)('https://fork.test'), true)
    assert.equal(fetchMock.mock.callCount(), 4)
  })

  it('rejects another chain id, a missing head block or a failed state read', async () => {
    const respond = (method: string, init?: RequestInit) =>
      JSON.parse(init?.body as string).method === method
    const mockRpc = (failing: string, result?: unknown) =>
      mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        if (respond(failing, init)) return Response.json({ result })
        if (respond('eth_chainId', init)) return Response.json({ result: '0x14a34' })
        if (respond('eth_blockNumber', init)) return Response.json({ result: '0x10' })
        if (respond('eth_getBlockByNumber', init))
          return Response.json({ result: { number: '0x10' } })
        return Response.json({ result: '0x00' })
      })

    mockRpc('eth_chainId', '0x1')
    assert.equal(await evmForkProbe(84532)('https://fork.test'), false, 'other chain id')
    mock.restoreAll()

    for (const method of ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getStorageAt']) {
      mockRpc(method, undefined)
      assert.equal(await evmForkProbe(84532)('https://fork.test'), false, method)
      mock.restoreAll()
    }

    mockRpc('eth_getBlockByNumber', { number: '0x11' })
    assert.equal(
      await evmForkProbe(84532)('https://fork.test'),
      false,
      'block number must match the reported head',
    )
  })
})

describe('reachableEvmForkEndpoint', () => {
  const original = process.env.RPC_BASE_SEPOLIA
  afterEach(() => {
    if (original === undefined) delete process.env.RPC_BASE_SEPOLIA
    else process.env.RPC_BASE_SEPOLIA = original
    mock.restoreAll()
  })

  it('skips an endpoint that fails the fork reads and returns the next one', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://storage-down.test,https://ok.test'
    mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      const { method } = JSON.parse(init?.body as string) as { method: string }
      if (url === 'https://storage-down.test' && method === 'eth_getStorageAt')
        return new Response('', { status: 429 })
      if (method === 'eth_chainId') return Response.json({ result: '0x14a34' })
      if (method === 'eth_blockNumber') return Response.json({ result: '0x10' })
      if (method === 'eth_getBlockByNumber') return Response.json({ result: { number: '0x10' } })
      return Response.json({ result: '0x00' })
    })
    assert.equal(await reachableEvmForkEndpoint('RPC_BASE_SEPOLIA', 84532), 'https://ok.test')
  })
})

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

  it('aborts losing probes after an unordered race selects a winner', async () => {
    process.env.RPC_BASE_SEPOLIA = 'https://slow.test,https://fast.test'
    let slowSignal: AbortSignal | undefined
    const selected = await raceRpcEndpoint(
      'RPC_BASE_SEPOLIA',
      (url, signal) => {
        if (url === 'https://fast.test') return Promise.resolve(true)
        if (url !== 'https://slow.test') return Promise.resolve(false)
        slowSignal = signal
        return new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => resolve(false), { once: true })
        })
      },
      { attempts: 1, timeoutMs: 1_000 },
    )
    assert.equal(selected, 'https://fast.test')
    assert.equal(slowSignal?.aborted, true)
  })

  it('reports a probe timeout and the public selection without exposing configured URLs', async () => {
    process.env.NETWORK_TEST_TIMINGS = '1'
    const privateUrl = 'https://private-key.test/path?token=secret'
    process.env.RPC_BASE_SEPOLIA = privateUrl
    const log = mock.method(console, 'error', () => {})
    let probeSignal: AbortSignal | undefined
    const selected = await raceRpcEndpoint(
      'RPC_BASE_SEPOLIA',
      (url, signal) => {
        if (url !== privateUrl) return Promise.resolve(true)
        probeSignal = signal
        return new Promise<boolean>(() => {})
      },
      { ordered: true, attempts: 1, timeoutMs: 10 },
    )
    assert.equal(selected, DEFAULT_RPC_ENDPOINTS.RPC_BASE_SEPOLIA.split(',')[0])
    assert.equal(probeSignal?.aborted, true, 'a probe timeout aborts its in-flight request')
    const output = log.mock.calls.map(({ arguments: args }) => args.join(' ')).join('\n')
    assert.match(output, /rpc-probe .*endpoint=configured-1 .*result=timeout duration_ms=\d+/)
    assert.match(output, /rpc-select .*endpoint=gateway\.tenderly\.co result=selected/)
    assert.doesNotMatch(output, /private-key|token=secret/)
  })
})
