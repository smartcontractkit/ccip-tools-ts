import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CCIPChainNotFoundError,
  CCIPCommitNotFoundError,
  CCIPUsdcAttestationError,
} from '@chainlink/ccip-sdk/src/index.ts'

import { formatCCIPError } from './utils.ts'

describe('formatCCIPError', () => {
  it('should return null for non-CCIPError instances', () => {
    const regularError = new Error('regular error')
    assert.equal(formatCCIPError(regularError), null)
    assert.equal(formatCCIPError('string error'), null)
    assert.equal(formatCCIPError(null), null)
    assert.equal(formatCCIPError(undefined), null)
  })

  it('should format CCIPError with code and message', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /^error\[CHAIN_NOT_FOUND\]:/)
    assert.match(formatted, /12345/)
  })

  it('should include help section with recovery hint', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /help:/)
    assert.match(formatted, /Verify the chainId/)
  })

  it('should include note section for transient errors', () => {
    const error = new CCIPCommitNotFoundError(1000, 123n)
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /note:/)
    assert.match(formatted, /may resolve on retry/)
  })

  it('should include retry timing for transient errors with retryAfterMs', () => {
    const error = new CCIPUsdcAttestationError('0xhash', { status: 'pending' })
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /wait \d+s/)
  })

  it('should not include note section for permanent errors', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.doesNotMatch(formatted, /note:/)
  })

  it('should format error with structured output', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    // Check format: error[CODE]: message
    assert.match(formatted, /^error\[\w+\]:/)
    // Check help: indentation
    assert.match(formatted, /\n {2}help:/)
  })

  it('should include stack trace when verbose is true', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error, true)

    assert.ok(formatted)
    assert.match(formatted, /Stack trace:/)
    assert.match(formatted, /at /)
  })

  it('should not include stack trace when verbose is false', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error, false)

    assert.ok(formatted)
    assert.doesNotMatch(formatted, /Stack trace:/)
  })
})
