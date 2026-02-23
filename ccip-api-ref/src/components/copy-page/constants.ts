/**
 * Copy Page Constants
 *
 * Centralized configuration for the Copy Page feature.
 * All configurable values should be defined here for easy maintenance.
 */

import type { ExtractionConfig } from './types.ts'

/**
 * Default extraction configuration for Docusaurus pages
 */
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  selectorsToRemove: [
    // Navigation and UI elements
    'nav',
    '.breadcrumbs',
    '.pagination-nav',

    // Interactive elements
    'button',
    '.clean-btn',
    '.copyButtonCopied',
    '[class*="copyButton"]',

    // Sidebars
    '.theme-doc-sidebar-container',
    '.table-of-contents',
    '.col--3',
    '[class*="tocCollapsible"]',

    // Footer and metadata
    'footer',
    '.theme-doc-footer',
    '[class*="docFooter"]',

    // Edit and version
    '.theme-edit-this-page',
    '[class*="lastUpdated"]',

    // Scripts and styles
    'script',
    'style',

    // Docusaurus-specific elements
    '[class*="codeBlockTitle"]',
    '.prism-code + button',

    // Copy page button itself (avoid recursion)
    '[class*="copyPage"]',
    '[class*="CopyPage"]',
  ],
  contentSelector: 'article, .theme-doc-markdown, [class*="docItemContainer"] main',
  includeFrontmatter: true,
}

/**
 * AI assistant configurations
 */
export const AI_ASSISTANTS = {
  chatgpt: {
    name: 'ChatGPT',
    baseUrl: 'https://chatgpt.com/',
    promptParam: 'prompt',
  },
  claude: {
    name: 'Claude',
    baseUrl: 'https://claude.ai/new',
    promptParam: 'q',
  },
} as const

/**
 * Generates the instruction prompt for AI assistants
 */
export function generateAIPrompt(pageUrl: string): string {
  return `I'm analyzing a CCIP Tools documentation page: ${pageUrl}

I have the full page content on my clipboard as plain text (Markdown).
The CCIP Tools docs site already copied it for me.

Please ask me to paste it now. After I paste, please:
- Explain the contents clearly
- Answer any questions I have about CCIP (Cross-Chain Interoperability Protocol)
- Help me understand how to implement the features described`
}

/**
 * Builds the AI assistant URL with the prompt
 */
export function buildAIUrl(assistant: keyof typeof AI_ASSISTANTS, pageUrl: string): string {
  const config = AI_ASSISTANTS[assistant]
  const prompt = generateAIPrompt(pageUrl)
  return `${config.baseUrl}?${config.promptParam}=${encodeURIComponent(prompt)}`
}

/**
 * Timing constants
 */
export const TIMING = {
  /** Duration to show "Copied!" feedback in milliseconds */
  copyFeedbackDuration: 2000,
  /** Animation duration for dropdown in milliseconds */
  dropdownAnimationDuration: 150,
} as const

/**
 * UI text strings (for potential i18n support)
 */
export const UI_TEXT = {
  button: {
    default: 'Copy page',
    copied: 'Copied!',
    loading: 'Extracting...',
  },
  dropdown: {
    copy: {
      title: 'Copy page',
      description: 'Copy the page as Markdown',
    },
    preview: {
      title: 'View as Markdown',
      description: 'Preview page as plain text',
    },
    chatgpt: {
      title: 'Open in ChatGPT',
      description: 'Ask questions about this page',
    },
    claude: {
      title: 'Open in Claude',
      description: 'Ask questions about this page',
    },
  },
  errors: {
    extractionFailed: 'Failed to extract page content. Please try again.',
    copyFailed: 'Failed to copy page content. Please try again.',
  },
} as const
