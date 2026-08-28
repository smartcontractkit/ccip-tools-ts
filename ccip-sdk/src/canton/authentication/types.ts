/**
 * Shared types for the Canton authentication providers.
 *
 * @packageDocumentation
 *
 * OAuth 2.0 authentication for the Canton Ledger API (JSON API / HTTP).
 *
 * Three auth schemes are supported:
 * - `static`           — a pre-obtained JWT
 * - `clientCredentials`— OAuth2 client credentials grant (RFC 6749 §4.4, machine-to-machine)
 * - `authorizationCode`— OAuth2 authorization code + PKCE (RFC 6749 §4.1 / RFC 7636, interactive browser login)
 */

/**
 * Supported authentication types for Canton participant APIs.
 */
export const AuthType = {
  /** Pre-obtained JWT. */
  Static: 'static',
  /** OAuth2 client credentials grant (machine-to-machine, CI/CD). */
  ClientCredentials: 'clientCredentials',
  /** OAuth2 authorization code + PKCE (interactive browser login). */
  AuthorizationCode: 'authorizationCode',
} as const

/** Union of supported auth type strings. */
export type AuthType = (typeof AuthType)[keyof typeof AuthType]

/**
 * An OAuth 2.0 access token with optional refresh metadata.
 *
 * The `expiresAt` field is derived from `expires_in` (seconds) at fetch time
 * so callers can check staleness without re-parsing the JWT.
 */
export interface AccessToken {
  /** The bearer access token (JWT). */
  accessToken: string
  /** Token type, typically `"Bearer"`. */
  tokenType?: string
  /** Absolute expiry (epoch ms). `undefined` when the server did not return `expires_in`. */
  expiresAt?: number
  /** Refresh token (authorization code flow only). Used to obtain new access tokens. */
  refreshToken?: string
}

/**
 * A source of {@link AccessToken} values with automatic refresh.
 *
 * Implementations cache the current token and re-fetch on demand when it is
 * expired or missing. Used internally by {@link CachingTokenSource} and
 * {@link StaticTokenSource}; {@link AuthProvider} exposes `token()` directly.
 */
export interface TokenSource {
  /**
   * Returns a valid (non-expired) access token, fetching or refreshing as needed.
   *
   * Implementations MUST be safe to call concurrently.
   */
  token(): Promise<AccessToken>
}

/**
 * An authentication provider for the Canton Ledger API.
 *
 * Exposes the auth scheme (`type`) and a `token()` method that returns a valid
 * bearer JWT, fetching or refreshing as needed.
 */
export interface AuthProvider {
  /** The auth scheme this provider was built from. */
  readonly type: AuthType
  /**
   * Returns a valid (non-expired) access token, fetching or refreshing as needed.
   *
   * Safe to call concurrently.
   */
  token(): Promise<AccessToken>
}

/**
 * Base configuration shared by all auth schemes.
 *
 * Base configuration shared by all auth schemes. Each concrete provider
 * accepts a subset of these fields.
 */
export interface AuthConfigBase {
  /** Auth scheme selector. Defaults to `"static"` when omitted (backward compatible). */
  type?: AuthType
  /**
   * OAuth2 "audience" request parameter (Auth0-specific extension).
   *
   * Identifies the API the issued access token should target (its JWT `aud` claim).
   * Only honored by Auth0 (or servers emulating Auth0); Okta/Keycloak ignore it.
   * Applicable to `clientCredentials` and `authorizationCode` only.
   */
  audience?: string
}

/**
 * `static` auth config.
 */
export interface StaticAuthConfig extends AuthConfigBase {
  type?: typeof AuthType.Static
  /** Pre-obtained JWT. Required. */
  jwt: string
}

/**
 * `clientCredentials` auth config (RFC 6749 §4.4).
 */
export interface ClientCredentialsAuthConfig extends AuthConfigBase {
  type: typeof AuthType.ClientCredentials
  /** OIDC authorization server base URL (e.g. `https://auth.example.com`). */
  authUrl: string
  /** OAuth2 client identifier. */
  clientId: string
  /** OAuth2 client secret (machine-to-machine). */
  clientSecret: string
  /** OAuth2 scopes. Defaults to `["daml_ledger_api"]`. */
  scopes?: string[]
}

/**
 * `authorizationCode` auth config (RFC 6749 §4.1 + PKCE RFC 7636).
 */
export interface AuthorizationCodeAuthConfig extends AuthConfigBase {
  type: typeof AuthType.AuthorizationCode
  /** OIDC authorization server base URL (e.g. `https://auth.example.com`). */
  authUrl: string
  /** OAuth2 client identifier. */
  clientId: string
  /** OAuth2 scopes. Defaults to `["openid", "daml_ledger_api"]`. */
  scopes?: string[]
  /** Local redirect URI. Defaults to `http://localhost:8400/callback`. */
  callbackUrl?: string
  /** Open the browser automatically (default `true`). */
  openBrowser?: boolean
  /** Overall flow timeout in ms (default 120_000). */
  timeoutMs?: number
}

/**
 * Discriminated union of all auth configs.
 *
 * The `type` field discriminates between the three schemes. When omitted,
 * `static` is assumed and `jwt` is required.
 */
export type AuthConfig =
  | StaticAuthConfig
  | ClientCredentialsAuthConfig
  | AuthorizationCodeAuthConfig

/**
 * Type-guard for {@link AccessToken}.
 */
export function isAccessToken(v: unknown): v is AccessToken {
  return (
    typeof v === 'object' &&
    v !== null &&
    'accessToken' in v &&
    typeof (v as AccessToken).accessToken === 'string' &&
    (v as AccessToken).accessToken.length > 0
  )
}
