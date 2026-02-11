import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dataSlice, getNumber } from 'ethers'

// Import index.ts to ensure all Chain classes are loaded and registered
import './index.ts'
import {
  type GenericExtraArgsV3,
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

describe('GenericExtraArgsV3', () => {
  describe('encoding', () => {
    it('should encode V3 args with correct tag', () => {
      const args: GenericExtraArgsV3 = {
        gasLimit: 200_000n,
        blockConfirmations: 5,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(args, ChainFamily.EVM)
      assert.match(encoded, /^0xa69dd4aa/) // GenericExtraArgsV3Tag
    })

    it('should encode gasLimit as uint32 big-endian', () => {
      const args: GenericExtraArgsV3 = {
        gasLimit: 0x12345678n,
        blockConfirmations: 0,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(args, ChainFamily.EVM)
      // After 4-byte tag, next 4 bytes should be gasLimit
      assert.equal(dataSlice(encoded, 4, 8), '0x12345678')
    })

    it('should encode blockConfirmations as uint16 big-endian', () => {
      const args: GenericExtraArgsV3 = {
        gasLimit: 0n,
        blockConfirmations: 0x1234,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(args, ChainFamily.EVM)
      // After 4-byte tag + 4-byte gasLimit, next 2 bytes should be blockConfirmations
      assert.equal(dataSlice(encoded, 8, 10), '0x1234')
    })
  })

  describe('decoding', () => {
    it('should decode V3 args with empty arrays', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 200_000n,
        blockConfirmations: 5,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM)

      assert.equal(decoded?._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 200_000n)
      assert.equal((decoded as GenericExtraArgsV3).blockConfirmations, 5)
      assert.deepEqual((decoded as GenericExtraArgsV3).ccvs, [])
      assert.deepEqual((decoded as GenericExtraArgsV3).ccvArgs, [])
      assert.equal((decoded as GenericExtraArgsV3).executor, '')
      assert.equal((decoded as GenericExtraArgsV3).tokenReceiver, '')
    })

    it('should decode V3 args with CCVs', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 100_000n,
        blockConfirmations: 10,
        ccvs: ['0x1234567890123456789012345678901234567890'],
        ccvArgs: ['0x01020304'],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as GenericExtraArgsV3 & {
        _tag: string
      }

      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.ccvs.length, 1)
      assert.equal(decoded.ccvs[0]?.toLowerCase(), '0x1234567890123456789012345678901234567890')
      assert.equal(decoded.ccvArgs[0], '0x01020304')
    })

    it('should decode V3 args with executor', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 50_000n,
        blockConfirmations: 0,
        ccvs: [],
        ccvArgs: [],
        executor: '0xabcdefABCDEF123456789012345678901234ABCD',
        executorArgs: '0xaabb',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as GenericExtraArgsV3 & {
        _tag: string
      }

      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.executor.toLowerCase(), '0xabcdefabcdef123456789012345678901234abcd')
      assert.equal(decoded.executorArgs, '0xaabb')
    })

    it('should decode V3 args with tokenReceiver and tokenArgs', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 300_000n,
        blockConfirmations: 15,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '0x0102030405060708090a0b0c0d0e0f1011121314',
        tokenArgs: '0xffeedd',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as GenericExtraArgsV3 & {
        _tag: string
      }

      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      // 20 bytes = EVM address, decoded to checksummed format
      assert.equal(
        decoded.tokenReceiver.toLowerCase(),
        '0x0102030405060708090a0b0c0d0e0f1011121314',
      )
      assert.equal(decoded.tokenArgs, '0xffeedd')
    })
  })

  describe('round-trip encoding/decoding', () => {
    it('should round-trip minimal V3 args', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 200_000n,
        blockConfirmations: 5,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as GenericExtraArgsV3 & {
        _tag: string
      }

      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, original.gasLimit)
      assert.equal(decoded.blockConfirmations, original.blockConfirmations)
      assert.deepEqual(decoded.ccvs, original.ccvs)
      assert.deepEqual(decoded.ccvArgs, original.ccvArgs)
      assert.equal(decoded.executor, original.executor)
      assert.equal(decoded.executorArgs, '0x')
      assert.equal(decoded.tokenReceiver, '')
      assert.equal(decoded.tokenArgs, '0x')
    })

    it('should round-trip V3 args with all fields populated', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 500_000n,
        blockConfirmations: 20,
        ccvs: [
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
        ],
        ccvArgs: ['0x010203', '0x0405060708'],
        executor: '0x3333333333333333333333333333333333333333',
        executorArgs: '0x102030',
        tokenReceiver: '0xa1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4',
        tokenArgs: '0xccddeeff',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as GenericExtraArgsV3 & {
        _tag: string
      }

      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, original.gasLimit)
      assert.equal(decoded.blockConfirmations, original.blockConfirmations)
      assert.equal(decoded.ccvs.length, 2)
      assert.equal(decoded.ccvs[0]?.toLowerCase(), original.ccvs[0]!.toLowerCase())
      assert.equal(decoded.ccvs[1]?.toLowerCase(), original.ccvs[1]!.toLowerCase())
      assert.equal(decoded.ccvArgs[0], '0x010203')
      assert.equal(decoded.ccvArgs[1], '0x0405060708')
      assert.equal(decoded.executor.toLowerCase(), original.executor.toLowerCase())
      assert.equal(decoded.executorArgs, '0x102030')
      // tokenReceiver is 20 bytes, returned as checksummed EVM address
      assert.equal(decoded.tokenReceiver.toLowerCase(), original.tokenReceiver.toLowerCase())
      assert.equal(decoded.tokenArgs, '0xccddeeff')
    })

    it('should round-trip V3 args with max uint32 gasLimit', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: BigInt(0xffffffff), // max uint32
        blockConfirmations: 0xffff, // max uint16
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded, ChainFamily.EVM) as GenericExtraArgsV3 & {
        _tag: string
      }

      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, BigInt(0xffffffff))
      assert.equal(decoded.blockConfirmations, 0xffff)
    })
  })

  describe('auto-detect chain family', () => {
    it('should auto-detect V3 args', () => {
      const original: GenericExtraArgsV3 = {
        gasLimit: 100_000n,
        blockConfirmations: 3,
        ccvs: [],
        ccvArgs: [],
        executor: '',
        executorArgs: '0x',
        tokenReceiver: '',
        tokenArgs: '0x',
      }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = decodeExtraArgs(encoded) // no chain family specified

      assert.equal(decoded?._tag, 'GenericExtraArgsV3')
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

  describe('canonical test vectors', () => {
    // These test vectors were generated using a Forge script that calls the actual
    // ExtraArgsCodec.sol library from the CCIP 2.0 contract code. The hex strings
    // are canonical reference values produced by the on-chain encoder.

    it('should decode test vector: minimal', () => {
      // gasLimit=200000, blockConfirmations=1, all empty
      const decoded = decodeExtraArgs(
        '0xa69dd4aa00030d40000100000000000000',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 200000n)
      assert.equal(decoded.blockConfirmations, 1)
      assert.deepEqual(decoded.ccvs, [])
      assert.deepEqual(decoded.ccvArgs, [])
      assert.equal(decoded.executor, '')
      assert.equal(decoded.executorArgs, '0x')
      assert.equal(decoded.tokenReceiver, '')
      assert.equal(decoded.tokenArgs, '0x')
    })

    it('should decode test vector: all zeros', () => {
      // All fields zero/empty
      const decoded = decodeExtraArgs(
        '0xa69dd4aa00000000000000000000000000',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 0n)
      assert.equal(decoded.blockConfirmations, 0)
      assert.deepEqual(decoded.ccvs, [])
      assert.deepEqual(decoded.ccvArgs, [])
      assert.equal(decoded.executor, '')
      assert.equal(decoded.executorArgs, '0x')
      assert.equal(decoded.tokenReceiver, '')
      assert.equal(decoded.tokenArgs, '0x')
    })

    it('should decode test vector: max values', () => {
      // gasLimit=4294967295 (max uint32), blockConfirmations=65535 (max uint16)
      const decoded = decodeExtraArgs(
        '0xa69dd4aaffffffffffff00000000000000',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 4294967295n)
      assert.equal(decoded.blockConfirmations, 65535)
      assert.deepEqual(decoded.ccvs, [])
      assert.deepEqual(decoded.ccvArgs, [])
      assert.equal(decoded.executor, '')
      assert.equal(decoded.executorArgs, '0x')
      assert.equal(decoded.tokenReceiver, '')
      assert.equal(decoded.tokenArgs, '0x')
    })

    it('should decode test vector: with executor', () => {
      // gasLimit=400000, blockConfirmations=5, executor=0x9fca2fa95be0944a4ad731474dd3cdb1b704f9c6, executorArgs="data"
      const decoded = decodeExtraArgs(
        '0xa69dd4aa00061a80000500149fca2fa95be0944a4ad731474dd3cdb1b704f9c6000464617461000000',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 400000n)
      assert.equal(decoded.blockConfirmations, 5)
      assert.deepEqual(decoded.ccvs, [])
      assert.deepEqual(decoded.ccvArgs, [])
      assert.equal(decoded.executor.toLowerCase(), '0x9fca2fa95be0944a4ad731474dd3cdb1b704f9c6')
      assert.equal(decoded.executorArgs, '0x64617461') // "data"
      assert.equal(decoded.tokenReceiver, '')
      assert.equal(decoded.tokenArgs, '0x')
    })

    it('should decode test vector: with 2 CCVs', () => {
      // gasLimit=300000, blockConfirmations=10, 2 CCVs with "args1"/"args2"
      const decoded = decodeExtraArgs(
        '0xa69dd4aa000493e0000a021497cb3391ea73689a81b6853deb104dd078538f6b0005617267733114a0b7e3c01fcd94560317638a6b01f81846dee14400056172677332000000000000',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 300000n)
      assert.equal(decoded.blockConfirmations, 10)
      assert.equal(decoded.ccvs.length, 2)
      assert.equal(decoded.ccvs[0]?.toLowerCase(), '0x97cb3391ea73689a81b6853deb104dd078538f6b')
      assert.equal(decoded.ccvs[1]?.toLowerCase(), '0xa0b7e3c01fcd94560317638a6b01f81846dee144')
      assert.equal(decoded.ccvArgs[0], '0x6172677331') // "args1"
      assert.equal(decoded.ccvArgs[1], '0x6172677332') // "args2"
      assert.equal(decoded.executor, '')
      assert.equal(decoded.executorArgs, '0x')
      assert.equal(decoded.tokenReceiver, '')
      assert.equal(decoded.tokenArgs, '0x')
    })

    it('should decode test vector: full fields', () => {
      // All fields populated: gasLimit=200000, blockConfirmations=12, 2 CCVs, executor, tokenReceiver, tokenArgs
      const decoded = decodeExtraArgs(
        '0xa69dd4aa00030d40000c021497cb3391ea73689a81b6853deb104dd078538f6b0005617267733114a0b7e3c01fcd94560317638a6b01f81846dee14400056172677332149fca2fa95be0944a4ad731474dd3cdb1b704f9c60008657865634172677314c9f66ef22b2e26c2af10fcf8847ac4a920ab3eaa0009746f6b656e41726773',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 200000n)
      assert.equal(decoded.blockConfirmations, 12)
      assert.equal(decoded.ccvs.length, 2)
      assert.equal(decoded.ccvs[0]?.toLowerCase(), '0x97cb3391ea73689a81b6853deb104dd078538f6b')
      assert.equal(decoded.ccvs[1]?.toLowerCase(), '0xa0b7e3c01fcd94560317638a6b01f81846dee144')
      assert.equal(decoded.ccvArgs[0], '0x6172677331') // "args1"
      assert.equal(decoded.ccvArgs[1], '0x6172677332') // "args2"
      assert.equal(decoded.executor.toLowerCase(), '0x9fca2fa95be0944a4ad731474dd3cdb1b704f9c6')
      // "execArgs" (note capital A) = 0x65 78 65 63 41 72 67 73
      assert.equal(decoded.executorArgs, '0x6578656341726773')
      // tokenReceiver is 20 bytes -> checksummed EVM address
      assert.equal(
        decoded.tokenReceiver.toLowerCase(),
        '0xc9f66ef22b2e26c2af10fcf8847ac4a920ab3eaa',
      )
      // "tokenArgs" (note capital A) = 0x74 6f 6b 65 6e 41 72 67 73
      assert.equal(decoded.tokenArgs, '0x746f6b656e41726773')
    })

    it('should decode test vector: zero-address CCVs', () => {
      // 2 CCVs with address(0), executor with 40-byte string args, tokenReceiver with 40-byte string
      const decoded = decodeExtraArgs(
        '0xa69dd4aa0000e86b00220200000000000014123456789012345678901234567890123456789000283332383233383934323839333538373233353938373233393538383537393238333932373335323528333238323338393432383933353837323335393837323332393338353739323833373237333532350000',
        ChainFamily.EVM,
      ) as GenericExtraArgsV3 & { _tag: string }
      assert.equal(decoded._tag, 'GenericExtraArgsV3')
      assert.equal(decoded.gasLimit, 59499n)
      assert.equal(decoded.blockConfirmations, 34)
      assert.equal(decoded.ccvs.length, 2)
      // CCVs with address(0) are decoded as empty strings
      assert.equal(decoded.ccvs[0], '')
      assert.equal(decoded.ccvs[1], '')
      assert.equal(decoded.ccvArgs[0], '0x') // empty
      assert.equal(decoded.ccvArgs[1], '0x') // empty
      assert.equal(decoded.executor.toLowerCase(), '0x1234567890123456789012345678901234567890')
      // executorArgs is "3282389428935872359872395885792839273525" (40 bytes = 80 hex chars + "0x" prefix)
      assert.equal(decoded.executorArgs.length, 82)
      // tokenReceiver is 40 bytes (not 20) -> hex string format
      assert.equal(
        decoded.tokenReceiver,
        '0x33323832333839343238393335383732333539383732333239333835373932383337323733353235',
      )
      assert.equal(decoded.tokenArgs, '0x')
    })
  })
})
