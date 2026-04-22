/**
 * Integration test for CantonChain.execute
 *
 *
 * Authentication uses OAuth 2.0 Authorization Code + PKCE
 *
 * This test is skipped by default. Set STAGING_CANTON_MANUAL=1 to enable it.
 *
 * Required env vars:
 *
 *   STAGING_CANTON_MANUAL                  (set to any non-empty value to run this test)
 *   STAGING_CANTON_MESSAGE_ID              — 0x-prefixed CCIP message ID to execute
 *   STAGING_CANTON_JSON_LEDGER_API_URL
 *   STAGING_CANTON_EDS_URL
 *   STAGING_CANTON_INDEXER_URL
 *   STAGING_CANTON_PARTY_ID
 *   STAGING_CANTON_DEST_SELECTOR
 *
 * Optional env vars:
 *
 *   STAGING_CANTON_JWT                     (skip OAuth browser flow if set)
 *   STAGING_CANTON_AUTH_URL                (OIDC issuer URL; required when JWT is not set)
 *   STAGING_CANTON_CLIENT_ID               (OAuth2 client ID; required when JWT is not set)
 *   STAGING_CANTON_EXPECTED_RESULTS        (number of verifier results to wait for)
 *   STAGING_CANTON_POLL_TIMEOUT_MS         (polling timeout in ms)
 *
 * Run with:
 *   npm test --workspace ccip-sdk -- --test-name-pattern="canton/execute"
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { describe, it } from 'node:test'

import { CantonChain } from './index.ts'
import { CCIPVersion } from '../types.ts'

// ---------------------------------------------------------------------------
// Staging configuration — all values must be provided via environment variables
// ---------------------------------------------------------------------------

/** OIDC authorization server base URL (required when JWT is not set) */
const AUTH_URL = process.env.STAGING_CANTON_AUTH_URL ?? ''

/** OAuth2 client ID (required when JWT is not set) */
const CLIENT_ID = process.env.STAGING_CANTON_CLIENT_ID ?? ''

/** Canton JSON Ledger API URL (SDK uses HTTP JSON API, not gRPC) */
const LEDGER_URL = process.env.STAGING_CANTON_JSON_LEDGER_API_URL ?? ''

/** Party acting as the executing party */
const PARTY = process.env.STAGING_CANTON_PARTY_ID ?? ''

/** Base URL of the Explicit Disclosure Service */
const EDS_URL = process.env.STAGING_CANTON_EDS_URL ?? ''

/** Base URL of the CCV indexer service */
const INDEXER_URL = process.env.STAGING_CANTON_INDEXER_URL ?? ''

/** 0x-prefixed CCIP message ID to execute */
const MESSAGE_ID = process.env.STAGING_CANTON_MESSAGE_ID ?? ''

/** Destination Canton chain selector */
const DEST_SELECTOR = process.env.STAGING_MANUAL_EXEC_EVM_TO_CANTON_DEST_SELECTOR
  ? BigInt(process.env.STAGING_MANUAL_EXEC_EVM_TO_CANTON_DEST_SELECTOR)
  : 0n

/** How often (ms) to poll the indexer for verifier results */
const POLL_INTERVAL_MS = 2_000

/** Maximum time (ms) to wait for verifier results */
const POLL_TIMEOUT_MS = Number(process.env.STAGING_CANTON_POLL_TIMEOUT_MS) || 300_000

/** Number of verifier results expected before executing */
const EXPECTED_VERIFIER_RESULTS = Number(process.env.STAGING_CANTON_EXPECTED_RESULTS) || 1

/** Pre-set JWT token — if provided, skips the OAuth browser flow */
const JWT_TOKEN = process.env.STAGING_CANTON_JWT ?? ''

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Raw shape of the Message object returned by the indexer (JSON field names
// match the Go struct tags in protocol.Message and protocol.TokenTransfer).
interface IndexerTokenTransfer {
  version: number
  amount: string // hex "0x..."
  source_pool_address: string
  source_pool_address_length: number
  source_token_address: string
  source_token_address_length: number
  dest_token_address: string
  dest_token_address_length: number
  token_receiver: string
  token_receiver_length: number
  extra_data: string
  extra_data_length: number
}

interface IndexerMessage {
  version: number
  source_chain_selector: string
  dest_chain_selector: string
  sequence_number: number
  execution_gas_limit: number
  ccip_receive_gas_limit: number
  finality: number
  ccv_and_executor_hash: string
  on_ramp_address: string
  on_ramp_address_length: number
  off_ramp_address: string
  off_ramp_address_length: number
  sender: string
  sender_length: number
  receiver: string
  receiver_length: number
  dest_blob: string
  dest_blob_length: number
  token_transfer: IndexerTokenTransfer | null
  token_transfer_length: number
  data: string
  data_length: number
}

interface IndexerVerifierResult {
  verifierResult: {
    message_id: string
    message: IndexerMessage
    message_ccv_addresses: string[]
    ccv_data: string
    timestamp: string
    verifier_source_address: string
    verifier_dest_address: string
  }
}

interface IndexerResponse {
  success: boolean
  results: IndexerVerifierResult[]
  messageID: string
}

/**
 * OAuth 2.0 Authorization Code + PKCE flow.
 *
 * Discovers OIDC endpoints from the issuer URL, opens the system browser for
 * user authentication, waits for the authorization-code callback on a local
 * HTTP server, exchanges the code for a token, and returns the access_token.
 *
 * Mirrors `authorizationcode.NewDiscoveryProvider` from the Go staging script.
 */
async function getTokenViaAuthCode(authUrl: string, clientId: string): Promise<string> {
  // 1. Discover OIDC endpoints
  const discoveryRes = await fetch(`${authUrl}/.well-known/openid-configuration`)
  if (!discoveryRes.ok) {
    throw new Error(`OIDC discovery failed (${discoveryRes.status}): ${authUrl}`)
  }
  const oidc = (await discoveryRes.json()) as {
    authorization_endpoint: string
    token_endpoint: string
  }

  // 2. Generate PKCE code_verifier / code_challenge and a CSRF state token
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')

  // 3. Start a local callback server on the fixed port 8400 registered in the
  //    Okta client app (same as the Go authorizationcode package default).
  const CALLBACK_PORT = 8400
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.listen(CALLBACK_PORT, 'localhost', () => resolve())
    server.on('error', reject)
  })
  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`

  // 4. Build the authorization URL and open the system browser
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
  console.log(`\n[execute.test] Opening browser for Canton authentication:\n  ${authEndpoint}\n`)
  // open is ESM-only; dynamic import avoids top-level await constraints
  const { default: open } = await import('open')
  await open(authEndpoint)

  // 5. Wait for the authorization code delivered to the local callback
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

  // 6. Exchange the authorization code for an access token
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

/**
 * Decode a hex string (with or without "0x" prefix) into a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (h.length === 0) return new Uint8Array(0)
  const buf = new Uint8Array(h.length / 2)
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return buf
}

/**
 * Encode a TokenTransfer to bytes, replicating TokenTransfer.Encode() from Go.
 *
 * Wire format:
 *   version (1 byte)
 *   amount  (32 bytes, big-endian)
 *   source_pool_address_length (1) + source_pool_address
 *   source_token_address_length (1) + source_token_address
 *   dest_token_address_length (1) + dest_token_address
 *   token_receiver_length (1) + token_receiver
 *   extra_data_length (2 BE) + extra_data
 */
function encodeTokenTransfer(tt: IndexerTokenTransfer): Uint8Array {
  const sourcePool = hexToBytes(tt.source_pool_address)
  const sourceToken = hexToBytes(tt.source_token_address)
  const destToken = hexToBytes(tt.dest_token_address)
  const tokenReceiver = hexToBytes(tt.token_receiver)
  const extraData = hexToBytes(tt.extra_data)

  // Amount: 32-byte big-endian from hex
  const amountHex =
    tt.amount.startsWith('0x') || tt.amount.startsWith('0X') ? tt.amount.slice(2) : tt.amount
  const amountBytes = new Uint8Array(32)
  const amountBig = BigInt('0x' + (amountHex || '0'))
  for (let i = 31; i >= 0; i--) {
    amountBytes[i] = Number((amountBig >> BigInt((31 - i) * 8)) & 0xffn)
  }

  const totalLen =
    1 +
    32 +
    1 +
    sourcePool.length +
    1 +
    sourceToken.length +
    1 +
    destToken.length +
    1 +
    tokenReceiver.length +
    2 +
    extraData.length
  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)
  let offset = 0

  buf[offset++] = tt.version
  buf.set(amountBytes, offset)
  offset += 32
  buf[offset++] = tt.source_pool_address_length
  buf.set(sourcePool, offset)
  offset += sourcePool.length
  buf[offset++] = tt.source_token_address_length
  buf.set(sourceToken, offset)
  offset += sourceToken.length
  buf[offset++] = tt.dest_token_address_length
  buf.set(destToken, offset)
  offset += destToken.length
  buf[offset++] = tt.token_receiver_length
  buf.set(tokenReceiver, offset)
  offset += tokenReceiver.length
  view.setUint16(offset, tt.extra_data_length, false)
  offset += 2
  buf.set(extraData, offset)

  return buf
}

/**
 * Encode a Message struct to bytes, replicating Message.Encode() from Go
 * (protocol/message_types.go).
 *
 * Wire format (big-endian):
 *   version (1)
 *   source_chain_selector (8)
 *   dest_chain_selector (8)
 *   sequence_number (8)
 *   execution_gas_limit (4)
 *   ccip_receive_gas_limit (4)
 *   finality (4)
 *   ccv_and_executor_hash (32)
 *   on_ramp_address_length (1) + on_ramp_address
 *   off_ramp_address_length (1) + off_ramp_address
 *   sender_length (1) + sender
 *   receiver_length (1) + receiver
 *   dest_blob_length (2) + dest_blob
 *   token_transfer_length (2) + token_transfer (encoded)
 *   data_length (2) + data
 */
function encodeMessage(msg: IndexerMessage): Uint8Array {
  const onRamp = hexToBytes(msg.on_ramp_address)
  const offRamp = hexToBytes(msg.off_ramp_address)
  const sender = hexToBytes(msg.sender)
  const receiver = hexToBytes(msg.receiver)
  const destBlob = msg.dest_blob ? hexToBytes(msg.dest_blob) : new Uint8Array(0)
  const data = hexToBytes(msg.data)
  const ccvHash = hexToBytes(msg.ccv_and_executor_hash)
  const tokenTransferBytes = msg.token_transfer
    ? encodeTokenTransfer(msg.token_transfer)
    : new Uint8Array(0)

  const totalLen =
    1 + // version
    8 + // source_chain_selector
    8 + // dest_chain_selector
    8 + // sequence_number
    4 + // execution_gas_limit
    4 + // ccip_receive_gas_limit
    4 + // finality (uint32)
    32 + // ccv_and_executor_hash
    1 +
    onRamp.length +
    1 +
    offRamp.length +
    1 +
    sender.length +
    1 +
    receiver.length +
    2 +
    destBlob.length +
    2 +
    tokenTransferBytes.length +
    2 +
    data.length

  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)
  let offset = 0

  buf[offset++] = msg.version
  view.setBigUint64(offset, BigInt(msg.source_chain_selector), false)
  offset += 8
  view.setBigUint64(offset, BigInt(msg.dest_chain_selector), false)
  offset += 8
  view.setBigUint64(offset, BigInt(msg.sequence_number), false)
  offset += 8
  view.setUint32(offset, msg.execution_gas_limit, false)
  offset += 4
  view.setUint32(offset, msg.ccip_receive_gas_limit, false)
  offset += 4
  view.setUint32(offset, msg.finality, false)
  offset += 4
  buf.set(ccvHash, offset)
  offset += 32
  buf[offset++] = msg.on_ramp_address_length
  buf.set(onRamp, offset)
  offset += onRamp.length
  buf[offset++] = msg.off_ramp_address_length
  buf.set(offRamp, offset)
  offset += offRamp.length
  buf[offset++] = msg.sender_length
  buf.set(sender, offset)
  offset += sender.length
  buf[offset++] = msg.receiver_length
  buf.set(receiver, offset)
  offset += receiver.length
  view.setUint16(offset, msg.dest_blob_length, false)
  offset += 2
  buf.set(destBlob, offset)
  offset += destBlob.length
  view.setUint16(offset, msg.token_transfer_length, false)
  offset += 2
  buf.set(tokenTransferBytes, offset)
  offset += tokenTransferBytes.length
  view.setUint16(offset, msg.data_length, false)
  offset += 2
  buf.set(data, offset)

  return buf
}

/**
 * Fetch raw verifier results from the indexer, returning the full response
 * including the unparsed Message struct needed to compute the encoded message.
 */
async function fetchIndexerRaw(indexerUrl: string, messageId: string): Promise<IndexerResponse> {
  const url = `${indexerUrl}/v1/verifierresults/${messageId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Indexer responded with ${res.status} for ${messageId}`)
  // Pre-process the raw JSON text to quote large uint64 fields before JSON.parse
  // converts them to float64 and loses precision (JS Number.MAX_SAFE_INTEGER ~9e15
  // is smaller than chain selectors ~1.6e19).
  const text = (await res.text()).replace(
    /"(source_chain_selector|dest_chain_selector)"\s*:\s*(\d+)/g,
    '"$1":"$2"',
  )
  return JSON.parse(text) as IndexerResponse
}

/**
 * Poll the indexer via `chain.getVerifications` until the expected number of
 * verifier results are available, mirroring the Go script's
 * `waitForVerifierResults` loop.
 *
 * Catches errors from `getVerifications` (e.g. 404 when the message hasn't
 * been indexed yet) and keeps retrying until the timeout.
 */
async function waitForVerifications(
  chain: CantonChain,
  offRamp: string,
  request: Parameters<CantonChain['getVerifications']>[0]['request'],
  expectedResults: number,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<{ ccvData: string; destAddress: string }[]> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const verifications = await chain.getVerifications({ offRamp, request })

      if ('verifications' in verifications) {
        const results = verifications.verifications
        console.log(
          `[execute.test] Indexer returned ${results.length}/${expectedResults} verifier result(s)`,
        )
        if (results.length >= expectedResults) {
          return results.map((v) => ({ ccvData: String(v.ccvData), destAddress: v.destAddress }))
        }
      }
    } catch (err) {
      // Keep polling — the indexer may return non-200 until the message is indexed
      console.log(
        `[execute.test] Waiting for verifier results: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${expectedResults} verifier result(s)`,
  )
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('canton/execute', { skip: !process.env.STAGING_CANTON_MANUAL }, () => {
  it('fetches verifications from indexer and then executes', async () => {
    // --- pre-flight checks ---
    assert.ok(MESSAGE_ID, 'STAGING_CANTON_MESSAGE_ID is required (0x-prefixed CCIP message ID)')

    // --- obtain JWT via OAuth2 Authorization Code + PKCE ---
    // Mirrors the Go script's authorizationCode flow (commonconfig.AuthTypeAuthorizationCode).
    const jwt = JWT_TOKEN || (await getTokenViaAuthCode(AUTH_URL, CLIENT_ID))
    console.log('[execute.test] OAuth2 token obtained successfully. JWT: ', jwt)

    // --- connect to Canton staging (HTTP/2 required — see client.ts) ---
    const chain = await CantonChain.fromUrl(LEDGER_URL, {
      cantonConfig: {
        party: PARTY,
        ccipParty: PARTY,
        jwt,
        edsUrl: EDS_URL,
        transferInstructionUrl: EDS_URL,
        indexerUrl: INDEXER_URL,
      },
    })

    console.log(
      `[execute.test] Connected to Canton staging (selector=${chain.network.chainSelector})`,
    )

    // Step 1 — Poll indexer for raw verifier results + derive encoded message from the
    // first result's Message struct (mirrors Go's resp.Results[0].VerifierResult.Message.Encode()).
    console.log(`[execute.test] Polling indexer for verifier results (message=${MESSAGE_ID})...`)

    // Fetch the raw response separately so we can access the Message struct
    // (CantonChain.getVerifications only surfaces ccvData / destAddress).
    let rawResponse: IndexerResponse | null = null
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        rawResponse = await fetchIndexerRaw(INDEXER_URL, MESSAGE_ID)
        if (rawResponse.success && rawResponse.results.length >= EXPECTED_VERIFIER_RESULTS) break
        console.log(
          `[execute.test] Waiting for indexer (${rawResponse.results.length}/${EXPECTED_VERIFIER_RESULTS} results)...`,
        )
      } catch (err) {
        console.log(
          `[execute.test] Indexer not ready: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    assert.ok(rawResponse?.success, 'Indexer did not return success=true within timeout')
    assert.ok(
      rawResponse.results.length >= EXPECTED_VERIFIER_RESULTS,
      `expected at least ${EXPECTED_VERIFIER_RESULTS} verifier result(s)`,
    )

    console.log(
      `[execute.test] Indexer returned raw message: ${JSON.stringify(rawResponse.results[0]?.verifierResult.message)}`,
    )
    // Encode the message from the first result's Message struct
    const firstMessage = rawResponse.results[0]?.verifierResult.message
    assert.ok(firstMessage, 'First verifier result must have a message')
    const encodedMessageBytes = encodeMessage(firstMessage)
    const encodedMessage = '0x' + Buffer.from(encodedMessageBytes).toString('hex')
    console.log(`[execute.test] Derived encodedMessage (${encodedMessageBytes.length} bytes)`)

    // Build a minimal CCIPRequest sufficient for getVerifications.
    // CantonChain.getVerifications only reads message.messageId and lane.version;
    // all other fields are zero-valued and cast through unknown to satisfy the type.
    const syntheticRequest = {
      lane: {
        version: CCIPVersion.V2_0,
        sourceChainSelector: DEST_SELECTOR,
        destChainSelector: DEST_SELECTOR,
        onRamp: '',
      },
      message: {
        messageId: MESSAGE_ID,
        encodedMessage: encodedMessage,
        sequenceNumber: 1n,
        sender: '',
        receiver: '',
        data: '0x',
        tokenAmounts: [],
        feeToken: '',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
        gasLimit: 0n,
        strict: false,
        nonce: 0n,
        header: {
          messageId: MESSAGE_ID,
          sourceChainSelector: DEST_SELECTOR,
          destChainSelector: DEST_SELECTOR,
          sequenceNumber: 1n,
          nonce: 0n,
        },
      },
      log: {
        topics: [],
        address: '',
        blockNumber: 0,
        transactionHash: '',
        index: 0,
        data: {},
      },
      tx: { hash: '' },
    } as unknown as Parameters<CantonChain['getVerifications']>[0]['request']

    const verificationResults = await waitForVerifications(
      chain,
      '' /* offRamp: not used by CantonChain.getVerifications */,
      syntheticRequest,
      EXPECTED_VERIFIER_RESULTS,
      POLL_INTERVAL_MS,
      POLL_TIMEOUT_MS,
    )

    console.log(
      `[execute.test] Loaded ${verificationResults.length} verifier result(s) from indexer`,
    )

    assert.ok(
      verificationResults.length >= EXPECTED_VERIFIER_RESULTS,
      `expected at least ${EXPECTED_VERIFIER_RESULTS} verifier result(s), got ${verificationResults.length}`,
    )

    // Step 2 — Execute via the SDK (mirrors the Go SubmitAndWaitForTransaction call).
    // The SDK's generateUnsignedExecute fetches ACS + EDS disclosures,
    // builds the Execute choice argument, and submits to the Canton Ledger API.
    console.log('[execute.test] Executing CCIP message on Canton...')
    const execution = await chain.execute({
      offRamp: '' /* not used by Canton execute path */,
      input: {
        encodedMessage: encodedMessage,
        verifications: verificationResults,
      },
      wallet: { party: PARTY },
    })

    console.log(`[execute.test] Executed — updateId=${execution.log.transactionHash}`)

    assert.ok(
      typeof execution.log.transactionHash === 'string' && execution.log.transactionHash.length > 0,
      'transactionHash (updateId) should be a non-empty string',
    )
    assert.ok(
      typeof execution.receipt.messageId === 'string' && execution.receipt.messageId.length > 0,
      'receipt.messageId should be a non-empty string',
    )
  })
})
