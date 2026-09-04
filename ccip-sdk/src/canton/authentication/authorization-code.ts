import * as oauth from 'oauth4webapi'

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import { discoverAuthorizationServer } from './metadata.ts'
import {
  type OAuthRequestOptions,
  buildOAuthRequestOptions,
  codeChallengeFromVerifier,
  createMemoizedTokenFetcher,
  generateCodeVerifier,
  generateState,
  toAccessToken,
  wrapOAuthError,
} from './token-source.ts'
import type { AccessToken, AuthProvider, AuthorizationCodeAuthConfig } from './types.ts'

/**
 * OAuth2 authorization code + PKCE protocol primitives (runtime-agnostic).
 *
 * @packageDocumentation
 *
 * This module implements **only the protocol pieces** of the authorization
 * code grant (RFC 6749 §4.1) with PKCE (RFC 7636, S256) that an embedder
 * cannot safely rewrite: building the authorize URL, validating the callback
 * (state + PKCE), exchanging the code for tokens, and refreshing via the
 * `refresh_token` grant.
 *
 * It is deliberately **runtime-agnostic**: it uses only `fetch` and WebCrypto
 * (via `oauth4webapi`) and imports no `node:*` modules. The environment-specific
 * orchestration — spawning a local callback server, opening a browser,
 * resolving `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET` from env vars — lives
 * in the CLI (`providers/canton/`), which composes these primitives and hands
 * the resulting JWT (or a `() => Promise<string>` token getter) to
 * {@link CantonConfig}.
 *
 * Web/Electron embedders compose these primitives with their own
 * redirect/callback handling.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

/** Default scopes for the authorization code flow. */
const DEFAULT_AUTHORIZATION_CODE_SCOPES = ['openid', 'daml_ledger_api']

/**
 * Resolved authorization-code provider configuration (after applying defaults).
 */
interface ResolvedAuthorizationCodeConfig {
  as: oauth.AuthorizationServer
  client: oauth.Client
  scopes: string[]
  audience: string
  redirectUri: string
  fetch?: typeof fetch
  signal?: AbortSignal
  allowInsecureRequests?: boolean
}

/**
 * PKCE + state material generated for an authorization request.
 *
 * The embedder keeps the `verifier` and `state` secret (server-side / in
 * process memory) and uses them to validate the callback and exchange the code.
 * The `codeChallenge` and `authorizeUrl` are safe to send to the browser.
 */
export interface AuthorizationRequest {
  /** The full authorization endpoint URL to redirect the user to. */
  authorizeUrl: string
  /** The PKCE code verifier — keep secret; required for the token exchange. */
  verifier: string
  /** The S256 code challenge derived from `verifier` (sent in the authorize URL). */
  codeChallenge: string
  /** The OAuth2 `state` parameter — keep secret; required to validate the callback. */
  state: string
  /** The redirect URI the authorization server will redirect back to. */
  redirectUri: string
}

/**
 * A validated authorization callback: the code + state extracted from the
 * redirect URL after {@link validateAuthorizationCallback} succeeds.
 *
 * The `callbackParams` field carries the branded `URLSearchParams` instance
 * returned by `oauth4webapi.validateAuthResponse`; it MUST be passed to
 * {@link exchangeAuthorizationCode} (the underlying library brand-checks it).
 */
export interface ValidatedCallback {
  /** The authorization code to exchange for tokens. */
  code: string
  /** The state echoed back by the server (already verified to match). */
  state: string
  /**
   * The branded `URLSearchParams` from `validateAuthResponse` — pass this to
   * {@link exchangeAuthorizationCode}. Do not reconstruct it.
   */
  callbackParams: URLSearchParams
}

/**
 * Options shared by the protocol helpers (fetch override, abort signal,
 * insecure-requests toggle for testing).
 */
export type AuthorizationCodeProtocolOptions = OAuthRequestOptions

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
 * Resolve an {@link AuthorizationCodeAuthConfig} into a
 * {@link ResolvedAuthorizationCodeConfig} using RFC 8414 metadata discovery.
 *
 * Requires the server to advertise S256 PKCE support and an
 * `authorization_endpoint`.
 *
 * @param config - Authorization code config with `authUrl`.
 * @param options - Optional fetch override and abort signal.
 * @returns The resolved config (authorization server metadata + client + defaults).
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on discovery failure, missing
 *   S256 support, or missing `authorization_endpoint`.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */
export async function resolveAuthorizationCodeConfig(
  config: AuthorizationCodeAuthConfig,
  options?: AuthorizationCodeProtocolOptions,
): Promise<ResolvedAuthorizationCodeConfig> {
  validateAuthorizationCodeConfig(config)
  const as = await discoverAuthorizationServer(config.authUrl, {
    fetch: options?.fetch,
    signal: options?.signal,
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
  return {
    as,
    client: { client_id: config.clientId },
    scopes: config.scopes?.length ? config.scopes : DEFAULT_AUTHORIZATION_CODE_SCOPES,
    audience: config.audience ?? '',
    redirectUri: config.callbackUrl ?? '',
    fetch: options?.fetch,
    signal: options?.signal,
    allowInsecureRequests: options?.allowInsecureRequests,
  }
}

/**
 * Build the authorization request: authorize URL + PKCE verifier + state.
 *
 * This is the first step of the interactive flow. The embedder redirects the
 * user's browser to `authorizeUrl` and retains `verifier` and `state` to
 * validate the callback and exchange the code.
 *
 * @param config - Authorization code config (with `authUrl`, `clientId`).
 * @param options - Optional fetch override, abort signal, and overrides for
 *   `redirectUri`, `state`, and `verifier` (the latter two for deterministic testing).
 * @returns The {@link AuthorizationRequest} (authorize URL + PKCE material).
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on discovery failure or invalid config.
 *
 * @example
 * ```ts
 * const req = await buildAuthorizationRequest({
 *   type: 'authorizationCode',
 *   authUrl: 'https://auth.example.com',
 *   clientId: 'ccip-app',
 *   callbackUrl: 'http://localhost:8400/callback',
 * })
 * // Redirect the user to req.authorizeUrl; keep req.verifier + req.state.
 * ```
 */
export async function buildAuthorizationRequest(
  config: AuthorizationCodeAuthConfig,
  options?: AuthorizationCodeProtocolOptions & {
    /** Override the PKCE state parameter (for deterministic testing). */
    stateOverride?: string
    /** Override the PKCE code verifier (for deterministic testing). */
    verifierOverride?: string
    /** Override the redirect URI (takes precedence over `config.callbackUrl`). */
    redirectUri?: string
  },
): Promise<AuthorizationRequest> {
  const cfg = await resolveAuthorizationCodeConfig(config, options)
  const redirectUri = options?.redirectUri ?? cfg.redirectUri
  if (!redirectUri) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'authorizationCode auth requires a callbackUrl (redirect URI)',
    )
  }
  const state = options?.stateOverride ?? generateState()
  const verifier = options?.verifierOverride ?? generateCodeVerifier()
  const codeChallenge = await codeChallengeFromVerifier(verifier)

  const params = new URLSearchParams({
    client_id: cfg.client.client_id,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  if (cfg.audience) {
    params.set('audience', cfg.audience)
  }
  const authorizeUrl = `${cfg.as.authorization_endpoint}?${params.toString()}`

  return { authorizeUrl, verifier, codeChallenge, state, redirectUri }
}

/**
 * Validate the authorization callback URL and extract the code + state.
 *
 * Checks for an OAuth2 error redirect first (e.g. the user denied consent),
 * then validates the state parameter (CSRF protection) and the presence of a
 * code via `oauth4webapi.validateAuthResponse`.
 *
 * @param config - Authorization code config (with `authUrl`, `clientId`).
 * @param callbackUrl - The full redirect URL the browser was sent back to
 *   (including `?code=…&state=…` or `?error=…`).
 * @param expectedState - The `state` value from {@link buildAuthorizationRequest}.
 * @param options - Optional fetch override and abort signal.
 * @returns The validated {@link ValidatedCallback} (code + state).
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on an OAuth2 error redirect,
 *   state mismatch, or missing code.
 *
 * @example
 * ```ts
 * const { code } = await validateAuthorizationCallback(
 *   config, 'http://localhost:8400/callback?code=abc&state=xyz', req.state,
 * )
 * ```
 */
export async function validateAuthorizationCallback(
  config: AuthorizationCodeAuthConfig,
  callbackUrl: string | URL,
  expectedState: string,
  options?: AuthorizationCodeProtocolOptions,
): Promise<ValidatedCallback> {
  const cfg = await resolveAuthorizationCodeConfig(config, options)
  const reqUrl = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl)

  // Always validate state + PKCE first (security-critical). The OAuth error
  // redirect check below is purely informational — it must not run before or
  // bypass the state validation, so we perform validation unconditionally.
  let callbackParams: URLSearchParams
  try {
    callbackParams = oauth.validateAuthResponse(cfg.as, cfg.client, reqUrl, expectedState)
  } catch (e) {
    // If the authorization server redirected with an OAuth2 error (RFC 6749
    // §4.1.2.1, e.g. the user denied consent), surface it as a descriptive
    // error instead of the generic state-mismatch message.
    const oauthError = reqUrl.searchParams.get('error')
    if (oauthError) {
      const desc = reqUrl.searchParams.get('error_description') ?? oauthError
      throw new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, `Authorization failed: ${desc}`, {
        context: { oauthError },
      })
    }
    throw wrapOAuthError(
      e,
      'Authorization callback validation failed (state mismatch or missing code)',
    )
  }
  const code = callbackParams.get('code')
  if (!code) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'Authorization callback is missing the code parameter',
    )
  }
  return { code, state: expectedState, callbackParams }
}

/**
 * Exchange an authorization code for tokens (access + refresh).
 *
 * Performs the token endpoint request with the PKCE verifier (RFC 7636) and
 * returns the parsed {@link AccessToken}. The embedder should persist the
 * `refreshToken` so {@link refreshAuthorizationCodeToken} can renew the
 * access token without re-running the interactive flow.
 *
 * @param config - Authorization code config (with `authUrl`, `clientId`).
 * @param callback - The {@link ValidatedCallback} from
 *   {@link validateAuthorizationCallback} (carries the branded `callbackParams`).
 * @param verifier - The PKCE code verifier from {@link buildAuthorizationRequest}.
 * @param redirectUri - The redirect URI used in the authorize request.
 * @param options - Optional fetch override and abort signal.
 * @returns The obtained {@link AccessToken} (with `refreshToken` when issued).
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on token exchange failure.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3
 */
export async function exchangeAuthorizationCode(
  config: AuthorizationCodeAuthConfig,
  callback: ValidatedCallback,
  verifier: string,
  redirectUri: string,
  options?: AuthorizationCodeProtocolOptions,
): Promise<AccessToken> {
  const cfg = await resolveAuthorizationCodeConfig(config, options)
  try {
    const response = await oauth.authorizationCodeGrantRequest(
      cfg.as,
      cfg.client,
      oauth.None(),
      callback.callbackParams,
      redirectUri,
      verifier,
      buildOAuthRequestOptions(cfg),
    )
    const tokenResponse = await oauth.processAuthorizationCodeResponse(cfg.as, cfg.client, response)
    return toAccessToken(tokenResponse)
  } catch (e) {
    throw wrapOAuthError(e, 'Authorization code token exchange failed')
  }
}

/**
 * Refresh an access token using the `refresh_token` grant (RFC 6749 §6).
 *
 * @param config - Authorization code config (with `authUrl`, `clientId`).
 * @param refreshToken - The refresh token from a prior {@link exchangeAuthorizationCode}.
 * @param options - Optional fetch override and abort signal.
 * @returns A fresh {@link AccessToken} (with a new `refreshToken` when rotated).
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on refresh failure.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-6
 */
export async function refreshAuthorizationCodeToken(
  config: AuthorizationCodeAuthConfig,
  refreshToken: string,
  options?: AuthorizationCodeProtocolOptions,
): Promise<AccessToken> {
  const cfg = await resolveAuthorizationCodeConfig(config, options)
  try {
    const response = await oauth.refreshTokenGrantRequest(
      cfg.as,
      cfg.client,
      oauth.None(),
      refreshToken,
      buildOAuthRequestOptions(cfg),
    )
    const tokenResponse = await oauth.processRefreshTokenResponse(cfg.as, cfg.client, response)
    return toAccessToken(tokenResponse)
  } catch (e) {
    throw wrapOAuthError(e, 'Authorization code token refresh failed')
  }
}

/**
 * An {@link AuthProvider} backed by caller-supplied token-fetch and
 * token-refresh callbacks.
 *
 * The embedder implements the interactive flow (browser + callback) using
 * {@link buildAuthorizationRequest}, {@link validateAuthorizationCallback},
 * and {@link exchangeAuthorizationCode}, then wraps the resulting token in
 * this provider. Refresh uses {@link refreshAuthorizationCodeToken} when a
 * refresh token is available; otherwise the initial token is re-fetched
 * via the `fetchToken` callback.
 *
 * The SDK stays runtime-agnostic: this provider holds only the caching/refresh
 * plumbing an embedder would otherwise have to re-implement.
 */
export class AuthorizationCodeProvider implements AuthProvider {
  readonly type = 'authorizationCode' as const
  private readonly fetchToken: () => Promise<AccessToken>
  private readonly cfg: AuthorizationCodeAuthConfig
  private readonly options: AuthorizationCodeProtocolOptions | undefined
  /** The last-seen token; updated on each fetch/refresh so doRefresh can read its refreshToken. */
  private lastToken: AccessToken | undefined

  /**
   * Creates a provider from an initial token and callbacks.
   *
   * @param config - Authorization code config (used for refresh).
   * @param initialToken - The token obtained from {@link exchangeAuthorizationCode}.
   * @param fetchToken - Called when the cached token is expired and no refresh
   *   callback is supplied (or refresh fails). Must return a fresh token.
   * @param options - Optional fetch override and abort signal (threaded to refresh).
   */
  constructor(
    config: AuthorizationCodeAuthConfig,
    initialToken: AccessToken,
    fetchToken: () => Promise<AccessToken>,
    options?: AuthorizationCodeProtocolOptions,
  ) {
    this.cfg = config
    this.options = options
    this.lastToken = initialToken
    this.fetchToken = createMemoizedTokenFetcher(() => this.doRefresh(fetchToken), initialToken)
  }

  /** Returns a valid access token, refreshing or re-fetching as needed. */
  token(): Promise<AccessToken> {
    return this.fetchToken()
  }

  /**
   * Refresh via the `refresh_token` grant when a refresh token is available;
   * otherwise fall back to the caller-supplied `fetchToken` callback.
   */
  private async doRefresh(fetchToken: () => Promise<AccessToken>): Promise<AccessToken> {
    if (this.lastToken?.refreshToken) {
      try {
        const refreshed = await refreshAuthorizationCodeToken(
          this.cfg,
          this.lastToken.refreshToken,
          this.options,
        )
        this.lastToken = refreshed
        return refreshed
      } catch {
        // refresh failed — fall through to the caller-supplied fetcher
      }
    }
    const fetched = await fetchToken()
    this.lastToken = fetched
    return fetched
  }
}

/**
 * Create an {@link AuthorizationCodeProvider} from an initial token and a
 * re-fetch callback.
 *
 * Convenience wrapper around the {@link AuthorizationCodeProvider} constructor.
 * The embedder is responsible for obtaining `initialToken` via the protocol
 * helpers ({@link buildAuthorizationRequest} → {@link validateAuthorizationCallback}
 * → {@link exchangeAuthorizationCode}).
 *
 * @param config - Authorization code config (used for refresh).
 * @param initialToken - The token obtained from the interactive flow.
 * @param fetchToken - Called when the cached token expires and refresh fails.
 * @param options - Optional fetch override and abort signal.
 * @returns A {@link AuthorizationCodeProvider}.
 */
export function createAuthorizationCodeProvider(
  config: AuthorizationCodeAuthConfig,
  initialToken: AccessToken,
  fetchToken: () => Promise<AccessToken>,
  options?: AuthorizationCodeProtocolOptions,
): AuthorizationCodeProvider {
  return new AuthorizationCodeProvider(config, initialToken, fetchToken, options)
}
