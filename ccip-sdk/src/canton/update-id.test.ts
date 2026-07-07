import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CANTON_UPDATE_ID_PREFIX, isCantonUpdateId, normalizeCantonUpdateId } from './update-id.ts'

const DIGEST = '4dd49d0cf1452a07e6d7fa7212443ebe5834fa78828d90751374e29b6f9f3fca'
const CANONICAL = `${CANTON_UPDATE_ID_PREFIX}${DIGEST}`

describe('normalizeCantonUpdateId', () => {
  it('returns canonical ids unchanged (lowercased)', () => {
    assert.equal(normalizeCantonUpdateId(CANONICAL), CANONICAL)
    assert.equal(normalizeCantonUpdateId(CANONICAL.toUpperCase()), CANONICAL)
  })

  it('strips 0x and prepends 1220 for bare 32-byte digests', () => {
    assert.equal(normalizeCantonUpdateId(DIGEST), CANONICAL)
    assert.equal(normalizeCantonUpdateId(`0x${DIGEST}`), CANONICAL)
  })

  it('strips 0x from canonical update ids', () => {
    assert.equal(normalizeCantonUpdateId(`0x${CANONICAL}`), CANONICAL)
  })
})

describe('isCantonUpdateId', () => {
  it('matches canonical update ids', () => {
    assert.equal(isCantonUpdateId(CANONICAL), true)
    assert.equal(isCantonUpdateId(`0x${CANONICAL}`), true)
  })

  it('does not match CCIP message ids', () => {
    assert.equal(
      isCantonUpdateId('0x18165c7cdab3b40b969ebd0409f1a22bb76a65e918095ed31f53ad8616d589a1'),
      false,
    )
  })

  it('does not match bare 64-hex digests without 1220 prefix', () => {
    assert.equal(isCantonUpdateId(DIGEST), false)
  })
})
