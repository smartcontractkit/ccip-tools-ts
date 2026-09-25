/**
 * Wallet Gateway (CIP-103) read-only client — test-support code, NOT part of
 * the SDK's public surface. The SDK is wallet-agnostic (same as EVM/Solana
 * CCT); this exists only so `index.integration.test.ts` can read live pool
 * state through the same realistic auth path a real integrator uses (a
 * gateway session token isn't mapped to direct ledger-read rights). A real
 * integrator's own copy of this pattern lives in `ccip-sdk-examples`.
 *
 * @packageDocumentation
 */

/** Build the `Authorization` header from a gateway credential. */
function authHeader(accessToken: string): string {
  if (accessToken.startsWith('ApiKey ') || accessToken.startsWith('Bearer ')) return accessToken
  return `Bearer ${accessToken}`
}

function cryptoRandomId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (c?.randomUUID) return c.randomUUID()
  return 'cct-' + Math.random().toString(36).slice(2, 10)
}

/** A JSON-RPC 2.0 response (success or error). */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Error thrown when a gateway call fails (HTTP or JSON-RPC level). */
export class GatewaySubmitError extends Error {
  readonly data: unknown
  constructor(message: string, data: unknown) {
    super(message)
    this.name = 'GatewaySubmitError'
    this.data = data
  }
}

function isDuplicateSessionError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const err = (body as { error?: { message?: string } }).error
  return typeof err?.message === 'string' && err.message.includes('Failed to add session')
}

/** Fetch the primary wallet's party ID from the gateway (`getPrimaryAccount`). */
export async function fetchGatewayPrimaryParty(params: {
  gatewayUrl: string
  accessToken: string
}): Promise<string> {
  const { gatewayUrl, accessToken } = params

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(accessToken) },
    body: JSON.stringify({ jsonrpc: '2.0', id: cryptoRandomId(), method: 'getPrimaryAccount' }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new GatewaySubmitError(
      `gateway HTTP ${response.status} ${response.statusText}`,
      errorBody,
    )
  }

  const json = (await response.json()) as JsonRpcResponse
  if (json.error) {
    throw new GatewaySubmitError(
      `gateway JSON-RPC error ${json.error.code}: ${json.error.message}`,
      json.error.data,
    )
  }

  const partyId = (json.result as { partyId?: unknown } | undefined)?.partyId
  if (typeof partyId !== 'string' || !partyId) {
    throw new GatewaySubmitError('gateway getPrimaryAccount returned no partyId', json.result)
  }
  return partyId
}

/**
 * Ensure the gateway has a stored session for `accessToken`, creating one via
 * the user-API `addSession` method if none exists. Tolerates an
 * already-existing session.
 */
export async function ensureGatewaySession(params: {
  gatewayUrl: string
  accessToken: string
  networkId: string
}): Promise<void> {
  const { gatewayUrl, accessToken, networkId } = params
  const origin = `test-${Math.random().toString(36).slice(2, 10)}`

  const userApiUrl = gatewayUrl.replace(/\/api\/v0\/dapp$/, '/api/v0/user')
  if (userApiUrl === gatewayUrl) {
    throw new GatewaySubmitError(
      `ensureGatewaySession: gatewayUrl must end with /api/v0/dapp (got ${gatewayUrl})`,
      undefined,
    )
  }

  const response = await fetch(userApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(accessToken) },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: cryptoRandomId(),
      method: 'addSession',
      params: { origin, networkId },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => response.text().catch(() => ''))
    if (isDuplicateSessionError(errorBody)) return
    throw new GatewaySubmitError(
      `ensureGatewaySession: gateway HTTP ${response.status} ${response.statusText}`,
      errorBody,
    )
  }

  const json = (await response.json()) as JsonRpcResponse
  if (json.error) {
    if (isDuplicateSessionError(json)) return
    throw new GatewaySubmitError(
      `ensureGatewaySession: gateway JSON-RPC error ${json.error.code}: ${json.error.message}`,
      json.error.data,
    )
  }
}

/**
 * A `fetch` wrapper that routes Canton JSON Ledger API reads through the
 * Wallet Gateway's `ledgerApi` JSON-RPC proxy — a gateway session token
 * carries `daml_ledger_api` scope but isn't mapped to ledger-party read
 * rights on the participant, so a direct Ledger API read 464s. Requests NOT
 * targeting `ledgerBaseUrl` pass through to the real `fetch` unchanged.
 */
export function createGatewayLedgerFetch(params: {
  gatewayUrl: string
  accessToken: string
  ledgerBaseUrl: string
}): typeof fetch {
  const { gatewayUrl, accessToken, ledgerBaseUrl } = params
  const ledgerPrefix = new URL(ledgerBaseUrl).href.replace(/\/$/, '')
  let jsonRpcId = 0

  const callLedgerApi = async (
    requestMethod: 'get' | 'post' | 'patch' | 'put' | 'delete',
    resource: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>,
  ): Promise<Response> => {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(accessToken) },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `gw-ledger-${jsonRpcId++}`,
        method: 'ledgerApi',
        params: { requestMethod, resource, body, query: query ?? {} },
      }),
    })

    if (!response.ok) {
      return new Response(await response.text(), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const text = await response.text()
    const json = text
      ? (JSON.parse(text) as {
          result?: unknown
          error?: { code: number; message: string; data?: unknown }
        })
      : {}
    if (json.error) {
      return new Response(JSON.stringify(json.error), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(json.result ?? {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const isRequest = typeof input !== 'string' && !(input instanceof URL) && 'method' in input
    const targetUrl = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const method = (isRequest ? (input as Request).method : init?.method) ?? 'GET'

    if (!targetUrl.href.startsWith(ledgerPrefix)) {
      return fetch(input, init)
    }

    const resource = targetUrl.href.slice(ledgerPrefix.length)
    const lowerMethod = method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
    let body: Record<string, unknown> | undefined
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

    return callLedgerApi(lowerMethod, resource, body, query)
  }
}
