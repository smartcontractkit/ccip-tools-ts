import * as oauth from 'oauth4webapi'

import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'

/**
 * A subset of the OAuth 2.0 Authorization Server Metadata (RFC 8414, §2).
 *
 * This is a thin camelCase wrapper over the `oauth4webapi.AuthorizationServer`
 * type, kept for backward compatibility with the existing public API.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414#section-2
 */
export interface AuthorizationServerMetadata {
  /** The authorization server's issuer identifier URL. */
  issuer: string
  /** URL of the authorization server's authorization endpoint. */
  authorizationEndpoint: string
  /** URL of the authorization server's token endpoint. */
  tokenEndpoint: string
  /**
   * PKCE code challenge methods supported by this authorization server.
   * Omitted when the server does not support PKCE.
   *
   * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.2
   */
  codeChallengeMethodsSupported?: string[]
}

/** Re-export the raw `oauth4webapi.AuthorizationServer` for provider implementations. */
export type { AuthorizationServer } from 'oauth4webapi'

/**
 * Convert an `oauth4webapi.AuthorizationServer` to our camelCase wrapper.
 */
function toMetadata(as: oauth.AuthorizationServer): AuthorizationServerMetadata {
  return {
    issuer: as.issuer,
    authorizationEndpoint: as.authorization_endpoint ?? '',
    tokenEndpoint: as.token_endpoint ?? '',
    codeChallengeMethodsSupported: as.code_challenge_methods_supported,
  }
}

/**
 * Parse a string into a URL, throwing a `CCIPError` on failure.
 */
function parseIssuerUrl(baseUrl: string): URL {
  try {
    return new URL(baseUrl)
  } catch {
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      `Authorization server URL is not a valid URL: "${baseUrl}"`,
    )
  }
}

/**
 * Fetch OAuth 2.0 Authorization Server Metadata from the well-known endpoint.
 *
 * Uses `oauth4webapi.discoveryRequest` + `processDiscoveryResponse` (RFC 8414),
 * which validates the issuer and parses the metadata. The result is mapped to
 * our camelCase {@link AuthorizationServerMetadata} interface.
 *
 * @param authorizationServerURL - Base URL of the authorization server (trailing `/` stripped).
 * @param options - Optional fetch override and abort signal.
 * @returns The parsed authorization server metadata.
 * @throws {@link CCIPError} with {@link CCIPErrorCode.CANTON_AUTH_ERROR} on discovery failure.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */
export async function getAuthorizationServerMetadata(
  authorizationServerURL: string,
  options?: { fetch?: typeof fetch; signal?: AbortSignal; allowInsecureRequests?: boolean },
): Promise<AuthorizationServerMetadata> {
  const as = await discoverAuthorizationServer(authorizationServerURL, options)
  return toMetadata(as)
}

/**
 * Perform RFC 8414 discovery and return the raw `oauth4webapi.AuthorizationServer`.
 *
 * Used internally by the client-credentials and authorization-code providers
 * that need to pass the `AuthorizationServer` directly to `oauth4webapi` grant
 * request functions.
 */
export async function discoverAuthorizationServer(
  authorizationServerURL: string,
  options?: { fetch?: typeof fetch; signal?: AbortSignal; allowInsecureRequests?: boolean },
): Promise<oauth.AuthorizationServer> {
  const baseUrl = authorizationServerURL.replace(/\/$/, '')
  if (!baseUrl) {
    throw new CCIPError(CCIPErrorCode.CANTON_AUTH_ERROR, 'Authorization server URL cannot be empty')
  }

  const issuerUrl = parseIssuerUrl(baseUrl)

  try {
    const response = await oauth.discoveryRequest(issuerUrl, {
      algorithm: 'oauth2',
      [oauth.customFetch]: options?.fetch,
      signal: options?.signal,
      [oauth.allowInsecureRequests]: options?.allowInsecureRequests,
    })
    return await oauth.processDiscoveryResponse(issuerUrl, response)
  } catch (e) {
    if (e instanceof CCIPError) throw e
    throw new CCIPError(
      CCIPErrorCode.CANTON_AUTH_ERROR,
      `Failed to discover authorization server metadata from ${baseUrl}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e instanceof Error ? e : undefined, isTransient: true },
    )
  }
}
