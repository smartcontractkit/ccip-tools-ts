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
 * The SDK exports only **runtime-agnostic** protocol pieces: types, RFC 8414
 * metadata discovery, PKCE/token-source primitives, the `clientCredentials`
 * and `static` providers, and the `authorizationCode` **protocol helpers**
 * (build-authorize-URL, callback validation, code→token exchange, refresh
 * grant). No `node:*` modules are imported here — the environment-specific
 * orchestration (local callback server, browser `open`, env-var resolution)
 * lives in the CLI (`providers/canton/`).
 *
 * Use {@link createAuthProvider} to build a provider from a discriminated
 * {@link AuthConfig} (for `static` / `clientCredentials`), or compose the
 * `authorizationCode` protocol helpers with your own callback handling and
 * wrap the result in {@link createAuthorizationCodeProvider}.
 *
 * @example
 * ```ts
 * import { createAuthProvider, AuthType } from '@chainlink/ccip-sdk'
 *
 * // Client credentials (CI/CD)
 * const provider = await createAuthProvider({
 *   type: AuthType.ClientCredentials,
 *   authUrl: 'https://auth.example.com',
 *   clientId: 'my-client-id',
 *   clientSecret: 'my-client-secret',
 * })
 * const jwt = (await provider.token()).accessToken
 * ```
 *
 * @example
 * ```ts
 * // Authorization code (interactive browser login) — protocol pieces only.
 * // The embedder (CLI / web app) owns the callback server + browser opening.
 * import {
 *   buildAuthorizationRequest,
 *   validateAuthorizationCallback,
 *   exchangeAuthorizationCode,
 *   createAuthorizationCodeProvider,
 * } from '@chainlink/ccip-sdk'
 *
 * const req = await buildAuthorizationRequest({
 *   type: 'authorizationCode',
 *   authUrl: 'https://auth.example.com',
 *   clientId: 'ccip-app',
 *   callbackUrl: 'http://localhost:8400/callback',
 * })
 * // …redirect user to req.authorizeUrl, receive callback at req.redirectUri…
 * const { code } = await validateAuthorizationCallback(config, callbackUrl, req.state)
 * const token = await exchangeAuthorizationCode(config, code, req.verifier, req.redirectUri)
 * const provider = createAuthorizationCodeProvider(config, token, () => runFlowAgain())
 * ```
 */

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import type { AuthorizationCodeProvider } from './authorization-code.ts'
import {
  type ClientCredentialsProvider,
  createClientCredentialsProvider,
} from './client-credentials.ts'
import { type StaticProvider, createStaticProvider } from './static.ts'
import type { OAuthRequestOptions } from './token-source.ts'
import { type AuthConfig, type AuthProvider, AuthType } from './types.ts'

export {
  type AuthorizationCodeProtocolOptions,
  type AuthorizationRequest,
  type ValidatedCallback,
  AuthorizationCodeProvider,
  buildAuthorizationRequest,
  createAuthorizationCodeProvider,
  exchangeAuthorizationCode,
  refreshAuthorizationCodeToken,
  resolveAuthorizationCodeConfig,
  validateAuthorizationCallback,
} from './authorization-code.ts'
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
 * Options for {@link createAuthProvider}.
 */
export type AuthProviderOptions = OAuthRequestOptions

/**
 * Build an {@link AuthProvider} from a discriminated {@link AuthConfig}.
 *
 * Supports the `static` and `clientCredentials` schemes — both are fully
 * runtime-agnostic (pure `fetch` + WebCrypto). The `authorizationCode` scheme
 * is **not** handled here because it requires environment-specific
 * orchestration (callback server, browser); use the protocol helpers exported
 * from this package ({@link buildAuthorizationRequest},
 * {@link validateAuthorizationCallback}, {@link exchangeAuthorizationCode},
 * {@link createAuthorizationCodeProvider}) to compose it with your own
 * callback handling.
 *
 * The `type` field selects the auth scheme; when omitted, `"static"`
 * is assumed (backward compatible with the existing `CantonConfig.jwt` field).
 *
 * @param config - Auth config (static or clientCredentials).
 * @param options - Optional fetch override and abort signal.
 * @returns An {@link AuthProvider} whose `token()` yields valid JWTs.
 * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config or auth failure.
 *
 * @example
 * ```ts
 * const provider = await createAuthProvider({
 *   type: AuthType.ClientCredentials,
 *   authUrl: 'https://smartcontract.okta.com/oauth2/austsuml9q2WhPBMM5d7',
 *   clientId: 'my-client-id',
 *   clientSecret: 'my-client-secret',
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
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        'authorizationCode cannot be built via createAuthProvider — it requires environment-specific ' +
          'orchestration (callback server, browser). Use buildAuthorizationRequest + ' +
          'validateAuthorizationCallback + exchangeAuthorizationCode + createAuthorizationCodeProvider.',
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
 * Type alias for the union of concrete provider classes.
 */
export type AnyAuthProvider = StaticProvider | ClientCredentialsProvider | AuthorizationCodeProvider
