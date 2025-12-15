/**
 * Content Extractor
 *
 * Extracts page content from Docusaurus DOM and converts to Markdown.
 * For OpenAPI pages, uses the OpenAPI spec directly for cleaner output.
 */

import { DEFAULT_EXTRACTION_CONFIG } from './constants.ts'
import { extractOpenApiContent, isOpenApiPage } from './openApiExtractor.ts'
import type { ExtractedContent, ExtractionConfig } from './types.ts'

/**
 * Extracts the main content from the current page
 *
 * @param config - Partial extraction configuration to override defaults
 * @returns The extracted content or null if extraction fails
 */
export async function extractPageContent(
  config: Partial<ExtractionConfig> = {},
): Promise<ExtractedContent | null> {
  // Check if this is an OpenAPI page - use spec-based extraction for cleaner output
  if (isOpenApiPage()) {
    console.log('[CopyPage] Detected OpenAPI page, using spec-based extraction')
    const openApiContent = await extractOpenApiContent()
    if (openApiContent) {
      return openApiContent
    }
    // Fall back to HTML extraction if OpenAPI extraction fails
    console.log('[CopyPage] OpenAPI extraction failed, falling back to HTML extraction')
  }

  return extractPageContentFromHtml(config)
}

/**
 * Extracts content using HTML/DOM parsing (for non-OpenAPI pages)
 */
function extractPageContentFromHtml(
  config: Partial<ExtractionConfig> = {},
): ExtractedContent | null {
  const fullConfig = { ...DEFAULT_EXTRACTION_CONFIG, ...config }

  try {
    // Find the main content element
    const mainContent = document.querySelector(fullConfig.contentSelector)
    if (!mainContent) {
      console.error('[CopyPage] Could not find main content element')
      return null
    }

    // Clone the content to avoid modifying the page
    const contentClone = mainContent.cloneNode(true) as HTMLElement

    // Remove unwanted elements
    fullConfig.selectorsToRemove.forEach((selector) => {
      const elements = contentClone.querySelectorAll(selector)
      elements.forEach((el) => el.remove())
    })

    // Get page title
    const title = getPageTitle()

    // Convert to markdown
    const markdown = convertToMarkdown(contentClone)

    // Add frontmatter if enabled
    const finalMarkdown = fullConfig.includeFrontmatter
      ? addFrontmatter({ markdown, title, url: window.location.href })
      : markdown

    return {
      markdown: finalMarkdown,
      title,
      url: window.location.href,
      timestamp: new Date(),
    }
  } catch (error) {
    console.error('[CopyPage] Error extracting page content:', error)
    return null
  }
}

/**
 * Gets the page title from various possible sources
 */
function getPageTitle(): string {
  // Try h1 heading first (most accurate for docs)
  const h1 = document.querySelector('article h1, .theme-doc-markdown h1, main h1')
  if (h1?.textContent) {
    return cleanText(h1.textContent)
  }

  // Try document title
  if (document.title) {
    // Remove site name suffix (e.g., " | CCIP Tools")
    return document.title.replace(/\s*[|–-]\s*.*$/, '').trim()
  }

  // Try meta og:title
  const ogTitle = document.querySelector('meta[property="og:title"]')
  const ogTitleContent = ogTitle?.getAttribute('content')
  if (ogTitleContent) {
    return ogTitleContent.trim()
  }

  return 'Documentation Page'
}

/**
 * Converts HTML element to Markdown
 */
function convertToMarkdown(element: HTMLElement, preserveInlineSpacing = false): string {
  let markdown = ''

  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        markdown += cleanText(text)
        // Add space after text if not followed by newline or at end
        if (preserveInlineSpacing) {
          markdown += ' '
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      markdown += convertElementToMarkdown(el)
    }
  })

  // Clean up: normalize multiple spaces and newlines
  return markdown
    .replace(/[ \t]+/g, ' ') // Normalize multiple spaces/tabs to single space
    .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines to 2
    .replace(/ +\n/g, '\n') // Remove trailing spaces before newlines
    .replace(/\n +/g, '\n') // Remove leading spaces after newlines (except indentation)
    .trim()
}

/**
 * Converts a single HTML element to Markdown based on its tag
 */
function convertElementToMarkdown(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role')

  // Check for ARIA roles first (OpenAPI plugin uses these)
  if (role === 'list') {
    return convertAriaListToMarkdown(el)
  }

  if (role === 'listitem') {
    // Process as a list item container
    return convertToMarkdown(el, true)
  }

  // Check for Docusaurus-specific components first
  if (el.classList.contains('tabs') || role === 'tablist') {
    return convertTabsToMarkdown(el)
  }

  // Skip ALL tabpanels - they are processed via their associated tablist
  // This prevents duplicate content extraction
  if (role === 'tabpanel') {
    return ''
  }

  if (el.classList.contains('admonition') || el.classList.contains('alert')) {
    return convertAdmonitionToMarkdown(el)
  }

  // Handle OpenAPI fieldset/group structures
  if (tag === 'fieldset' || el.classList.contains('openapi-explorer__form-item')) {
    return convertOpenApiFieldToMarkdown(el)
  }

  switch (tag) {
    case 'h1':
      return formatHeading(1, cleanText(el.textContent || ''))
    case 'h2':
      return formatHeading(2, cleanText(el.textContent || ''))
    case 'h3':
      return formatHeading(3, cleanText(el.textContent || ''))
    case 'h4':
      return formatHeading(4, cleanText(el.textContent || ''))
    case 'h5':
      return formatHeading(5, cleanText(el.textContent || ''))
    case 'h6':
      return formatHeading(6, cleanText(el.textContent || ''))

    case 'p':
      return `\n${convertToMarkdown(el, true)}\n\n`

    case 'a': {
      const href = el.getAttribute('href') || ''
      const text = cleanText(el.textContent || '')
      if (!text) return ''
      const fullUrl = resolveUrl(href)
      return `[${text}](${fullUrl})`
    }

    case 'strong':
    case 'b':
      return `**${cleanText(el.textContent || '')}**`

    case 'em':
    case 'i':
      return `*${cleanText(el.textContent || '')}*`

    case 'code':
      // Inline code (not inside pre)
      if (el.parentElement?.tagName !== 'PRE') {
        return `\`${el.textContent || ''}\``
      }
      // Block code - handled by pre tag
      return el.textContent || ''

    case 'pre': {
      const code = el.querySelector('code')
      const language = extractLanguage(code || el)
      // Extract code preserving line breaks from individual line spans
      const codeText = extractCodeContent(code || el)
      return formatCodeBlock(codeText, language)
    }

    case 'ul':
    case 'ol': {
      // Get list items - try <li> first, then any direct children (OpenAPI uses <div> in <ul>)
      let listChildren = Array.from(el.children).filter(
        (child) => child.tagName.toLowerCase() === 'li',
      )

      // If no <li> found, use all direct children (OpenAPI pattern)
      if (listChildren.length === 0) {
        listChildren = Array.from(el.children)
      }

      const items = listChildren
        .map((item, index) => {
          const bullet = tag === 'ul' ? '-' : `${index + 1}.`
          const content = convertToMarkdown(item as HTMLElement, true).trim()
          return content ? `${bullet} ${content}` : ''
        })
        .filter(Boolean)
        .join('\n')
      return items ? `\n${items}\n\n` : ''
    }

    case 'li':
      return convertToMarkdown(el, true)

    case 'blockquote':
      return formatBlockquote(convertToMarkdown(el))

    case 'table':
      return convertTableToMarkdown(el)

    case 'img': {
      const src = el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || ''
      const fullSrc = resolveUrl(src)
      return `![${alt}](${fullSrc})\n\n`
    }

    case 'hr':
      return '\n---\n\n'

    case 'br':
      return '\n'

    case 'div':
    case 'section':
    case 'article':
    case 'aside':
    case 'details':
    case 'summary':
    case 'span': {
      // Check if this is a block-level container or inline
      const display = window.getComputedStyle(el).display
      const isBlock = display === 'block' || display === 'flex' || display === 'grid'
      const content = convertToMarkdown(el, true)
      // Add newline for block elements, space for inline
      return isBlock ? `\n${content}\n` : `${content} `
    }

    default:
      // For unknown tags, process children with inline spacing
      return convertToMarkdown(el, true) + ' '
  }
}

/**
 * Converts ARIA list (role="list") to Markdown
 * OpenAPI plugin uses these instead of semantic ul/ol
 */
function convertAriaListToMarkdown(el: HTMLElement): string {
  const items = Array.from(el.children)
    .filter((child) => {
      const childRole = child.getAttribute('role')
      return childRole === 'listitem' || child.tagName.toLowerCase() === 'li'
    })
    .map((item) => {
      const content = convertToMarkdown(item as HTMLElement, true).trim()
      return `- ${content}`
    })
    .join('\n')

  // If no role="listitem" children found, try processing all children
  if (!items) {
    const allItems = Array.from(el.children)
      .map((item) => {
        const content = convertToMarkdown(item as HTMLElement, true).trim()
        return content ? `- ${content}` : ''
      })
      .filter(Boolean)
      .join('\n')
    return allItems ? `\n${allItems}\n\n` : convertToMarkdown(el, true)
  }

  return `\n${items}\n\n`
}

/**
 * Converts OpenAPI field/parameter structure to Markdown
 */
function convertOpenApiFieldToMarkdown(el: HTMLElement): string {
  let markdown = ''

  // Get field name from legend or first strong element
  const legend = el.querySelector('legend')
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM element may be null
  const fieldName = legend?.textContent?.trim()

  if (fieldName) {
    markdown += `\n**${fieldName}**\n\n`
  }

  // Process the rest of the content
  markdown += convertToMarkdown(el, true)

  return markdown
}

/**
 * Extracts code content preserving line breaks from syntax-highlighted code
 * Handles Prism/highlight.js which wrap lines in span elements
 */
function extractCodeContent(el: HTMLElement): string {
  // Check for Docusaurus/Prism token-line spans (most specific)
  const tokenLines = el.querySelectorAll(':scope .token-line')
  if (tokenLines.length > 0) {
    return Array.from(tokenLines)
      .map((span) => span.textContent || '')
      .join('\n')
  }

  // Check for code lines with data attributes
  const codeLines = el.querySelectorAll(':scope [data-line], :scope .code-line')
  if (codeLines.length > 0) {
    return Array.from(codeLines)
      .map((line) => line.textContent || '')
      .join('\n')
  }

  // Fallback: get text content directly
  // Replace <br> with newlines first
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('br').forEach((br) => {
    br.replaceWith('\n')
  })

  return clone.textContent || ''
}

/**
 * Extracts language identifier from code element
 */
function extractLanguage(el: HTMLElement): string {
  // Check class for language-* pattern
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- className may be undefined in some contexts
  const classMatch = el.className?.match(/language-(\w+)/)
  if (classMatch) return classMatch[1]

  // Check data-language attribute
  const dataLang = el.getAttribute('data-language')
  if (dataLang) return dataLang

  // Check parent for language info (Docusaurus pattern)
  const parent = el.closest('[class*="language-"]')
  if (parent) {
    const parentMatch = parent.className.match(/language-(\w+)/)
    if (parentMatch) return parentMatch[1]
  }

  return ''
}

/**
 * Converts Docusaurus tabs component to Markdown
 * Only extracts content from the selected/visible tab to avoid duplication
 */
function convertTabsToMarkdown(el: HTMLElement): string {
  // Find the selected tab within this tablist only
  const selectedTab = el.querySelector(
    ':scope > [role="tab"][aria-selected="true"], [role="tab"][aria-selected="true"]',
  )
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM query may return null
  const tabName = selectedTab?.textContent?.trim() || ''

  // Find the associated tabpanel - should be a sibling or nearby element
  // First try to find by aria-controls/id relationship
  const selectedTabId = selectedTab?.getAttribute('aria-controls')
  let visiblePanel: HTMLElement | null = null

  if (selectedTabId) {
    visiblePanel = document.getElementById(selectedTabId) as HTMLElement
  }

  // If not found by ID, look for tabpanels in the common container
  if (!visiblePanel) {
    // Get the parent container that holds both tablist and tabpanels
    // OpenAPI plugin uses .openapi-tabs__container which has tablist in one child and tabpanels in another
    // IMPORTANT: Check specific containers first, avoid broad [class*="tabs"] which matches the tablist itself
    const tabContainer =
      el.closest('.openapi-tabs__container') || el.closest('.tabs-container') || el.parentElement

    if (tabContainer) {
      // Search for ALL tabpanels within the container (not just direct children)
      // OpenAPI structure: container > header-section > tablist, container > margin-top--md > tabpanels
      const allPanels = tabContainer.querySelectorAll('[role="tabpanel"]')

      allPanels.forEach((panel) => {
        const panelEl = panel as HTMLElement
        // Check if this panel is visible (not hidden)
        const isHidden =
          panelEl.hasAttribute('hidden') ||
          panelEl.getAttribute('aria-hidden') === 'true' ||
          window.getComputedStyle(panelEl).display === 'none'

        // IMPORTANT: Skip tabpanels that CONTAIN this tablist - they are ancestor panels, not our target
        // This prevents infinite recursion when nested tablists find their ancestor's tabpanel
        const containsTablist = panelEl.contains(el)

        // Only take the first visible panel that doesn't contain our tablist
        if (!isHidden && !visiblePanel && !containsTablist) {
          visiblePanel = panelEl
        }
      })
    }
  }

  // Last resort: find next sibling tabpanel (for simpler tab structures)
  if (!visiblePanel) {
    let sibling = el.nextElementSibling
    while (sibling) {
      if (sibling.getAttribute('role') === 'tabpanel') {
        const sibEl = sibling as HTMLElement
        const isHidden =
          sibEl.hasAttribute('hidden') ||
          sibEl.getAttribute('aria-hidden') === 'true' ||
          window.getComputedStyle(sibEl).display === 'none'
        if (!isHidden) {
          visiblePanel = sibEl
          break
        }
      }
      sibling = sibling.nextElementSibling
    }
  }

  if (!visiblePanel) {
    return ''
  }

  let markdown = ''
  if (tabName) {
    markdown += `${tabName}\n\n`
  }
  markdown += convertToMarkdown(visiblePanel)
  markdown += '\n'

  return markdown
}

/**
 * Converts Docusaurus admonition/alert to Markdown blockquote
 */
function convertAdmonitionToMarkdown(el: HTMLElement): string {
  // Get admonition type
  let type = 'note'
  const classList = el.className.split(' ')
  for (const cls of classList) {
    if (cls.includes('danger')) type = 'DANGER'
    else if (cls.includes('warning')) type = 'WARNING'
    else if (cls.includes('tip')) type = 'TIP'
    else if (cls.includes('info')) type = 'INFO'
    else if (cls.includes('note')) type = 'NOTE'
    else if (cls.includes('caution')) type = 'CAUTION'
  }

  // Get title if present
  const titleEl = el.querySelector('[class*="admonitionHeading"]')
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM query may return null
  const title = titleEl?.textContent?.trim() || type

  // Get content (excluding title)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Element needs HTMLElement cast for convertToMarkdown
  const contentEl = el.querySelector('[class*="admonitionContent"]') as HTMLElement | null

  const content = contentEl ? convertToMarkdown(contentEl) : convertToMarkdown(el)

  return `> **${title}**\n> ${content.replace(/\n/g, '\n> ')}\n\n`
}

/**
 * Converts a table element to Markdown
 */
function convertTableToMarkdown(table: HTMLElement): string {
  const rows: string[][] = []

  // Get all rows
  const tableRows = table.querySelectorAll('tr')
  tableRows.forEach((row) => {
    const cells: string[] = []
    row.querySelectorAll('td, th').forEach((cell) => {
      cells.push(cleanText(cell.textContent || ''))
    })
    if (cells.length > 0) {
      rows.push(cells)
    }
  })

  if (rows.length === 0) return ''

  // Build markdown table
  let markdown = ''

  // Header row
  if (rows.length > 0) {
    markdown += '| ' + rows[0].join(' | ') + ' |\n'
    markdown += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n'
  }

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    markdown += '| ' + rows[i].join(' | ') + ' |\n'
  }

  return markdown + '\n'
}

/**
 * Formats a heading with the appropriate number of # symbols
 */
function formatHeading(level: number, text: string): string {
  const prefix = '#'.repeat(level)
  return `\n${prefix} ${text}\n\n`
}

/**
 * Formats a code block with language identifier
 */
function formatCodeBlock(code: string, language: string): string {
  const trimmedCode = code.trim()
  return `\n\`\`\`${language}\n${trimmedCode}\n\`\`\`\n\n`
}

/**
 * Formats a blockquote
 */
function formatBlockquote(content: string): string {
  const lines = content.trim().split('\n')
  return lines.map((line) => `> ${line}`).join('\n') + '\n\n'
}

/**
 * Cleans text by removing extra whitespace and special characters
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .trim()
}

/**
 * Resolves a URL to absolute form
 */
function resolveUrl(url: string): string {
  if (!url) return ''

  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // Protocol-relative
  if (url.startsWith('//')) {
    return window.location.protocol + url
  }

  // Anchor link
  if (url.startsWith('#')) {
    return window.location.href.split('#')[0] + url
  }

  // Relative URL
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}

/**
 * Adds frontmatter to the markdown content
 */
function addFrontmatter(content: { markdown: string; title: string; url: string }): string {
  const frontmatter = `---
title: "${content.title}"
source: ${content.url}
extracted: ${new Date().toISOString()}
---

`
  return frontmatter + content.markdown
}

/**
 * Copies text to clipboard using the modern Clipboard API
 */
export async function copyToClipboard(text: string): Promise<void> {
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
  } catch (error) {
    console.error('[CopyPage] Failed to copy to clipboard:', error)
    throw new Error('Failed to copy to clipboard')
  }
}
