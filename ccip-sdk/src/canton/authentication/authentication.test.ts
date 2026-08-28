/**
 * Unit tests for the Canton authentication providers.
 *
 * Test approach:
 * - Mock token endpoints via a lightweight `http.Server` (no external deps).
 * - Validate request form params (grant_type, scope, audience, code_verifier).
 * - For the authorization code flow, simulate the browser callback.
 */
import assert from 'node:assert/strict'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'

import { CCIPError } from '../../errors/index.ts'
import {
  CachingTokenSource,
  StaticTokenSource,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from './token-source.ts'
import {
  AuthType,
  createAuthProvider,
  createStaticProvider,
  isAccessToken,
  isTokenExpired,
  resolveCantonJwt,
} from './index.ts'

// ---------------------------------------------------------------------------
// Helpers — mock OAuth2 token + metadata servers
// ---------------------------------------------------------------------------

/** Parsed form body of the last token request received by the mock server. */
interface CapturedTokenRequest {
  method: string
  url: string
  body: Record<string, string>
  headers: Record<string, string | string[] | undefined>
}

/**
 * Start a mock token endpoint that captures the request and returns a canned token.
 *
 * @param response - Token JSON to return (default: a valid access token).
 * @param status - HTTP status (default 200).
 * @param validate - Optional callback to assert on the captured request.
 */
function startTokenServer(opts: {
  response?: Record<string, unknown>
  status?: number
  validate?: (req: CapturedTokenRequest) => void
}): Promise<{ server: Server; url: string; requests: CapturedTokenRequest[] }> {
  const requests: CapturedTokenRequest[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = Object.fromEntries(new URLSearchParams(body))
      const captured: CapturedTokenRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: parsed,
        headers: req.headers,
      }
      requests.push(captured)
      opts.validate?.(captured)
      const status = opts.status ?? 200
      const json =
        opts.response ??
        ({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600 } as const)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(json))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}`, requests })
    })
  })
}

/**
 * Start a mock authorization-server metadata endpoint.
 */
function startMetadataServer(opts: {
  tokenEndpoint?: string
  authorizationEndpoint?: string
  codeChallengeMethods?: string[]
  issuer?: string
  status?: number
}): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/oauth-authorization-server') {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const status = opts.status ?? 200
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'metadata unavailable' }))
      return
    }
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const json = {
      issuer: opts.issuer ?? baseUrl,
      token_endpoint: opts.tokenEndpoint ?? `${baseUrl}/v1/token`,
      authorization_endpoint: opts.authorizationEndpoint ?? `${baseUrl}/v1/authorize`,
      code_challenge_methods_supported: opts.codeChallengeMethods ?? ['S256'],
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(json))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}

/** Fetch wrapper that records calls (for threading into providers). */
function makeFetchSpy(): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const spy: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    return fetch(input, init)
  }
  return { fetch: spy, calls }
}

// ---------------------------------------------------------------------------
// types.ts
// ---------------------------------------------------------------------------

describe('canton/authentication — types', () => {
  it('isAccessToken validates shape', () => {
    assert.equal(isAccessToken({ accessToken: 'abc' }), true)
    assert.equal(isAccessToken({ accessToken: '' }), false)
    assert.equal(isAccessToken({ token: 'abc' }), false)
    assert.equal(isAccessToken(null), false)
  })

  it('AuthType constants match Go commonconfig values', () => {
    assert.equal(AuthType.Static, 'static')
    assert.equal(AuthType.ClientCredentials, 'clientCredentials')
    assert.equal(AuthType.AuthorizationCode, 'authorizationCode')
  })
})

// ---------------------------------------------------------------------------
// token-source.ts
// ---------------------------------------------------------------------------

describe('canton/authentication — token-source primitives', () => {
  it('isTokenExpired returns true for missing token', () => {
    assert.equal(isTokenExpired(undefined), true)
  })

  it('isTokenExpired returns false for token with no expiry', () => {
    assert.equal(isTokenExpired({ accessToken: 'x' }), false)
  })

  it('isTokenExpired returns true past expiry (with skew)', () => {
    const past = { accessToken: 'x', expiresAt: Date.now() - 1000 }
    assert.equal(isTokenExpired(past), true)
  })

  it('isTokenExpired returns false well before expiry', () => {
    const future = { accessToken: 'x', expiresAt: Date.now() + 60_000 }
    assert.equal(isTokenExpired(future), false)
  })

  it('StaticTokenSource always returns the same token', async () => {
    const ts = new StaticTokenSource({ accessToken: 'static-abc' })
    assert.equal((await ts.token()).accessToken, 'static-abc')
    assert.equal((await ts.token()).accessToken, 'static-abc')
  })

  it('CachingTokenSource fetches once and caches', async () => {
    let fetchCount = 0
    const ts = new CachingTokenSource(async () => {
      fetchCount++
      return { accessToken: `tok-${fetchCount}`, expiresAt: Date.now() + 60_000 }
    })
    assert.equal((await ts.token()).accessToken, 'tok-1')
    assert.equal((await ts.token()).accessToken, 'tok-1') // cached
    assert.equal(fetchCount, 1)
  })

  it('CachingTokenSource re-fetches when expired', async () => {
    let fetchCount = 0
    const ts = new CachingTokenSource(async () => {
      fetchCount++
      return { accessToken: `tok-${fetchCount}`, expiresAt: Date.now() - 1000 } // already expired
    })
    await ts.token()
    await ts.token()
    assert.equal(fetchCount, 2)
  })

  it('CachingTokenSource coalesces concurrent fetches', async () => {
    let fetchCount = 0
    const ts = new CachingTokenSource(async () => {
      fetchCount++
      // simulate latency
      await new Promise((r) => setTimeout(r, 10))
      return { accessToken: `tok-${fetchCount}`, expiresAt: Date.now() + 60_000 }
    })
    const [a, b, c] = await Promise.all([ts.token(), ts.token(), ts.token()])
    assert.equal(fetchCount, 1, 'concurrent calls should share a single fetch')
    assert.equal(a.accessToken, b.accessToken)
    assert.equal(b.accessToken, c.accessToken)
  })

  it('generateCodeVerifier produces a non-empty base64url string', () => {
    const v = generateCodeVerifier()
    assert.ok(v.length >= 43, `verifier too short: ${v.length}`)
    assert.ok(/^[A-Za-z0-9_-]+$/.test(v), 'verifier must be base64url (no padding)')
  })

  it('codeChallengeFromVerifier produces S256 challenge', async () => {
    const verifier = 'dGVzdA' // "test" base64url-ish
    const challenge = await codeChallengeFromVerifier(verifier)
    assert.ok(challenge.length > 0)
    // S256 challenge is base64url(sha256(verifier)) — 43 chars for 32-byte digest
    assert.equal(challenge.length, 43)
  })

  it('generateState produces unique values', () => {
    const a = generateState()
    const b = generateState()
    assert.notEqual(a, b)
    assert.ok(a.length > 0)
  })
})

// ---------------------------------------------------------------------------
// static.ts
// ---------------------------------------------------------------------------

describe('canton/authentication — static providers', () => {
  it('createStaticProvider returns a token yielding the JWT', async () => {
    const provider = createStaticProvider('my-jwt-123')
    assert.equal(provider.type, AuthType.Static)
    assert.equal((await provider.token()).accessToken, 'my-jwt-123')
  })

  it('static providers reject empty JWT', () => {
    assert.throws(() => createStaticProvider(''), CCIPError)
    assert.throws(() => createStaticProvider('   '), CCIPError)
  })
})

// ---------------------------------------------------------------------------
// client-credentials.ts
// ---------------------------------------------------------------------------

describe('canton/authentication — client credentials flow', () => {
  it('fromDirect fetches a token via the client_credentials grant', async () => {
    const { server, url, requests } = await startTokenServer({
      validate: (req) => {
        assert.equal(req.body['grant_type'], 'client_credentials')
        assert.equal(req.body['client_id'], 'cid')
        assert.equal(req.body['client_secret'], 'secret')
        assert.equal(req.body['scope'], 'daml_ledger_api')
      },
    })
    try {
      const { ClientCredentialsProvider } = await import('./client-credentials.ts')
      const provider = ClientCredentialsProvider.fromDirect(
        {
          type: AuthType.ClientCredentials,
          authUrl: url,
          tokenUrl: `${url}/v1/token`,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { allowInsecureRequests: true },
      )
      const token = await provider.token()
      assert.equal(token.accessToken, 'test-access-token')
      assert.equal(requests.length, 1)
    } finally {
      server.close()
    }
  })

  it('WithAudience sends the audience form param', async () => {
    const { server, url, requests } = await startTokenServer({
      validate: (req) => {
        assert.equal(req.body['audience'], 'https://ledger.example.com')
      },
    })
    try {
      const { ClientCredentialsProvider } = await import('./client-credentials.ts')
      const provider = ClientCredentialsProvider.fromDirect(
        {
          type: AuthType.ClientCredentials,
          authUrl: url,
          tokenUrl: `${url}/v1/token`,
          clientId: 'cid',
          clientSecret: 'secret',
          audience: 'https://ledger.example.com',
        },
        { allowInsecureRequests: true },
      )
      await provider.token()
      assert.equal(requests.length, 1)
    } finally {
      server.close()
    }
  })

  it('fromDiscovery uses metadata token_endpoint', async () => {
    const tokenServer = await startTokenServer({})
    const metaServer = await startMetadataServer({
      tokenEndpoint: `${tokenServer.url}/v1/token`,
    })
    try {
      const { ClientCredentialsProvider } = await import('./client-credentials.ts')
      const provider = await ClientCredentialsProvider.fromDiscovery(
        {
          type: AuthType.ClientCredentials,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { allowInsecureRequests: true },
      )
      const token = await provider.token()
      assert.equal(token.accessToken, 'test-access-token')
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })

  it('fromDiscovery fails on non-200 metadata', async () => {
    const metaServer = await startMetadataServer({ status: 500 })
    try {
      const { ClientCredentialsProvider } = await import('./client-credentials.ts')
      await assert.rejects(
        ClientCredentialsProvider.fromDiscovery(
          {
            type: AuthType.ClientCredentials,
            authUrl: metaServer.baseUrl,
            clientId: 'cid',
            clientSecret: 'secret',
          },
          { allowInsecureRequests: true },
        ),
        CCIPError,
      )
    } finally {
      metaServer.server.close()
    }
  })

  it('rejects empty config fields', async () => {
    const { ClientCredentialsProvider } = await import('./client-credentials.ts')
    assert.throws(
      () =>
        ClientCredentialsProvider.fromDirect(
          {
            type: AuthType.ClientCredentials,
            authUrl: '',
            tokenUrl: 'x',
            clientId: '',
            clientSecret: '',
          },
          { allowInsecureRequests: true },
        ),
      CCIPError,
    )
  })

  it('caches the token across multiple token() calls', async () => {
    const { server, url, requests } = await startTokenServer({})
    try {
      const { ClientCredentialsProvider } = await import('./client-credentials.ts')
      const provider = ClientCredentialsProvider.fromDirect(
        {
          type: AuthType.ClientCredentials,
          authUrl: url,
          tokenUrl: `${url}/v1/token`,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { allowInsecureRequests: true },
      )
      await provider.token()
      await provider.token()
      assert.equal(requests.length, 1, 'token should be cached')
    } finally {
      server.close()
    }
  })
})

// ---------------------------------------------------------------------------
// authorization-code.ts (interactive flow simulated)
// ---------------------------------------------------------------------------

describe('canton/authentication — authorization code flow', () => {
  it('fromDirect completes the PKCE flow when callback is hit', async () => {
    const tokenServer = await startTokenServer({
      response: { access_token: 'auth-code-token', token_type: 'Bearer', expires_in: 3600 },
      validate: (req) => {
        assert.equal(req.body['grant_type'], 'authorization_code')
        assert.ok(req.body['code'], 'must include code')
        assert.ok(req.body['code_verifier'], 'must include code_verifier (PKCE)')
        assert.equal(req.body['client_id'], 'cid')
      },
    })

    // Find a free port for the callback server.
    const portGrabber = createServer()
    const callbackPort: number = await new Promise((resolve) => {
      portGrabber.listen(0, '127.0.0.1', () => {
        const { port } = portGrabber.address() as AddressInfo
        portGrabber.close(() => resolve(port))
      })
    })
    const callbackUrl = `http://127.0.0.1:${callbackPort}/callback`
    const knownState = 'known-test-state'

    try {
      const { AuthorizationCodeProvider } = await import('./authorization-code.ts')

      // Start the provider in the background — it blocks waiting for the callback.
      // Pass a fixed state so we can simulate the browser redirect deterministically.
      const providerPromise = AuthorizationCodeProvider.fromDirect(
        {
          type: AuthType.AuthorizationCode,
          authUrl: `${tokenServer.url}/v1/authorize`,
          tokenUrl: `${tokenServer.url}/v1/token`,
          clientId: 'cid',
          callbackUrl,
          openBrowser: false,
          timeoutMs: 5_000,
        },
        { fetch: fetch, stateOverride: knownState, allowInsecureRequests: true },
      )

      // Wait for the callback server to start listening, then simulate the
      // browser redirect with the known state and a fake authorization code.
      await waitForPort(callbackPort, 1_000)
      const callbackResp = await fetch(`${callbackUrl}?code=test-code&state=${knownState}`)
      assert.equal(callbackResp.status, 200)

      const provider = await providerPromise
      const token = await provider.token()
      assert.equal(token.accessToken, 'auth-code-token')
    } finally {
      tokenServer.server.close()
    }
  })

  it('fromDirect rejects on state mismatch', async () => {
    const tokenServer = await startTokenServer({})
    const portGrabber = createServer()
    const callbackPort: number = await new Promise((resolve) => {
      portGrabber.listen(0, '127.0.0.1', () => {
        const { port } = portGrabber.address() as AddressInfo
        portGrabber.close(() => resolve(port))
      })
    })
    const callbackUrl = `http://127.0.0.1:${callbackPort}/callback`

    try {
      const { AuthorizationCodeProvider } = await import('./authorization-code.ts')
      const providerPromise = AuthorizationCodeProvider.fromDirect(
        {
          type: AuthType.AuthorizationCode,
          authUrl: `${tokenServer.url}/v1/authorize`,
          tokenUrl: `${tokenServer.url}/v1/token`,
          clientId: 'cid',
          callbackUrl,
          openBrowser: false,
          timeoutMs: 5_000,
        },
        { fetch: fetch, stateOverride: 'correct-state', allowInsecureRequests: true },
      )
      // Mark the promise as handled early to avoid unhandledRejection before
      // assert.rejects gets to await it (the callback may fire synchronously).
      providerPromise.catch(() => {})

      await waitForPort(callbackPort, 1_000)
      // Hit with a wrong state → provider should reject.
      const resp = await fetch(`${callbackUrl}?code=x&state=wrong`)
      assert.equal(resp.status, 400)
      await assert.rejects(providerPromise, CCIPError)
    } finally {
      tokenServer.server.close()
    }
  })

  it('fromDiscovery requires S256 PKCE support', async () => {
    const metaServer = await startMetadataServer({ codeChallengeMethods: ['plain'] })
    try {
      const { AuthorizationCodeProvider } = await import('./authorization-code.ts')
      await assert.rejects(
        AuthorizationCodeProvider.fromDiscovery(
          {
            type: AuthType.AuthorizationCode,
            authUrl: metaServer.baseUrl,
            clientId: 'cid',
          },
          { allowInsecureRequests: true },
        ),
        /S256/,
      )
    } finally {
      metaServer.server.close()
    }
  })

  it('rejects empty config fields', async () => {
    const { AuthorizationCodeProvider } = await import('./authorization-code.ts')
    await assert.rejects(
      AuthorizationCodeProvider.fromDiscovery({
        type: AuthType.AuthorizationCode,
        authUrl: '',
        clientId: '',
      }),
      CCIPError,
    )
  })
})

/** Poll until a TCP port accepts a connection (callback server is up). */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    function attempt() {
      fetch(`http://127.0.0.1:${port}/__nonexistent__`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error(`port ${port} not ready in ${timeoutMs}ms`))
          else setTimeout(attempt, 20)
        })
    }
    attempt()
  })
}

// ---------------------------------------------------------------------------
// index.ts — createAuthProvider / resolveCantonJwt
// ---------------------------------------------------------------------------

describe('canton/authentication — createAuthProvider / resolveCantonJwt', () => {
  it('createAuthProvider defaults to static when type omitted', async () => {
    const provider = await createAuthProvider({ jwt: 'static-jwt' })
    assert.equal(provider.type, AuthType.Static)
    assert.equal((await provider.token()).accessToken, 'static-jwt')
  })

  it('createAuthProvider builds a static provider', async () => {
    const provider = await createAuthProvider({ type: AuthType.Static, jwt: 'j1' })
    assert.equal(provider.type, AuthType.Static)
    assert.equal((await provider.token()).accessToken, 'j1')
  })

  it('createAuthProvider rejects unsupported type', async () => {
    await assert.rejects(
      createAuthProvider({ type: 'unknown', jwt: 'x' } as unknown as Parameters<
        typeof createAuthProvider
      >[0]),
      CCIPError,
    )
  })

  it('createAuthProvider builds a clientCredentials provider via discovery', async () => {
    const tokenServer = await startTokenServer({})
    const metaServer = await startMetadataServer({ tokenEndpoint: `${tokenServer.url}/v1/token` })
    try {
      const provider = await createAuthProvider(
        {
          type: AuthType.ClientCredentials,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { allowInsecureRequests: true },
      )
      assert.equal(provider.type, AuthType.ClientCredentials)
      const token = await provider.token()
      assert.equal(token.accessToken, 'test-access-token')
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })

  it('resolveCantonJwt returns the JWT string', async () => {
    const jwt = await resolveCantonJwt({ jwt: 'raw-jwt-789' })
    assert.equal(jwt, 'raw-jwt-789')
  })

  it('resolveCantonJwt fetches via client credentials', async () => {
    const tokenServer = await startTokenServer({})
    const metaServer = await startMetadataServer({ tokenEndpoint: `${tokenServer.url}/v1/token` })
    try {
      const jwt = await resolveCantonJwt(
        {
          type: AuthType.ClientCredentials,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { allowInsecureRequests: true },
      )
      assert.equal(jwt, 'test-access-token')
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })

  it('custom fetch is threaded through to discovery + token fetch', async () => {
    const tokenServer = await startTokenServer({})
    const metaServer = await startMetadataServer({ tokenEndpoint: `${tokenServer.url}/v1/token` })
    const { fetch: spyFetch, calls } = makeFetchSpy()
    try {
      await resolveCantonJwt(
        {
          type: AuthType.ClientCredentials,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { fetch: spyFetch, allowInsecureRequests: true },
      )
      // At least 2 calls: metadata discovery + token fetch
      assert.ok(calls.length >= 2, `expected >= 2 spy calls, got ${calls.length}`)
      assert.ok(calls.some((u) => u.includes('.well-known')))
      assert.ok(calls.some((u) => u.includes('/v1/token')))
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })
})
