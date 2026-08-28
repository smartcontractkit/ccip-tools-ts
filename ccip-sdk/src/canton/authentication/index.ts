/**
 * Canton authentication providers — public exports.
 *
 * @packageDocumentation
 *
 * OAuth 2.0 authentication for the Canton Ledger API.
 *
 * Three auth schemes are supported:
 * - **static** — pre-obtained JWT (no refresh)
 * - **clientCredentials** — OAuth2 client credentials grant (machine-to-machine)
 * - **authorizationCode** — OAuth2 authorization code + PKCE (interactive browser login)
 *
 * Use {@link createAuthProvider} to build a provider from a discriminated
 * {@link AuthConfig}, or {@link resolveCantonJwt} to obtain a JWT string
 * directly (convenient for the existing `CantonConfig.jwt` field).
 *
 * @example
 * ```ts
 * import { createAuthProvider, AuthType } from '@chainlink/ccip-sdk'
 *
 * // Client credentials (CI/CD)
 * const provider = await createAuthProvider({
 *   type: AuthType.ClientCredentials,
 *   authUrl: 'https://auth.example.com',
 *   clientId: process.env.CANTON_CLIENT_ID!,
 *   clientSecret: process.env.CANTON_CLIENT_SECRET!,
 * })
 * const jwt = (await provider.token()).accessToken
 * ```
 *
 * @example
 * ```ts
 * // Authorization code (interactive browser login)
 * const provider = await createAuthProvider({
 *   type: AuthType.AuthorizationCode,
 *   authUrl: 'https://auth.example.com',
 *   clientId: 'ccip-app',
 * })
 * const jwt = (await provider.token()).accessToken
 * ```
 */

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import {
  type AuthorizationCodeProvider,
  createAuthorizationCodeProvider,
} from './authorization-code.ts'
import {
  type ClientCredentialsProvider,
  createClientCredentialsProvider,
} from './client-credentials.ts'
import { type StaticProvider, createStaticProvider } from './static.ts'
import type { OAuthRequestOptions } from './token-source.ts'
import { type AuthConfig, type AuthProvider, AuthType } from './types.ts'

export { AuthorizationCodeProvider, createAuthorizationCodeProvider } from './authorization-code.ts'
export { ClientCredentialsProvider, createClientCredentialsProvider } from './client-credentials.ts'
export {
  type AuthorizationServer,
  type AuthorizationServerMetadata,
  discoverAuthorizationServer,
  getAuthorizationServerMetadata,
} from './metadata.ts'
export {
  type OAuthRequestOptions,
  CachingTokenSource,
  StaticTokenSource,
  buildOAuthRequestOptions,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
  isTokenExpired,
  toAccessToken,
  wrapOAuthError,
} from './token-source.ts'
export { StaticProvider, createStaticProvider } from './static.ts'
export {
  type AccessToken,
  type AuthConfig,
  type AuthProvider,
  type AuthorizationCodeAuthConfig,
  type ClientCredentialsAuthConfig,
  type StaticAuthConfig,
  AuthType,
  isAccessToken,
} from './types.ts'

/**
 * Options for {@link createAuthProvider} and {@link resolveCantonJwt}.
 */
export type AuthProviderOptions = OAuthRequestOptions

/**
 * Build an {@link AuthProvider} from a discriminated {@link AuthConfig}.
 *
 * The `type` field selects the auth scheme; when omitted, `"static"`
 * is assumed (backward compatible with the existing `CantonConfig.jwt` field).
 *
 * @param config - Auth config (static, clientCredentials, or authorizationCode).
 * @param options - Optional fetch override and abort signal.
 * @returns An {@link AuthProvider} whose `token()` yields valid JWTs.
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config or auth failure.
 *
 * @example
 * ```ts
 * const provider = await createAuthProvider({
 *   type: AuthType.ClientCredentials,
 *   authUrl: 'https://smartcontract.okta.com/oauth2/austsuml9q2WhPBMM5d7',
 *   clientId: process.env.CANTON_CLIENT_ID!,
 *   clientSecret: process.env.CANTON_CLIENT_SECRET!,
 * })
 * ```
 */
export async function createAuthProvider(
  config: AuthConfig,
  options?: AuthProviderOptions,
): Promise<AuthProvider> {
  const type: AuthType = config.type ?? AuthType.Static

  switch (type) {
    case AuthType.Static:
      return createStaticProvider((config as { jwt?: string }).jwt ?? '')

    case AuthType.ClientCredentials:
      return createClientCredentialsProvider(
        config as Parameters<typeof createClientCredentialsProvider>[0],
        options,
      )

    case AuthType.AuthorizationCode:
      return createAuthorizationCodeProvider(
        config as Parameters<typeof createAuthorizationCodeProvider>[0],
        {
          fetch: options?.fetch,
          allowInsecureRequests: options?.allowInsecureRequests,
        },
      )

    default: {
      const t: string = type
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        `Unsupported auth type: "${t}" (expected static, clientCredentials, or authorizationCode)`,
      )
    }
  }
}

/**
 * Resolve a JWT string for Canton Ledger API authentication.
 *
 * This is a convenience wrapper around {@link createAuthProvider} that returns
 * the raw access token string (suitable for the existing `CantonConfig.jwt`
 * field) instead of a provider. It fetches a token immediately.
 *
 * @param config - Auth config (static, clientCredentials, or authorizationCode).
 * @param options - Optional fetch override and abort signal.
 * @returns The JWT access token string.
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config or auth failure.
 *
 * @example
 * ```ts
 * const jwt = await resolveCantonJwt({
 *   type: AuthType.ClientCredentials,
 *   authUrl: process.env.CANTON_AUTH_URL!,
 *   clientId: process.env.CANTON_CLIENT_ID!,
 *   clientSecret: process.env.CANTON_CLIENT_SECRET!,
 * })
 * ```
 */
export async function resolveCantonJwt(
  config: AuthConfig,
  options?: AuthProviderOptions,
): Promise<string> {
  const provider = await createAuthProvider(config, options)
  const token = await provider.token()
  return token.accessToken
}

/**
 * Type alias for the union of concrete provider classes.
 */
export type AnyAuthProvider = StaticProvider | ClientCredentialsProvider | AuthorizationCodeProvider
