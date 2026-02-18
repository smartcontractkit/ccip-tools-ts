/**
 * CCIP Docs Config API Client
 * Fetches chain configuration from https://docs.chain.link/api/ccip/v1/chains
 * Note: This is NOT the official CCIP API - used for display names only
 */

import {
  type Logger,
  CCIPHttpError,
  DEFAULT_API_RETRY_CONFIG,
  NetworkType,
  networkInfo,
  withRetry,
} from '@chainlink/ccip-sdk/src/index.ts'

/** Chain details returned by the CCIP docs config API. */
export interface ChainDetailsAPI {
  chainId: number | string
  displayName: string
  selector: string
  internalId: string
  feeTokens: string[]
  router: string
  chainFamily: string
  supported: boolean
}

/** Response structure from the CCIP docs config API. */
export interface ChainsAPIResponse {
  metadata: {
    environment: 'mainnet' | 'testnet'
    timestamp: string
    validChainCount: number
  }
  data: Record<string, Record<string, ChainDetailsAPI>> // family -> chains
}

/** Environment type for CCIP chains. */
export type Environment = 'mainnet' | 'testnet'

/** Chain info from API (passthrough, no SDK processing). */
export type ChainInfo = {
  name: string // internalId from API
  chainId: number | string
  chainSelector: string
  family: string // chainFamily from API
  displayName: string
  environment: Environment
  supported: boolean
}

// Constants
const API_BASE = 'https://docs.chain.link/api/ccip/v1/chains'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Cache structure
const cache = new Map<Environment, { data: ChainsAPIResponse; timestamp: number }>()

/**
 * Fetch chains from the CCIP docs config API for a specific environment.
 * Uses exponential backoff for transient errors.
 * @param environment - The environment to fetch chains for ('mainnet' or 'testnet')
 * @param logger - Optional logger for retry attempts
 * @returns Promise resolving to the API response
 */
export async function fetchChains(
  environment: Environment,
  logger?: Logger,
): Promise<ChainsAPIResponse> {
  // Check cache first
  const cached = cache.get(environment)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  const url = `${API_BASE}?environment=${environment}&outputKey=selector`

  const data = await withRetry(
    async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new CCIPHttpError(response.status, response.statusText)
      }
      return (await response.json()) as ChainsAPIResponse
    },
    { ...DEFAULT_API_RETRY_CONFIG, logger },
  )

  cache.set(environment, { data, timestamp: Date.now() })
  return data
}

/**
 * Fetch chains from one or both environments.
 * Uses exponential backoff for transient errors.
 * @param environment - Optional environment filter ('mainnet' or 'testnet'). If not provided, fetches both.
 * @param logger - Optional logger for retry attempts and warnings
 * @returns Promise resolving to an array of API responses
 */
export async function fetchAllChains(
  environment?: Environment,
  logger?: Logger,
): Promise<ChainsAPIResponse[]> {
  if (environment) {
    return [await fetchChains(environment, logger)]
  }
  return Promise.all([fetchChains('mainnet', logger), fetchChains('testnet', logger)])
}

/**
 * Search chains using the API's search parameter.
 * The API auto-detects search type (displayName, selector, internalId).
 * @param search - Search term
 * @param environment - Optional environment filter ('mainnet' or 'testnet'). If not provided, searches both.
 * @param logger - Optional logger for retry attempts
 * @returns Promise resolving to an array of API responses
 */
export async function searchChainsAPI(
  search: string,
  environment?: Environment,
  logger?: Logger,
): Promise<ChainsAPIResponse[]> {
  const searchEnv = async (env: Environment): Promise<ChainsAPIResponse> => {
    const url = `${API_BASE}?environment=${env}&outputKey=selector&search=${encodeURIComponent(search)}`

    return withRetry(
      async () => {
        const response = await fetch(url)
        if (!response.ok) {
          throw new CCIPHttpError(response.status, response.statusText)
        }
        return (await response.json()) as ChainsAPIResponse
      },
      { ...DEFAULT_API_RETRY_CONFIG, logger },
    )
  }

  if (environment) {
    return [await searchEnv(environment)]
  }
  return Promise.all([searchEnv('mainnet'), searchEnv('testnet')])
}

/**
 * Flatten the nested API response structure into a flat array of ChainInfo objects.
 * Uses SDK's networkInfo for name, family, and environment for consistency.
 * @param responses - Array of API responses from fetchAllChains
 * @returns Flat array of ChainInfo objects
 */
export function getAllChainsFlat(responses: ChainsAPIResponse[]): ChainInfo[] {
  const chains: ChainInfo[] = []

  for (const response of responses) {
    const apiEnvironment = response.metadata.environment
    for (const familyChains of Object.values(response.data)) {
      for (const details of Object.values(familyChains)) {
        // Use SDK networkInfo for consistent name, family, and environment
        let name = details.internalId
        let family = details.chainFamily.toUpperCase()
        let environment: Environment = apiEnvironment

        try {
          const info = networkInfo(BigInt(details.selector))
          name = info.name
          family = info.family
          environment = info.networkType === NetworkType.Testnet ? 'testnet' : 'mainnet'
        } catch {
          // Chain not in SDK - use API values
        }

        chains.push({
          name,
          chainId: details.chainId,
          chainSelector: details.selector,
          family,
          displayName: details.displayName,
          environment,
          supported: details.supported,
        })
      }
    }
  }
  return chains
}

/**
 * Clear the cache for all environments.
 */
export function clearCache(): void {
  cache.clear()
}
