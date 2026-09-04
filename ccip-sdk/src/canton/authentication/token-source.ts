import { memoize } from 'micro-memoize'
import * as oauth from 'oauth4webapi'

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import type { AccessToken } from './types.ts'

/**
 * Shared token-source primitives for the Canton authentication providers.
 *
 * @packageDocumentation
 *
 * PKCE helpers and token-response conversion delegate to `oauth4webapi` (the
 * spec-compliant OAuth2/OIDC library for JavaScript runtimes). Token caching
 * with concurrent fetch coalescing and expiry-based invalidation is handled by
 * `micro-memoize` (`{ async: true }`).
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
// Memoized token fetcher
// ---------------------------------------------------------------------------

/**
 * Create a memoized async token fetcher that caches the result until the token
 * expires, coalesces concurrent callers onto a single in-flight promise, and
 * auto-removes the cache entry on rejection.
 *
 * Uses `micro-memoize` with `{ async: true }` for promise coalescing and
 * rejection-based cache invalidation. Token expiry is tracked via a
 * `lastToken` closure variable; when expired, the cache is cleared so the
 * next call re-fetches.
 *
 * @param fetcher - Called when the cached token is missing or expired.
 *   MUST return a fresh {@link AccessToken}.
 * @param initial - Optional initial token (returned on the first call without
 *   fetching, when still valid).
 * @returns A memoized `() => Promise<AccessToken>` that caches until the
 *   returned token's `expiresAt` passes (accounting for skew).
 */
export function createMemoizedTokenFetcher(
  fetcher: () => Promise<AccessToken>,
  initial?: AccessToken,
): () => Promise<AccessToken> {
  // Track the last-seen token outside the memoize cache so we can check expiry
  // without awaiting the cached Promise (which would defeat coalescing).
  let lastToken: AccessToken | undefined = initial

  const memoized = memoize(
    async () => {
      const token = await fetcher()
      lastToken = token
      return token
    },
    {
      // `async: true` coalesces concurrent callers onto a single in-flight
      // promise and auto-removes the cache entry on rejection.
      async: true,
    },
  )

  // When an initial token is provided and still valid, short-circuit the first
  // call to return it without fetching. Subsequent calls delegate to the
  // memoized fetcher (which will fetch only if the token has since expired).
  if (initial && !isTokenExpired(initial)) {
    let usedInitial = false
    return async (): Promise<AccessToken> => {
      if (!usedInitial) {
        usedInitial = true
        return initial
      }
      if (isTokenExpired(lastToken)) {
        memoized.cache.clear('token expired')
      }
      return memoized()
    }
  }

  return async (): Promise<AccessToken> => {
    // Only clear the cache when we have a previously-fetched token that has
    // since expired. When lastToken is undefined (never fetched), skip clearing
    // so concurrent first calls coalesce onto a single in-flight fetch.
    if (lastToken && isTokenExpired(lastToken)) {
      memoized.cache.clear('token expired')
    }
    return memoized()
  }
}
