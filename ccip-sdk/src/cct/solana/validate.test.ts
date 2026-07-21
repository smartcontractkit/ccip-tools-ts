import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import {
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
  validateWritableIndexes,
} from './validate.ts'
import { CCTParamsInvalidError } from '../errors.ts'

describe('cct/solana validate', () => {
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

  it('accepts valid public key arrays', () => {
    assert.doesNotThrow(() => validatePublicKeys('op', 'allowlist', [PublicKey.default.toBase58()]))
  })

  it('rejects non-array public key arrays', () => {
    assert.throws(
      () => validatePublicKeys('op', 'allowlist', 'nope'),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'allowlist',
    )
  })

  it('rejects invalid public key array items', () => {
    assert.throws(
      () => validatePublicKeys('op', 'allowlist', [PublicKey.default.toBase58(), 'nope']),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'allowlist[1]',
    )
  })

  it('accepts valid token pool types', () => {
    assert.doesNotThrow(() => validatePoolType('op', 'poolType', 'burn-mint'))
    assert.doesNotThrow(() => validatePoolType('op', 'poolType', 'lock-release'))
  })

  it('rejects invalid token pool types', () => {
    assert.throws(
      () => validatePoolType('op', 'poolType', 'mint-burn'),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'poolType',
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
