import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { describe, it } from 'node:test'

import { Ed25519TransactionSigner } from './signer.ts'

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const PARTY_ID = 'party::1234567890abcdef'

// A known 32-byte Ed25519 seed (all zeros for predictable test behavior)
const ZERO_SEED_HEX = '0000000000000000000000000000000000000000000000000000000000000000'

// A different seed for testing multiple keys
const TEST_SEED_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

// A sample transaction hash to sign (32 bytes of 0xab)
const SAMPLE_HASH = new Uint8Array(32).fill(0xab)

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Compute the expected Canton fingerprint for a given seed, using the same
 * algorithm as the implementation. Used to verify the constructor's fingerprint.
 */
function computeExpectedFingerprint(seedHex: string): string {
  // Build PKCS8 DER envelope
  const seed = Buffer.from(seedHex.replace(/^0x/, ''), 'hex')
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ])
  const pkcs8 = Buffer.concat([prefix, seed])

  // Derive public key
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey)
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const rawPublicKey = publicKeyDer.subarray(publicKeyDer.length - 32)

  // Compute fingerprint
  const h = createHash('sha256')
  h.update(Buffer.from([0, 0, 0, 12])) // PURPOSE_PUBLIC_KEY_FINGERPRINT
  h.update(rawPublicKey)
  const digest = h.digest()

  // Prepend multihash header
  const result = Buffer.concat([Buffer.from([0x12, 0x20]), digest])
  return result.toString('hex')
}

/**
 * Extract the public key in SPKI DER format from a seed, for signature verification.
 */
function derivePublicKeyDer(seedHex: string): Buffer {
  const seed = Buffer.from(seedHex.replace(/^0x/, ''), 'hex')
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ])
  const pkcs8 = Buffer.concat([prefix, seed])
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey)
  return publicKey.export({ type: 'spki', format: 'der' }) as Buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canton/signer', () => {
  describe('Ed25519TransactionSigner constructor', () => {
    it('constructs with a valid 64-char hex seed', () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      assert.ok(signer, 'signer should be constructed')
    })

    it('constructs with a 0x-prefixed seed', () => {
      const signer = new Ed25519TransactionSigner('0x' + ZERO_SEED_HEX, PARTY_ID)
      assert.ok(signer, 'signer should be constructed')
    })

    it('throws when seed is too short', () => {
      assert.throws(
        () => new Ed25519TransactionSigner('deadbeef', PARTY_ID),
        /expected 32-byte seed/,
        'should throw for short seed',
      )
    })

    it('throws when seed is too long', () => {
      const tooLong = ZERO_SEED_HEX + 'ff'
      assert.throws(
        () => new Ed25519TransactionSigner(tooLong, PARTY_ID),
        /expected 32-byte seed/,
        'should throw for long seed',
      )
    })

    it('throws when seed contains non-hex characters', () => {
      const invalidHex = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
      assert.throws(
        () => new Ed25519TransactionSigner(invalidHex, PARTY_ID),
        /expected 32-byte seed/,
        'should throw for invalid hex',
      )
    })

    it('computes the correct Canton fingerprint', () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const fingerprint = signer.getFingerprint()

      // Verify fingerprint structure: 68 hex chars (0x12 0x20 prefix + 32-byte SHA-256)
      assert.equal(fingerprint.length, 68, 'fingerprint should be 68 hex characters')
      assert.ok(/^[0-9a-f]{68}$/.test(fingerprint), 'fingerprint should be lowercase hex')

      // Verify multihash prefix (0x12 = sha256, 0x20 = 32 bytes)
      assert.ok(fingerprint.startsWith('1220'), 'fingerprint should start with multihash header')

      // Verify against expected value
      const expected = computeExpectedFingerprint(ZERO_SEED_HEX)
      assert.equal(fingerprint, expected, 'fingerprint should match expected value')
    })

    it('produces different fingerprints for different seeds', () => {
      const signer1 = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const signer2 = new Ed25519TransactionSigner(TEST_SEED_HEX, PARTY_ID)

      assert.notEqual(
        signer1.getFingerprint(),
        signer2.getFingerprint(),
        'different seeds should produce different fingerprints',
      )
    })
  })

  describe('Ed25519TransactionSigner.sign()', () => {
    it('returns a PartySignatures structure', async () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const result = await signer.sign(SAMPLE_HASH)

      assert.ok(result.signatures, 'result should have signatures array')
      assert.equal(result.signatures.length, 1, 'should have one SinglePartySignatures entry')
    })

    it('includes the correct party ID', async () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const result = await signer.sign(SAMPLE_HASH)

      assert.ok(result.signatures[0], 'should have first party signature')
      assert.equal(result.signatures[0].party, PARTY_ID, 'party should match constructor argument')
    })

    it('produces a signature with correct properties', async () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const result = await signer.sign(SAMPLE_HASH)

      assert.ok(result.signatures[0], 'should have first party signature')
      assert.ok(result.signatures[0].signatures[0], 'should have first signature')
      const sig = result.signatures[0].signatures[0]

      assert.equal(
        sig.format,
        'SIGNATURE_FORMAT_RAW',
        'format should be SIGNATURE_FORMAT_RAW for Ed25519',
      )
      assert.equal(
        sig.signingAlgorithmSpec,
        'SIGNING_ALGORITHM_SPEC_ED25519',
        'algorithm spec should be ED25519',
      )
      assert.equal(
        sig.signedBy,
        signer.getFingerprint(),
        'signedBy should match signer fingerprint',
      )
      assert.ok(sig.signature, 'signature should be present')
      assert.equal(typeof sig.signature, 'string', 'signature should be a string (base64)')
    })

    it('produces a valid Ed25519 signature (64 bytes)', async () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const result = await signer.sign(SAMPLE_HASH)

      assert.ok(result.signatures[0]?.signatures[0], 'should have signature')
      const sig = result.signatures[0].signatures[0]
      assert.ok(sig.signature, 'signature field should be present')
      const sigBytes = Buffer.from(sig.signature, 'base64')

      assert.equal(sigBytes.length, 64, 'Ed25519 signatures are always 64 bytes')
    })

    it('produces a cryptographically valid signature', async () => {
      const signer = new Ed25519TransactionSigner(TEST_SEED_HEX, PARTY_ID)
      const result = await signer.sign(SAMPLE_HASH)

      assert.ok(result.signatures[0]?.signatures[0], 'should have signature')
      const sig = result.signatures[0].signatures[0]
      assert.ok(sig.signature, 'signature field should be present')
      const sigBytes = Buffer.from(sig.signature, 'base64')

      // Verify the signature using Node.js crypto.verify
      const publicKeyDer = derivePublicKeyDer(TEST_SEED_HEX)
      const publicKeyObject = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' })
      const isValid = verify(null, Buffer.from(SAMPLE_HASH), publicKeyObject, sigBytes)

      assert.ok(isValid, 'signature should be cryptographically valid')
    })

    it('produces different signatures for different hashes', async () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)

      const hash1 = new Uint8Array(32).fill(0xaa)
      const hash2 = new Uint8Array(32).fill(0xbb)

      const result1 = await signer.sign(hash1)
      const result2 = await signer.sign(hash2)

      assert.ok(result1.signatures[0]?.signatures[0]?.signature, 'result1 should have signature')
      assert.ok(result2.signatures[0]?.signatures[0]?.signature, 'result2 should have signature')
      const sig1 = result1.signatures[0].signatures[0].signature
      const sig2 = result2.signatures[0].signatures[0].signature

      assert.notEqual(sig1, sig2, 'different hashes should produce different signatures')
    })

    it('produces different signatures for different signers (same hash)', async () => {
      const signer1 = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const signer2 = new Ed25519TransactionSigner(TEST_SEED_HEX, PARTY_ID)

      const result1 = await signer1.sign(SAMPLE_HASH)
      const result2 = await signer2.sign(SAMPLE_HASH)

      assert.ok(result1.signatures[0]?.signatures[0]?.signature, 'result1 should have signature')
      assert.ok(result2.signatures[0]?.signatures[0]?.signature, 'result2 should have signature')
      const sig1 = result1.signatures[0].signatures[0].signature
      const sig2 = result2.signatures[0].signatures[0].signature

      assert.notEqual(sig1, sig2, 'different signers should produce different signatures')
    })

    it('handles empty hash (edge case)', async () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const emptyHash = new Uint8Array(0)

      const result = await signer.sign(emptyHash)
      assert.ok(result.signatures[0]?.signatures[0], 'should have signature')
      const sig = result.signatures[0].signatures[0]

      assert.ok(sig.signature, 'should produce a signature even for empty input')

      // Verify it's still a valid Ed25519 signature structure
      const sigBytes = Buffer.from(sig.signature, 'base64')
      assert.equal(sigBytes.length, 64, 'signature should still be 64 bytes')
    })
  })

  describe('Ed25519TransactionSigner.getFingerprint()', () => {
    it('returns the fingerprint computed during construction', () => {
      const signer = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const fp1 = signer.getFingerprint()
      const fp2 = signer.getFingerprint()

      assert.equal(fp1, fp2, 'fingerprint should be stable across calls')
    })

    it('returns a 68-character hex string', () => {
      const signer = new Ed25519TransactionSigner(TEST_SEED_HEX, PARTY_ID)
      const fingerprint = signer.getFingerprint()

      assert.equal(fingerprint.length, 68, 'fingerprint should be 68 characters')
      assert.ok(/^[0-9a-f]{68}$/.test(fingerprint), 'fingerprint should be lowercase hex')
    })
  })

  describe('Integration: multiple signers with same party', () => {
    it('allows multiple signers for the same party with different keys', async () => {
      const signer1 = new Ed25519TransactionSigner(ZERO_SEED_HEX, PARTY_ID)
      const signer2 = new Ed25519TransactionSigner(TEST_SEED_HEX, PARTY_ID)

      const result1 = await signer1.sign(SAMPLE_HASH)
      const result2 = await signer2.sign(SAMPLE_HASH)

      assert.ok(result1.signatures[0], 'result1 should have party signature')
      assert.ok(result2.signatures[0], 'result2 should have party signature')

      // Both should have the same party
      assert.equal(result1.signatures[0].party, PARTY_ID)
      assert.equal(result2.signatures[0].party, PARTY_ID)

      assert.ok(result1.signatures[0].signatures[0], 'result1 should have signature')
      assert.ok(result2.signatures[0].signatures[0], 'result2 should have signature')

      // But different fingerprints
      assert.notEqual(
        result1.signatures[0].signatures[0].signedBy,
        result2.signatures[0].signatures[0].signedBy,
      )

      // And different signatures
      assert.notEqual(
        result1.signatures[0].signatures[0].signature,
        result2.signatures[0].signatures[0].signature,
      )
    })
  })
})
