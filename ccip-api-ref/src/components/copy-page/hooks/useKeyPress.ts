/**
 * useKeyPress - Keyboard event handling hook
 *
 * Listens for specific key presses and triggers callbacks.
 */

import { useCallback, useEffect, useState } from 'react'

interface UseKeyPressParams {
  /** Callback when key is pressed down */
  onDown?: () => void
  /** Callback when key is released */
  onUp?: () => void
}

/**
 * Hook for detecting keyboard key presses
 *
 * @param targetKey - The key to listen for (e.g., 'Escape', 'Enter')
 * @param params - Optional callbacks for key down/up events
 * @returns Whether the key is currently pressed
 *
 * @example
 * ```tsx
 * // Close modal on ESC
 * useKeyPress('Escape', { onDown: () => setIsOpen(false) })
 *
 * // Track if Enter is held
 * const isEnterPressed = useKeyPress('Enter')
 * ```
 */
export function useKeyPress(targetKey: string, params?: UseKeyPressParams): boolean {
  const [keyPressed, setKeyPressed] = useState(false)

  const downHandler = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === targetKey) {
        setKeyPressed(true)
        params?.onDown?.()
      }
    },
    [targetKey, params],
  )

  const upHandler = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === targetKey) {
        setKeyPressed(false)
        params?.onUp?.()
      }
    },
    [targetKey, params],
  )

  useEffect(() => {
    window.addEventListener('keydown', downHandler)
    window.addEventListener('keyup', upHandler)

    return () => {
      window.removeEventListener('keydown', downHandler)
      window.removeEventListener('keyup', upHandler)
    }
  }, [downHandler, upHandler])

  return keyPressed
}
