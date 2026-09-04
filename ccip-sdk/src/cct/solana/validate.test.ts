import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import { CCIPTokenAccountNotFoundError } from '../../errors/index.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../errors.ts'
import { type PoolProgramRef, TOKEN_POOL_PROGRAMS } from './programs/token-pool.ts'
import {
  parseHexBytes,
  parseNonEmptyHexBytes,
  parsePublicKey,
  resolveExistingTokenAccount,
  resolveLockReleasePoolProgram,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateDelegation,
  validateInteger,
  validateNonEmptyString,
  validateOptionalPublicKey,
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
  validateWritableIndexes,
} from './validate.ts'

function mintData() {
  const data = Buffer.alloc(MINT_SIZE)
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: PublicKey.default,
      supply: 0n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  )
  return data
}

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
    assert.throws(() => parseHexBytes('op', 'address', null), CCTParamsInvalidError)
  })

  it('rejects empty hex bytes when required', () => {
    assert.deepEqual(parseNonEmptyHexBytes('op', 'address', '0x01'), Buffer.from([1]))
    assert.throws(
      () => parseNonEmptyHexBytes('op', 'address', ''),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.reason === 'must not be empty',
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

  it('validates the executing authority', () => {
    const authority = PublicKey.default

    assert.doesNotThrow(() => validateAuthorityMatchesWallet('op', authority, authority))
    assert.throws(
      () =>
        validateAuthorityMatchesWallet(
          'op',
          authority,
          new PublicKey(Uint8Array.from({ length: 32 }, () => 1)),
        ),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
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

  it('resolves lock-release pool programs only', () => {
    assert.ok(resolveLockReleasePoolProgram('op', { poolType: 'lock-release' }))
    assert.throws(
      () => resolveLockReleasePoolProgram('op', { poolType: 'burn-mint' }),
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
    assert.throws(() => validateInteger('op', 'threshold', 0, 1), CCTParamsInvalidError)
    assert.throws(() => validateInteger('op', 'limit', 2, undefined, 1), CCTParamsInvalidError)
    assert.throws(() => validateInteger('op', 'integer', 1.5), CCTParamsInvalidError)
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

  it('validates token delegation', () => {
    const tokenAccount = PublicKey.default
    const delegate = new PublicKey(Uint8Array.from({ length: 32 }, () => 1))
    const otherDelegate = new PublicKey(Uint8Array.from({ length: 32 }, () => 2))

    assert.doesNotThrow(() =>
      validateDelegation(
        'op',
        tokenAccount,
        { delegate, delegatedAmount: 2n } as never,
        delegate,
        2n,
      ),
    )
    for (const account of [
      { delegate: null, delegatedAmount: 2n },
      { delegate: otherDelegate, delegatedAmount: 2n },
      { delegate, delegatedAmount: 1n },
    ]) {
      assert.throws(
        () => validateDelegation('op', tokenAccount, account as never, delegate, 2n),
        (err: unknown) => err instanceof CCTTxFailedError,
      )
    }
  })

  it('maps missing token accounts and preserves other lookup errors', async () => {
    const mint = new PublicKey(Uint8Array.from({ length: 32 }, () => 1))
    const holder = new PublicKey(Uint8Array.from({ length: 32 }, () => 2))
    const tokenAccount = new PublicKey(Uint8Array.from({ length: 32 }, () => 3))
    const connection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(mint) ? { owner: TOKEN_PROGRAM_ID, data: mintData() } : null,
    }

    await assert.rejects(
      () => resolveExistingTokenAccount(connection as never, mint, holder, tokenAccount),
      (err: unknown) => err instanceof CCIPTokenAccountNotFoundError,
    )

    const invalidConnection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(mint)
          ? { owner: TOKEN_PROGRAM_ID, data: mintData() }
          : { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(0) },
    }
    await assert.rejects(() =>
      resolveExistingTokenAccount(invalidConnection as never, mint, holder, tokenAccount),
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
