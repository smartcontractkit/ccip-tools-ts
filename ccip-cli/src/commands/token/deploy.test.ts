import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as balance from './balance.ts'
import * as deploy from './deploy.ts'

// =============================================================================
// Module shape
// =============================================================================

describe('token deploy — module shape', () => {
  it('should export command as "deploy"', () => {
    assert.equal(deploy.command, 'deploy')
  })

  it('should export a describe string', () => {
    assert.equal(typeof deploy.describe, 'string')
    assert.ok(deploy.describe.length > 0)
  })

  it('should export a builder function', () => {
    assert.equal(typeof deploy.builder, 'function')
  })

  it('should export a handler function', () => {
    assert.equal(typeof deploy.handler, 'function')
  })
})

// =============================================================================
// token balance — module shape (backward compat)
// =============================================================================

describe('token balance — module shape', () => {
  it('should export command as "$0" (default subcommand)', () => {
    assert.equal(balance.command, '$0')
  })

  it('should export a describe string', () => {
    assert.equal(typeof balance.describe, 'string')
  })

  it('should export a builder function', () => {
    assert.equal(typeof balance.builder, 'function')
  })

  it('should export a handler function', () => {
    assert.equal(typeof balance.handler, 'function')
  })
})
