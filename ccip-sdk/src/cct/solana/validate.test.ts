import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import {
  parsePublicKey,
  validateInteger,
  validateNonEmptyString,
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
  validateWritableIndexes,
} from './validate.ts'
import { CCTParamsInvalidError } from '../errors.ts'

describe('cct/solana validate', () => {
  it('parses valid public keys', () => {
    const key = parsePublicKey('op', 'payer', PublicKey.default.toBase58())
    assert.ok(key.equals(PublicKey.default))
  })

  it('accepts valid public keys', () => {
    assert.doesNotThrow(() => validatePublicKey('op', 'payer', PublicKey.default.toBase58()))
  })

  it('rejects non-string public keys', () => {
    assert.throws(
      () => validatePublicKey('op', 'payer', 123),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'payer',
    )
  })

  it('rejects invalid public key strings', () => {
    assert.throws(
      () => validatePublicKey('op', 'payer', 'nope'),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'payer',
    )
  })

  it('validates public key arrays', () => {
    assert.doesNotThrow(() => validatePublicKeys('op', 'signers', []))
    assert.doesNotThrow(() => validatePublicKeys('op', 'signers', [PublicKey.default.toBase58()]))
    assert.throws(
      () => validatePublicKeys('op', 'signers', ['nope']),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'signers[0]',
    )
    assert.throws(
      () => validatePublicKeys('op', 'signers', 'nope'),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'signers',
    )
  })

  it('validates non-empty strings', () => {
    assert.doesNotThrow(() => validateNonEmptyString('op', 'seed', 'abc'))
    assert.throws(
      () => validateNonEmptyString('op', 'seed', '   '),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'seed',
    )
  })

  it('validates pool types', () => {
    assert.doesNotThrow(() => validatePoolType('op', 'poolType', 'burn-mint'))
    assert.doesNotThrow(() => validatePoolType('op', 'poolType', 'lock-release'))
    assert.throws(
      () => validatePoolType('op', 'poolType', 'nope'),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'poolType',
    )
  })

  it('validates integers', () => {
    assert.doesNotThrow(() => validateInteger('op', 'threshold', 1))
    assert.doesNotThrow(() => validateInteger('op', 'decimals', 255, 0, 255))
    assert.throws(
      () => validateInteger('op', 'decimals', 256, 0, 255),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
    )
  })

  it('accepts omitted and valid writable indexes', () => {
    assert.doesNotThrow(() => validateWritableIndexes('op', 'writableIndexes', undefined))
    assert.doesNotThrow(() => validateWritableIndexes('op', 'writableIndexes', [0, 3, 255]))
  })

  it('rejects empty writable indexes', () => {
    assert.throws(
      () => validateWritableIndexes('op', 'writableIndexes', []),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'writableIndexes',
    )
  })

  it('rejects writable indexes outside byte range', () => {
    assert.throws(
      () => validateWritableIndexes('op', 'writableIndexes', [256]),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'writableIndexes[0]',
    )
  })
})
