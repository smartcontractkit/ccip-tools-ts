import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeCantonEncodedMessage } from './events.ts'

describe('canton/events normalizeCantonEncodedMessage', () => {
  it('adds 0x prefix to bare hex', () => {
    assert.equal(normalizeCantonEncodedMessage('0180a1'), '0x0180a1')
  })

  it('preserves existing 0x prefix', () => {
    assert.equal(normalizeCantonEncodedMessage('0x0180a1'), '0x0180a1')
  })

  it('normalizes 0X prefix', () => {
    assert.equal(normalizeCantonEncodedMessage('0X0180a1'), '0x0180a1')
  })
})
