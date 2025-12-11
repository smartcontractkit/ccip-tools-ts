import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { beginCell } from '@ton/core'
import { toBigInt } from 'ethers'

import { extractMagicTag, hexToBuffer, tryParseCell } from './utils.ts'
import {
  EVMExtraArgsV1Tag,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'

describe('TON utils', () => {
  describe('hexToBuffer', () => {
    it('should convert hex string with 0x prefix', () => {
      const buffer = hexToBuffer('0x48656c6c6f')
      assert.deepEqual(buffer, Buffer.from('Hello'))
    })

    it('should convert hex string without 0x prefix', () => {
      const buffer = hexToBuffer('48656c6c6f')
      assert.deepEqual(buffer, Buffer.from('Hello'))
    })

    it('should handle uppercase 0X prefix', () => {
      const buffer = hexToBuffer('0X48656c6c6f')
      assert.deepEqual(buffer, Buffer.from('Hello'))
    })

    it('should return empty buffer for empty input', () => {
      const buffer = hexToBuffer('')
      assert.deepEqual(buffer, Buffer.alloc(0))
    })

    it('should return empty buffer for just 0x', () => {
      const buffer = hexToBuffer('0x')
      assert.deepEqual(buffer, Buffer.alloc(0))
    })
  })

  describe('toBigInt', () => {
    it('should return bigint unchanged', () => {
      const result = toBigInt(123n)
      assert.equal(result, 123n)
    })

    it('should convert number to bigint', () => {
      const result = toBigInt(123)
      assert.equal(result, 123n)
    })

    it('should convert string to bigint', () => {
      const result = toBigInt('123')
      assert.equal(result, 123n)
    })

    it('should convert hex string to bigint', () => {
      const result = toBigInt('0x7b')
      assert.equal(result, 123n)
    })
  })

  describe('tryParseCell', () => {
    it('should parse valid BOC format', () => {
      const cell = beginCell().storeUint(0x12345678, 32).endCell()

      const bocHex = '0x' + cell.toBoc().toString('hex')
      const parsed = tryParseCell(bocHex)

      assert.equal(parsed.beginParse().loadUint(32), 0x12345678)
    })

    it('should fall back to raw bytes for invalid BOC', () => {
      const rawHex = '0x48656c6c6f' // "Hello" in hex
      const cell = tryParseCell(rawHex)

      assert.deepEqual(cell.beginParse().loadBuffer(5), Buffer.from('Hello'))
    })

    it('should return empty cell for empty input', () => {
      const cell = tryParseCell('')
      const slice = cell.beginParse()
      assert.equal(slice.remainingBits, 0)
      assert.equal(slice.remainingRefs, 0)
    })
  })

  describe('extractMagicTag', () => {
    it('should extract magic tag from BOC', () => {
      const cell = beginCell()
        .storeUint(Number(EVMExtraArgsV2Tag), 32)
        .storeUint(123456, 256)
        .storeBit(true)
        .endCell()

      const bocHex = '0x' + cell.toBoc().toString('hex')
      const tag = extractMagicTag(bocHex)

      assert.equal(tag, '0x181dcf10')
    })

    it('should pad tag to 8 hex digits', () => {
      const cell = beginCell().storeUint(0x123, 32).endCell()

      const bocHex = '0x' + cell.toBoc().toString('hex')
      const tag = extractMagicTag(bocHex)

      assert.equal(tag, '0x00000123')
    })

    it('should handle different tag values', () => {
      const testCases = [
        { input: Number(EVMExtraArgsV1Tag), expected: '0x97a657c9' },
        { input: Number(SuiExtraArgsV1Tag), expected: '0x21ea4ca9' },
        { input: Number(SVMExtraArgsV1Tag), expected: '0x1f3b3aba' },
      ]

      for (const testCase of testCases) {
        const cell = beginCell().storeUint(testCase.input, 32).endCell()

        const bocHex = '0x' + cell.toBoc().toString('hex')
        const tag = extractMagicTag(bocHex)

        assert.equal(tag, testCase.expected)
      }
    })
  })
})
