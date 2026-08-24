/**
 * Gateway submitter — submit an unsigned Canton tx to a Canton Wallet Gateway
 * for approval, signing, and on-ledger execution.
 *
 * The Wallet Gateway speaks CIP-103 over JSON-RPC 2.0 (HTTP POST to its
 * `/api/v0/dapp` endpoint). `prepareExecuteAndWait` takes a
 * `JsPrepareSubmissionRequest` — which is the same shape as the `JsCommands`
 * the CCT ops produce (`commands`, `actAs`, `disclosedContracts`,
 * `commandId`, ...) — so an {@link UnsignedCantonTx} from
 * `manager.generateUnsigned<Op>(...)` maps directly onto the gateway call.
 *
 * The gateway handles approval (its `approve` UI, or auto-approve for capable
 * wallets), signs via its configured signing driver (participant / Blockdaemon
 * / Fireblocks / Securosys / Dfns / internal), and submits to the Canton
 * ledger. `prepareExecuteAndWait` blocks until the transaction is executed,
 * returning the full transaction event. This submitter parses out the
 * `updateId` (the Canton tx hash) and returns a {@link CantonTransactionResult}.
 *
 * This is the "initiate from the SDK, approve + send via gateway" seam. It
 * composes directly with the CCT ops:
 *
 * ```ts
 * const unsigned = await manager.generateUnsignedSetDynamicConfig({...})
 * const result = await submitViaGateway({
 *   gatewayUrl: 'http://localhost:8400/api/v0/dapp',
 *   accessToken: '<gateway session token>',
 *   unsigned,
 * })
 * // → { hash: updateId, response }
 * ```
 *
 * @packageDocumentation
 */

import type { UnsignedCantonTx } from '../../canton/types.ts'

/**
 * Result of {@link submitViaGateway}: the gateway's `prepareExecute` response.
 * `approveUrl` is the URL to open (in a browser) to approve the tx for
 * user-JWT auth; for API-key auth, sign+execute already ran (the URL is still
 * returned but the tx is done). `response` is the raw JSON-RPC result for
 * callers that need other fields.
 */
export interface GatewaySubmitResult {
  /** Gateway `/approve/` URL (user-JWT auth) — open it to approve + execute. */
  approveUrl: string
  /** Raw JSON-RPC result object. */
  response: Record<string, unknown>
}

/** Inputs to {@link submitViaGateway}. */
export interface SubmitViaGatewayParams {
  /** Wallet Gateway dApp RPC URL, e.g. `http://localhost:8400/api/v0/dapp`. */
  gatewayUrl: string
  /**
   * Gateway credential, sent in the `Authorization` header. Either:
   * - a gateway **session token** (minted after `connect`) → `Bearer <token>`, or
   * - a gateway **API key** (long-lived, service-account rights) → `ApiKey <key>`.
   *
   * NOT the Okta/IdP JWT. If the value starts with `ApiKey ` or `Bearer ` it is
   * sent verbatim; otherwise it defaults to `Bearer <accessToken>` (back-compat).
   * Prefer an API key for automation — it has no 1h expiry and the gateway proxies
   * `ledgerApi` reads through the network's service account, so ACS reads succeed.
   */
  accessToken: string
  /** The unsigned Canton tx from a CCT `generateUnsigned<Op>` call. */
  unsigned: UnsignedCantonTx
  /**
   * Optional read-as parties (granted read access to the command). Defaults to
   * none — the gateway uses the primary wallet's party for `actAs` when
   * `unsigned.commands.actAs` is unset.
   */
  readAs?: string[]
  /**
   * Optional synchronizer ID override. When omitted the gateway picks a
   * suitable connected synchronizer.
   */
  synchronizerId?: string
  /**
   * Optional package-id selection preferences for resolving package names in the
   * command. Mirrors `CantonConfig` / the Canton Ledger API
   * `packageIdSelectionPreference`.
   */
  packageIdSelectionPreference?: string[]
  /** Optional `fetch` implementation (defaults to global `fetch`). */
  fetchFn?: typeof fetch
  /** Optional abort signal. */
  signal?: AbortSignal
}

/**
 * Submit an unsigned Canton tx to a Wallet Gateway via CIP-103 `prepareExecute`.
 *
 * The gateway's `prepareExecute` is **two-phase** (there is no
 * `prepareExecuteAndWait` on the gateway): it prepares the tx on the ledger +
 * creates a pending transaction, then either:
 *   - **API-key auth**: auto signs + executes immediately (straight-through,
 *     no human approval). The result still carries `approveUrl` but execution
 *     has already happened.
 *   - **User-JWT auth** (browser session): returns an `approveUrl`; a human
 *     approves at that URL (the gateway's `/approve/` page), after which the
 *     gateway signs + executes. Execution is asynchronous — this call resolves
 *     once the tx is *prepared*, not executed.
 *
 * The params are a `JsPrepareSubmissionRequest`, which is structurally the
 * `JsCommands` the SDK's `generateUnsigned<Op>` produces (`commands`, `actAs`,
 * `disclosedContracts`, `commandId`, ...), so an {@link UnsignedCantonTx} maps
 * directly.
 *
 * @returns the gateway's `prepareExecute` result: `{ approveUrl }` (open it to
 *   approve, or — for API-key auth — execution is already done). The final
 *   on-ledger `updateId` is NOT returned here; track it via the gateway UI /
 *   activities after approval.
 * @throws {GatewaySubmitError} on a non-2xx HTTP response or a JSON-RPC error.
 */
export async function submitViaGateway(
  params: SubmitViaGatewayParams,
): Promise<GatewaySubmitResult> {
  const {
    gatewayUrl,
    accessToken,
    unsigned,
    readAs,
    synchronizerId,
    packageIdSelectionPreference,
    fetchFn = globalThis.fetch.bind(globalThis),
    signal,
  } = params

  // The gateway's prepareExecute takes a JsPrepareSubmissionRequest, which is
  // structurally the JsCommands the SDK already produced, plus the optional
  // readAs / synchronizerId / packageIdSelectionPreference fields.
  const requestParams: Record<string, unknown> = {
    ...unsigned.commands,
  }
  if (readAs) requestParams['readAs'] = readAs
  if (synchronizerId) requestParams['synchronizerId'] = synchronizerId
  if (packageIdSelectionPreference) {
    requestParams['packageIdSelectionPreference'] = packageIdSelectionPreference
  }

  const body = {
    jsonrpc: '2.0',
    id: cryptoRandomId(),
    method: 'prepareExecute',
    params: requestParams,
  }

  const response = await fetchFn(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(accessToken),
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text().catch(() => '')
    }
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

  // prepareExecute result: { userUrl: <approveUrl> } (two-phase — the tx is
  // prepared + pending; for user-JWT auth a human approves at userUrl, for
  // API-key auth sign+execute already ran). The final on-ledger updateId is
  // not returned here; track it via the gateway UI / activities after approval.
  const result = (json.result ?? {}) as { userUrl?: string }
  return { approveUrl: result.userUrl ?? '', response: json.result as Record<string, unknown> }
}

/**
 * Fetch the primary wallet's party ID from the gateway (CIP-103 dApp API
 * `getPrimaryAccount`). Lets flows derive the acting party from the gateway
 * session instead of requiring the user to type their party ID.
 *
 * @throws {GatewaySubmitError} on a non-2xx HTTP response, a JSON-RPC error,
 *   or a result without a `partyId`.
 */
export async function fetchGatewayPrimaryParty(params: {
  /** Gateway dApp JSON-RPC URL. */
  gatewayUrl: string
  /** Gateway access token (session or API key). */
  accessToken: string
  /** Injectable fetch (testing). */
  fetchFn?: typeof fetch
  /** Optional abort signal. */
  signal?: AbortSignal
}): Promise<string> {
  const { gatewayUrl, accessToken, fetchFn = globalThis.fetch.bind(globalThis), signal } = params

  const response = await fetchFn(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(accessToken),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: cryptoRandomId(), method: 'getPrimaryAccount' }),
    signal,
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
 * the user-API `addSession` method if none exists.
 *
 * Why: `prepareExecute` and the `ledgerApi` proxy both call
 * `getCurrentNetwork()` → `getSession(accessToken)`, which requires a stored
 * session row keyed by `(userId, accessToken)`. A raw Bearer/Okta JWT is a
 * valid *ledger* credential but is never registered as a gateway session
 * outside the browser `connect`/`addSession` flow — so submit/read 401 with
 * "No session found". Calling `addSession` headlessly provisions that row from
 * any token whose claims match the network (`assertTokenClaimsMatchNetwork`),
 * no browser required.
 *
 * Tolerates an already-existing session: the gateway returns HTTP 500 with a
 * JSON-RPC error `Failed to add session` when a session for the token already
 * exists. That is treated as success (the goal — a usable session — is met),
 * not an error. Safe to call at every run start.
 *
 * The user-API endpoint is the gateway's `userPath` (e.g.
 * `http://localhost:8400/api/v0/user`), derived from the dApp URL by replacing
 * the trailing `/api/v0/dapp` with `/api/v0/user`.
 *
 * @throws {GatewaySubmitError} on a non-2xx HTTP response that is NOT the
 *   duplicate-session case, or a JSON-RPC error other than "Failed to add
 *   session".
 */
export async function ensureGatewaySession(params: {
  /** Gateway dApp JSON-RPC URL (`…/api/v0/dapp`). The user-API URL is derived. */
  gatewayUrl: string
  /** Gateway access token (the Bearer JWT to provision a session for). */
  accessToken: string
  /** Network ID to bind the session to (e.g. `canton:chainlink-testnet`). */
  networkId: string
  /** Origin label for the session (defaults to `cli-<random>`). */
  origin?: string
  /** Injectable fetch (testing). */
  fetchFn?: typeof fetch
  /** Optional abort signal. */
  signal?: AbortSignal
}): Promise<void> {
  const {
    gatewayUrl,
    accessToken,
    networkId,
    origin = `cli-${Math.random().toString(36).slice(2, 10)}`,
    fetchFn = globalThis.fetch.bind(globalThis),
    signal,
  } = params

  // The user-API shares the gateway host but lives at /api/v0/user.
  const userApiUrl = gatewayUrl.replace(/\/api\/v0\/dapp$/, '/api/v0/user')
  if (userApiUrl === gatewayUrl) {
    throw new GatewaySubmitError(
      `ensureGatewaySession: gatewayUrl must end with /api/v0/dapp (got ${gatewayUrl})`,
      undefined,
    )
  }

  const response = await fetchFn(userApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(accessToken),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: cryptoRandomId(),
      method: 'addSession',
      params: { origin, networkId },
    }),
    signal,
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text().catch(() => '')
    }
    // The gateway 500s with "Failed to add session" when a session already
    // exists for this token — that satisfies the precondition, so treat it as
    // success rather than a hard error.
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

/** Match the gateway's duplicate-session error (`Failed to add session`). */
function isDuplicateSessionError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const err = (body as { error?: { message?: string } }).error
  return typeof err?.message === 'string' && err.message.includes('Failed to add session')
}

/** Error thrown when a gateway submission fails (HTTP or JSON-RPC level). */
export class GatewaySubmitError extends Error {
  /** Raw error data from the gateway (HTTP body or JSON-RPC `error.data`). */
  readonly data: unknown
  constructor(message: string, data: unknown) {
    super(message)
    this.name = 'GatewaySubmitError'
    this.data = data
  }
}

/** A JSON-RPC 2.0 response (success or error). */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Build the `Authorization` header value from a gateway credential.
 *
 * Accepts either a raw token (sent as `Bearer <token>`) or a pre-schemed
 * value (`ApiKey <key>` / `Bearer <token>`) sent verbatim. The scheme matters:
 * `ApiKey` makes the gateway use the network's service account for `ledgerApi`
 * reads (broad rights, no 1h expiry); `Bearer` uses the caller's session token.
 */
export function authHeader(accessToken: string): string {
  if (accessToken.startsWith('ApiKey ') || accessToken.startsWith('Bearer ')) {
    return accessToken
  }
  return `Bearer ${accessToken}`
}

/**
 * Generate a random JSON-RPC id. Uses `crypto.randomUUID` when available,
 * falling back to a random hex string.
 */
function cryptoRandomId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (c?.randomUUID) return c.randomUUID()
  return 'cct-' + Math.random().toString(36).slice(2, 10)
}
