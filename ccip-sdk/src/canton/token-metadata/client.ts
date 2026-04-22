import { get } from '../client/client.ts'

/**
 * Map from token standard API name to the minor version of the API supported.
 *
 * Example: `{ "splice-api-token-metadata-v1": 1 }`
 */
export type SupportedApis = Record<string, number>

/**
 * Information about the token registry.
 */
export interface GetRegistryInfoResponse {
  /** The Daml party representing the registry app. */
  adminId: string
  /** The token standard APIs supported by the registry. */
  supportedApis: SupportedApis
}

/**
 * Metadata for a single instrument managed by the registry.
 */
export interface Instrument {
  /** Unique identifier assigned by the admin to the instrument. */
  id: string
  /** Display name recommended by the instrument admin (not necessarily unique). */
  name: string
  /** Symbol recommended by the instrument admin (not necessarily unique). */
  symbol: string
  /** Decimal-encoded current total supply of the instrument. */
  totalSupply?: string
  /** Timestamp when the total supply was last computed. */
  totalSupplyAsOf?: string
  /**
   * Number of decimal places used by the instrument (0–10).
   *
   * Daml interfaces represent holding amounts as `Decimal` values with 10
   * decimal places. This number SHOULD be used for display purposes.
   *
   * Defaults to 10.
   */
  decimals: number
  /** Token standard APIs supported for this specific instrument. */
  supportedApis: SupportedApis
}

/**
 * Paginated list of instruments.
 */
export interface ListInstrumentsResponse {
  /** Instruments on the current page. */
  instruments: Instrument[]
  /** Token for fetching the next page, if available. */
  nextPageToken?: string
}

/**
 * Standard error envelope returned by the token-metadata API.
 */
export interface TokenMetadataErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Pagination options
// ---------------------------------------------------------------------------

/**
 * Options for listing instruments.
 */
export interface ListInstrumentsOptions {
  /** Number of instruments per page (default: 25). */
  pageSize?: number
  /** Page token received from a previous `listInstruments` response. */
  pageToken?: string
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Token Metadata API client.
 */
export interface TokenMetadataClientConfig {
  /** Base URL of the token registry (e.g. http://localhost:9000) */
  baseUrl: string
  /** Optional JWT for authentication */
  jwt?: string
  /** Request timeout in milliseconds (default: 30 000) */
  timeout?: number
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Create a typed Token Metadata API client.
 *
 * The client mirrors the endpoints defined in `token-metadata-v1.yaml`.
 */
export function createTokenMetadataClient(config: TokenMetadataClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  console.log('Creating Token Metadata client with base URL:', baseUrl)
  const headers = buildHeaders(config.jwt)
  const timeoutMs = config.timeout ?? 30_000

  const appendScanProxyPath = (path: string) => `/v0/scan-proxy${path}`
  return {
    /**
     * Get information about the registry, including supported APIs.
     *
     * `GET /registry/metadata/v1/info`
     */
    async getRegistryInfo(): Promise<GetRegistryInfoResponse> {
      return get<GetRegistryInfoResponse>(
        baseUrl,
        appendScanProxyPath('/registry/metadata/v1/info'),
        headers,
        timeoutMs,
      )
    },

    /**
     * List all instruments managed by this instrument admin.
     *
     * `GET /registry/metadata/v1/instruments`
     */
    async listInstruments(options?: ListInstrumentsOptions): Promise<ListInstrumentsResponse> {
      const queryParams: Record<string, string> = {}
      if (options?.pageSize !== undefined) {
        queryParams['pageSize'] = String(options.pageSize)
      }
      if (options?.pageToken !== undefined) {
        queryParams['pageToken'] = options.pageToken
      }
      return get<ListInstrumentsResponse>(
        baseUrl,
        appendScanProxyPath('/registry/metadata/v1/instruments'),
        headers,
        timeoutMs,
        Object.keys(queryParams).length > 0 ? queryParams : undefined,
      )
    },

    /**
     * Retrieve an instrument's metadata by its ID.
     *
     * `GET /registry/metadata/v1/instruments/{instrumentId}`
     */
    async getInstrument(instrumentId: string): Promise<Instrument> {
      return get<Instrument>(
        baseUrl,
        appendScanProxyPath(
          `/registry/metadata/v1/instruments/${encodeURIComponent(instrumentId)}`,
        ),
        headers,
        timeoutMs,
      )
    },
  }
}

/**
 * Type alias for the Token Metadata client instance.
 */
export type TokenMetadataClient = ReturnType<typeof createTokenMetadataClient>

function buildHeaders(jwt?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`
  return headers
}
