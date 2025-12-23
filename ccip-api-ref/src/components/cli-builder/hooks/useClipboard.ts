/**
 * useClipboard - Copy to clipboard hook
 */

import { useCallback, useState } from 'react'

interface UseClipboardResult {
  /** Whether content was recently copied */
  copied: boolean
  /** Copy text to clipboard */
  copy: (text: string) => Promise<void>
}

/**
 * Hook for copying text to clipboard with feedback
 * @param resetDelay - Time in ms before copied state resets (default: 2000)
 */
export function useClipboard(resetDelay = 2000): UseClipboardResult {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), resetDelay)
      } catch (_error) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        setTimeout(() => setCopied(false), resetDelay)
      }
    },
    [resetDelay],
  )

  return { copied, copy }
}
