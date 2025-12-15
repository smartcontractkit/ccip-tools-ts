/**
 * Copy Page Component Types
 *
 * Type definitions for the Copy Page button feature.
 */

/** Available copy actions */
export type CopyAction = 'copy' | 'preview' | 'chatgpt' | 'claude'

/** Props for the CopyPageButton component */
export interface CopyPageButtonProps {
  /** Additional CSS class name */
  className?: string
}

/** Props for the MarkdownPreviewModal component */
export interface MarkdownPreviewModalProps {
  /** Markdown content to display */
  markdown: string
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback to close the modal */
  onClose: () => void
  /** Page title for the modal header */
  title: string
}

/** Extracted content from the page */
export interface ExtractedContent {
  /** Markdown representation of the page */
  markdown: string
  /** Page title */
  title: string
  /** Current page URL */
  url: string
  /** Extraction timestamp */
  timestamp: Date
}

/** Configuration for content extraction */
export interface ExtractionConfig {
  /** CSS selectors for elements to remove before extraction */
  selectorsToRemove: string[]
  /** CSS selector for the main content container */
  contentSelector: string
  /** Whether to include frontmatter in output */
  includeFrontmatter: boolean
}

/** Dropdown menu item configuration */
export interface DropdownItem {
  /** Action identifier */
  action: CopyAction
  /** Icon component or SVG */
  icon: React.ReactNode
  /** Display title */
  title: string
  /** Description text */
  description: string
}
