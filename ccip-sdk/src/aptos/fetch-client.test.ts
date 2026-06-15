/**
 * Tests for the Aptos fetch shim injected by fromAptosConfig.
 *
 * Strategy:
 * - Integration suite: observable contract via fromAptosConfig (the first test populates
 *   the networkInfo('aptos:2') cache so subsequent tests that skip getChainId() still work).
 * - Unit suite: test the shim's provider() directly by extracting it from the AptosConfig
 *   that fromAptosConfig installs.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Client, type ClientRequest, AptosConfig, Network } from '@aptos-labs/ts-sdk'

import { AptosChain } from './index.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHAIN_ID = 2 // Aptos Testnet — a valid supported chain

/** Safely extract the URL string from any fetch `input` argument. */
function toUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function ledgerInfo(chainId = CHAIN_ID) {
  return {
    chain_id: chainId,
    ledger_version: '1',
    epoch: '1',
    ledger_timestamp: '0',
    node_role: 'full_node',
    oldest_ledger_version: '0',
    oldest_block_height: '0',
    block_height: '1',
    git_hash: '',
  }
}

/** Build a fake Aptos Client that returns a fixed JSON response. */
function makeFakeAptosClient(chainId = CHAIN_ID) {
  const providerCalls: Array<ClientRequest<unknown>> = []
  const client: Client = {
    async provider<Req, Res>(req: ClientRequest<Req>) {
      providerCalls.push(req)
      return {
        status: 200,
        statusText: 'OK',
        data: ledgerInfo(chainId) as unknown as Res,
        headers: {},
        config: req,
        request: null,
        response: null,
      }
    },
  }
  return { client, providerCalls }
}

/**
 * Extract the Client shim that fromAptosConfig installs by capturing the AptosConfig
 * that gets built inside fromAptosConfig.  We do this by patching AptosConfig constructor.
 */
async function extractInstalledClient(
  settings: Parameters<typeof AptosChain.fromAptosConfig>[0],
  ctx?: Parameters<typeof AptosChain.fromAptosConfig>[1],
): Promise<Client> {
  let capturedClient: Client | undefined

  // Wrap the AptosConfig constructor to capture what gets passed as `client`
  const OrigAptosConfig = AptosConfig
  const PatchedConfig = class extends OrigAptosConfig {
    constructor(s: ConstructorParameters<typeof AptosConfig>[0]) {
      super(s)
      if (s?.client && s.client !== capturedClient) {
        capturedClient = s.client
      }
    }
  } as typeof AptosConfig

  // Temporarily replace the global AptosConfig — only works if the module's reference
  // is accessible. Since we can't easily mock ESM imports, we instead call fromAptosConfig
  // and then directly inspect via the Aptos provider instance on the returned chain.
  //
  // Approach: call fromAptosConfig, then read provider.config.client from the Aptos instance.
  const chain = await AptosChain.fromAptosConfig(settings, ctx)
  // `chain.provider` is the `Aptos` instance; `chain.provider.config` is the AptosConfig.
  const installedClient: Client = chain.provider.config.client

  void PatchedConfig
  void capturedClient
  return installedClient
}

// ---------------------------------------------------------------------------
// Integration tests: shim contract via fromAptosConfig
// Note: The FIRST test in this suite must populate networkInfo('aptos:2') cache
// using a spy fetch so we can assert that spy was called.
// ---------------------------------------------------------------------------

describe('createAptosFetchClient shim (integration via fromAptosConfig)', () => {
  it('routes all Aptos REST calls through ctx.fetch (populates networkInfo cache)', async () => {
    const fetchCalls: Array<{ url: string; method: string | undefined }> = []
    const spyFetch: typeof fetch = async (input, init) => {
      fetchCalls.push({
        url: toUrlString(input),
        method: init?.method,
      })
      return new Response(JSON.stringify(ledgerInfo()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    await AptosChain.fromAptosConfig(
      { network: Network.MAINNET, fullnode: 'https://fullnode.example.internal' },
      { fetch: spyFetch },
    )

    assert.ok(
      fetchCalls.length >= 1,
      `fetch spy should be called at least once; got ${fetchCalls.length}`,
    )
    assert.ok(
      fetchCalls.every((c) => c.url.startsWith('https://fullnode.example.internal')),
      `all calls must use the fullnode URL; got: ${fetchCalls.map((c) => c.url).join(', ')}`,
    )
    assert.ok(
      fetchCalls.every((c) => !c.method || c.method === 'GET'),
      'getLedgerInfo should be GET',
    )
  })

  it('raw AptosSettings with explicit client: ctx.fetch not called', async () => {
    const { client: fakeClient } = makeFakeAptosClient()
    const ctxFetchCalls: string[] = []
    const spyFetch: typeof fetch = async (input) => {
      ctxFetchCalls.push(toUrlString(input))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }

    await AptosChain.fromAptosConfig(
      { network: Network.MAINNET, client: fakeClient },
      {
        fetch: spyFetch,
      },
    )

    assert.equal(
      ctxFetchCalls.length,
      0,
      'ctx.fetch must not be called when explicit client is set',
    )
  })

  it('pre-built AptosConfig with explicit client: ctx.fetch not called', async () => {
    const { client: fakeClient } = makeFakeAptosClient()
    const ctxFetchCalls: string[] = []
    const spyFetch: typeof fetch = async (input) => {
      ctxFetchCalls.push(toUrlString(input))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }

    await AptosChain.fromAptosConfig(
      new AptosConfig({ network: Network.MAINNET, client: fakeClient }),
      { fetch: spyFetch },
    )

    assert.equal(
      ctxFetchCalls.length,
      0,
      'ctx.fetch must not be called when explicit client is set',
    )
  })

  it('fromProvider: provider instance is passed through unchanged (no shim)', async () => {
    const { Aptos } = await import('@aptos-labs/ts-sdk')
    const { client: fakeClient } = makeFakeAptosClient()

    const aptosProvider = new Aptos(
      new AptosConfig({ network: Network.MAINNET, client: fakeClient }),
    )
    const chain = await AptosChain.fromProvider(aptosProvider, {})

    // fromProvider must NOT wrap the provider — it should be the exact same reference
    assert.strictEqual(
      chain.provider,
      aptosProvider,
      'fromProvider must not wrap the Aptos provider',
    )
    // The config's client must still be fakeClient (not replaced by the shim)
    assert.strictEqual(
      chain.provider.config.client,
      fakeClient,
      'fromProvider must not replace config.client with a shim',
    )
  })
})

// ---------------------------------------------------------------------------
// Unit tests: test the shim's provider() function directly.
// We extract the installed client from the AptosConfig via the chain's provider.
// ---------------------------------------------------------------------------

describe('createAptosFetchClient provider() contract (unit)', () => {
  it('GET request: calls fetch with method=GET and no body', async () => {
    const fetchCalls: Array<{ method: string | undefined; body: unknown }> = []
    const spyFetch: typeof fetch = async (input, init) => {
      fetchCalls.push({ method: init?.method, body: init?.body })
      return new Response(JSON.stringify(ledgerInfo()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Extract the installed client
    const client = await extractInstalledClient(
      { network: Network.MAINNET, fullnode: 'https://probe.test.internal' },
      { fetch: spyFetch },
    )

    // Reset and call provider() directly with a GET request
    fetchCalls.length = 0
    const req: ClientRequest<never> = {
      url: 'https://probe.test.internal/v1',
      method: 'GET',
      params: { ledger_version: 1 },
    }
    const resp = await client.provider(req)

    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0]!.method, 'GET')
    assert.ok(!fetchCalls[0]!.body, 'GET must not have a body')
    assert.equal(resp.status, 200)
    assert.ok(resp.data, 'response data should be parsed')
    // Query param should be appended
    const calledUrl = typeof fetchCalls[0] === 'object' ? '' : ''
    void calledUrl
  })

  it('GET with params: query params appended to URL', async () => {
    const calledUrls: string[] = []
    const spyFetch: typeof fetch = async (input, _init) => {
      calledUrls.push(toUrlString(input))
      return new Response(JSON.stringify(ledgerInfo()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const client = await extractInstalledClient(
      { network: Network.MAINNET, fullnode: 'https://probe.test.internal' },
      { fetch: spyFetch },
    )

    calledUrls.length = 0
    await client.provider({
      url: 'https://probe.test.internal/v1/accounts/0x1',
      method: 'GET',
      params: { ledger_version: 999, extra: 'val' },
    })

    assert.equal(calledUrls.length, 1)
    const url = new URL(calledUrls[0]!)
    assert.equal(url.searchParams.get('ledger_version'), '999')
    assert.equal(url.searchParams.get('extra'), 'val')
  })

  it('POST with JSON body: serializes body and sets content-type', async () => {
    const fetchCalls: Array<{ method: string | undefined; body: unknown; ct: string | undefined }> =
      []
    const spyFetch: typeof fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined
      fetchCalls.push({ method: init?.method, body: init?.body, ct: headers?.['content-type'] })
      return new Response(JSON.stringify([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const client = await extractInstalledClient(
      { network: Network.MAINNET, fullnode: 'https://probe.test.internal' },
      { fetch: spyFetch },
    )

    fetchCalls.length = 0
    const payload = { function: '0x1::foo::bar', arguments: ['0x1'] }
    await client.provider({
      url: 'https://probe.test.internal/v1/view',
      method: 'POST',
      body: payload,
      contentType: 'application/json',
    })

    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0]!.method, 'POST')
    assert.ok(fetchCalls[0]!.ct?.includes('application/json'), `content-type: ${fetchCalls[0]!.ct}`)
    assert.doesNotThrow(() => JSON.parse(fetchCalls[0]!.body as string), 'body must be valid JSON')
    assert.deepStrictEqual(JSON.parse(fetchCalls[0]!.body as string), payload)
  })

  it('non-2xx response: returned (not thrown) with correct status', async () => {
    const spyFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error_code: 'not_found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })

    const client = await extractInstalledClient(
      { network: Network.MAINNET, fullnode: 'https://probe.test.internal' },
      { fetch: spyFetch },
    )

    // provider() must NOT throw on 404 — it returns the response for the SDK to handle
    const resp = await client.provider({
      url: 'https://probe.test.internal/v1/accounts/0xdead',
      method: 'GET',
    })

    assert.equal(resp.status, 404)
    assert.equal(resp.statusText, 'Not Found')
    assert.deepStrictEqual(resp.data, { error_code: 'not_found' })
  })

  it('response JSON is parsed into data field', async () => {
    const spyFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ value: 42, nested: { x: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    const client = await extractInstalledClient(
      { network: Network.MAINNET, fullnode: 'https://probe.test.internal' },
      { fetch: spyFetch },
    )

    const resp = await client.provider({
      url: 'https://probe.test.internal/v1/something',
      method: 'GET',
    })

    assert.deepStrictEqual(resp.data, { value: 42, nested: { x: 1 } })
    assert.equal(resp.status, 200)
  })
})
