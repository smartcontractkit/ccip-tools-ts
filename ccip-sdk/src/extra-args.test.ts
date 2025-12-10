import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dataSlice, getNumber } from 'ethers'

// Import index.ts to ensure all Chain classes are loaded and registered
import './index.ts'
import {
  EVMExtraArgsV2Tag,
  GenericExtraArgsV2Tag,
  decodeExtraArgs,
  encodeExtraArgs,
} from './extra-args.ts'
import { extractMagicTag } from './ton/utils.ts'
import { ChainFamily } from './types.ts'

describe('encodeExtraArgs', () => {
  describe('EVM extra args', () => {
    it('should encode v2 args with allowOutOfOrderExecution', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: true },
        ChainFamily.EVM,
      )
      assert.match(encoded, /^0x181dcf10/) // EVMExtraArgsV2Tag
      assert.equal(getNumber(dataSlice(encoded, 4, 4 + 32)), 200_000) // gas limit
      assert.equal(getNumber(dataSlice(encoded, 4 + 32, 4 + 32 * 2)), 1) // bool true
    })

    it('should encode v2 args with default gas limit', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: false },
        ChainFamily.EVM,
      )
      assert.match(encoded, /^0x181dcf10/) // EVMExtraArgsV2Tag
      assert.equal(getNumber(dataSlice(encoded, 4, 4 + 32)), 200_000) // default gas limit
      assert.equal(getNumber(dataSlice(encoded, 4 + 32, 4 + 32 * 2)), 0) // bool false
    })

    it('should encode v1 args with custom gas limit', () => {
      const encoded = encodeExtraArgs({ gasLimit: 100_000n }, ChainFamily.EVM)
      assert.match(encoded, /^0x97a657c9/) // EVMExtraArgsV1Tag
      assert.equal(getNumber(dataSlice(encoded, 4, 4 + 32)), 100_000) // custom gas limit
    })

    it('should default to empty string when no args provided', () => {
      const encoded = encodeExtraArgs({} as any, ChainFamily.EVM)
      assert.equal(encoded, '0x')
    })
  })

  describe('Solana extra args', () => {
    it('should encode EVMExtraArgsV2 from Solana (compact encoding)', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: false },
        ChainFamily.Solana,
      )
      assert.match(encoded, /^0x181dcf10/) // EVMExtraArgsV2Tag
      // Solana uses compact encoding (uint128 little-endian instead of uint256)
      assert.equal(encoded.length, 2 + 2 * (4 + 16 + 1)) // Much shorter than EVM encoding
    })

    it('should encode EVMExtraArgsV2 with allowOutOfOrderExecution from Solana', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 500_000n, allowOutOfOrderExecution: true },
        ChainFamily.Solana,
      )
      assert.match(encoded, /^0x181dcf10/) // EVMExtraArgsV2Tag
      assert.match(encoded, /01$/) // boolean true at the end
    })
  })

  describe('Aptos extra args', () => {
    it('should encode EVMExtraArgsV2 from Aptos (compact encoding)', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 300_000n, allowOutOfOrderExecution: false },
        ChainFamily.Aptos,
      )
      assert.match(encoded, /^0x181dcf10/) // EVMExtraArgsV2Tag
      // Aptos uses compact encoding similar to Solana
      assert.equal(encoded.length, 2 + 2 * (4 + 32 + 1)) // Much shorter than EVM encoding
    })
  })
  describe('TON extra args', () => {
    it('should encode EVMExtraArgsV2', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 400_000n, allowOutOfOrderExecution: true },
        ChainFamily.TON,
      )

      assert.equal(extractMagicTag(encoded), GenericExtraArgsV2Tag)
      assert.ok(encoded.length > 10)
    })

    it('should encode GenericExtraArgsV2 with allowOutOfOrderExecution false', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 500_000n, allowOutOfOrderExecution: false },
        ChainFamily.TON,
      )

      assert.equal(extractMagicTag(encoded), GenericExtraArgsV2Tag)
      assert.ok(encoded.length > 10)
    })
  })
})

describe('parseExtraArgs', () => {
  describe('EVM extra args', () => {
    it('should parse v1 args', () => {
      const res = decodeExtraArgs(
        '0x97a657c9000000000000000000000000000000000000000000000000000000000000000a',
        ChainFamily.EVM,
      )
      assert.deepEqual(res, { _tag: 'EVMExtraArgsV1', gasLimit: 10n })
    })

    it('should parse v2 args with allowOutOfOrderExecution true', () => {
      const res = decodeExtraArgs(
        '0x181dcf10000000000000000000000000000000000000000000000000000000000000000b0000000000000000000000000000000000000000000000000000000000000001',
        ChainFamily.EVM,
      )
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 11n,
        allowOutOfOrderExecution: true,
      })
    })

    it('should parse v2 args with allowOutOfOrderExecution false', () => {
      const res = decodeExtraArgs(
        '0x181dcf10000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000',
        ChainFamily.EVM,
      )
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 12n,
        allowOutOfOrderExecution: false,
      })
    })
  })

  describe('Solana extra args (compact encoding)', () => {
    it('should parse Solana-encoded extraArgs case', () => {
      const res = decodeExtraArgs(
        '0x181dcf10400d030000000000000000000000000000',
        ChainFamily.Solana,
      )
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 200000n,
        allowOutOfOrderExecution: false,
      })
    })
  })

  describe('Aptos extra args (compact encoding)', () => {
    it('should parse Aptos-encoded extraArgs case', () => {
      const res = decodeExtraArgs(
        '0x181dcf10e09304000000000000000000000000000000000000000000000000000000000000',
        ChainFamily.Aptos,
      )
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 300000n,
        allowOutOfOrderExecution: false,
      })
    })
  })
  describe('TON extra args (TLB encoding)', () => {
    it('should parse EVMExtraArgsV2 (GenericExtraArgsV2)', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 400_000n, allowOutOfOrderExecution: true },
        ChainFamily.TON,
      )
      const res = decodeExtraArgs(encoded, ChainFamily.TON)
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 400000n,
        allowOutOfOrderExecution: true,
      })
    })

    it('should parse EVMExtraArgsV2 (GenericExtraArgsV2) with allowOutOfOrderExecution false', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 500_000n, allowOutOfOrderExecution: false },
        ChainFamily.TON,
      )
      const res = decodeExtraArgs(encoded, ChainFamily.TON)
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 500000n,
        allowOutOfOrderExecution: false,
      })
    })
  })

  describe('auto-detect chain family', () => {
    it('should auto-detect EVM v1 args', () => {
      const res = decodeExtraArgs(
        '0x97a657c9000000000000000000000000000000000000000000000000000000000000000a',
      )
      assert.deepEqual(res, { _tag: 'EVMExtraArgsV1', gasLimit: 10n })
    })

    it('should auto-detect Solana-encoded v2 args', () => {
      const res = decodeExtraArgs(
        '0x181dcf10400d030000000000000000000000000000',
        ChainFamily.Solana,
      )
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 200000n,
        allowOutOfOrderExecution: false,
      })
    })

    it('should throw on unknown tag', () => {
      assert.throws(() => decodeExtraArgs('0x12345678'), /Could not parse extraArgs/)
    })

    it('should throw on empty data', () => {
      assert.throws(() => decodeExtraArgs('0x'))
    })
  })

  describe('round-trip encoding/decoding', () => {
    it('should round-trip EVM v1 args', () => {
      const original = { gasLimit: 123_456n }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM)
      assert.deepEqual(decoded, { ...original, _tag: 'EVMExtraArgsV1' })
    })

    it('should round-trip EVM v2 args', () => {
      const original = { gasLimit: 250_000n, allowOutOfOrderExecution: true }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM)
      assert.deepEqual(decoded, { ...original, _tag: 'EVMExtraArgsV2' })
    })

    it('should round-trip Solana-encoded v2 args', () => {
      const original = { gasLimit: 500_000n, allowOutOfOrderExecution: true }
      const encoded = encodeExtraArgs(original, ChainFamily.Solana)
      const decoded = decodeExtraArgs(encoded, ChainFamily.Solana)
      assert.deepEqual(decoded, { ...original, _tag: 'EVMExtraArgsV2' })
    })

    it('should round-trip Aptos-encoded v2 args', () => {
      const original = { gasLimit: 300_000n, allowOutOfOrderExecution: false }
      const encoded = encodeExtraArgs(original, ChainFamily.Aptos)
      const decoded = decodeExtraArgs(encoded, ChainFamily.Aptos)
      assert.deepEqual(decoded, { ...original, _tag: 'EVMExtraArgsV2' })
    })

    it('should round-trip TON EVMExtraArgsV2', () => {
      const original = { gasLimit: 400_000n, allowOutOfOrderExecution: true }
      const encoded = encodeExtraArgs(original, ChainFamily.TON)
      const decoded = decodeExtraArgs(encoded, ChainFamily.TON)
      assert.deepEqual(decoded, { ...original, _tag: 'EVMExtraArgsV2' })
    })
  })

  describe('encoding format differences', () => {
    it('should produce different encodings for EVM vs Solana', () => {
      const args = { gasLimit: 200_000n, allowOutOfOrderExecution: false }
      const evmEncoded = encodeExtraArgs(args, ChainFamily.EVM)
      const solanaEncoded = encodeExtraArgs(args, ChainFamily.Solana)

      // Both should have the same tag
      assert.equal(evmEncoded.substring(0, 10), solanaEncoded.substring(0, 10))
      // But different lengths (EVM uses uint256, Solana uses uint128)
      assert.ok(evmEncoded.length > solanaEncoded.length)
    })

    it('should produce different encodings for EVM vs Aptos', () => {
      const args = { gasLimit: 300_000n, allowOutOfOrderExecution: false }
      const evmEncoded = encodeExtraArgs(args, ChainFamily.EVM)
      const aptosEncoded = encodeExtraArgs(args, ChainFamily.Aptos)

      // Both should have the same tag
      assert.equal(evmEncoded.substring(0, 10), aptosEncoded.substring(0, 10))
      // But different lengths
      assert.ok(evmEncoded.length > aptosEncoded.length)
    })

    it('should produce different encodings for EVM vs TON', () => {
      const args = { gasLimit: 300_000n, allowOutOfOrderExecution: false }
      const evmEncoded = encodeExtraArgs(args, ChainFamily.EVM)
      const tonEncoded = encodeExtraArgs(args, ChainFamily.TON)

      assert.equal(evmEncoded.substring(0, 10), EVMExtraArgsV2Tag)
      assert.equal(extractMagicTag(tonEncoded), GenericExtraArgsV2Tag)
      assert.notEqual(evmEncoded, tonEncoded)
    })
  })
})
