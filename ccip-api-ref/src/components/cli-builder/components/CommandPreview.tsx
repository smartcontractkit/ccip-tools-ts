/**
 * CommandPreview - Display generated CLI command with copy functionality
 *
 * Shows the generated command string with syntax highlighting
 * and a copy-to-clipboard button with feedback.
 */

import { useMemo } from 'react'

import styles from './CLIBuilder.module.css'
import { useClipboard } from '../hooks/index.ts'
import { formatCommandForDisplay } from '../utils/index.ts'

export interface CommandPreviewProps {
  /** The generated command string */
  command: string
  /** Whether to show line breaks for long commands */
  formatForDisplay?: boolean
  /** Maximum line length before breaking (if formatForDisplay is true) */
  maxLineLength?: number
}

/**
 * Command preview with copy button
 *
 * @example
 * ```tsx
 * <CommandPreview
 *   command="ccip-cli send ethereum-testnet-sepolia 0x... --receiver 0x..."
 *   formatForDisplay
 * />
 * ```
 */
export function CommandPreview({
  command,
  formatForDisplay = true,
  maxLineLength = 80,
}: CommandPreviewProps) {
  const { copied, copy } = useClipboard(2000)

  const displayCommand = useMemo(() => {
    if (formatForDisplay) {
      return formatCommandForDisplay(command, maxLineLength)
    }
    return command
  }, [command, formatForDisplay, maxLineLength])

  const handleCopy = () => {
    // Always copy the original (non-formatted) command
    void copy(command)
  }

  return (
    <div className={styles.commandPreview}>
      <div className={styles.commandHeader}>
        <span className={styles.commandLabel}>Generated Command</span>
        <button
          type="button"
          onClick={handleCopy}
          className={styles.copyButton}
          aria-label={copied ? 'Copied!' : 'Copy command to clipboard'}
        >
          {copied ? (
            <>
              <CheckIcon />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <CopyIcon />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className={styles.commandCode}>
        <code>{displayCommand}</code>
      </pre>
    </div>
  )
}

/**
 * Copy icon SVG
 */
function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/**
 * Check icon SVG
 */
function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
