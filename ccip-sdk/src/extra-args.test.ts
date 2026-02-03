import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dataSlice, getNumber } from 'ethers'

// Import index.ts to ensure all Chain classes are loaded and registered
import './index.ts'
import {
  type EVMExtraArgsV3,
  EVMExtraArgsV2Tag,
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
    it('should encode EVMExtraArgsV2 (GenericExtraArgsV2)', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 400_000n, allowOutOfOrderExecution: true },
        ChainFamily.TON,
      )

      assert.equal(extractMagicTag(encoded), EVMExtraArgsV2Tag)
      assert.ok(encoded.length > 10)
    })

    it('should encode EVMExtraArgsV2 (GenericExtraArgsV2) with allowOutOfOrderExecution false', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 500_000n, allowOutOfOrderExecution: false },
        ChainFamily.TON,
      )

      assert.equal(extractMagicTag(encoded), EVMExtraArgsV2Tag)
      assert.ok(encoded.length > 10)
    })

    it('should parse real Sepolia->TON message extraArgs', () => {
      // https://sepolia.etherscan.io/tx/0x6bdfcce8def68f19f40d340bc38d01866c10a4c92685df1c3d08180280a4ccac
      const res = decodeExtraArgs(
        '0x181dcf100000000000000000000000000000000000000000000000000000000005f5e1000000000000000000000000000000000000000000000000000000000000000001',
        ChainFamily.EVM,
      )
      assert.deepEqual(res, {
        _tag: 'EVMExtraArgsV2',
        gasLimit: 100_000_000n,
        allowOutOfOrderExecution: true,
      })
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
      assert.equal(extractMagicTag(tonEncoded), EVMExtraArgsV2Tag)
      assert.notEqual(evmEncoded, tonEncoded)
    })
  })
})

describe('EVMExtraArgsV3', () => {
  describe('encoding', () => {
    it('should encode V3 args with correct tag', () => {
      const args: EVMExtraArgsV3 = {
        gasLimit: 200_000n,
        blockConfirmations: 5,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(args, ChainFamily.EVM)
      assert.match(encoded, /^0x302326cb/) // EVMExtraArgsV3Tag
    })

    it('should encode gasLimit as uint32 big-endian', () => {
      const args: EVMExtraArgsV3 = {
        gasLimit: 0x12345678n,
        blockConfirmations: 0,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(args, ChainFamily.EVM)
      // After 4-byte tag, next 4 bytes should be gasLimit
      assert.equal(dataSlice(encoded, 4, 8), '0x12345678')
    })

    it('should encode blockConfirmations as uint16 big-endian', () => {
      const args: EVMExtraArgsV3 = {
        gasLimit: 0n,
        blockConfirmations: 0x1234,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(args, ChainFamily.EVM)
      // After 4-byte tag + 4-byte gasLimit, next 2 bytes should be blockConfirmations
      assert.equal(dataSlice(encoded, 8, 10), '0x1234')
    })
  })

  describe('decoding', () => {
    it('should decode V3 args with empty arrays', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 200_000n,
        blockConfirmations: 5,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM)

      assert.equal(decoded?._tag, 'EVMExtraArgsV3')
      assert.equal(decoded?.gasLimit, 200_000n)
      assert.equal((decoded as EVMExtraArgsV3).blockConfirmations, 5)
      assert.deepEqual((decoded as EVMExtraArgsV3).ccvs, [])
      assert.deepEqual((decoded as EVMExtraArgsV3).ccvArgs, [])
      assert.equal((decoded as EVMExtraArgsV3).executor, '')
    })

    it('should decode V3 args with CCVs', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 100_000n,
        blockConfirmations: 10,
        ccvs: ['0x1234567890123456789012345678901234567890'],
        ccvArgs: [new Uint8Array([1, 2, 3, 4])],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as EVMExtraArgsV3 & { _tag: string }

      assert.equal(decoded._tag, 'EVMExtraArgsV3')
      assert.equal(decoded.ccvs.length, 1)
      assert.equal(decoded.ccvs[0]?.toLowerCase(), '0x1234567890123456789012345678901234567890')
      assert.deepEqual(decoded.ccvArgs[0], new Uint8Array([1, 2, 3, 4]))
    })

    it('should decode V3 args with executor', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 50_000n,
        blockConfirmations: 0,
        ccvs: [],
        ccvArgs: [],
        executor: '0xabcdefABCDEF123456789012345678901234ABCD',
        executorArgs: new Uint8Array([0xaa, 0xbb]),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as EVMExtraArgsV3 & { _tag: string }

      assert.equal(decoded._tag, 'EVMExtraArgsV3')
      assert.equal(decoded.executor.toLowerCase(), '0xabcdefabcdef123456789012345678901234abcd')
      assert.deepEqual(decoded.executorArgs, new Uint8Array([0xaa, 0xbb]))
    })

    it('should decode V3 args with tokenReceiver and tokenArgs', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 300_000n,
        blockConfirmations: 15,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        ]),
        tokenArgs: new Uint8Array([0xff, 0xee, 0xdd]),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as EVMExtraArgsV3 & { _tag: string }

      assert.equal(decoded._tag, 'EVMExtraArgsV3')
      assert.deepEqual(decoded.tokenReceiver, original.tokenReceiver)
      assert.deepEqual(decoded.tokenArgs, original.tokenArgs)
    })
  })

  describe('round-trip encoding/decoding', () => {
    it('should round-trip minimal V3 args', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 200_000n,
        blockConfirmations: 5,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as EVMExtraArgsV3 & { _tag: string }

      assert.equal(decoded._tag, 'EVMExtraArgsV3')
      assert.equal(decoded.gasLimit, original.gasLimit)
      assert.equal(decoded.blockConfirmations, original.blockConfirmations)
      assert.deepEqual(decoded.ccvs, original.ccvs)
      assert.deepEqual(decoded.ccvArgs, original.ccvArgs)
      assert.equal(decoded.executor, original.executor)
      assert.deepEqual(decoded.executorArgs, original.executorArgs)
      assert.deepEqual(decoded.tokenReceiver, original.tokenReceiver)
      assert.deepEqual(decoded.tokenArgs, original.tokenArgs)
    })

    it('should round-trip V3 args with all fields populated', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 500_000n,
        blockConfirmations: 20,
        ccvs: [
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
        ],
        ccvArgs: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7, 8])],
        executor: '0x3333333333333333333333333333333333333333',
        executorArgs: new Uint8Array([0x10, 0x20, 0x30]),
        tokenReceiver: new Uint8Array([
          0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf,
          0xb0, 0xb1, 0xb2, 0xb3, 0xb4,
        ]),
        tokenArgs: new Uint8Array([0xcc, 0xdd, 0xee, 0xff]),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as EVMExtraArgsV3 & { _tag: string }

      assert.equal(decoded._tag, 'EVMExtraArgsV3')
      assert.equal(decoded.gasLimit, original.gasLimit)
      assert.equal(decoded.blockConfirmations, original.blockConfirmations)
      assert.equal(decoded.ccvs.length, 2)
      assert.equal(decoded.ccvs[0]?.toLowerCase(), original.ccvs[0]!.toLowerCase())
      assert.equal(decoded.ccvs[1]?.toLowerCase(), original.ccvs[1]!.toLowerCase())
      assert.deepEqual(decoded.ccvArgs[0], original.ccvArgs[0])
      assert.deepEqual(decoded.ccvArgs[1], original.ccvArgs[1])
      assert.equal(decoded.executor.toLowerCase(), original.executor.toLowerCase())
      assert.deepEqual(decoded.executorArgs, original.executorArgs)
      assert.deepEqual(decoded.tokenReceiver, original.tokenReceiver)
      assert.deepEqual(decoded.tokenArgs, original.tokenArgs)
    })

    it('should round-trip V3 args with max uint32 gasLimit', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: BigInt(0xffffffff), // max uint32
        blockConfirmations: 0xffff, // max uint16
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as EVMExtraArgsV3 & { _tag: string }

      assert.equal(decoded._tag, 'EVMExtraArgsV3')
      assert.equal(decoded.gasLimit, BigInt(0xffffffff))
      assert.equal(decoded.blockConfirmations, 0xffff)
    })
  })

  describe('auto-detect chain family', () => {
    it('should auto-detect V3 args', () => {
      const original: EVMExtraArgsV3 = {
        gasLimit: 100_000n,
        blockConfirmations: 3,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: new Uint8Array(0),
        tokenReceiver: new Uint8Array(0),
        tokenArgs: new Uint8Array(0),
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded) // no chain family specified

      assert.equal(decoded?._tag, 'EVMExtraArgsV3')
    })
  })

  describe('V1/V2 backward compatibility', () => {
    it('should still correctly decode V1 args after V3 addition', () => {
      const res = decodeExtraArgs(
        '0x97a657c9000000000000000000000000000000000000000000000000000000000000000a',
        ChainFamily.EVM,
      )
      assert.deepEqual(res, { _tag: 'EVMExtraArgsV1', gasLimit: 10n })
    })

    it('should still correctly decode V2 args after V3 addition', () => {
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

    it('should still correctly encode V1 args after V3 addition', () => {
      const encoded = encodeExtraArgs({ gasLimit: 100_000n }, ChainFamily.EVM)
      assert.match(encoded, /^0x97a657c9/) // EVMExtraArgsV1Tag
    })

    it('should still correctly encode V2 args after V3 addition', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: true },
        ChainFamily.EVM,
      )
      assert.match(encoded, /^0x181dcf10/) // EVMExtraArgsV2Tag
    })
  })
})
