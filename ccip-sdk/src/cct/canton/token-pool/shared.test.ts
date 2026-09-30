/**
 * Tests for the shared token-pool helpers (address normalization).
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeRemoteAddress } from './shared.ts'

describe('normalizeRemoteAddress', () => {
  it('strips 0x and left-pads a 20-byte EVM address to 32 bytes', () => {
    assert.equal(
      normalizeRemoteAddress('0x36e518336a67177cb102726c2dfa3d29b12f4c7b'),
      '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b',
    )
  })

  it('pads a bare (no-prefix) 20-byte address the same way', () => {
    assert.equal(
      normalizeRemoteAddress('36e518336a67177cb102726c2dfa3d29b12f4c7b'),
      '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b',
    )
  })

  it('leaves an already-32-byte bare-hex value unchanged (modulo 0x prefix)', () => {
    assert.equal(
      normalizeRemoteAddress('1d913a42a72f8eba8c670355ca3ed14257bc3a1135e264fad3522acf95a36a36'),
      '1d913a42a72f8eba8c670355ca3ed14257bc3a1135e264fad3522acf95a36a36',
    )
    assert.equal(
      normalizeRemoteAddress('0x1d913a42a72f8eba8c670355ca3ed14257bc3a1135e264fad3522acf95a36a36'),
      '1d913a42a72f8eba8c670355ca3ed14257bc3a1135e264fad3522acf95a36a36',
    )
  })
})
