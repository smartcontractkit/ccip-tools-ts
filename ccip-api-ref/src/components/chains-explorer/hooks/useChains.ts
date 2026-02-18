/**
 * useChains - Fetches and manages chain data
 */

import { useCallback, useEffect, useState } from 'react'

import {
  type Environment,
  fetchChainsWithFilter,
  getAllChainsFlat,
} from '../../../services/chains-api.ts'
import type { ChainInfo } from '../types.ts'

/** Options for useChains hook. */
export interface UseChainsOptions {
  /** Environment filter */
  environment?: Environment
  /** Search term */
  search?: string
  /** Auto-fetch on mount */
  fetchOnMount?: boolean
}

/** Result from useChains hook. */
export interface UseChainsResult {
  /** Chain data */
  chains: ChainInfo[]
  /** Loading state */
  isLoading: boolean
  /** Error state */
  error: Error | null
  /** Refetch with new params */
  refetch: (environment?: Environment, search?: string) => Promise<void>
}

/** Hook for fetching and managing chain data. */
export function useChains(options: UseChainsOptions = {}): UseChainsResult {
  const { environment, search, fetchOnMount = true } = options

  const [chains, setChains] = useState<ChainInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async (env?: Environment, searchTerm?: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const responses = await fetchChainsWithFilter(env, searchTerm)
      const flatChains = getAllChainsFlat(responses)
      setChains(flatChains)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch chains'))
      setChains([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (fetchOnMount) {
      void refetch(environment, search)
    }
  }, []) // Only on mount

  return {
    chains,
    isLoading,
    error,
    refetch,
  }
}
