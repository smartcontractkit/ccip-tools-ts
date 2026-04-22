/**
 * Integration test for CantonChain.sendMessage
 *
 *
 * Authentication uses OAuth 2.0 Authorization Code + PKCE
 *
 * This test is skipped by default. Set STAGING_CANTON_MANUAL=1 to enable it.
 *
 * Required env vars:
 *
 *   STAGING_CANTON_MANUAL                      (set to any non-empty value to run this test)
 *   STAGING_CANTON_JSON_LEDGER_API_URL
 *   STAGING_CANTON_EDS_URL
 *   STAGING_CANTON_TRANSFER_INSTRUCTION_URL
 *   STAGING_CANTON_PARTY_ID
 *   STAGING_CANTON_DEST_SELECTOR
 *   STAGING_CANTON_RECEIVER
 *   STAGING_CANTON_DATA                        (hex-encoded message payload)
 *
 * Optional env vars:
 *
 *   STAGING_CANTON_JWT                         (skip OAuth browser flow if set)
 *   STAGING_CANTON_AUTH_URL                    (OIDC issuer URL; required when JWT is not set)
 *   STAGING_CANTON_CLIENT_ID                   (OAuth2 client ID; required when JWT is not set)
 *   STAGING_CANTON_GAS_LIMIT
 *
 * Run with:
 *   npm test --workspace ccip-sdk -- --test-name-pattern="canton/send"
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { describe, it } from 'node:test'

import { CantonChain } from './index.ts'

// ---------------------------------------------------------------------------
// Staging configuration — all values must be provided via environment variables
// ---------------------------------------------------------------------------

/** OIDC authorization server base URL (required when JWT is not set) */
const AUTH_URL = process.env.STAGING_CANTON_AUTH_URL ?? ''

/** OAuth2 client ID (required when JWT is not set) */
const CLIENT_ID = process.env.STAGING_CANTON_CLIENT_ID ?? ''

/** Canton JSON Ledger API URL (SDK uses HTTP JSON API, not gRPC) */
const LEDGER_URL = process.env.STAGING_CANTON_JSON_LEDGER_API_URL ?? ''

/** Party acting as the sender */
const PARTY = process.env.STAGING_CANTON_PARTY_ID ?? ''

/** Base URL of the Explicit Disclosure Service */
const EDS_URL = process.env.STAGING_CANTON_EDS_URL ?? ''

/** Base URL for Transfer Instruction and Token Metadata APIs (validator scan-proxy) */
const TRANSFER_INSTRUCTION_URL = process.env.STAGING_CANTON_TRANSFER_INSTRUCTION_URL ?? ''

/** Destination EVM chain selector */
const DEST_CHAIN_SELECTOR = process.env.STAGING_CANTON_DEST_SELECTOR
  ? BigInt(process.env.STAGING_CANTON_DEST_SELECTOR)
  : 0n

/** Destination receiver EVM address */
const RECEIVER = process.env.STAGING_CANTON_RECEIVER ?? ''

/** Message payload as hex */
const MESSAGE_DATA = process.env.STAGING_CANTON_DATA ?? '0x32'

/** Execution gas limit on destination */
const GAS_LIMIT = process.env.STAGING_CANTON_GAS_LIMIT
  ? BigInt(process.env.STAGING_CANTON_GAS_LIMIT)
  : undefined

/** Pre-set JWT token — if provided, skips the OAuth browser flow */
const JWT_TOKEN = process.env.STAGING_CANTON_JWT ?? ''

// ---------------------------------------------------------------------------
// OAuth2 Authorization Code + PKCE flow
// ---------------------------------------------------------------------------

/**
 * Mirrors `authorizationcode.NewDiscoveryProvider` from the Go staging script.
 *
 * Discovers OIDC endpoints from the issuer URL, opens the system browser for
 * user authentication, waits for the callback on a local HTTP server,
 * exchanges the code for a token, and returns the access_token.
 */
async function getTokenViaAuthCode(authUrl: string, clientId: string): Promise<string> {
  const discoveryRes = await fetch(`${authUrl}/.well-known/openid-configuration`)
  if (!discoveryRes.ok) {
    throw new Error(`OIDC discovery failed (${discoveryRes.status}): ${authUrl}`)
  }
  const oidc = (await discoveryRes.json()) as {
    authorization_endpoint: string
    token_endpoint: string
  }

  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')

  const CALLBACK_PORT = 8400
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.listen(CALLBACK_PORT, 'localhost', () => resolve())
    server.on('error', reject)
  })
  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: 'daml_ledger_api openid',
    state,
  })
  const authEndpoint = `${oidc.authorization_endpoint}?${authParams.toString()}`
  console.log(`\n[send.test] Opening browser for Canton authentication:\n  ${authEndpoint}\n`)
  const { default: open } = await import('open')
  await open(authEndpoint)

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('OAuth2 timeout: no authorization code received within 120s'))
    }, 120_000)

    server.on('request', (req, res) => {
      clearTimeout(timer)
      try {
        const cbUrl = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)
        const authCode = cbUrl.searchParams.get('code')
        const returnedState = cbUrl.searchParams.get('state')
        const error = cbUrl.searchParams.get('error')
        const errorDesc = cbUrl.searchParams.get('error_description') ?? error ?? 'unknown error'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          authCode && returnedState === state
            ? '<html><body><h2>Authentication successful!</h2><p>You can close this tab.</p></body></html>'
            : `<html><body><h2>Authentication failed</h2><p>${errorDesc}</p></body></html>`,
        )
        server.close()
        if (authCode && returnedState === state) {
          resolve(authCode)
        } else if (returnedState !== state) {
          reject(new Error('OAuth2 error: state mismatch (CSRF check failed)'))
        } else {
          reject(new Error(`OAuth2 error: ${errorDesc}`))
        }
      } catch (e) {
        server.close()
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })

  const tokenRes = await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
  })
  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`)
  }
  const tokenData = (await tokenRes.json()) as { access_token: string }
  return tokenData.access_token
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('canton/send', { skip: !process.env.STAGING_CANTON_MANUAL }, () => {
  it('sends a CCIP message from Canton to EVM and returns a valid CCIPRequest', async () => {
    // --- obtain JWT ---
    const jwt = JWT_TOKEN || (await getTokenViaAuthCode(AUTH_URL, CLIENT_ID))
    console.log('[send.test] JWT token obtained successfully')

    // --- connect to Canton staging ---
    const chain = await CantonChain.fromUrl(LEDGER_URL, {
      cantonConfig: {
        party: PARTY,
        ccipParty: PARTY,
        jwt,
        edsUrl: EDS_URL,
        transferInstructionUrl: TRANSFER_INSTRUCTION_URL,
      },
    })
    console.log(`[send.test] Connected to Canton (selector=${chain.network.chainSelector})`)

    // --- auto-discover fee token and extra args from the chain ---
    const { feeToken, extraArgs } = await chain.discoverSendArgs(PARTY)
    if (GAS_LIMIT !== undefined) extraArgs.gasLimit = GAS_LIMIT
    console.log(`[send.test] Fee token: ${feeToken}`)

    // --- send ---
    console.log('[send.test] Sending CCIP message from Canton to EVM...')
    const request = await chain.sendMessage({
      wallet: { party: PARTY },
      router: '',
      destChainSelector: DEST_CHAIN_SELECTOR,
      message: { receiver: RECEIVER, data: MESSAGE_DATA, tokenAmounts: [], feeToken, extraArgs },
    })

    // --- assertions ---
    console.log(`[send.test] Message sent — messageId=${request.message.messageId}`)
    console.log(`[send.test] Sequence number : ${request.message.sequenceNumber}`)
    console.log(`[send.test] Update ID       : ${request.tx.hash}`)

    assert.ok(
      typeof request.message.messageId === 'string' && request.message.messageId.length > 0,
      'messageId should be a non-empty string',
    )
    assert.equal(
      request.lane.sourceChainSelector,
      chain.network.chainSelector,
      'sourceChainSelector should match the connected chain',
    )
    assert.equal(
      request.lane.destChainSelector,
      DEST_CHAIN_SELECTOR,
      'destChainSelector should match the requested destination',
    )
    assert.ok(request.message.sequenceNumber > 0n, 'sequenceNumber should be greater than 0')
    assert.ok(
      typeof request.tx.hash === 'string' && request.tx.hash.length > 0,
      'tx hash should be set',
    )
  })
})
