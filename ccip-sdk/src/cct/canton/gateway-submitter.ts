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
   * Gateway session access token (the gateway's own session token obtained
   * after `connect`, sent as `Authorization: Bearer <accessToken>`). NOT the
   * Okta/IdP JWT — the gateway mints its own session token after the user
   * authenticates via the `connect` flow.
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
      Authorization: `Bearer ${accessToken}`,
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
 * Generate a random JSON-RPC id. Uses `crypto.randomUUID` when available,
 * falling back to a random hex string.
 */
function cryptoRandomId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (c?.randomUUID) return c.randomUUID()
  return 'cct-' + Math.random().toString(36).slice(2, 10)
}
