/**
 * CCIP Docs Config API Client
 *
 * Fetches chain configuration from https://docs.chain.link/api/ccip/v1/chains
 * Independent implementation for ccip-api-ref documentation site.
 */

import {
  type ChainFamily,
  type NetworkType,
  NetworkType as NetworkTypeEnum,
  networkInfo,
} from '@chainlink/ccip-sdk'

// Re-export SDK types for convenience
export type { ChainFamily, NetworkType }

// API types

/** Network environment type. */
export type Environment = 'mainnet' | 'testnet'

/** Chain details from API response. */
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

/** API response structure for chains endpoint. */
export interface ChainsAPIResponse {
  metadata: {
    environment: Environment
    timestamp: string
    validChainCount: number
  }
  data: Record<string, Record<string, ChainDetailsAPI>> // family -> chains
}

/** Normalized chain information for display. */
export interface ChainInfo {
  name: string
  chainId: number | string
  chainSelector: string
  family: ChainFamily
  displayName: string
  environment: Environment
  supported: boolean
}

// Constants
const API_BASE = 'https://docs.chain.link/api/ccip/v1/chains'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Cache structure
interface CacheEntry {
  data: ChainsAPIResponse
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Get cache key for a request
 */
function getCacheKey(environment?: Environment, search?: string): string {
  return `${environment ?? 'all'}_${search ?? ''}`
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false
  return Date.now() - entry.timestamp < CACHE_TTL_MS
}

/**
 * Fetch chains from API for a specific environment
 */
export async function fetchChains(
  environment: Environment,
  search?: string,
): Promise<ChainsAPIResponse> {
  const cacheKey = getCacheKey(environment, search)
  const cached = cache.get(cacheKey)

  if (isCacheValid(cached)) {
    return cached.data
  }

  const params = new URLSearchParams()
  params.set('environment', environment)
  params.set('outputKey', 'selector')
  if (search) {
    params.set('search', search)
  }

  const url = `${API_BASE}?${params.toString()}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as ChainsAPIResponse
  cache.set(cacheKey, { data, timestamp: Date.now() })

  return data
}

/**
 * Fetch chains from both mainnet and testnet environments
 */
export async function fetchAllChains(search?: string): Promise<ChainsAPIResponse[]> {
  const results = await Promise.all([
    fetchChains('mainnet', search),
    fetchChains('testnet', search),
  ])
  return results
}

/**
 * Fetch chains with optional environment filter
 */
export async function fetchChainsWithFilter(
  environment?: Environment,
  search?: string,
): Promise<ChainsAPIResponse[]> {
  if (environment) {
    const result = await fetchChains(environment, search)
    return [result]
  }
  return fetchAllChains(search)
}

/**
 * Flatten API responses into a flat array of ChainInfo
 * Uses SDK's networkInfo for consistent family values
 */
export function getAllChainsFlat(responses: ChainsAPIResponse[]): ChainInfo[] {
  const chains: ChainInfo[] = []

  for (const response of responses) {
    const apiEnvironment = response.metadata.environment

    for (const familyChains of Object.values(response.data)) {
      for (const details of Object.values(familyChains)) {
        // Use SDK's networkInfo for consistent name and family
        let name = details.internalId
        let family: ChainFamily = details.chainFamily.toUpperCase() as ChainFamily
        let environment: Environment = apiEnvironment

        try {
          const info = networkInfo(BigInt(details.selector))
          name = info.name
          family = info.family
          environment = info.networkType === NetworkTypeEnum.Testnet ? 'testnet' : 'mainnet'
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
 * Clear the cache (useful for testing or forced refresh)
 */
export function clearCache(): void {
  cache.clear()
}
