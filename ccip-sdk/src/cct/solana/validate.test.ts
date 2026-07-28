import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import { validatePublicKey, validateWritableIndexes } from './validate.ts'
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
