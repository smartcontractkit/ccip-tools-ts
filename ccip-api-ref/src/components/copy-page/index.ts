/**
 * Copy Page Component
 *
 * Public exports for the Copy Page button feature.
 */

// Components
export { CopyPageButton } from './CopyPageButton.tsx'
export { MarkdownPreviewModal } from './MarkdownPreviewModal.tsx'
export { CopyPageErrorBoundary, ErrorBoundary } from './ErrorBoundary.tsx'

// Utilities
export { copyToClipboard, extractPageContent } from './contentExtractor.ts'

// Hooks
export { useClickOutside, useClipboard, useKeyPress } from './hooks/index.ts'
export type { UseClipboardOptions, UseClipboardReturn } from './hooks/index.ts'

// Constants
export {
  AI_ASSISTANTS,
  DEFAULT_EXTRACTION_CONFIG,
  TIMING,
  UI_TEXT,
  buildAIUrl,
  generateAIPrompt,
} from './constants.ts'

// Types
export type {
  CopyAction,
  CopyPageButtonProps,
  ExtractedContent,
  ExtractionConfig,
  MarkdownPreviewModalProps,
} from './types.ts'
