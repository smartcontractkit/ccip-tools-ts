import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import {
  parseHexBytes,
  parsePublicKey,
  resolvePoolProgram,
  validateBigInt,
  validateInteger,
  validateNonEmptyString,
  validateOptionalPublicKey,
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
  validateWritableIndexes,
} from './validate.ts'
import { CCTParamsInvalidError } from '../errors.ts'
import { type PoolProgramRef, TOKEN_POOL_PROGRAMS } from './programs/token-pool.ts'

describe('Validate (cct/solana)', () => {
  it('parses valid public keys', () => {
    const key = parsePublicKey('op', 'payer', PublicKey.default.toBase58())
    assert.ok(key.equals(PublicKey.default))
  })

  it('parses hex bytes with an optional maximum size', () => {
    assert.deepEqual(parseHexBytes('op', 'address', '0x01ab', 2), Buffer.from('01ab', 'hex'))
    assert.deepEqual(parseHexBytes('op', 'address', ''), Buffer.alloc(0))
    assert.throws(
      () => parseHexBytes('op', 'address', '0x123', 2),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.reason === 'must be a hex string of at most 2 bytes',
    )
  })

  it('accepts valid public keys', () => {
    assert.doesNotThrow(() => validatePublicKey('op', 'payer', PublicKey.default.toBase58()))
  })

  it('accepts omitted and valid optional public keys', () => {
    assert.doesNotThrow(() => validateOptionalPublicKey('op', 'authority', undefined))
    assert.doesNotThrow(() =>
      validateOptionalPublicKey('op', 'authority', PublicKey.default.toBase58()),
    )
  })

  it('rejects invalid optional public keys', () => {
    for (const value of [null, '']) {
      assert.throws(
        () => validateOptionalPublicKey('op', 'authority', value),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    }
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

  it('resolves pool programs', () => {
    assert.equal(
      resolvePoolProgram('op', { poolType: 'burn-mint' }).toBase58(),
      TOKEN_POOL_PROGRAMS['burn-mint'],
    )
    assert.ok(
      resolvePoolProgram('op', { poolProgramAddress: PublicKey.default.toBase58() }).equals(
        PublicKey.default,
      ),
    )

    const invalidRefs: unknown[] = [
      {},
      { poolType: 'burn-mint', poolProgramAddress: PublicKey.default.toBase58() },
      { poolType: 'nope' },
      { poolProgramAddress: 'nope' },
    ]
    for (const params of invalidRefs) {
      assert.throws(() => resolvePoolProgram('op', params as PoolProgramRef), CCTParamsInvalidError)
    }
  })

  it('resolves pool references with the other key explicitly undefined', () => {
    // Value semantics: an explicitly-set `undefined` key must not count as provided.
    const custom = PublicKey.default.toBase58()

    assert.equal(
      resolvePoolProgram('op', { poolProgramAddress: custom, poolType: undefined }).toBase58(),
      custom,
    )
    assert.equal(
      resolvePoolProgram('op', {
        poolType: 'burn-mint',
        poolProgramAddress: undefined,
      }).toBase58(),
      TOKEN_POOL_PROGRAMS['burn-mint'],
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

  it('validates bigint bounds with useful errors', () => {
    assert.doesNotThrow(() => validateBigInt('op', 'selector', 0n, 0n))
    assert.throws(
      () => validateBigInt('op', 'selector', -1n, 0n),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.reason === 'must be a bigint >= 0',
    )
    assert.throws(
      () => validateBigInt('op', 'selector', 2n, undefined, 1n),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.reason === 'must be a bigint <= 1',
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
