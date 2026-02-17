/**
 * Constants Unit Tests
 *
 * Tests for the Copy Page constants and utility functions.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-condition -- tests verify constant values */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AI_ASSISTANTS,
  DEFAULT_EXTRACTION_CONFIG,
  TIMING,
  UI_TEXT,
  buildAIUrl,
  generateAIPrompt,
} from './constants.ts'

describe('DEFAULT_EXTRACTION_CONFIG', () => {
  it('should have required configuration properties', () => {
    assert.ok(Array.isArray(DEFAULT_EXTRACTION_CONFIG.selectorsToRemove))
    assert.equal(typeof DEFAULT_EXTRACTION_CONFIG.contentSelector, 'string')
    assert.equal(typeof DEFAULT_EXTRACTION_CONFIG.includeFrontmatter, 'boolean')
  })

  it('should have selectors to remove navigation elements', () => {
    const { selectorsToRemove } = DEFAULT_EXTRACTION_CONFIG
    assert.ok(selectorsToRemove.includes('nav'))
    assert.ok(selectorsToRemove.includes('.breadcrumbs'))
    assert.ok(selectorsToRemove.includes('.pagination-nav'))
  })

  it('should have selectors to remove interactive elements', () => {
    const { selectorsToRemove } = DEFAULT_EXTRACTION_CONFIG
    assert.ok(selectorsToRemove.includes('button'))
    assert.ok(selectorsToRemove.some((s) => s.includes('copyButton')))
  })

  it('should have selectors to remove sidebar elements', () => {
    const { selectorsToRemove } = DEFAULT_EXTRACTION_CONFIG
    assert.ok(selectorsToRemove.includes('.theme-doc-sidebar-container'))
    assert.ok(selectorsToRemove.includes('.table-of-contents'))
  })

  it('should have selectors to avoid recursion on copy page button', () => {
    const { selectorsToRemove } = DEFAULT_EXTRACTION_CONFIG
    assert.ok(selectorsToRemove.some((s) => s.includes('copyPage') || s.includes('CopyPage')))
  })

  it('should have a valid content selector', () => {
    const { contentSelector } = DEFAULT_EXTRACTION_CONFIG
    assert.ok(contentSelector.includes('article'))
    assert.ok(contentSelector.includes('theme-doc-markdown'))
  })

  it('should include frontmatter by default', () => {
    assert.equal(DEFAULT_EXTRACTION_CONFIG.includeFrontmatter, true)
  })
})

describe('AI_ASSISTANTS', () => {
  it('should have ChatGPT configuration', () => {
    assert.ok('chatgpt' in AI_ASSISTANTS)
    assert.equal(AI_ASSISTANTS.chatgpt.name, 'ChatGPT')
    assert.equal(AI_ASSISTANTS.chatgpt.baseUrl, 'https://chatgpt.com/')
    assert.equal(AI_ASSISTANTS.chatgpt.promptParam, 'prompt')
  })

  it('should have Claude configuration', () => {
    assert.ok('claude' in AI_ASSISTANTS)
    assert.equal(AI_ASSISTANTS.claude.name, 'Claude')
    assert.equal(AI_ASSISTANTS.claude.baseUrl, 'https://claude.ai/new')
    assert.equal(AI_ASSISTANTS.claude.promptParam, 'q')
  })
})

describe('TIMING', () => {
  it('should have copy feedback duration', () => {
    assert.ok('copyFeedbackDuration' in TIMING)
    assert.equal(typeof TIMING.copyFeedbackDuration, 'number')
    assert.ok(TIMING.copyFeedbackDuration > 0)
  })

  it('should have dropdown animation duration', () => {
    assert.ok('dropdownAnimationDuration' in TIMING)
    assert.equal(typeof TIMING.dropdownAnimationDuration, 'number')
    assert.ok(TIMING.dropdownAnimationDuration > 0)
  })

  it('should have reasonable timing values', () => {
    // Copy feedback should be visible for a reasonable time
    assert.ok(TIMING.copyFeedbackDuration >= 1000)
    assert.ok(TIMING.copyFeedbackDuration <= 5000)

    // Animation should be quick
    assert.ok(TIMING.dropdownAnimationDuration >= 50)
    assert.ok(TIMING.dropdownAnimationDuration <= 500)
  })
})

describe('UI_TEXT', () => {
  describe('button text', () => {
    it('should have default button text', () => {
      assert.equal(typeof UI_TEXT.button.default, 'string')
      assert.ok(UI_TEXT.button.default.length > 0)
    })

    it('should have copied button text', () => {
      assert.equal(typeof UI_TEXT.button.copied, 'string')
      assert.ok(UI_TEXT.button.copied.length > 0)
    })

    it('should have loading button text', () => {
      assert.equal(typeof UI_TEXT.button.loading, 'string')
      assert.ok(UI_TEXT.button.loading.length > 0)
    })
  })

  describe('dropdown text', () => {
    it('should have copy action text', () => {
      assert.equal(typeof UI_TEXT.dropdown.copy.title, 'string')
      assert.equal(typeof UI_TEXT.dropdown.copy.description, 'string')
    })

    it('should have preview action text', () => {
      assert.equal(typeof UI_TEXT.dropdown.preview.title, 'string')
      assert.equal(typeof UI_TEXT.dropdown.preview.description, 'string')
    })

    it('should have ChatGPT action text', () => {
      assert.equal(typeof UI_TEXT.dropdown.chatgpt.title, 'string')
      assert.equal(typeof UI_TEXT.dropdown.chatgpt.description, 'string')
    })

    it('should have Claude action text', () => {
      assert.equal(typeof UI_TEXT.dropdown.claude.title, 'string')
      assert.equal(typeof UI_TEXT.dropdown.claude.description, 'string')
    })
  })

  describe('error messages', () => {
    it('should have extraction failed error', () => {
      assert.equal(typeof UI_TEXT.errors.extractionFailed, 'string')
      assert.ok(UI_TEXT.errors.extractionFailed.length > 0)
    })

    it('should have copy failed error', () => {
      assert.equal(typeof UI_TEXT.errors.copyFailed, 'string')
      assert.ok(UI_TEXT.errors.copyFailed.length > 0)
    })
  })
})

describe('generateAIPrompt', () => {
  it('should include the page URL in the prompt', () => {
    const pageUrl = 'https://example.com/docs/test-page'
    const prompt = generateAIPrompt(pageUrl)
    assert.ok(prompt.indexOf(pageUrl) !== -1)
  })

  it('should mention CCIP in the prompt', () => {
    const prompt = generateAIPrompt('https://example.com')
    assert.ok(prompt.includes('CCIP'))
  })

  it('should mention markdown/clipboard in the prompt', () => {
    const prompt = generateAIPrompt('https://example.com')
    assert.ok(
      prompt.toLowerCase().includes('clipboard') || prompt.toLowerCase().includes('markdown'),
    )
  })

  it('should ask the assistant to request paste', () => {
    const prompt = generateAIPrompt('https://example.com')
    assert.ok(prompt.toLowerCase().includes('paste'))
  })

  it('should return a non-empty string', () => {
    const prompt = generateAIPrompt('https://example.com')
    assert.equal(typeof prompt, 'string')
    assert.ok(prompt.length > 0)
  })
})

describe('buildAIUrl', () => {
  describe('ChatGPT URLs', () => {
    it('should build a valid ChatGPT URL', () => {
      const url = buildAIUrl('chatgpt', 'https://example.com/docs')
      assert.ok(url.startsWith('https://chatgpt.com/'))
    })

    it('should include the prompt parameter', () => {
      const url = buildAIUrl('chatgpt', 'https://example.com/docs')
      assert.ok(url.includes('prompt='))
    })

    it('should URL-encode the prompt', () => {
      const url = buildAIUrl('chatgpt', 'https://example.com/docs?foo=bar')
      assert.ok(url.includes('%3A')) // Encoded colon from URL
    })

    it('should include the page URL in the encoded prompt', () => {
      const pageUrl = 'https://example.com/docs/test'
      const url = buildAIUrl('chatgpt', pageUrl)
      assert.ok(url.indexOf(encodeURIComponent(pageUrl).substring(0, 20)) !== -1)
    })
  })

  describe('Claude URLs', () => {
    it('should build a valid Claude URL', () => {
      const url = buildAIUrl('claude', 'https://example.com/docs')
      assert.ok(url.startsWith('https://claude.ai/new'))
    })

    it('should include the q parameter', () => {
      const url = buildAIUrl('claude', 'https://example.com/docs')
      assert.ok(url.includes('q='))
    })

    it('should URL-encode the prompt', () => {
      const url = buildAIUrl('claude', 'https://example.com/docs?foo=bar')
      assert.ok(url.includes('%3A')) // Encoded colon from URL
    })

    it('should include the page URL in the encoded prompt', () => {
      const pageUrl = 'https://example.com/docs/test'
      const url = buildAIUrl('claude', pageUrl)
      assert.ok(url.indexOf(encodeURIComponent(pageUrl).substring(0, 20)) !== -1)
    })
  })

  describe('URL format consistency', () => {
    it('should produce valid URL format for both assistants', () => {
      const pageUrl = 'https://example.com/docs'

      const chatgptUrl = buildAIUrl('chatgpt', pageUrl)
      const claudeUrl = buildAIUrl('claude', pageUrl)

      // Both should be valid URLs (contain protocol and domain)
      assert.ok(chatgptUrl.startsWith('https://'))
      assert.ok(claudeUrl.startsWith('https://'))

      // Both should contain query parameters
      assert.ok(chatgptUrl.includes('?'))
      assert.ok(claudeUrl.includes('?'))
    })

    it('should handle special characters in page URL', () => {
      const pageUrl = 'https://example.com/docs?param=value&other=test#section'

      const chatgptUrl = buildAIUrl('chatgpt', pageUrl)
      const claudeUrl = buildAIUrl('claude', pageUrl)

      // URLs should still be valid (not throw errors)
      assert.ok(chatgptUrl.length > 0)
      assert.ok(claudeUrl.length > 0)
    })
  })
})
