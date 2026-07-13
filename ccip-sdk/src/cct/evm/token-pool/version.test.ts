import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TOKEN_POOL_ABIS,
  TOKEN_POOL_TYPES,
  TokenPoolVersion,
  isTokenPoolType,
  isTokenPoolVersion,
  parseTokenPoolVersion,
  resolveEncoder,
  tokenPoolAbi,
} from './version.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
} from '../../errors.ts'

const ADDR = '0x' + '11'.repeat(20)

describe('pool types', () => {
  it('lists known EVM pool types', () => {
    assert.deepEqual([...TOKEN_POOL_TYPES], ['BurnMintTokenPool', 'LockReleaseTokenPool'])
  })

  it('isTokenPoolType narrows supported types and rejects others', () => {
    assert.equal(isTokenPoolType('BurnMintTokenPool'), true)
    assert.equal(isTokenPoolType('LockReleaseTokenPool'), true)
    assert.equal(isTokenPoolType('UpgradeableLockReleaseTokenPool'), false)
    assert.equal(isTokenPoolType('TokenAdminRegistry'), false)
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

describe('TOKEN_POOL_ABIS', () => {
  it('returns an array (ABI) for each supported version', () => {
    assert.ok(Array.isArray(TOKEN_POOL_ABIS[TokenPoolVersion.V1_5_0]))
    assert.ok(Array.isArray(TOKEN_POOL_ABIS[TokenPoolVersion.V1_5_1]))
    assert.ok(Array.isArray(TOKEN_POOL_ABIS[TokenPoolVersion.V1_6_1]))
    assert.ok(Array.isArray(TOKEN_POOL_ABIS[TokenPoolVersion.V2_0_0]))
  })

  it('returns distinct ABI objects for different version slots', () => {
    assert.notDeepEqual(
      TOKEN_POOL_ABIS[TokenPoolVersion.V1_5_0],
      TOKEN_POOL_ABIS[TokenPoolVersion.V1_5_1],
    )
  })
})

describe('tokenPoolAbi', () => {
  it('returns the exact ABI for the requested version', () => {
    assert.equal(
      tokenPoolAbi('BurnMintTokenPool', TokenPoolVersion.V1_5_0),
      TOKEN_POOL_ABIS[TokenPoolVersion.V1_5_0],
    )
    assert.equal(
      tokenPoolAbi('LockReleaseTokenPool', TokenPoolVersion.V2_0_0),
      TOKEN_POOL_ABIS[TokenPoolVersion.V2_0_0],
    )
  })

  it('ignores type today: both types resolve to the same ABI per version', () => {
    assert.equal(
      tokenPoolAbi('BurnMintTokenPool', TokenPoolVersion.V1_6_1),
      tokenPoolAbi('LockReleaseTokenPool', TokenPoolVersion.V1_6_1),
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
