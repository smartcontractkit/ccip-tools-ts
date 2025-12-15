/**
 * useClipboard - Clipboard operations hook
 *
 * Provides clipboard copy functionality with success/error state management.
 */

import { useCallback, useState } from 'react'

import { TIMING } from '../constants.ts'

/** Options for the useClipboard hook */
export interface UseClipboardOptions {
  /** Duration to show success feedback in milliseconds */
  feedbackDuration?: number
  /** Callback on successful copy */
  onSuccess?: () => void
  /** Callback on copy error */
  onError?: (error: Error) => void
}

/** Return type for the useClipboard hook */
export interface UseClipboardReturn {
  /** Whether content was recently copied successfully */
  copied: boolean
  /** Whether a copy operation is in progress */
  isLoading: boolean
  /** Any error from the last copy attempt */
  error: Error | null
  /** Function to copy text to clipboard */
  copy: (text: string) => Promise<boolean>
  /** Reset the copied state */
  reset: () => void
}

/**
 * Hook for clipboard operations with state management
 *
 * @param options - Configuration options
 * @returns Clipboard state and copy function
 *
 * @example
 * ```tsx
 * const { copied, copy, isLoading } = useClipboard({
 *   onSuccess: () => console.log('Copied!'),
 * })
 *
 * return (
 *   <button onClick={() => copy(text)} disabled={isLoading}>
 *     {copied ? 'Copied!' : 'Copy'}
 *   </button>
 * )
 * ```
 */
export function useClipboard(options: UseClipboardOptions = {}): UseClipboardReturn {
  const { feedbackDuration = TIMING.copyFeedbackDuration, onSuccess, onError } = options

  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reset = useCallback(() => {
    setCopied(false)
    setError(null)
  }, [])

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      setIsLoading(true)
      setError(null)

      try {
        // Check for modern Clipboard API (not available in older browsers)
        if ('clipboard' in navigator && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
        } else {
          // Fallback for older browsers
          const textArea = document.createElement('textarea')
          textArea.value = text
          textArea.style.position = 'fixed'
          textArea.style.left = '-999999px'
          textArea.style.top = '-999999px'
          document.body.appendChild(textArea)
          textArea.focus()
          textArea.select()
          document.execCommand('copy')
          document.body.removeChild(textArea)
        }

        setCopied(true)
        onSuccess?.()

        // Reset copied state after feedback duration
        setTimeout(() => {
          setCopied(false)
        }, feedbackDuration)

        return true
      } catch (err) {
        const copyError = err instanceof Error ? err : new Error('Failed to copy to clipboard')
        setError(copyError)
        onError?.(copyError)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [feedbackDuration, onSuccess, onError],
  )

  return {
    copied,
    isLoading,
    error,
    copy,
    reset,
  }
}
