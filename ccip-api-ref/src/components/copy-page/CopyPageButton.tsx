/**
 * CopyPageButton
 *
 * Dropdown button component for copying page content as markdown,
 * previewing it, or opening in AI assistants.
 */

import { useCallback, useRef, useState } from 'react'

import styles from './CopyPageButton.module.css'
import { MarkdownPreviewModal } from './MarkdownPreviewModal.tsx'
import { TIMING, UI_TEXT, buildAIUrl } from './constants.ts'
import { copyToClipboard, extractPageContent } from './contentExtractor.ts'
import { useClickOutside, useKeyPress } from './hooks/index.ts'
import type { CopyAction, CopyPageButtonProps } from './types.ts'

export function CopyPageButton({ className }: CopyPageButtonProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [extractedMarkdown, setExtractedMarkdown] = useState('')
  const [pageTitle, setPageTitle] = useState('')
  const [copiedAction, setCopiedAction] = useState<CopyAction | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close dropdown when clicking outside
  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false)
  }, [])

  useClickOutside([dropdownRef, buttonRef], closeDropdown, isDropdownOpen)

  // Close dropdown on ESC and focus button
  useKeyPress('Escape', {
    onDown: useCallback(() => {
      if (isDropdownOpen) {
        setIsDropdownOpen(false)
        buttonRef.current?.focus()
      }
    }, [isDropdownOpen]),
  })

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen)
  }

  const handleAction = async (action: CopyAction) => {
    setIsDropdownOpen(false)
    setIsLoading(true)

    try {
      // Extract page content (async for OpenAPI pages)
      const content = await extractPageContent()

      if (!content) {
        alert(UI_TEXT.errors.extractionFailed)
        return
      }

      const { markdown, title } = content
      setExtractedMarkdown(markdown)
      setPageTitle(title)

      switch (action) {
        case 'copy':
          await copyToClipboard(markdown)
          showCopyFeedback('copy')
          break

        case 'preview':
          setIsModalOpen(true)
          break

        case 'chatgpt':
        case 'claude': {
          // Copy markdown to clipboard first
          await copyToClipboard(markdown)

          // Open AI assistant with the prompt
          const aiUrl = buildAIUrl(action, window.location.href)
          window.open(aiUrl, '_blank', 'noopener,noreferrer')
          break
        }
      }
    } catch (error) {
      console.error(`[CopyPage] Error handling action ${action}:`, error)
      alert(UI_TEXT.errors.copyFailed)
    } finally {
      setIsLoading(false)
    }
  }

  const showCopyFeedback = (action: CopyAction) => {
    setCopiedAction(action)
    setTimeout(() => setCopiedAction(null), TIMING.copyFeedbackDuration)
  }

  const getButtonText = (): string => {
    if (isLoading) return UI_TEXT.button.loading
    if (copiedAction === 'copy') return UI_TEXT.button.copied
    return UI_TEXT.button.default
  }

  const closeModal = () => {
    setIsModalOpen(false)
  }

  return (
    <>
      <div className={`${styles.container} ${className || ''}`}>
        <button
          ref={buttonRef}
          className={`${styles.trigger} ${isLoading ? styles.loading : ''}`}
          onClick={toggleDropdown}
          disabled={isLoading}
          aria-expanded={isDropdownOpen}
          aria-haspopup="true"
          aria-label="Copy page content options"
          type="button"
        >
          {isLoading ? (
            <LoadingSpinner className={styles.triggerIcon} />
          ) : (
            <ClipboardIcon className={styles.triggerIcon} />
          )}
          <span className={styles.triggerText}>{getButtonText()}</span>
          <ChevronIcon className={`${styles.arrow} ${isDropdownOpen ? styles.arrowOpen : ''}`} />
        </button>

        {isDropdownOpen && (
          <div ref={dropdownRef} className={styles.dropdown} role="menu">
            <div className={styles.dropdownContent}>
              <button
                className={styles.dropdownItem}
                onClick={() => void handleAction('copy')}
                role="menuitem"
                type="button"
              >
                <ClipboardIcon className={styles.itemIcon} />
                <div className={styles.itemContent}>
                  <div className={styles.itemTitle}>{UI_TEXT.dropdown.copy.title}</div>
                  <div className={styles.itemDescription}>{UI_TEXT.dropdown.copy.description}</div>
                </div>
              </button>

              <button
                className={styles.dropdownItem}
                onClick={() => void handleAction('preview')}
                role="menuitem"
                type="button"
              >
                <EyeIcon className={styles.itemIcon} />
                <div className={styles.itemContent}>
                  <div className={styles.itemTitle}>{UI_TEXT.dropdown.preview.title}</div>
                  <div className={styles.itemDescription}>
                    {UI_TEXT.dropdown.preview.description}
                  </div>
                </div>
              </button>

              {/* Divider between copy actions and AI actions */}
              <div className={styles.divider} role="separator" aria-hidden="true" />

              <button
                className={styles.dropdownItem}
                onClick={() => void handleAction('chatgpt')}
                role="menuitem"
                type="button"
              >
                <ChatGPTIcon className={styles.itemIcon} />
                <div className={styles.itemContent}>
                  <div className={styles.itemTitle}>{UI_TEXT.dropdown.chatgpt.title}</div>
                  <div className={styles.itemDescription}>
                    {UI_TEXT.dropdown.chatgpt.description}
                  </div>
                </div>
              </button>

              <button
                className={styles.dropdownItem}
                onClick={() => void handleAction('claude')}
                role="menuitem"
                type="button"
              >
                <ClaudeIcon className={styles.itemIcon} />
                <div className={styles.itemContent}>
                  <div className={styles.itemTitle}>{UI_TEXT.dropdown.claude.title}</div>
                  <div className={styles.itemDescription}>
                    {UI_TEXT.dropdown.claude.description}
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      <MarkdownPreviewModal
        markdown={extractedMarkdown}
        isOpen={isModalOpen}
        onClose={closeModal}
        title={pageTitle}
      />
    </>
  )
}

// Icons
function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <path d="M8 5a2 2 0 002 2h2a2 2 0 002-2 2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2.5 4.5L6 8L9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function ChatGPTIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="-0.17 0.48 41.14 40.03"
      fill="currentColor"
    >
      <path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835A9.964 9.964 0 0 0 18.306.5a10.079 10.079 0 0 0-9.614 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 7.516 3.35 10.078 10.078 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813zM22.498 37.886a7.474 7.474 0 0 1-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 0 0 .655-1.134V19.054l3.366 1.944a.12.12 0 0 1 .066.092v9.299a7.505 7.505 0 0 1-7.49 7.496zM6.392 31.006a7.471 7.471 0 0 1-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 0 0 1.308 0l9.724-5.614v3.888a.12.12 0 0 1-.048.103l-8.051 4.649a7.504 7.504 0 0 1-10.24-2.744zM4.297 13.62A7.469 7.469 0 0 1 8.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 0 0 .654 1.132l9.723 5.614-3.366 1.944a.12.12 0 0 1-.114.01L7.04 23.856a7.504 7.504 0 0 1-2.743-10.237zm27.658 6.437l-9.724-5.615 3.367-1.943a.121.121 0 0 1 .113-.01l8.052 4.648a7.498 7.498 0 0 1-1.158 13.528v-9.476a1.293 1.293 0 0 0-.65-1.132zm3.35-5.043c-.059-.037-.162-.099-.236-.141l-7.965-4.6a1.298 1.298 0 0 0-1.308 0l-9.723 5.614v-3.888a.12.12 0 0 1 .048-.103l8.05-4.645a7.497 7.497 0 0 1 11.135 7.763zm-21.063 6.929l-3.367-1.944a.12.12 0 0 1-.065-.092v-9.299a7.497 7.497 0 0 1 12.293-5.756 6.94 6.94 0 0 0-.236.134l-7.965 4.6a1.294 1.294 0 0 0-.654 1.132l-.006 11.225zm1.829-3.943l4.33-2.501 4.332 2.5v5l-4.331 2.5-4.331-2.5V18z" />
    </svg>
  )
}

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
    >
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  )
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  )
}
