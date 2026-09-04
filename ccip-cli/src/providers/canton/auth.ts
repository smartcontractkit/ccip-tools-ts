import { execFile } from 'node:child_process'
import { type Server, createServer } from 'node:http'

import {
  type AccessToken,
  type AuthorizationCodeAuthConfig,
  type CantonAuthConfig,
  type CantonAuthProvider,
  type CantonAuthProviderOptions,
  CCIPError,
  CCIPErrorCode,
  CantonAuthType,
  CantonStaticProvider,
  buildCantonAuthorizationRequest,
  createCantonAuthProvider,
  createCantonMemoizedTokenFetcher,
  exchangeCantonAuthorizationCode,
  refreshCantonAuthorizationCodeToken,
  validateCantonAuthorizationCallback,
} from '@chainlink/ccip-sdk/src/index.ts'

/**
 * Canton OAuth 2.0 orchestration — Node-specific bits that compose the SDK's
 * runtime-agnostic protocol helpers.
 *
 * @packageDocumentation
 *
 * The SDK exports only the protocol pieces (build-authorize-URL, callback
 * validation, code→token exchange, refresh grant, client-credentials/static
 * providers). This module owns everything environment-specific:
 * - the local `node:http` callback server for the authorization-code flow
 * - `open`/`xdg-open` browser launching
 * - `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET` env-var resolution
 * - timeouts and terminal UX
 *
 * It resolves auth upfront and hands the result to `cantonConfig` as either a
 * static `jwt` string or a `() => Promise<string>` token getter that the SDK
 * clients call per request (enabling automatic refresh).
 */

/** Default local redirect URI for the authorization-code callback server. */
const DEFAULT_CALLBACK_URL = 'http://localhost:8400/callback'

/** Default overall authorization-code flow timeout (2 minutes). */
const DEFAULT_FLOW_TIMEOUT_MS = 120_000

/** HTML shown to the user in the browser after a successful callback. */
const CALLBACK_SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Authentication Complete</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 40px;">
  <h1>Authentication complete!</h1>
  <p>You can safely close this window.</p>
</body>
</html>`

/**
 * Merge `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET` env vars into an
 * {@link AuthConfig} when the `auth` block omits them.
 *
 * This allows config files to specify the non-secret OIDC parameters (`type`,
 * `authUrl`, `audience`, `scopes`) while credentials come from environment
 * variables — keeping secrets out of version-controlled JSON files.
 */
export function mergeAuthEnvVars(auth: CantonAuthConfig): CantonAuthConfig {
  const envClientId = process.env.CANTON_CLIENT_ID?.trim()
  const envClientSecret = process.env.CANTON_CLIENT_SECRET?.trim()

  if (auth.type === CantonAuthType.ClientCredentials) {
    const clientId = auth.clientId || envClientId || ''
    const clientSecret = auth.clientSecret || envClientSecret || ''
    if (!clientId || !clientSecret) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        'clientCredentials auth requires a clientId and clientSecret. Set them via the CANTON_CLIENT_ID and CANTON_CLIENT_SECRET environment variables.',
      )
    }
    return { ...auth, clientId, clientSecret }
  }

  if (auth.type === CantonAuthType.AuthorizationCode) {
    const clientId = auth.clientId || envClientId || ''
    if (!clientId) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        'authorizationCode auth requires a clientId. Set it via the CANTON_CLIENT_ID environment variable.',
      )
    }
    return { ...auth, clientId }
  }

  return auth
}

/**
 * Open a URL in the default browser (cross-platform best-effort).
 *
 * Uses `execFile` (not `exec`) to avoid spawning a shell, preventing command
 * injection through the URL string.
 */
export function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve) => {
    execFile(cmd, [url], (err) => {
      if (err) {
        process.stderr.write(`Could not open browser — visit this URL manually:\n${url}\n`)
      }
      resolve()
    })
  })
}

/**
 * Run the full authorization-code + PKCE flow on Node: start a local callback
 * server, open the browser, wait for the callback, and exchange the code for
 * tokens.
 *
 * Composes the SDK protocol helpers ({@link buildAuthorizationRequest},
 * {@link validateAuthorizationCallback}, {@link exchangeAuthorizationCode})
 * with the Node-only callback server and browser launching.
 *
 * @param config - Authorization code config (with `authUrl`, `clientId`).
 * @param options - Optional fetch override, abort signal, and flow controls
 *   (`callbackUrl`, `openBrowser`, `timeoutMs`).
 * @returns The obtained {@link AccessToken}.
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on timeout, callback errors,
 *   state mismatch, or token exchange failure.
 */
export async function runAuthorizationCodeFlow(
  config: AuthorizationCodeAuthConfig,
  options?: CantonAuthProviderOptions & {
    /** Local redirect URI. Defaults to `http://localhost:8400/callback`. */
    callbackUrl?: string
    /** Open the browser automatically (default `true`). */
    openBrowser?: boolean
    /** Overall flow timeout in ms (default 120_000). */
    timeoutMs?: number
    /** Override the PKCE state parameter (for deterministic testing). */
    stateOverride?: string
    /** Override the PKCE code verifier (for deterministic testing). */
    verifierOverride?: string
  },
): Promise<AccessToken> {
  const callbackUrl = options?.callbackUrl ?? config.callbackUrl ?? DEFAULT_CALLBACK_URL
  const shouldOpenBrowser = options?.openBrowser ?? true
  const timeoutMs = options?.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS

  const req = await buildCantonAuthorizationRequest(config, {
    fetch: options?.fetch,
    signal: options?.signal,
    allowInsecureRequests: options?.allowInsecureRequests,
    redirectUri: callbackUrl,
    stateOverride: options?.stateOverride,
    verifierOverride: options?.verifierOverride,
  })

  const callback = new URL(callbackUrl)
  const callbackPath = callback.pathname || '/callback'
  const callbackHost = callback.hostname || '127.0.0.1'
  const callbackPort = Number(callback.port) || 8400

  return new Promise<AccessToken>((resolve, reject) => {
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }

    const server: Server = createServer((req2, res) => {
      const reqUrl = new URL(req2.url ?? '/', `http://${callbackHost}:${callbackPort}`)
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      validateCantonAuthorizationCallback(config, reqUrl, req.state, {
        fetch: options?.fetch,
        signal: options?.signal,
        allowInsecureRequests: options?.allowInsecureRequests,
      })
        .then((callback) =>
          exchangeCantonAuthorizationCode(config, callback, req.verifier, req.redirectUri, {
            fetch: options?.fetch,
            signal: options?.signal,
            allowInsecureRequests: options?.allowInsecureRequests,
          }),
        )
        .then((token: AccessToken) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(CALLBACK_SUCCESS_HTML)
          finish(() => resolve(token))
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e)
          try {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            // Send a generic message to the browser — never expose internal
            // error details or stack traces in the HTTP response body.
            res.end('Authentication failed. Check the terminal for details.')
          } catch {
            // response may already be sent
          }
          finish(() =>
            reject(
              e instanceof CCIPError
                ? e
                : new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, message, {
                    cause: e instanceof Error ? e : undefined,
                  }),
            ),
          )
        })
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      server.close()
      reject(
        new CCIPError(
          CCIPErrorCode.CANTON_AUTH_ERROR,
          `Authorization code flow timed out after ${timeoutMs}ms`,
          { isTransient: true },
        ),
      )
    }, timeoutMs)

    server.on('error', (err) => {
      finish(() =>
        reject(
          new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, `Callback server error: ${err.message}`, {
            cause: err,
          }),
        ),
      )
    })

    server.listen(callbackPort, callbackHost, () => {
      process.stderr.write(`Waiting for authentication on ${callbackUrl}\n`)
      if (shouldOpenBrowser) {
        process.stderr.write('Opening browser for login…\n')
        process.stderr.write(`If the browser does not open, visit:\n${req.authorizeUrl}\n\n`)
        void openBrowser(req.authorizeUrl)
      } else {
        process.stderr.write(`Visit the following URL to authenticate:\n${req.authorizeUrl}\n\n`)
      }
    })
  })
}

/**
 * Build an {@link AuthProvider} for the CLI from a discriminated
 * {@link AuthConfig}, resolving `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET`
 * from env vars and orchestrating the authorization-code flow on Node.
 *
 * - `static` / `clientCredentials`: delegated to the SDK's
 *   {@link createAuthProvider} (runtime-agnostic).
 * - `authorizationCode`: orchestrated here via {@link runAuthorizationCodeFlow}
 *   and wrapped in a caching provider that refreshes via the SDK's
 *   `refreshAuthorizationCodeToken` helper.
 *
 * @param auth - Auth config (static, clientCredentials, or authorizationCode).
 * @param options - Optional fetch override, abort signal, and flow controls.
 * @returns An {@link AuthProvider} whose `token()` yields valid JWTs.
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config or auth failure.
 */
export async function createCliAuthProvider(
  auth: CantonAuthConfig,
  options?: CantonAuthProviderOptions & {
    callbackUrl?: string
    openBrowser?: boolean
    timeoutMs?: number
  },
): Promise<CantonAuthProvider> {
  return getOrCreateCliAuthProvider(auth, options)
}

/**
 * CLI authorization-code provider: wraps the SDK's caching plumbing with the
 * Node-specific re-fetch callback (re-runs the interactive flow).
 *
 * Refresh delegates to the SDK's `refreshAuthorizationCodeToken` helper; when
 * that fails (or no refresh token is held), the interactive flow is re-run.
 */
class CliAuthorizationCodeProvider implements CantonAuthProvider {
  readonly type = 'authorizationCode' as const
  private readonly fetchToken: () => Promise<AccessToken>
  private readonly cfg: AuthorizationCodeAuthConfig
  private readonly options: CantonAuthProviderOptions | undefined
  private readonly reFetchToken: () => Promise<AccessToken>
  /** The last-seen token; updated on each fetch/refresh so doRefresh can read its refreshToken. */
  private lastToken: AccessToken | undefined

  constructor(
    cfg: AuthorizationCodeAuthConfig,
    initialToken: AccessToken,
    fetchToken: () => Promise<AccessToken>,
    options?: CantonAuthProviderOptions,
  ) {
    this.cfg = cfg
    this.options = options
    this.reFetchToken = fetchToken
    this.lastToken = initialToken
    this.fetchToken = createCantonMemoizedTokenFetcher(() => this.doRefresh(), initialToken)
  }

  token(): Promise<AccessToken> {
    return this.fetchToken()
  }

  private async doRefresh(): Promise<AccessToken> {
    if (this.lastToken?.refreshToken) {
      try {
        const refreshed = await refreshCantonAuthorizationCodeToken(
          this.cfg,
          this.lastToken.refreshToken,
          this.options,
        )
        this.lastToken = refreshed
        return refreshed
      } catch {
        // refresh failed — fall through to re-running the interactive flow
      }
    }
    const fetched = await this.reFetchToken()
    this.lastToken = fetched
    return fetched
  }
}

/**
 * Resolve a JWT (or token getter) for a {@link CantonConfig} from an
 * {@link AuthConfig}, suitable for `cantonConfig.jwt`.
 *
 * The CLI calls this upfront (before `CantonChain.fromUrl`) so auth is resolved
 * once. When the auth config is `static`, a static JWT string is returned; for
 * refreshable flows (clientCredentials / authorizationCode), a
 * `() => Promise<string>` getter is returned so the SDK clients refresh per
 * request.
 *
 * The resolved provider is memoized process-wide by auth-config fingerprint, so
 * repeated calls within one process (e.g. `send` → `showRequests` both calling
 * `fetchChainsFromRpcs`) reuse the same cached token instead of re-running the
 * interactive flow.
 *
 * @param auth - Auth config (static, clientCredentials, or authorizationCode).
 * @param options - Optional fetch override, abort signal, and flow controls.
 * @returns A `string` for static auth, or a `() => Promise<string>` getter for
 *   refreshable flows (clientCredentials / authorizationCode).
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config or auth failure.
 *
 * @example
 * ```ts
 * const jwt = await resolveCantonTokenGetter(auth)
 * const cantonConfig = { ...rest, jwt }
 * ```
 */
export async function resolveCantonTokenGetter(
  auth: CantonAuthConfig,
  options?: CantonAuthProviderOptions & {
    callbackUrl?: string
    openBrowser?: boolean
    timeoutMs?: number
  },
): Promise<string | (() => Promise<string>)> {
  const provider = await getOrCreateCliAuthProvider(auth, options)

  // Static tokens never expire → return a plain jwt string.
  if (provider instanceof CantonStaticProvider) {
    const token = await provider.token()
    return token.accessToken
  }

  // Refreshable flows (clientCredentials / authorizationCode) → return a
  // getter the SDK clients call per request.
  const tokenGetter = async () => {
    const token = await provider.token()
    return token.accessToken
  }
  // Eagerly fetch the first token so connection-time errors surface early.
  await tokenGetter()
  return tokenGetter
}

/**
 * Process-wide cache of CLI auth providers, keyed by config fingerprint.
 *
 * This prevents re-running the interactive authorization-code flow when
 * multiple CLI code paths call `fetchChainsFromRpcs` in one process (e.g.
 * `send` resolves auth, then calls `showRequests` which resolves auth again).
 * The cached provider holds a `CachingTokenSource` so subsequent `token()`
 * calls reuse the already-obtained token until it expires.
 */
const cliAuthProviderCache = new Map<string, CantonAuthProvider>()

/**
 * Stable fingerprint for a {@link CantonAuthConfig}, ignoring volatile fields.
 *
 * Two configs with the same `type`/`authUrl`/`audience`/`scopes`/`clientId`
 * resolve to the same provider — the `clientSecret` is intentionally included
 * so different secrets yield different providers (and the env-var merge happens
 * before fingerprinting).
 */
function cliAuthFingerprint(auth: CantonAuthConfig): string {
  const parts: string[] = [auth.type ?? CantonAuthType.Static]
  if ('authUrl' in auth && typeof auth.authUrl === 'string') parts.push(`authUrl=${auth.authUrl}`)
  if ('audience' in auth && typeof auth.audience === 'string')
    parts.push(`audience=${auth.audience}`)
  if ('scopes' in auth && Array.isArray(auth.scopes)) parts.push(`scopes=${auth.scopes.join(',')}`)
  if ('clientId' in auth && typeof auth.clientId === 'string')
    parts.push(`clientId=${auth.clientId}`)
  if ('clientSecret' in auth && typeof auth.clientSecret === 'string')
    parts.push(`clientSecret=${auth.clientSecret}`)
  return parts.join('|')
}

/**
 * Return a cached {@link CantonAuthProvider} for `auth`, or create and cache one.
 *
 * The env-var merge (`mergeAuthEnvVars`) runs before fingerprinting so that
 * `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET` are part of the key.
 */
async function getOrCreateCliAuthProvider(
  auth: CantonAuthConfig,
  options?: CantonAuthProviderOptions & {
    callbackUrl?: string
    openBrowser?: boolean
    timeoutMs?: number
  },
): Promise<CantonAuthProvider> {
  const merged = mergeAuthEnvVars(auth)
  const key = cliAuthFingerprint(merged)
  let provider = cliAuthProviderCache.get(key)
  if (!provider) {
    provider = await createCliAuthProviderInternal(merged, options)
    cliAuthProviderCache.set(key, provider)
  }
  return provider
}

/**
 * Internal provider creation (no caching) — called by {@link getOrCreateCliAuthProvider}.
 *
 * `createCliAuthProvider` (public) delegates here after merging env vars; the
 * caching layer wraps this so the interactive flow runs at most once per
 * fingerprint per process.
 */
async function createCliAuthProviderInternal(
  merged: CantonAuthConfig,
  options?: CantonAuthProviderOptions & {
    callbackUrl?: string
    openBrowser?: boolean
    timeoutMs?: number
  },
): Promise<CantonAuthProvider> {
  const type = merged.type ?? CantonAuthType.Static

  if (type === CantonAuthType.AuthorizationCode) {
    const cfg = merged as AuthorizationCodeAuthConfig
    const initialToken = await runAuthorizationCodeFlow(cfg, options)
    // The re-fetch callback re-runs the interactive flow when refresh fails.
    const fetchToken = () => runAuthorizationCodeFlow(cfg, options)
    return new CliAuthorizationCodeProvider(cfg, initialToken, fetchToken, options)
  }

  return createCantonAuthProvider(merged, options)
}
