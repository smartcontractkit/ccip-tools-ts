import * as oauth from 'oauth4webapi'

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import { discoverAuthorizationServer } from './metadata.ts'
import {
  type OAuthRequestOptions,
  CachingTokenSource,
  buildOAuthRequestOptions,
  toAccessToken,
  wrapOAuthError,
} from './token-source.ts'
import type { AccessToken, AuthProvider, ClientCredentialsAuthConfig } from './types.ts'

/**
 * OAuth2 client credentials flow authentication provider (RFC 6749 §4.4).
 *
 * @packageDocumentation
 *
 * Designed for machine-to-machine authentication where the client can securely
 * maintain a client secret — ideal for CI/CD pipelines and server-to-server
 * communication. Tokens are fetched on demand via `oauth4webapi` and cached
 * until expiry; refresh is automatic (a new `client_credentials` grant request).
 *
 * Implements RFC 8414 metadata discovery and the Auth0-specific
 * `audience` extension.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.4
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

/** Default scopes for the client credentials flow (Canton ledger API access). */
const DEFAULT_CLIENT_CREDENTIALS_SCOPES = ['daml_ledger_api']

/**
 * Resolved client-credentials provider configuration (after applying defaults).
 */
interface ResolvedClientCredentialsConfig {
  as: oauth.AuthorizationServer
  client: oauth.Client
  clientSecret: string
  scopes: string[]
  audience: string
  fetch?: typeof fetch
  signal?: AbortSignal
  allowInsecureRequests?: boolean
}

/** Options for {@link ClientCredentialsProvider.fromDiscovery} and {@link ClientCredentialsProvider.fromDirect}. */
export type ClientCredentialsProviderOptions = OAuthRequestOptions

/**
 * Client credentials auth provider.
 *
 * Uses a {@link CachingTokenSource} so the first `token()` call fetches a
 * token and subsequent calls return the cached value until it expires.
 */
export class ClientCredentialsProvider implements AuthProvider {
  readonly type = 'clientCredentials' as const
  private readonly cfg: ResolvedClientCredentialsConfig
  private readonly tokenSourceImpl: CachingTokenSource

  /** Creates a provider from resolved config (internal — use fromDiscovery). */
  private constructor(cfg: ResolvedClientCredentialsConfig) {
    this.cfg = cfg
    this.tokenSourceImpl = new CachingTokenSource(() => this.doFetch())
  }

  /** Returns a valid access token, fetching via the client credentials grant if needed. */
  token(): Promise<AccessToken> {
    return this.tokenSourceImpl.token()
  }

  /** Fetch a fresh access token via the client credentials grant. */
  private async doFetch(): Promise<AccessToken> {
    const params = new URLSearchParams()
    if (this.cfg.scopes.length > 0) {
      params.set('scope', this.cfg.scopes.join(' '))
    }
    if (this.cfg.audience) {
      params.set('audience', this.cfg.audience)
    }

    try {
      const response = await oauth.clientCredentialsGrantRequest(
        this.cfg.as,
        this.cfg.client,
        oauth.ClientSecretPost(this.cfg.clientSecret),
        params,
        buildOAuthRequestOptions(this.cfg),
      )
      const tokenResponse = await oauth.processClientCredentialsResponse(
        this.cfg.as,
        this.cfg.client,
        response,
      )
      return toAccessToken(tokenResponse)
    } catch (e) {
      throw wrapOAuthError(e, 'Client credentials token request failed')
    }
  }

  /**
   * Create a provider using OAuth2 Authorization Server Metadata discovery
   * (RFC 8414) to automatically locate the token endpoint.
   *
   * This is the recommended approach when the authorization server supports
   * metadata discovery, as it eliminates the need to manually specify the
   * token endpoint URL.
   *
   * @param config - Client credentials config with `authUrl` (authorization server base URL).
   * @param options - Optional fetch override and abort signal.
   * @returns A {@link ClientCredentialsProvider}.
   * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on discovery failure or invalid config.
   *
   * @see https://datatracker.ietf.org/doc/html/rfc8414
   */
  static async fromDiscovery(
    config: ClientCredentialsAuthConfig,
    options?: ClientCredentialsProviderOptions,
  ): Promise<ClientCredentialsProvider> {
    validateClientCredentialsConfig(config)
    const as = await discoverAuthorizationServer(config.authUrl, {
      fetch: options?.fetch,
      signal: options?.signal,
      allowInsecureRequests: options?.allowInsecureRequests,
    })
    if (!as.token_endpoint) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        'Authorization server metadata is missing a token_endpoint',
      )
    }
    const resolved: ResolvedClientCredentialsConfig = {
      as,
      client: { client_id: config.clientId },
      clientSecret: config.clientSecret,
      scopes: config.scopes?.length ? config.scopes : DEFAULT_CLIENT_CREDENTIALS_SCOPES,
      audience: config.audience ?? '',
      fetch: options?.fetch,
      signal: options?.signal,
      allowInsecureRequests: options?.allowInsecureRequests,
    }
    return new ClientCredentialsProvider(resolved)
  }

  /**
   * Create a provider with an explicit token endpoint URL (no discovery).
   *
   * Suitable for environments where the token endpoint is known in advance.
   * A minimal `oauth4webapi.AuthorizationServer` is constructed from the
   * provided `authUrl` (issuer) and `tokenUrl`.
   *
   * @param config - Client credentials config plus a `tokenUrl`.
   * @param options - Optional fetch override and abort signal.
   * @returns A {@link ClientCredentialsProvider}.
   * @throws {@link CCIPError} (CANTON_AUTH_ERROR) on invalid config.
   */
  static fromDirect(
    config: ClientCredentialsAuthConfig & { tokenUrl: string },
    options?: ClientCredentialsProviderOptions,
  ): ClientCredentialsProvider {
    validateClientCredentialsConfig(config)
    if (!config.tokenUrl) {
      throw new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, 'tokenUrl cannot be empty')
    }
    const resolved: ResolvedClientCredentialsConfig = {
      as: { issuer: config.authUrl.replace(/\/$/, ''), token_endpoint: config.tokenUrl },
      client: { client_id: config.clientId },
      clientSecret: config.clientSecret,
      scopes: config.scopes?.length ? config.scopes : DEFAULT_CLIENT_CREDENTIALS_SCOPES,
      audience: config.audience ?? '',
      fetch: options?.fetch,
      signal: options?.signal,
      allowInsecureRequests: options?.allowInsecureRequests,
    }
    return new ClientCredentialsProvider(resolved)
  }
}

/**
 * Validate the shared client-credentials config fields.
 */
function validateClientCredentialsConfig(config: ClientCredentialsAuthConfig): void {
  if (!config.authUrl.trim()) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'clientCredentials auth requires a non-empty authUrl',
    )
  }
  if (!config.clientId.trim()) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'clientCredentials auth requires a non-empty clientId',
    )
  }
  if (!config.clientSecret.trim()) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      'clientCredentials auth requires a non-empty clientSecret',
    )
  }
}

/**
 * Create a client credentials provider using RFC 8414 metadata discovery.
 *
 * Convenience wrapper for {@link ClientCredentialsProvider.fromDiscovery}.
 *
 * @param config - Client credentials config.
 * @param options - Optional fetch override and abort signal.
 */
export function createClientCredentialsProvider(
  config: ClientCredentialsAuthConfig,
  options?: ClientCredentialsProviderOptions,
): Promise<ClientCredentialsProvider> {
  return ClientCredentialsProvider.fromDiscovery(config, options)
}
