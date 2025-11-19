import { dataSlice, getNumber } from 'ethers'

// Import index.ts to ensure all Chain classes are loaded and registered
import './index.ts'
import { ChainFamily } from './chain.ts'
import { encodeExtraArgs, parseExtraArgs } from './extra-args.ts'

describe('encodeExtraArgs', () => {
  describe('EVM extra args', () => {
    it('should encode v2 args with allowOutOfOrderExecution', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: true },
        ChainFamily.EVM,
      )
      expect(encoded).toMatch(/^0x181dcf10/) // EVMExtraArgsV2Tag
      expect(getNumber(dataSlice(encoded, 4, 4 + 32))).toBe(200_000) // gas limit
      expect(getNumber(dataSlice(encoded, 4 + 32, 4 + 32 * 2))).toBe(1) // bool true
    })

    it('should encode v2 args with default gas limit', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: false },
        ChainFamily.EVM,
      )
      expect(encoded).toMatch(/^0x181dcf10/) // EVMExtraArgsV2Tag
      expect(getNumber(dataSlice(encoded, 4, 4 + 32))).toBe(200_000) // default gas limit
      expect(getNumber(dataSlice(encoded, 4 + 32, 4 + 32 * 2))).toBe(0) // bool false
    })

    it('should encode v1 args with custom gas limit', () => {
      const encoded = encodeExtraArgs({ gasLimit: 100_000n }, ChainFamily.EVM)
      expect(encoded).toMatch(/^0x97a657c9/) // EVMExtraArgsV1Tag
      expect(getNumber(dataSlice(encoded, 4, 4 + 32))).toBe(100_000) // custom gas limit
    })

    it('should default to empty string when no args provided', () => {
      const encoded = encodeExtraArgs({} as any, ChainFamily.EVM)
      expect(encoded).toBe('0x')
    })
  })

  describe('Solana extra args', () => {
    it('should encode EVMExtraArgsV2 from Solana (compact encoding)', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 200_000n, allowOutOfOrderExecution: false },
        ChainFamily.Solana,
      )
      expect(encoded).toMatch(/^0x181dcf10/) // EVMExtraArgsV2Tag
      // Solana uses compact encoding (uint128 little-endian instead of uint256)
      expect(encoded).toHaveLength(2 + 2 * (4 + 16 + 1)) // Much shorter than EVM encoding
    })

    it('should encode EVMExtraArgsV2 with allowOutOfOrderExecution from Solana', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 500_000n, allowOutOfOrderExecution: true },
        ChainFamily.Solana,
      )
      expect(encoded).toMatch(/^0x181dcf10/) // EVMExtraArgsV2Tag
      expect(encoded).toMatch(/01$/) // boolean true at the end
    })
  })

  describe('Aptos extra args', () => {
    it('should encode EVMExtraArgsV2 from Aptos (compact encoding)', () => {
      const encoded = encodeExtraArgs(
        { gasLimit: 300_000n, allowOutOfOrderExecution: false },
        ChainFamily.Aptos,
      )
      expect(encoded).toMatch(/^0x181dcf10/) // EVMExtraArgsV2Tag
      // Aptos uses compact encoding similar to Solana
      expect(encoded).toHaveLength(2 + 2 * (4 + 32 + 1)) // Much shorter than EVM encoding
    })
  })
})

describe('parseExtraArgs', () => {
  describe('EVM extra args', () => {
    it('should parse v1 args', () => {
      const res = parseExtraArgs(
        '0x97a657c9000000000000000000000000000000000000000000000000000000000000000a',
        ChainFamily.EVM,
      )
      expect(res).toEqual({ _tag: 'EVMExtraArgsV1', gasLimit: 10n })
    })

    it('should parse v2 args with allowOutOfOrderExecution true', () => {
      const res = parseExtraArgs(
        '0x181dcf10000000000000000000000000000000000000000000000000000000000000000b0000000000000000000000000000000000000000000000000000000000000001',
        ChainFamily.EVM,
      )
      expect(res).toEqual({ _tag: 'EVMExtraArgsV2', gasLimit: 11n, allowOutOfOrderExecution: true })
    })

    it('should parse v2 args with allowOutOfOrderExecution false', () => {
      const res = parseExtraArgs(
        '0x181dcf10000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000',
        ChainFamily.EVM,
      )
      expect(res).toEqual({
        _tag: 'EVMExtraArgsV2',
        gasLimit: 12n,
        allowOutOfOrderExecution: false,
      })
    })
  })

  describe('Solana extra args (compact encoding)', () => {
    it('should parse Solana-encoded extraArgs case', () => {
      const res = parseExtraArgs('0x181dcf10400d030000000000000000000000000000', ChainFamily.Solana)
      expect(res).toEqual({
        _tag: 'EVMExtraArgsV2',
        gasLimit: 200000n,
        allowOutOfOrderExecution: false,
      })
    })
  })

  describe('Aptos extra args (compact encoding)', () => {
    it('should parse Aptos-encoded extraArgs case', () => {
      const res = parseExtraArgs(
        '0x181dcf10e09304000000000000000000000000000000000000000000000000000000000000',
        ChainFamily.Aptos,
      )
      expect(res).toEqual({
        _tag: 'EVMExtraArgsV2',
        gasLimit: 300000n,
        allowOutOfOrderExecution: false,
      })
    })
  })

  describe('auto-detect chain family', () => {
    it('should auto-detect EVM v1 args', () => {
      const res = parseExtraArgs(
        '0x97a657c9000000000000000000000000000000000000000000000000000000000000000a',
      )
      expect(res).toEqual({ _tag: 'EVMExtraArgsV1', gasLimit: 10n })
    })

    it('should auto-detect Solana-encoded v2 args', () => {
      const res = parseExtraArgs('0x181dcf10400d030000000000000000000000000000', ChainFamily.Solana)
      expect(res).toEqual({
        _tag: 'EVMExtraArgsV2',
        gasLimit: 200000n,
        allowOutOfOrderExecution: false,
      })
    })

    it('should throw on unknown tag', () => {
      expect(() => parseExtraArgs('0x12345678')).toThrow('Could not parse extraArgs')
    })

    it('should throw on empty data', () => {
      expect(() => parseExtraArgs('0x')).toThrow()
    })
  })

  describe('round-trip encoding/decoding', () => {
    it('should round-trip EVM v1 args', () => {
      const original = { gasLimit: 123_456n }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = parseExtraArgs(encoded, ChainFamily.EVM)
      expect(decoded).toEqual({ ...original, _tag: 'EVMExtraArgsV1' })
    })

    it('should round-trip EVM v2 args', () => {
      const original = { gasLimit: 250_000n, allowOutOfOrderExecution: true }
      const encoded = encodeExtraArgs(original, ChainFamily.EVM)
      const decoded = parseExtraArgs(encoded, ChainFamily.EVM)
      expect(decoded).toEqual({ ...original, _tag: 'EVMExtraArgsV2' })
    })

    it('should round-trip Solana-encoded v2 args', () => {
      const original = { gasLimit: 500_000n, allowOutOfOrderExecution: true }
      const encoded = encodeExtraArgs(original, ChainFamily.Solana)
      const decoded = parseExtraArgs(encoded, ChainFamily.Solana)
      expect(decoded).toEqual({ ...original, _tag: 'EVMExtraArgsV2' })
    })

    it('should round-trip Aptos-encoded v2 args', () => {
      const original = { gasLimit: 300_000n, allowOutOfOrderExecution: false }
      const encoded = encodeExtraArgs(original, ChainFamily.Aptos)
      const decoded = parseExtraArgs(encoded, ChainFamily.Aptos)
      expect(decoded).toEqual({ ...original, _tag: 'EVMExtraArgsV2' })
    })
  })

  describe('encoding format differences', () => {
    it('should produce different encodings for EVM vs Solana', () => {
      const args = { gasLimit: 200_000n, allowOutOfOrderExecution: false }
      const evmEncoded = encodeExtraArgs(args, ChainFamily.EVM)
      const solanaEncoded = encodeExtraArgs(args, ChainFamily.Solana)

      // Both should have the same tag
      expect(evmEncoded.substring(0, 10)).toBe(solanaEncoded.substring(0, 10))
      // But different lengths (EVM uses uint256, Solana uses uint128)
      expect(evmEncoded.length).toBeGreaterThan(solanaEncoded.length)
    })

    it('should produce different encodings for EVM vs Aptos', () => {
      const args = { gasLimit: 300_000n, allowOutOfOrderExecution: false }
      const evmEncoded = encodeExtraArgs(args, ChainFamily.EVM)
      const aptosEncoded = encodeExtraArgs(args, ChainFamily.Aptos)

      // Both should have the same tag
      expect(evmEncoded.substring(0, 10)).toBe(aptosEncoded.substring(0, 10))
      // But different lengths
      expect(evmEncoded.length).toBeGreaterThan(aptosEncoded.length)
    })
  })
})
