import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SuiExtraArgsV1Tag } from '../extra-args.ts'
import { decodeSolanaSuiExtraArgsV1, encodeSolanaSuiExtraArgsV1 } from './extra-args.ts'
import { decodeMoveExtraArgs } from '../shared/bcs-codecs.ts'
import { encodeSuiExtraArgsV1 } from '../sui/types.ts'

/**
 * Unit tests for SuiExtraArgsV1 encoding/decoding, validating against the
 * on-chain layout defined in chainlink-ccip PR #2239.
 *
 * Layout (after 4-byte tag):
 *   gas_limit: u128 LE (16 bytes)
 *   allow_out_of_order_execution: bool (1 byte)
 *   token_receiver: fixed 32-byte array (no length prefix)
 *   receiver_object_ids: Vec of 32-byte arrays (Borsh: 4-byte LE count + N*32 bytes)
 *
 * Borsh (Solana) uses 4-byte LE for vec lengths; BCS (Sui) uses ULEB128.
 * The two encodings are NOT byte-identical when receiverObjectIds is non-empty.
 */
describe('SuiExtraArgsV1 Borsh codec (Solana source)', () => {
  // Tag: 0x21ea4ca9 (4 bytes)
  // gasLimit: 200000 = 0x30d40 → u128 LE = 400d0300000000000000000000000000
  // allowOutOfOrderExecution: true = 01
  // tokenReceiver: 0x11…11 (32 bytes)
  // receiverObjectIds count: 1 = 01000000 (Borsh u32 LE)
  // receiverObjectIds[0]: 0x22…22 (32 bytes)
  const SYNTHETIC_BORSH_1 =
    '0x21ea4ca9' + // tag
    '400d0300000000000000000000000000' + // gasLimit u128 LE (16 bytes)
    '01' + // allowOutOfOrderExecution
    '11'.repeat(32) + // tokenReceiver [u8;32]
    '01000000' + // receiverObjectIds count (Borsh u32 LE = 1)
    '22'.repeat(32) // receiverObjectIds[0]

  it('encodes SuiExtraArgsV1 with correct Borsh layout', () => {
    const encoded = encodeSolanaSuiExtraArgsV1({
      gasLimit: 200000n,
      allowOutOfOrderExecution: true,
      tokenReceiver: '0x' + '11'.repeat(32),
      receiverObjectIds: ['0x' + '22'.repeat(32)],
    })
    assert.equal(encoded, SYNTHETIC_BORSH_1)
    // Total: 4(tag) + 16(u128) + 1(bool) + 32(tokenReceiver) + 4(count) + 32(obj) = 89 bytes
    assert.equal((encoded.length - 2) / 2, 89)
  })

  it('decodes SuiExtraArgsV1 from synthetic Borsh bytes', () => {
    const bytes = new Uint8Array(Buffer.from(SYNTHETIC_BORSH_1.slice(2), 'hex'))
    const decoded = decodeSolanaSuiExtraArgsV1(bytes)
    assert.equal(decoded._tag, 'SuiExtraArgsV1')
    assert.equal(decoded.gasLimit, 200000n)
    assert.equal(decoded.allowOutOfOrderExecution, true)
    assert.equal(decoded.tokenReceiver, '0x' + '11'.repeat(32))
    assert.equal(decoded.receiverObjectIds.length, 1)
    assert.equal(decoded.receiverObjectIds[0], '0x' + '22'.repeat(32))
  })

  it('round-trips encode → decode', () => {
    const args = {
      gasLimit: 200000n,
      allowOutOfOrderExecution: true,
      tokenReceiver: '0x' + '11'.repeat(32),
      receiverObjectIds: ['0x' + '22'.repeat(32)],
    }
    const encoded = encodeSolanaSuiExtraArgsV1(args)
    const decoded = decodeSolanaSuiExtraArgsV1(new Uint8Array(Buffer.from(encoded.slice(2), 'hex')))
    assert.deepEqual(decoded, { ...args, _tag: 'SuiExtraArgsV1' })
  })

  it('encodes gasLimit as u128 (16 bytes LE), not u64 (8 bytes)', () => {
    // gasLimit = 2^64 = 0x10000000000000000
    // u128 LE: 0000000000000000 0100000000000000 (16 bytes)
    const encoded = encodeSolanaSuiExtraArgsV1({
      gasLimit: 1n << 64n,
      allowOutOfOrderExecution: false,
      tokenReceiver: '0x' + '00'.repeat(32),
      receiverObjectIds: [],
    })
    // u128 LE of 2^64: bytes 4-19 = 0000000000000000 0100000000000000
    const bytes = Buffer.from(encoded.slice(2), 'hex')
    const gasLimitBytes = bytes.subarray(4, 20)
    assert.equal(gasLimitBytes.length, 16, 'gasLimit must be 16 bytes (u128)')
    assert.equal(gasLimitBytes[8], 1, 'high u64 should be 1')
    assert.equal(
      gasLimitBytes.subarray(0, 8).every((b) => b === 0),
      true,
    )
    assert.equal(
      gasLimitBytes.subarray(9).every((b) => b === 0),
      true,
    )
  })

  it('decodes gasLimit that crosses u64 boundary (u128)', () => {
    // Synthetic: gasLimit = 2^64 + 42
    // u128 LE: 2a00000000000000 0100000000000000
    const gasLimitLe = '2a00000000000000' + '0100000000000000'
    const synthetic =
      '0x21ea4ca9' +
      gasLimitLe +
      '00' + // allowOutOfOrderExecution = false
      '00'.repeat(32) + // tokenReceiver
      '00000000' // receiverObjectIds count = 0

    const decoded = decodeSolanaSuiExtraArgsV1(
      new Uint8Array(Buffer.from(synthetic.slice(2), 'hex')),
    )
    assert.equal(decoded.gasLimit, (1n << 64n) + 42n)
  })

  it('encodes tokenReceiver as fixed [u8;32] (no length prefix)', () => {
    const encoded = encodeSolanaSuiExtraArgsV1({
      gasLimit: 0n,
      allowOutOfOrderExecution: false,
      tokenReceiver: '0x' + 'ab'.repeat(32),
      receiverObjectIds: [],
    })
    const bytes = Buffer.from(encoded.slice(2), 'hex')
    // After tag(4) + gasLimit(16) + bool(1) = offset 21
    // tokenReceiver should be exactly 32 bytes of 0xab, NOT preceded by a length prefix
    const tokenReceiver = bytes.subarray(21, 53)
    assert.equal(tokenReceiver.length, 32)
    assert.equal(
      tokenReceiver.every((b) => b === 0xab),
      true,
    )
    // Next byte should be the receiverObjectIds count (0x00), not part of tokenReceiver
    assert.equal(bytes[53], 0x00)
  })

  it('encodes empty receiverObjectIds with 4-byte zero count', () => {
    const encoded = encodeSolanaSuiExtraArgsV1({
      gasLimit: 0n,
      allowOutOfOrderExecution: false,
      tokenReceiver: '0x' + '00'.repeat(32),
      receiverObjectIds: [],
    })
    const bytes = Buffer.from(encoded.slice(2), 'hex')
    // After tag(4) + gasLimit(16) + bool(1) + tokenReceiver(32) = offset 53
    // 4-byte count = 00000000
    const count = bytes.subarray(53, 57)
    assert.equal(count.length, 4)
    assert.equal(
      count.every((b) => b === 0),
      true,
    )
    // Total: 4 + 16 + 1 + 32 + 4 = 57 bytes
    assert.equal(bytes.length, 57)
  })

  it('encodes multiple receiverObjectIds', () => {
    const encoded = encodeSolanaSuiExtraArgsV1({
      gasLimit: 0n,
      allowOutOfOrderExecution: false,
      tokenReceiver: '0x' + '00'.repeat(32),
      receiverObjectIds: ['0x' + '01'.repeat(32), '0x' + '02'.repeat(32), '0x' + '03'.repeat(32)],
    })
    const bytes = Buffer.from(encoded.slice(2), 'hex')
    // count at offset 53
    const count = bytes.readUInt32LE(53)
    assert.equal(count, 3)
    // Total: 4 + 16 + 1 + 32 + 4 + 3*32 = 153
    assert.equal(bytes.length, 153)
    // Verify each object ID
    for (let i = 0; i < 3; i++) {
      const obj = bytes.subarray(57 + i * 32, 57 + (i + 1) * 32)
      assert.equal(obj[0], i + 1)
      assert.equal(
        obj.every((b) => b === i + 1),
        true,
      )
    }
  })

  it('uses correct SuiExtraArgsV1Tag (0x21ea4ca9)', () => {
    const encoded = encodeSolanaSuiExtraArgsV1({
      gasLimit: 0n,
      allowOutOfOrderExecution: false,
      tokenReceiver: '0x' + '00'.repeat(32),
      receiverObjectIds: [],
    })
    assert.equal(encoded.slice(0, 10), SuiExtraArgsV1Tag)
  })
})

describe('SuiExtraArgsV1 BCS codec (Sui source)', () => {
  // BCS-encoded SuiExtraArgsV1 from a Sui source chain.
  // Same field layout as Borsh, but vec count uses ULEB128 (1 byte for small counts)
  // instead of 4-byte LE.
  //
  // gasLimit=200000 → u128 LE: 400d0300000000000000000000000000
  // allowOutOfOrderExecution=true → 01
  // tokenReceiver=[u8;32] → 32×0x11 (fixed array, no length prefix)
  // receiverObjectIds=Vec<[u8;32]> → ULEB128 count=01 + 32×0x22
  const SYNTHETIC_BCS_1 =
    SuiExtraArgsV1Tag +
    '400d0300000000000000000000000000' + // gasLimit u128 LE
    '01' + // allowOutOfOrderExecution
    '11'.repeat(32) + // tokenReceiver [u8;32]
    '01' + // receiverObjectIds count (BCS ULEB128 = 1)
    '22'.repeat(32) // receiverObjectIds[0]

  it('decodes BCS-encoded SuiExtraArgsV1 from synthetic bytes', () => {
    const decoded = decodeMoveExtraArgs(SYNTHETIC_BCS_1)
    assert.ok(decoded, 'should decode')
    assert.equal(decoded._tag, 'SuiExtraArgsV1')
    assert.equal(decoded.gasLimit, 200000n)
    assert.equal(decoded.allowOutOfOrderExecution, true)
    assert.equal(decoded.tokenReceiver, '0x' + '11'.repeat(32))
    assert.equal(decoded.receiverObjectIds.length, 1)
    assert.equal(decoded.receiverObjectIds[0], '0x' + '22'.repeat(32))
  })

  it('encodes via Sui BCS codec and round-trips through decodeMoveExtraArgs', () => {
    const encoded = encodeSuiExtraArgsV1({
      gasLimit: 200000n,
      allowOutOfOrderExecution: true,
      tokenReceiver: '0x' + '11'.repeat(32),
      receiverObjectIds: ['0x' + '22'.repeat(32)],
    })
    const decoded = decodeMoveExtraArgs(encoded)
    assert.ok(decoded, 'should decode')
    assert.equal(decoded._tag, 'SuiExtraArgsV1')
    assert.equal(decoded.gasLimit, 200000n)
    assert.equal(decoded.allowOutOfOrderExecution, true)
    assert.equal(decoded.receiverObjectIds.length, 1)
  })

  it('encodes gasLimit as u128 in BCS (16 bytes LE)', () => {
    const encoded = encodeSuiExtraArgsV1({
      gasLimit: 1n << 64n,
      allowOutOfOrderExecution: false,
      tokenReceiver: '0x' + '00'.repeat(32),
      receiverObjectIds: [],
    })
    const bytes = Buffer.from(encoded.slice(2), 'hex')
    // tag(4) + gasLimit(16) = offset 4..20
    const gasLimitBytes = bytes.subarray(4, 20)
    assert.equal(gasLimitBytes.length, 16, 'gasLimit must be 16 bytes (u128)')
    assert.equal(gasLimitBytes[8], 1, 'high u64 should be 1')
  })

  it('BCS and Borsh differ in vec count encoding', () => {
    // BCS uses ULEB128 for vec count, Borsh uses 4-byte LE.
    // For count=1: BCS = 0x01 (1 byte), Borsh = 0x01000000 (4 bytes).
    // The two encodings should NOT be byte-identical when receiverObjectIds is non-empty.
    const args = {
      gasLimit: 200000n,
      allowOutOfOrderExecution: true,
      tokenReceiver: '0x' + '11'.repeat(32),
      receiverObjectIds: ['0x' + '22'.repeat(32)],
    }
    const bcs = encodeSuiExtraArgsV1(args)
    const borsh = encodeSolanaSuiExtraArgsV1(args)
    assert.notEqual(bcs, borsh, 'BCS and Borsh must differ (vec count encoding)')
    // BCS payload is shorter by 3 bytes (ULEB128 1 byte vs u32 4 bytes)
    assert.equal((bcs.length - 2) / 2, (borsh.length - 2) / 2 - 3, 'BCS should be 3 bytes shorter')
  })

  it('decodes BCS SuiExtraArgsV1 with empty receiverObjectIds', () => {
    // BCS with empty vec: count=00 (ULEB128), no elements
    const synthetic =
      SuiExtraArgsV1Tag +
      '00000000000000000000000000000000' + // gasLimit=0 u128 LE
      '00' + // allowOutOfOrderExecution=false
      '00'.repeat(32) + // tokenReceiver
      '00' // receiverObjectIds count (ULEB128 = 0)
    const decoded = decodeMoveExtraArgs(synthetic)
    assert.ok(decoded, 'should decode')
    assert.equal(decoded._tag, 'SuiExtraArgsV1')
    assert.equal(decoded.gasLimit, 0n)
    assert.equal(decoded.allowOutOfOrderExecution, false)
    assert.equal(decoded.receiverObjectIds.length, 0)
  })
})
