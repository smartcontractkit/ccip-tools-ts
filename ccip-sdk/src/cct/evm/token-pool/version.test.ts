import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import {
  TOKEN_POOL_FAMILIES,
  TOKEN_POOL_INTERFACES,
  TOKEN_POOL_TYPES,
  TokenPoolVersion,
  getTokenPoolFamily,
  getTokenPoolInterface,
  isTokenPoolType,
  isTokenPoolVersion,
  parseTokenPoolVersion,
  resolveEncoder,
} from './version.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
} from '../../errors.ts'

const ADDR = '0x' + '11'.repeat(20)

describe('pool types', () => {
  it('lists known EVM pool types (burn family + lock release)', () => {
    assert.deepEqual(
      [...TOKEN_POOL_TYPES].sort(),
      [
        'BurnFromMintTokenPool',
        'BurnMintTokenPool',
        'BurnMintWithLockReleaseFlagTokenPool',
        'BurnToAddressTokenPool',
        'BurnWithFromMintTokenPool',
        'LockReleaseTokenPool',
        'SiloedLockReleaseTokenPool',
      ].sort(),
    )
  })

  it('isTokenPoolType accepts burn-family + lock-release, rejects others', () => {
    assert.equal(isTokenPoolType('BurnMintTokenPool'), true)
    assert.equal(isTokenPoolType('BurnFromMintTokenPool'), true)
    assert.equal(isTokenPoolType('BurnWithFromMintTokenPool'), true)
    assert.equal(isTokenPoolType('LockReleaseTokenPool'), true)
    assert.equal(isTokenPoolType('UpgradeableLockReleaseTokenPool'), false)
    assert.equal(isTokenPoolType('CCTPThroughCCVTokenPool'), false)
    assert.equal(isTokenPoolType('TokenAdminRegistry'), false)
  })

  it('maps burn-* variants to the BurnMint family, LockRelease to its own', () => {
    assert.equal(getTokenPoolFamily('BurnFromMintTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('BurnWithFromMintTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('BurnToAddressTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('BurnMintWithLockReleaseFlagTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('LockReleaseTokenPool'), 'LockRelease')
  })
})

describe('pool versions', () => {
  it('lists known EVM pool versions low→high', () => {
    assert.deepEqual(Object.values(TokenPoolVersion), [
      TokenPoolVersion.V1_5_0,
      TokenPoolVersion.V1_5_1,
      TokenPoolVersion.V1_6_1,
      TokenPoolVersion.V2_0_0,
    ])
  })

  it('isTokenPoolVersion narrows known versions and rejects others', () => {
    assert.equal(isTokenPoolVersion(TokenPoolVersion.V1_5_1), true)
    assert.equal(isTokenPoolVersion(TokenPoolVersion.V2_0_0), true)
    // `1.6.0` is a real on-chain string for SiloedLockReleaseTokenPool (v1.6.0 tag), but its ABI
    // isn't in the 2.0.0 dep, so it's deliberately deferred (rejected) — not "no such version".
    assert.equal(isTokenPoolVersion('1.6.0'), false)
    assert.equal(isTokenPoolVersion('garbage'), false)
  })
})

describe('parseTokenPoolVersion', () => {
  it('returns { type, version } for a known pool type+version', () => {
    assert.deepEqual(
      parseTokenPoolVersion({ address: ADDR, contractType: 'BurnMintTokenPool', version: '1.5.1' }),
      {
        type: 'BurnMintTokenPool',
        version: TokenPoolVersion.V1_5_1,
      },
    )
    assert.deepEqual(
      parseTokenPoolVersion({
        address: ADDR,
        contractType: 'LockReleaseTokenPool',
        version: '2.0.0',
      }),
      {
        type: 'LockReleaseTokenPool',
        version: TokenPoolVersion.V2_0_0,
      },
    )
  })

  it('throws CCTContractTypeInvalidError for an unsupported pool type', () => {
    assert.throws(
      () =>
        parseTokenPoolVersion({
          address: ADDR,
          contractType: 'TokenAdminRegistry',
          version: '1.5.1',
        }),
      CCTContractTypeInvalidError,
    )
  })

  it('throws CCTContractTypeInvalidError for UpgradeableLockReleaseTokenPool (not in TOKEN_POOL_TYPES)', () => {
    assert.throws(
      () =>
        parseTokenPoolVersion({
          address: ADDR,
          contractType: 'UpgradeableLockReleaseTokenPool',
          version: '1.5.1',
        }),
      CCTContractTypeInvalidError,
    )
  })

  it('narrows a burn-family variant to its exact type', () => {
    assert.deepEqual(
      parseTokenPoolVersion({
        address: ADDR,
        contractType: 'BurnFromMintTokenPool',
        version: '1.5.1',
      }),
      { type: 'BurnFromMintTokenPool', version: TokenPoolVersion.V1_5_1 },
    )
  })

  it('throws CCTContractVersionUnsupportedError for an unknown version', () => {
    assert.throws(
      () =>
        parseTokenPoolVersion({
          address: ADDR,
          contractType: 'BurnMintTokenPool',
          version: '1.7.0',
        }),
      CCTContractVersionUnsupportedError,
    )
  })
})

describe('TOKEN_POOL_INTERFACES', () => {
  it('provides a cached ethers Interface for each family and version', () => {
    for (const family of TOKEN_POOL_FAMILIES) {
      for (const version of Object.values(TokenPoolVersion)) {
        assert.ok(TOKEN_POOL_INTERFACES[family][version] instanceof Interface)
      }
    }
  })

  it('resolves distinct Interfaces per family at the same version', () => {
    assert.notEqual(
      TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V1_5_1],
      TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V1_5_1],
    )
  })

  it('uses the *_and_proxy variant at V1_5_0 (exposes getPreviousPool)', () => {
    assert.ok(
      TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V1_5_0].hasFunction('getPreviousPool'),
    )
    assert.ok(
      !TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V1_5_1].hasFunction('getPreviousPool'),
    )
  })
})

describe('getTokenPoolInterface', () => {
  it('returns the cached family Interface for the type+version (same instance across calls)', () => {
    const a = getTokenPoolInterface('BurnMintTokenPool', TokenPoolVersion.V1_5_1)
    const b = getTokenPoolInterface('BurnMintTokenPool', TokenPoolVersion.V1_5_1)
    assert.ok(a instanceof Interface)
    assert.equal(a, b)
    assert.equal(a, TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V1_5_1])
  })

  it('resolves all burn-* variants to the same BurnMint-family Interface', () => {
    const burnMint = getTokenPoolInterface('BurnMintTokenPool', TokenPoolVersion.V1_5_1)
    assert.equal(getTokenPoolInterface('BurnFromMintTokenPool', TokenPoolVersion.V1_5_1), burnMint)
    assert.equal(
      getTokenPoolInterface('BurnWithFromMintTokenPool', TokenPoolVersion.V1_5_1),
      burnMint,
    )
    assert.equal(getTokenPoolInterface('BurnToAddressTokenPool', TokenPoolVersion.V1_5_1), burnMint)
  })

  it('resolves LockRelease to a different Interface than the BurnMint family', () => {
    assert.notEqual(
      getTokenPoolInterface('BurnMintTokenPool', TokenPoolVersion.V1_6_1),
      getTokenPoolInterface('LockReleaseTokenPool', TokenPoolVersion.V1_6_1),
    )
  })
})

describe('resolveEncoder', () => {
  it('floor-matches to the encoder at the greatest version ≤ requested', () => {
    const encoders = {
      [TokenPoolVersion.V1_5_0]: () => 'a',
      [TokenPoolVersion.V2_0_0]: () => 'b',
    }
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_5_0, 'op')(), 'a')
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_6_1, 'op')(), 'a')
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V2_0_0, 'op')(), 'b')
  })

  it('throws when nothing is registered at or below the version', () => {
    assert.throws(
      () => resolveEncoder({ [TokenPoolVersion.V2_0_0]: () => 'b' }, TokenPoolVersion.V1_5_0, 'op'),
      CCTOperationUnsupportedError,
    )
  })
})
