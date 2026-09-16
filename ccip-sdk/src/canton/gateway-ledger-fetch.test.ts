import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createGatewayLedgerFetch } from './gateway-ledger-fetch.ts'

function mockFetch(handler: (req: Request) => Promise<Response> | Response) {
  const calls: Request[] = []
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    calls.push(req)
    return handler(req)
  }
  return { fetchFn, calls }
}

describe('createGatewayLedgerFetch', () => {
  const gatewayUrl = 'https://gateway.example.com/rpc'
  const ledgerBaseUrl = 'https://ledger.example.com/api/json'

  it('passes through requests outside the ledger base URL unchanged', async () => {
    const { fetchFn, calls } = mockFetch(() => new Response('{}', { status: 200 }))
    const gwFetch = createGatewayLedgerFetch({
      gatewayUrl,
      accessToken: 'tok',
      ledgerBaseUrl,
      fetchFn,
    })
    await gwFetch('https://eds.example.com/some/path')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'https://eds.example.com/some/path')
  })

  it('assigns a unique, monotonic id per request within one instance', async () => {
    const { fetchFn, calls } = mockFetch(() =>
      new Response(JSON.stringify({ result: {} }), { status: 200 }),
    )
    const gwFetch = createGatewayLedgerFetch({
      gatewayUrl,
      accessToken: 'tok',
      ledgerBaseUrl,
      fetchFn,
    })
    await gwFetch(`${ledgerBaseUrl}/v2/state/active-contracts`)
    await gwFetch(`${ledgerBaseUrl}/v2/state/active-contracts`)

    const ids = await Promise.all(
      calls.map(async (c) => ((await c.clone().json()) as { id: string }).id),
    )
    assert.equal(new Set(ids).size, 2)
  })

  it('gives each createGatewayLedgerFetch instance its own id counter', async () => {
    const { fetchFn, calls } = mockFetch(() =>
      new Response(JSON.stringify({ result: {} }), { status: 200 }),
    )
    const gwFetchA = createGatewayLedgerFetch({ gatewayUrl, accessToken: 'tok', ledgerBaseUrl, fetchFn })
    const gwFetchB = createGatewayLedgerFetch({ gatewayUrl, accessToken: 'tok', ledgerBaseUrl, fetchFn })
    await gwFetchA(`${ledgerBaseUrl}/v2/state/active-contracts`)
    await gwFetchB(`${ledgerBaseUrl}/v2/state/active-contracts`)

    const ids = await Promise.all(
      calls.map(async (c) => ((await c.clone().json()) as { id: string }).id),
    )
    assert.deepEqual(ids, ['gw-ledger-0', 'gw-ledger-0'])
  })

  it('routes /livez through the gateway instead of faking success without a network call', async () => {
    const { fetchFn, calls } = mockFetch(() => new Response('', { status: 200 }))
    const gwFetch = createGatewayLedgerFetch({
      gatewayUrl,
      accessToken: 'tok',
      ledgerBaseUrl,
      fetchFn,
    })
    const res = await gwFetch(`${ledgerBaseUrl}/livez`)
    assert.equal(calls.length, 1)
    assert.equal(res.status, 200)
  })

  it('tolerates an empty JSON-RPC response body from /livez', async () => {
    const { fetchFn } = mockFetch(() => new Response('', { status: 200 }))
    const gwFetch = createGatewayLedgerFetch({
      gatewayUrl,
      accessToken: 'tok',
      ledgerBaseUrl,
      fetchFn,
    })
    const res = await gwFetch(`${ledgerBaseUrl}/livez`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {})
  })
})
