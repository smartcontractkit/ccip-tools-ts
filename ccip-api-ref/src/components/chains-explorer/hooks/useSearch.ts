/**
 * useSearch - Search input with debounce
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Options for useSearch hook. */
export interface UseSearchOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number
  /** Initial value */
  initialValue?: string
  /** Callback when search value changes (after debounce) */
  onSearch?: (value: string) => void
}

/** Result from useSearch hook. */
export interface UseSearchResult {
  /** Current input value */
  value: string
  /** Debounced value (for API calls) */
  debouncedValue: string
  /** Whether debounce is pending */
  isPending: boolean
  /** Handle input change */
  onChange: (value: string) => void
  /** Clear search */
  clear: () => void
}

/** Hook for debounced search input. */
export function useSearch(options: UseSearchOptions = {}): UseSearchResult {
  const { debounceMs = 300, initialValue = '', onSearch } = options

  const [value, setValue] = useState(initialValue)
  const [debouncedValue, setDebouncedValue] = useState(initialValue)
  const [isPending, setIsPending] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onChange = useCallback(
    (newValue: string) => {
      setValue(newValue)
      setIsPending(true)

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = setTimeout(() => {
        setDebouncedValue(newValue)
        setIsPending(false)
        onSearch?.(newValue)
      }, debounceMs)
    },
    [debounceMs, onSearch],
  )

  const clear = useCallback(() => {
    setValue('')
    setDebouncedValue('')
    setIsPending(false)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    onSearch?.('')
  }, [onSearch])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return {
    value,
    debouncedValue,
    isPending,
    onChange,
    clear,
  }
}
