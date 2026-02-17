/**
 * MarkdownPreviewModal
 *
 * Modal component for previewing extracted markdown content.
 */

import { FocusTrap } from 'focus-trap-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './MarkdownPreviewModal.module.css'
import { copyToClipboard } from './contentExtractor.ts'
import { useKeyPress } from './hooks/useKeyPress.ts'
import type { MarkdownPreviewModalProps } from './types.ts'

export function MarkdownPreviewModal({
  markdown,
  isOpen,
  onClose,
  title,
}: MarkdownPreviewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  const [isCopied, setIsCopied] = useState(false)

  // Close on ESC key
  useKeyPress('Escape', { onDown: onClose })

  useEffect(() => {
    if (!isOpen) return

    // Store the previously focused element
    previousActiveElement.current = document.activeElement as HTMLElement

    // Focus the modal
    modalRef.current?.focus()

    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = ''

      // Restore focus to the previous element
      previousActiveElement.current?.focus()
    }
  }, [isOpen])

  const handleCopyClick = async () => {
    try {
      await copyToClipboard(markdown)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (error) {
      console.error('[CopyPage] Failed to copy markdown:', error)
      alert('Failed to copy to clipboard. Please try again.')
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null
  if (typeof document === 'undefined') return null // SSR safety

  return createPortal(
    <FocusTrap>
      <div className={styles.backdrop} onClick={handleBackdropClick}>
        <div
          ref={modalRef}
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="copy-page-modal-title"
          aria-describedby="copy-page-modal-description"
          tabIndex={-1}
        >
          <div className={styles.header}>
            <h2 id="copy-page-modal-title" className={styles.title}>
              {title || 'Markdown Preview'}
            </h2>
            <button
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close modal"
              type="button"
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.content}>
            <div id="copy-page-modal-description" className={styles.srOnly}>
              Preview of extracted markdown content. You can copy this content or close the preview.
            </div>
            <pre className={styles.markdown}>
              <code>{markdown}</code>
            </pre>
          </div>

          <div className={styles.footer}>
            <button
              className={styles.copyButton}
              onClick={() => void handleCopyClick()}
              type="button"
            >
              {isCopied ? (
                <>
                  <CheckIcon />
                  Copied!
                </>
              ) : (
                <>
                  <CopyIcon />
                  Copy
                </>
              )}
            </button>
            <button className={styles.cancelButton} onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>,
    document.body,
  )
}

// Icons
function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
