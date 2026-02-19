/**
 * useFilters - Filter state management with URL sync
 */

import type { ChainFamily } from '@chainlink/ccip-sdk'
import { useCallback, useEffect, useState } from 'react'

import { type ChainFilters, DEFAULT_FILTERS } from '../types.ts'

/** Options for useFilters hook. */
export interface UseFiltersOptions {
  /** Initial filter values */
  initialFilters?: Partial<ChainFilters>
  /** Sync filters to URL */
  syncToUrl?: boolean
  /** Callback when filters change */
  onFiltersChange?: (filters: ChainFilters) => void
}

/** Result from useFilters hook. */
export interface UseFiltersResult {
  /** Current filter values */
  filters: ChainFilters
  /** Update a single filter */
  setFilter: <K extends keyof ChainFilters>(key: K, value: ChainFilters[K]) => void
  /** Reset all filters to defaults */
  resetFilters: () => void
  /** Check if any filter is active */
  hasActiveFilters: boolean
}

/**
 * Parse filters from URL search params
 */
function parseFiltersFromUrl(): Partial<ChainFilters> {
  if (typeof window === 'undefined') return {}

  const params = new URLSearchParams(window.location.search)
  const filters: Partial<ChainFilters> = {}

  const family = params.get('family')
  if (family) {
    filters.family = family as ChainFamily | 'all'
  }

  const environment = params.get('environment')
  if (environment === 'mainnet' || environment === 'testnet') {
    filters.environment = environment
  }

  const search = params.get('search')
  if (search) {
    filters.search = search
  }

  return filters
}

/**
 * Update URL search params with filters
 */
function updateUrlWithFilters(filters: ChainFilters): void {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams()

  if (filters.family !== 'all') {
    params.set('family', filters.family)
  }
  if (filters.environment !== 'all') {
    params.set('environment', filters.environment)
  }
  if (filters.search) {
    params.set('search', filters.search)
  }

  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname

  window.history.replaceState({}, '', newUrl)
}

/** Hook for managing filter state with URL sync. */
export function useFilters(options: UseFiltersOptions = {}): UseFiltersResult {
  const { initialFilters = {}, syncToUrl = true, onFiltersChange } = options

  // Initialize from URL if syncing, otherwise use provided initial values
  const [filters, setFilters] = useState<ChainFilters>(() => {
    const urlFilters = syncToUrl ? parseFiltersFromUrl() : {}
    return {
      ...DEFAULT_FILTERS,
      ...initialFilters,
      ...urlFilters,
    }
  })

  const setFilter = useCallback(
    <K extends keyof ChainFilters>(key: K, value: ChainFilters[K]) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value }
        if (syncToUrl) {
          updateUrlWithFilters(next)
        }
        onFiltersChange?.(next)
        return next
      })
    },
    [syncToUrl, onFiltersChange],
  )

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    if (syncToUrl) {
      updateUrlWithFilters(DEFAULT_FILTERS)
    }
    onFiltersChange?.(DEFAULT_FILTERS)
  }, [syncToUrl, onFiltersChange])

  const hasActiveFilters =
    filters.family !== 'all' || filters.environment !== 'all' || filters.search !== ''

  // Sync URL changes (e.g., back/forward navigation)
  useEffect(() => {
    if (!syncToUrl || typeof window === 'undefined') return

    const handlePopState = () => {
      const urlFilters = parseFiltersFromUrl()
      setFilters({
        ...DEFAULT_FILTERS,
        ...urlFilters,
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [syncToUrl])

  return {
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters,
  }
}
