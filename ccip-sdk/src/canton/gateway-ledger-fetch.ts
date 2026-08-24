/**
 * A `fetch` wrapper that routes Canton JSON Ledger API reads through a Wallet
 * Gateway's `ledgerApi` JSON-RPC proxy (CIP-103 dApp API).
 *
 * Why: a user's Okta session token (used to authenticate with the gateway)
 * carries `daml_ledger_api` scope but is not mapped to ledger-party read
 * rights on the participant — direct Ledger API reads return HTTP 464. The
 * gateway's `ledgerApi` proxy uses the caller's credential; with an **API key**
 * (`ApiKey <key>`) the gateway mints a service-account context with broad read
 * rights, so proxied reads succeed. With a `Bearer` session token the proxy
 * still 464s (same rights as direct), so prefer an API key for reads.
 *
 * The wrapper is transparent: requests NOT targeting `ledgerBaseUrl` are
 * passed through to the real `fetch` unchanged (EDS, transfer-instruction,
 * token-metadata calls are public or carry their own auth). Only ledger calls
 * are translated into a `ledgerApi` JSON-RPC request posted to `gatewayUrl`.
 *
 * @packageDocumentation
 */

import { authHeader } from '../cct/canton/gateway-submitter.ts'

/** Params for {@link createGatewayLedgerFetch}. */
export interface CreateGatewayLedgerFetchParams {
  /** Gateway dApp JSON-RPC URL (the same URL used for `prepareExecute`). */
  gatewayUrl: string
  /** Gateway access token (session or API key). */
  accessToken: string
  /**
   * The ledger base URL whose requests should be proxied. Compared by
   * `URL` origin + pathname prefix against each outgoing request.
   */
  ledgerBaseUrl: string
  /** Optional abort signal propagated to gateway requests. */
  signal?: AbortSignal
  /** Injectable fetch (testing). Defaults to `globalThis.fetch`. */
  fetchFn?: typeof fetch
}

/** Monotonic JSON-RPC id counter (Math.random is avoided to stay deterministic). */
let jsonRpcId = 0

/**
 * Create a `fetch` that proxies ledger reads through the gateway `ledgerApi`
 * method. Returns a function with the standard `fetch` signature so it can be
 * passed straight to `CantonChain.fromUrl({ fetch })` / `createCantonClient`.
 */
export function createGatewayLedgerFetch(
  params: CreateGatewayLedgerFetchParams,
): typeof fetch {
  const { gatewayUrl, accessToken, ledgerBaseUrl, signal, fetchFn = globalThis.fetch.bind(globalThis) } = params
  const ledgerPrefix = new URL(ledgerBaseUrl).href.replace(/\/$/, '')

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const isRequest = typeof input !== 'string' && !(input instanceof URL) && 'method' in input
    const targetUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    // Axios's fetch adapter constructs a `Request` object and calls
    // `fetch(request, fetchOptions)` — the method is on the Request, not in
    // `init.method`. Read it from both places.
    const method =
      (isRequest ? (input as Request).method : init?.method) ?? 'GET'

    // Only proxy requests whose URL is under the ledger base. Everything else
    // (EDS, transfer-instruction, token-metadata) goes to the real network.
    if (!targetUrl.href.startsWith(ledgerPrefix)) {
      return fetchFn(input, init)
    }

    // Health/liveness endpoints: short-circuit with a 200. The real ledger
    // is HTTP/2-only (CV1's ALB), so a "direct" globalThis.fetch fails (no
    // allowH2), and the gateway's ledgerApi proxy chokes on /livez's empty
    // 200 body. Since all actual reads go through the proxy (which reaches
    // the ledger), a live proxy IS proof the ledger is reachable — skip the
    // redundant health probe. Match by suffix (the ledger base URL may include
    // a path prefix like /api/json, so pathname is /api/json/livez, not /livez).
    if (targetUrl.pathname.endsWith('/livez') || targetUrl.pathname.endsWith('/readyz')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Translate the ledger HTTP request into a `ledgerApi` JSON-RPC call.
    const resource = targetUrl.href.slice(ledgerPrefix.length) // path + query
    const lowerMethod = method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
    if (process.env['DEBUG_LEDGER_FETCH'] === '1') {
      console.error(`[gateway-ledger-fetch] ${lowerMethod} ${resource} body=${init?.body || (isRequest && (input as Request).body) ? 'yes' : 'no'}`)
    }
    let body: Record<string, unknown> | undefined
    // Axios's fetch adapter puts the body on the Request object (for POST);
    // init.body may be undefined. Read from either, and buffer the Request
    // body stream if needed.
    let rawBody: unknown = init?.body
    if (!rawBody && isRequest && (input as Request).body) {
      rawBody = await new Response((input as Request).body).text()
    }
    if (rawBody && lowerMethod !== 'get' && lowerMethod !== 'delete') {
      try {
        body = JSON.parse(rawBody as string) as Record<string, unknown>
      } catch {
        body = undefined
      }
    }
    const query: Record<string, string> = {}
    targetUrl.searchParams.forEach((value, key) => {
      query[key] = value
    })

    const rpcBody = {
      jsonrpc: '2.0',
      id: `gw-ledger-${jsonRpcId++}`,
      method: 'ledgerApi',
      params: { requestMethod: lowerMethod, resource, body, query },
    }

    const response = await fetchFn(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(accessToken),
      },
      body: JSON.stringify(rpcBody),
      signal: signal ?? init?.signal,
    })

    if (!response.ok) {
      // Surface HTTP errors as a Response with the same status so the SDK's
      // retry/error handling treats it like a direct ledger failure.
      return new Response(await response.text(), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const json = (await response.json()) as {
      result?: unknown
      error?: { code: number; message: string; data?: unknown }
    }
    if (json.error) {
      // JSON-RPC error → 500 with the message; caller surfaces CantonApiError.
      return new Response(JSON.stringify(json.error), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // The ledgerApi result is the raw ledger endpoint response body. Wrap it
    // as a 200 Response so the SDK's JSON parser handles it identically.
    return new Response(JSON.stringify(json.result ?? {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
