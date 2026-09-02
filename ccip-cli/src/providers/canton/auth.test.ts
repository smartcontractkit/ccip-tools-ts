/**
 * Unit tests for the CLI Canton OAuth 2.0 orchestration (Node-specific).
 *
 * Tests the callback server + browser launching that was moved out of the SDK
 * into the CLI's `providers/canton/auth.ts`. The SDK protocol primitives are
 * tested in `ccip-sdk/src/canton/authentication/authentication.test.ts`.
 */
import assert from 'node:assert/strict'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'

import { CantonAuthType as AuthType } from '@chainlink/ccip-sdk/src/index.ts'

import { mergeAuthEnvVars, resolveCantonTokenGetter, runAuthorizationCodeFlow } from './auth.ts'

// ---------------------------------------------------------------------------
// Helpers — mock OAuth2 token + metadata servers
// ---------------------------------------------------------------------------

/** Start a mock token endpoint that returns a canned token. */
function startTokenServer(opts: {
  response?: Record<string, unknown>
  status?: number
}): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const status = opts.status ?? 200
    const json =
      opts.response ??
      ({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600 } as const)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(json))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

/** Start a mock authorization-server metadata endpoint. */
function startMetadataServer(opts: {
  tokenEndpoint?: string
  authorizationEndpoint?: string
}): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/oauth-authorization-server') {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const json = {
      issuer: baseUrl,
      token_endpoint: opts.tokenEndpoint ?? `${baseUrl}/v1/token`,
      authorization_endpoint: opts.authorizationEndpoint ?? `${baseUrl}/v1/authorize`,
      code_challenge_methods_supported: ['S256'],
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

/** Grab a free TCP port then release it immediately. */
function grabFreePort(): Promise<number> {
  const grabber = createServer()
  return new Promise((resolve) => {
    grabber.listen(0, '127.0.0.1', () => {
      const { port } = grabber.address() as AddressInfo
      grabber.close(() => resolve(port))
    })
  })
}

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
// mergeAuthEnvVars
// ---------------------------------------------------------------------------

describe('cli/providers/canton/auth — mergeAuthEnvVars', () => {
  it('fills clientId/clientSecret from env for clientCredentials', () => {
    const prevId = process.env.CANTON_CLIENT_ID
    const prevSecret = process.env.CANTON_CLIENT_SECRET
    process.env.CANTON_CLIENT_ID = 'env-cid'
    process.env.CANTON_CLIENT_SECRET = 'env-secret'
    try {
      const merged = mergeAuthEnvVars({
        type: AuthType.ClientCredentials,
        authUrl: 'https://auth.example.com',
        clientId: '',
        clientSecret: '',
      })
      assert.equal(merged.type, AuthType.ClientCredentials)
      assert.equal((merged as { clientId: string }).clientId, 'env-cid')
      assert.equal((merged as { clientSecret: string }).clientSecret, 'env-secret')
    } finally {
      process.env.CANTON_CLIENT_ID = prevId
      process.env.CANTON_CLIENT_SECRET = prevSecret
    }
  })

  it('fills clientId from env for authorizationCode', () => {
    const prevId = process.env.CANTON_CLIENT_ID
    process.env.CANTON_CLIENT_ID = 'env-cid'
    try {
      const merged = mergeAuthEnvVars({
        type: AuthType.AuthorizationCode,
        authUrl: 'https://auth.example.com',
        clientId: '',
      })
      assert.equal(merged.type, AuthType.AuthorizationCode)
      assert.equal((merged as { clientId: string }).clientId, 'env-cid')
    } finally {
      process.env.CANTON_CLIENT_ID = prevId
    }
  })

  it('preserves explicit config values over env', () => {
    const prevId = process.env.CANTON_CLIENT_ID
    process.env.CANTON_CLIENT_ID = 'env-cid'
    try {
      const merged = mergeAuthEnvVars({
        type: AuthType.AuthorizationCode,
        authUrl: 'https://auth.example.com',
        clientId: 'explicit-cid',
      })
      assert.equal((merged as { clientId: string }).clientId, 'explicit-cid')
    } finally {
      process.env.CANTON_CLIENT_ID = prevId
    }
  })

  it('passes static config through unchanged', () => {
    const merged = mergeAuthEnvVars({ jwt: 'my-jwt' })
    assert.equal(merged.type ?? 'static', 'static')
  })

  it('throws a helpful error mentioning env vars when clientCredentials credentials are missing', () => {
    const prevId = process.env.CANTON_CLIENT_ID
    const prevSecret = process.env.CANTON_CLIENT_SECRET
    delete process.env.CANTON_CLIENT_ID
    delete process.env.CANTON_CLIENT_SECRET
    try {
      assert.throws(
        () =>
          mergeAuthEnvVars({
            type: AuthType.ClientCredentials,
            authUrl: 'https://auth.example.com',
            clientId: '',
            clientSecret: '',
          }),
        /CANTON_CLIENT_ID.*CANTON_CLIENT_SECRET/,
      )
    } finally {
      process.env.CANTON_CLIENT_ID = prevId
      process.env.CANTON_CLIENT_SECRET = prevSecret
    }
  })

  it('throws a helpful error mentioning env vars when authorizationCode clientId is missing', () => {
    const prevId = process.env.CANTON_CLIENT_ID
    delete process.env.CANTON_CLIENT_ID
    try {
      assert.throws(
        () =>
          mergeAuthEnvVars({
            type: AuthType.AuthorizationCode,
            authUrl: 'https://auth.example.com',
            clientId: '',
          }),
        /CANTON_CLIENT_ID/,
      )
    } finally {
      process.env.CANTON_CLIENT_ID = prevId
    }
  })
})

// ---------------------------------------------------------------------------
// runAuthorizationCodeFlow (callback server + browser orchestration)
// ---------------------------------------------------------------------------

describe('cli/providers/canton/auth — runAuthorizationCodeFlow', () => {
  it('completes the PKCE flow when the callback is hit with matching state', async () => {
    const tokenServer = await startTokenServer({
      response: { access_token: 'auth-code-token', token_type: 'Bearer', expires_in: 3600 },
    })
    const metaServer = await startMetadataServer({
      tokenEndpoint: `${tokenServer.url}/v1/token`,
      authorizationEndpoint: `${tokenServer.url}/v1/authorize`,
    })
    const callbackPort = await grabFreePort()
    const callbackUrl = `http://127.0.0.1:${callbackPort}/callback`
    const knownState = 'known-test-state'

    try {
      // Start the flow in the background with a fixed state for deterministic testing.
      const flowPromise = runAuthorizationCodeFlow(
        {
          type: AuthType.AuthorizationCode,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          callbackUrl,
        },
        {
          openBrowser: false,
          timeoutMs: 5_000,
          stateOverride: knownState,
          allowInsecureRequests: true,
        },
      )

      // Wait for the callback server to start, then simulate the browser redirect.
      await waitForPort(callbackPort, 1_000)
      const resp = await fetch(`${callbackUrl}?code=test-code&state=${knownState}`)
      assert.equal(resp.status, 200)

      const token = await flowPromise
      assert.equal(token.accessToken, 'auth-code-token')
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })

  it('rejects on state mismatch', async () => {
    const tokenServer = await startTokenServer({})
    const metaServer = await startMetadataServer({
      tokenEndpoint: `${tokenServer.url}/v1/token`,
      authorizationEndpoint: `${tokenServer.url}/v1/authorize`,
    })
    const callbackPort = await grabFreePort()
    const callbackUrl = `http://127.0.0.1:${callbackPort}/callback`

    try {
      const flowPromise = runAuthorizationCodeFlow(
        {
          type: AuthType.AuthorizationCode,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          callbackUrl,
        },
        {
          openBrowser: false,
          timeoutMs: 5_000,
          stateOverride: 'correct-state',
          allowInsecureRequests: true,
        },
      )
      flowPromise.catch(() => {})

      await waitForPort(callbackPort, 1_000)
      // Hit with a wrong state → flow should reject.
      const resp = await fetch(`${callbackUrl}?code=x&state=wrong`)
      assert.equal(resp.status, 400)
      await assert.rejects(flowPromise, Error)
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })
})

// ---------------------------------------------------------------------------
// resolveCantonTokenGetter
// ---------------------------------------------------------------------------

describe('cli/providers/canton/auth — resolveCantonTokenGetter', () => {
  it('returns a static jwt for static auth', async () => {
    const { jwt, tokenGetter } = await resolveCantonTokenGetter({ jwt: 'static-jwt-123' })
    assert.equal(jwt, 'static-jwt-123')
    assert.equal(tokenGetter, undefined)
  })

  it('returns a tokenGetter for clientCredentials', async () => {
    const tokenServer = await startTokenServer({})
    const metaServer = await startMetadataServer({ tokenEndpoint: `${tokenServer.url}/v1/token` })
    try {
      const { jwt, tokenGetter } = await resolveCantonTokenGetter(
        {
          type: AuthType.ClientCredentials,
          authUrl: metaServer.baseUrl,
          clientId: 'cid',
          clientSecret: 'secret',
        },
        { allowInsecureRequests: true },
      )
      assert.equal(jwt, undefined)
      assert.ok(typeof tokenGetter === 'function')
      const token = await tokenGetter!()
      assert.equal(token, 'test-access-token')
    } finally {
      tokenServer.server.close()
      metaServer.server.close()
    }
  })
})
