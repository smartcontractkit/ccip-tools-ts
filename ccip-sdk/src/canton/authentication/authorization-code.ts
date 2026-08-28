import type { IncomingMessage, Server, ServerResponse } from 'node:http'

import * as oauth from 'oauth4webapi'

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import { discoverAuthorizationServer } from './metadata.ts'
import {
  type OAuthRequestOptions,
  CachingTokenSource,
  buildOAuthRequestOptions,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
  toAccessToken,
  wrapOAuthError,
} from './token-source.ts'
import type { AccessToken, AuthProvider, AuthorizationCodeAuthConfig } from './types.ts'

/**
 * OAuth2 authorization code flow with PKCE (S256) authentication provider.
 *
 * @packageDocumentation
 *
 * Implements the authorization code grant (RFC 6749 §4.1) with PKCE
 * (RFC 7636, S256 challenge method required). Designed for interactive user
 * authentication where a browser login is required: it starts a local callback
 * server to receive the authorization code and exchanges it for tokens.
 *
 * The OAuth2 protocol mechanics (PKCE challenge generation, auth-response
 * validation, token exchange, refresh) delegate to `oauth4webapi`; only the
 * local callback HTTP server and browser launching are implemented here
 * (inherently Node-only).
 *
 * Implements RFC 8414 metadata discovery, state validation (CSRF
 * protection), and automatic browser opening.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

/** Default scopes for the authorization code flow. */
const DEFAULT_AUTHORIZATION_CODE_SCOPES = ['openid', 'daml_ledger_api']

/** Default local redirect URI. */
const DEFAULT_CALLBACK_URL = 'http://localhost:8400/callback'

/** Default overall flow timeout (2 minutes). */
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
 * Resolved authorization-code provider configuration (after applying defaults).
 */
interface ResolvedAuthorizationCodeConfig {
  as: oauth.AuthorizationServer
  client: oauth.Client
  scopes: string[]
  audience: string
  callbackUrl: string
  openBrowser: boolean
  timeoutMs: number
  fetch?: typeof fetch
  allowInsecureRequests?: boolean
}

/** Options for {@link AuthorizationCodeProvider.fromDiscovery} and {@link AuthorizationCodeProvider.fromDirect}. */
export interface AuthorizationCodeProviderOptions extends OAuthRequestOptions {
  /** Override the PKCE state parameter (for deterministic testing). */
  stateOverride?: string
}

/**
 * Authorization code auth provider.
 *
 * The constructor performs the full interactive flow (browser + callback
 * server) and resolves once tokens are obtained. The internal
 * {@link CachingTokenSource} refreshes via the `refresh_token` grant when the
 * access token expires.
 */
export class AuthorizationCodeProvider implements AuthProvider {
  readonly type = 'authorizationCode' as const
  private readonly tokenSourceImpl: CachingTokenSource

  /** Creates a provider from resolved config and an initial token (internal). */
  private constructor(cfg: ResolvedAuthorizationCodeConfig, initialToken: AccessToken) {
    this.cfg = cfg
    this.tokenSourceImpl = new CachingTokenSource(() => this.doRefresh(), initialToken)
  }

  private readonly cfg: ResolvedAuthorizationCodeConfig

  /** Returns a valid access token, refreshing via the refresh_token grant if needed. */
  token(): Promise<AccessToken> {
    return this.tokenSourceImpl.token()
  }

  /** Refresh the access token using the refresh_token grant (RFC 6749 §6). */
  private async doRefresh(): Promise<AccessToken> {
    // Read the cached token directly — calling token() here would deadlock
    // because doRefresh IS the fetcher that token() invokes when the token
    // is expired.
    const current = this.tokenSourceImpl.getCachedToken()
    if (current?.refreshToken) {
      try {
        const response = await oauth.refreshTokenGrantRequest(
          this.cfg.as,
          this.cfg.client,
          oauth.None(),
          current.refreshToken,
          buildOAuthRequestOptions(this.cfg),
        )
        const tokenResponse = await oauth.processRefreshTokenResponse(
          this.cfg.as,
          this.cfg.client,
          response,
        )
        return toAccessToken(tokenResponse)
      } catch {
        // refresh failed — fall through to re-running the interactive flow
      }
    }
    // No refresh token or refresh failed → re-run the interactive flow.
    return runAuthorizationCodeFlow(this.cfg)
  }

  /**
   * Create a provider using OAuth2 Authorization Server Metadata discovery
   * (RFC 8414) to locate the authorization and token endpoints.
   *
   * Requires the server to advertise S256 PKCE support.
   *
   * @param config - Authorization code config with `authUrl`.
   * @param options - Optional fetch override.
   * @returns A {@link AuthorizationCodeProvider}.
   * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on discovery failure, missing
   *   S256 support, or callback/flow errors.
   *
   * @see https://datatracker.ietf.org/doc/html/rfc8414
   */
  static async fromDiscovery(
    config: AuthorizationCodeAuthConfig,
    options?: AuthorizationCodeProviderOptions,
  ): Promise<AuthorizationCodeProvider> {
    validateAuthorizationCodeConfig(config)
    const as = await discoverAuthorizationServer(config.authUrl, {
      fetch: options?.fetch,
      allowInsecureRequests: options?.allowInsecureRequests,
    })
    if (!as.code_challenge_methods_supported?.includes('S256')) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        'Authorization server does not support S256 PKCE challenges',
      )
    }
    if (!as.authorization_endpoint) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        'Authorization server metadata is missing an authorization_endpoint',
      )
    }
    const resolved: ResolvedAuthorizationCodeConfig = {
      as,
      client: { client_id: config.clientId },
      scopes: config.scopes?.length ? config.scopes : DEFAULT_AUTHORIZATION_CODE_SCOPES,
      audience: config.audience ?? '',
      callbackUrl: config.callbackUrl ?? DEFAULT_CALLBACK_URL,
      openBrowser: config.openBrowser ?? true,
      timeoutMs: config.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS,
      fetch: options?.fetch,
      allowInsecureRequests: options?.allowInsecureRequests,
    }
    const token = await runAuthorizationCodeFlow(resolved)
    return new AuthorizationCodeProvider(resolved, token)
  }

  /**
   * Create a provider with explicit authorization and token endpoint URLs.
   *
   * Performs the full interactive flow (browser + callback server) and resolves
   * once tokens are obtained. A minimal `oauth4webapi.AuthorizationServer` is
   * constructed from the provided endpoint URLs.
   *
   * @param config - Authorization code config plus a `tokenUrl` endpoint.
   * @param options - Optional fetch override and `stateOverride` (for testing).
   * @returns A {@link AuthorizationCodeProvider}.
   * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config or flow errors.
   */
  static async fromDirect(
    config: AuthorizationCodeAuthConfig & {
      tokenUrl: string
    },
    options?: AuthorizationCodeProviderOptions,
  ): Promise<AuthorizationCodeProvider> {
    validateAuthorizationCodeConfig(config)
    if (!config.tokenUrl) {
      throw new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, 'tokenUrl cannot be empty')
    }
    const resolved: ResolvedAuthorizationCodeConfig = {
      as: {
        issuer: config.authUrl,
        authorization_endpoint: config.authUrl,
        token_endpoint: config.tokenUrl,
      },
      client: { client_id: config.clientId },
      scopes: config.scopes?.length ? config.scopes : DEFAULT_AUTHORIZATION_CODE_SCOPES,
      audience: config.audience ?? '',
      callbackUrl: config.callbackUrl ?? DEFAULT_CALLBACK_URL,
      openBrowser: config.openBrowser ?? true,
      timeoutMs: config.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS,
      fetch: options?.fetch,
      allowInsecureRequests: options?.allowInsecureRequests,
    }
    const token = await runAuthorizationCodeFlow(resolved, options?.stateOverride)
    return new AuthorizationCodeProvider(resolved, token)
  }
}

/**
 * Validate the shared authorization-code config fields.
 */
function validateAuthorizationCodeConfig(config: AuthorizationCodeAuthConfig): void {
  if (!config.authUrl.trim()) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'authorizationCode auth requires a non-empty authUrl',
    )
  }
  if (!config.clientId.trim()) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'authorizationCode auth requires a non-empty clientId',
    )
  }
}

/**
 * Build the authorization URL with PKCE challenge and state.
 *
 * Uses `oauth4webapi`'s PKCE primitives for the code challenge.
 */
async function buildAuthorizeUrl(
  cfg: ResolvedAuthorizationCodeConfig,
  state: string,
  verifier: string,
): Promise<string> {
  const challenge = await codeChallengeFromVerifier(verifier)
  const params = new URLSearchParams({
    client_id: cfg.client.client_id,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    redirect_uri: cfg.callbackUrl,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  if (cfg.audience) {
    params.set('audience', cfg.audience)
  }
  return `${cfg.as.authorization_endpoint}?${params.toString()}`
}

/**
 * Open a URL in the default browser (cross-platform best-effort).
 *
 * Uses `execFile` (not `exec`) to avoid spawning a shell, preventing command
 * injection through the URL string.
 */
async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  execFile(cmd, [url], (err) => {
    if (err) {
      console.error('Could not open browser — visit this URL manually:\n', url)
    }
  })
}

/**
 * Process a single callback request: validate state, exchange code for tokens.
 *
 * Uses `oauth4webapi.validateAuthResponse` for state/PKCE validation and
 * `oauth4webapi.authorizationCodeGrantRequest` + `processAuthorizationCodeResponse`
 * for the token exchange.
 */
async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    callbackHost: string
    callbackPort: number
    callbackPath: string
    state: string
    verifier: string
    cfg: ResolvedAuthorizationCodeConfig
    finish: (fn: () => void) => void
    resolve: (token: AccessToken) => void
    reject: (err: unknown) => void
  },
): Promise<void> {
  try {
    const reqUrl = new URL(req.url ?? '/', `http://${ctx.callbackHost}:${ctx.callbackPort}`)
    if (reqUrl.pathname !== ctx.callbackPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }

    // OAuth error redirect (e.g. user denied consent)
    const oauthError = reqUrl.searchParams.get('error')
    if (oauthError) {
      const desc = reqUrl.searchParams.get('error_description') ?? oauthError
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(`Authentication failed: ${desc}`)
      ctx.finish(() =>
        ctx.reject(
          new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, `Authorization failed: ${desc}`, {
            context: { oauthError },
          }),
        ),
      )
      return
    }

    // Validate the authorization response (state + PKCE) via oauth4webapi.
    let callbackParams: URLSearchParams
    try {
      callbackParams = oauth.validateAuthResponse(ctx.cfg.as, ctx.cfg.client, reqUrl, ctx.state)
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Invalid callback (state mismatch or missing code)')
      ctx.finish(() => ctx.reject(wrapOAuthError(e, 'Authorization callback validation failed')))
      return
    }

    // Exchange the authorization code for tokens (PKCE verifier included).
    const response = await oauth.authorizationCodeGrantRequest(
      ctx.cfg.as,
      ctx.cfg.client,
      oauth.None(),
      callbackParams,
      ctx.cfg.callbackUrl,
      ctx.verifier,
      buildOAuthRequestOptions(ctx.cfg),
    )
    const tokenResponse = await oauth.processAuthorizationCodeResponse(
      ctx.cfg.as,
      ctx.cfg.client,
      response,
    )
    const token = toAccessToken(tokenResponse)

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(CALLBACK_SUCCESS_HTML)
    ctx.finish(() => ctx.resolve(token))
  } catch (e) {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(e instanceof Error ? e.message : String(e))
    } catch {
      // response may already be sent
    }
    ctx.finish(() => ctx.reject(wrapOAuthError(e, 'Authorization code flow failed')))
  }
}

/**
 * Run the full authorization code + PKCE flow: start a local callback server,
 * open the browser, wait for the callback, and exchange the code for tokens.
 *
 * @returns The obtained access token.
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on timeout, callback errors,
 *   state mismatch, or token exchange failure.
 */
async function runAuthorizationCodeFlow(
  cfg: ResolvedAuthorizationCodeConfig,
  stateOverride?: string,
): Promise<AccessToken> {
  const state = stateOverride ?? generateState()
  const verifier = generateCodeVerifier()
  const authorizeUrl = await buildAuthorizeUrl(cfg, state, verifier)

  const callback = new URL(cfg.callbackUrl)
  const callbackPath = callback.pathname || '/callback'
  const callbackHost = callback.hostname || '127.0.0.1'
  const callbackPort = Number(callback.port) || 8400

  const { createServer } = await import('node:http')

  return new Promise<AccessToken>((resolve, reject) => {
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Wrap the async handler so its promise rejection is always caught —
      // the outer promise is settled via finish()/reject() inside.
      handleCallback(req, res, {
        callbackHost,
        callbackPort,
        callbackPath,
        state,
        verifier,
        cfg,
        finish,
        resolve,
        reject,
      }).catch(() => {
        // already handled via finish()/reject() inside handleCallback
      })
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      server.close()
      reject(
        new CCIPError(
          CCIPErrorCode.CANTON_AUTH_ERROR,
          `Authorization code flow timed out after ${cfg.timeoutMs}ms`,
          { isTransient: true },
        ),
      )
    }, cfg.timeoutMs)

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
      console.error(`Waiting for authentication on ${cfg.callbackUrl}`)
      if (cfg.openBrowser) {
        console.error('Opening browser for login…')
        console.error('If the browser does not open, visit:\n', authorizeUrl, '\n')
        openBrowser(authorizeUrl).catch(() => {
          console.error('Could not open browser — visit this URL manually:\n', authorizeUrl)
        })
      } else {
        console.error('Visit the following URL to authenticate:\n', authorizeUrl, '\n')
      }
    })
  })
}

/**
 * Create an authorization code provider using RFC 8414 metadata discovery.
 *
 * Convenience wrapper for {@link AuthorizationCodeProvider.fromDiscovery}.
 *
 * @param config - Authorization code config.
 * @param options - Optional fetch override.
 */
export function createAuthorizationCodeProvider(
  config: AuthorizationCodeAuthConfig,
  options?: AuthorizationCodeProviderOptions,
): Promise<AuthorizationCodeProvider> {
  return AuthorizationCodeProvider.fromDiscovery(config, options)
}
