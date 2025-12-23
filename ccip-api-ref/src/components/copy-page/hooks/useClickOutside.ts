/**
 * useClickOutside - Click outside detection hook
 *
 * Detects clicks outside of specified elements and triggers a callback.
 * Useful for closing dropdowns, modals, and other overlay components.
 */

import { type RefObject, useCallback, useEffect } from 'react'

/**
 * Hook for detecting clicks outside of specified elements
 *
 * @param refs - Array of refs to elements that should be considered "inside"
 * @param handler - Callback function to execute when clicking outside
 * @param enabled - Whether the listener is active (default: true)
 *
 * @example
 * ```tsx
 * const dropdownRef = useRef<HTMLDivElement>(null)
 * const buttonRef = useRef<HTMLButtonElement>(null)
 *
 * useClickOutside([dropdownRef, buttonRef], () => {
 *   setIsOpen(false)
 * }, isOpen)
 * ```
 */
export function useClickOutside(
  refs: RefObject<HTMLElement | null>[],
  handler: () => void,
  enabled: boolean = true,
): void {
  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      // Check if click is outside all provided refs
      const isOutside = refs.every((ref) => {
        return ref.current && !ref.current.contains(event.target as Node)
      })

      if (isOutside) {
        handler()
      }
    },
    [refs, handler],
  )

  useEffect(() => {
    if (!enabled) return

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [enabled, handleClickOutside])
}
