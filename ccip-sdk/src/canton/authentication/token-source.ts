import * as oauth from 'oauth4webapi'

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import type { AccessToken, TokenSource } from './types.ts'

/**
 * Shared token-source primitives for the Canton authentication providers.
 *
 * @packageDocumentation
 *
 * PKCE helpers and token-response conversion delegate to `oauth4webapi` (the
 * spec-compliant OAuth2/OIDC library for JavaScript runtimes), while the
 * {@link CachingTokenSource} and {@link StaticTokenSource} are our own thin
 * abstractions over the `TokenSource` interface.
 */

/** Skew applied to token expiry so refresh happens slightly before the real expiry. */
const EXPIRY_SKEW_MS = 10_000

/**
 * Returns `true` when `token` is missing or expired (accounting for skew).
 */
export function isTokenExpired(token: AccessToken | undefined): boolean {
  if (!token) return true
  if (token.expiresAt === undefined) return false // no expiry → assume valid
  return Date.now() >= token.expiresAt - EXPIRY_SKEW_MS
}

// ---------------------------------------------------------------------------
// PKCE / state helpers — delegate to oauth4webapi (Web Crypto API, cross-runtime)
// ---------------------------------------------------------------------------

/** Cryptographically-secure random PKCE code verifier (RFC 7636 §4.1). */
export function generateCodeVerifier(): string {
  return oauth.generateRandomCodeVerifier()
}

/** S256 code challenge = base64url( sha256( verifier ) ). Async (Web Crypto API). */
export function codeChallengeFromVerifier(verifier: string): Promise<string> {
  return oauth.calculatePKCECodeChallenge(verifier)
}

/** Cryptographically-secure random state parameter (CSRF protection). */
export function generateState(): string {
  return oauth.generateRandomState()
}

// ---------------------------------------------------------------------------
// Token response conversion
// ---------------------------------------------------------------------------

/**
 * Convert an `oauth4webapi.TokenEndpointResponse` to our {@link AccessToken}.
 *
 * The `expiresAt` field is derived from `expires_in` (seconds) so callers can
 * check staleness without re-parsing the JWT.
 */
export function toAccessToken(response: oauth.TokenEndpointResponse): AccessToken {
  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    expiresAt:
      typeof response.expires_in === 'number' ? Date.now() + response.expires_in * 1000 : undefined,
    refreshToken: response.refresh_token,
  }
}

/**
 * Wrap an `oauth4webapi` OAuth2Error (thrown by `process*Response`) in a
 * {@link CCIPError} with `CANTON_AUTH_ERROR`.
 */
export function wrapOAuthError(e: unknown, context?: string): CCIPError {
  if (e instanceof CCIPError) return e
  const message = e instanceof Error ? e.message : String(e)
  return new CCIPError(
    CCIPErrorCode.CANTON_AUTH_ERROR,
    context ? `${context}: ${message}` : message,
    { cause: e instanceof Error ? e : undefined },
  )
}

/**
 * Shared options for `oauth4webapi` HTTP requests (custom fetch + insecure requests).
 *
 * Used by {@link buildOAuthRequestOptions} to construct the symbol-keyed
 * options object that `oauth4webapi` grant request functions expect.
 */
export interface OAuthRequestOptions {
  /** Custom fetch implementation (testing / custom HTTP transport). */
  fetch?: typeof fetch
  /** Abort signal for the HTTP request. */
  signal?: AbortSignal
  /**
   * Allow HTTP (non-HTTPS) requests. **For testing only** — never use in
   * production. Passes through to `oauth4webapi`'s `allowInsecureRequests`.
   */
  allowInsecureRequests?: boolean
}

/**
 * Build the `oauth4webapi` request options object from our {@link OAuthRequestOptions}.
 *
 * Shared by the client-credentials and authorization-code providers to avoid
 * duplicating the symbol-keyed options construction.
 */
export function buildOAuthRequestOptions(opts: OAuthRequestOptions) {
  return {
    [oauth.customFetch]: opts.fetch,
    signal: opts.signal,
    [oauth.allowInsecureRequests]: opts.allowInsecureRequests,
  }
}

// ---------------------------------------------------------------------------
// Token sources
// ---------------------------------------------------------------------------

/**
 * A {@link TokenSource} that caches a token and lazily re-fetches via a
 * caller-supplied `fetcher` when the cached token is expired or missing.
 *
 * The first `token()` call fetches; subsequent calls return the cached value
 * until it expires, at which point a new fetch is triggered. Concurrent callers
 * share a single in-flight fetch promise to avoid duplicate token requests.
 */
export class CachingTokenSource implements TokenSource {
  private current: AccessToken | undefined
  private readonly fetcher: () => Promise<AccessToken>
  private inFlight: Promise<AccessToken> | undefined

  /**
   * Creates a new caching token source.
   *
   * @param fetcher - Called when the cached token is missing or expired.
   *   MUST return a fresh {@link AccessToken}.
   * @param initial - Optional initial token (skips the first fetch).
   */
  constructor(fetcher: () => Promise<AccessToken>, initial?: AccessToken) {
    this.fetcher = fetcher
    this.current = initial
  }

  /** Returns a valid token, fetching if the cached one is expired or missing. */
  async token(): Promise<AccessToken> {
    if (!isTokenExpired(this.current)) {
      return this.current!
    }
    // Coalesce concurrent callers onto a single in-flight fetch.
    if (!this.inFlight) {
      this.inFlight = this.fetcher()
        .then((t) => {
          this.current = t
          return t
        })
        .finally(() => {
          this.inFlight = undefined
        })
    }
    return this.inFlight
  }

  /**
   * Returns the currently cached token (possibly expired) without triggering a fetch.
   *
   * Used by refresh callbacks that need to inspect the old token's `refreshToken`
   * field without recursively calling {@link token} (which would deadlock when
   * the refresh callback is itself the fetcher).
   */
  getCachedToken(): AccessToken | undefined {
    return this.current
  }
}

/**
 * A {@link TokenSource} that always returns the same static token (no refresh).
 */
export class StaticTokenSource implements TokenSource {
  private readonly tokenValue: AccessToken
  /** Creates a static token source that always returns the given token. */
  constructor(token: AccessToken) {
    this.tokenValue = token
  }
  /** Returns the static token. */
  async token(): Promise<AccessToken> {
    return this.tokenValue
  }
}
