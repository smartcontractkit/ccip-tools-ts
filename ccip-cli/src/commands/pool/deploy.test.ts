import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as deploy from './deploy.ts'

// =============================================================================
// Module shape
// =============================================================================

describe('pool deploy — module shape', () => {
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
