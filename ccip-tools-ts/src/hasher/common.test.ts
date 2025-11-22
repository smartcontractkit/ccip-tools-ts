import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hashInternal } from './common.ts'

describe('common hash', () => {
  it('should hash internal values', () => {
    const a = '0x01'
    const b = '0x02'
    const result = hashInternal(a, b)
    assert.equal(result, '0x93b82a55d406c553471937ba1e3176dfdacfc274e84c75b0cbf212388a8bd37b')
  })
})
