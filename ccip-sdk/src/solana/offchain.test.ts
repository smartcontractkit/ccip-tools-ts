import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { encodeSolanaOffchainTokenData } from './offchain.ts'

describe('encodeSolanaOffchainTokenData', () => {
  it('should return 0x for undefined data', () => {
    assert.equal(encodeSolanaOffchainTokenData(undefined), '0x')
  })

  it('should Borsh-encode USDC message and attestation', () => {
    const data = {
      _tag: 'usdc',
      message: '0xaabbccdd',
      attestation: '0x11223344',
    }
    const result = encodeSolanaOffchainTokenData(data)
    // Borsh wraps with length prefixes — output must be longer than raw input
    assert.ok(
      result.length > '0xaabbccdd11223344'.length,
      `Expected Borsh overhead, got: ${result}`,
    )
    // Must not be the raw fallback
    assert.notEqual(result, '0x')
  })

  it('should hex-encode LBTC attestation as raw bytes (no Borsh)', () => {
    const attestation = '0xdeadbeefcafebabe'
    const data = {
      _tag: 'lbtc',
      attestation,
      extraData: '0x' + 'ab'.repeat(32),
    }
    const result = encodeSolanaOffchainTokenData(data)
    // LBTC is raw hex — no Borsh wrapping, unlike USDC
    assert.equal(result, '0xdeadbeefcafebabe')
  })

  it('should return 0x for LBTC without attestation', () => {
    const data = {
      _tag: 'lbtc',
      extraData: '0x' + 'ab'.repeat(32),
    }
    assert.equal(encodeSolanaOffchainTokenData(data), '0x')
  })
})
