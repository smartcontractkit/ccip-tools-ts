import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
} from '../../errors.ts'
import SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/siloed-lock-release-token-pool.ts'
import {
  type TokenPoolFamily,
  TOKEN_POOL_FAMILIES,
  TOKEN_POOL_INTERFACES,
  TOKEN_POOL_TYPES,
  TokenPoolVersion,
  assertLockReleasePool,
  assertNonSiloedLockReleasePool,
  getTokenPoolArtifact,
  getTokenPoolFamily,
  getTokenPoolInterface,
  isLockReleaseTokenPoolType,
  isTokenPoolType,
  isTokenPoolVersion,
  parseTokenPoolVersion,
  resolveEncoder,
} from './contracts.ts'

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

  it('narrows lock-release types with isLockReleaseTokenPoolType, matching the family split', () => {
    assert.equal(isLockReleaseTokenPoolType('LockReleaseTokenPool'), true)
    assert.equal(isLockReleaseTokenPoolType('SiloedLockReleaseTokenPool'), true)
    assert.equal(isLockReleaseTokenPoolType('BurnMintTokenPool'), false)
    // the anchored ^Burn rule: a burn pool naming lock-release is still BurnMint
    assert.equal(isLockReleaseTokenPoolType('BurnMintWithLockReleaseFlagTokenPool'), false)
    // the predicate must agree with getTokenPoolFamily for every supported type: every family but
    // BurnMint escrows liquidity, siloed included
    for (const type of TOKEN_POOL_TYPES)
      assert.equal(isLockReleaseTokenPoolType(type), getTokenPoolFamily(type) !== 'BurnMint')
  })

  it('maps burn-* variants to the BurnMint family, each lock/release pool to its own', () => {
    assert.equal(getTokenPoolFamily('BurnFromMintTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('BurnWithFromMintTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('BurnToAddressTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('BurnMintWithLockReleaseFlagTokenPool'), 'BurnMint')
    assert.equal(getTokenPoolFamily('LockReleaseTokenPool'), 'LockRelease')
    assert.equal(getTokenPoolFamily('SiloedLockReleaseTokenPool'), 'SiloedLockRelease')
  })
})

describe('pool versions', () => {
  it('lists known EVM pool versions low→high', () => {
    assert.deepEqual(Object.values(TokenPoolVersion), [
      TokenPoolVersion.V1_5_0,
      TokenPoolVersion.V1_5_1,
      TokenPoolVersion.V1_6_0,
      TokenPoolVersion.V1_6_1,
      TokenPoolVersion.V2_0_0,
    ])
  })

  it('isTokenPoolVersion narrows known versions and rejects others', () => {
    assert.equal(isTokenPoolVersion(TokenPoolVersion.V1_5_1), true)
    assert.equal(isTokenPoolVersion(TokenPoolVersion.V1_6_0), true)
    assert.equal(isTokenPoolVersion(TokenPoolVersion.V2_0_0), true)
    // exact match: an unlisted patch is unknown, not floor-matched to its neighbour
    assert.equal(isTokenPoolVersion('1.6.2'), false)
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

  it('normalizes the v1.5.0 *AndProxy shims to their base type', () => {
    for (const [contractType, type] of [
      ['BurnMintTokenPoolAndProxy', 'BurnMintTokenPool'],
      ['BurnFromMintTokenPoolAndProxy', 'BurnFromMintTokenPool'],
      ['BurnWithFromMintTokenPoolAndProxy', 'BurnWithFromMintTokenPool'],
      ['LockReleaseTokenPoolAndProxy', 'LockReleaseTokenPool'],
    ] as const) {
      assert.deepEqual(parseTokenPoolVersion({ address: ADDR, contractType, version: '1.5.0' }), {
        type,
        version: TokenPoolVersion.V1_5_0,
      })
    }
  })

  it('only strips AndProxy at v1.5.0 — the shim exists at no other version', () => {
    for (const version of ['1.5.1', '1.6.1', '2.0.0']) {
      assert.throws(
        () =>
          parseTokenPoolVersion({
            address: ADDR,
            contractType: 'BurnMintTokenPoolAndProxy',
            version,
          }),
        CCTContractTypeInvalidError,
      )
    }
  })

  it('gates the stripped base type, so an unsupported AndProxy name is still rejected', () => {
    assert.throws(
      () =>
        parseTokenPoolVersion({
          address: ADDR,
          contractType: 'UpgradeableLockReleaseTokenPoolAndProxy',
          version: '1.5.0',
        }),
      CCTContractTypeInvalidError,
    )
  })

  it('accepts SiloedLockReleaseTokenPool at 1.6.0, the one pool that release stamped 1.6.0', () => {
    assert.deepEqual(
      parseTokenPoolVersion({
        address: ADDR,
        contractType: 'SiloedLockReleaseTokenPool',
        version: '1.6.0',
      }),
      { type: 'SiloedLockReleaseTokenPool', version: TokenPoolVersion.V1_6_0 },
    )
  })

  it('rejects every other pool type at 1.6.0, which never shipped', () => {
    for (const contractType of TOKEN_POOL_TYPES.filter((t) => t !== 'SiloedLockReleaseTokenPool'))
      assert.throws(
        () => parseTokenPoolVersion({ address: ADDR, contractType, version: '1.6.0' }),
        (error: unknown) =>
          error instanceof CCTContractVersionUnsupportedError && error.context.address === ADDR,
        contractType,
      )
  })

  it('rejects SiloedLockReleaseTokenPool before 1.6.0, where it never shipped', () => {
    for (const version of ['1.5.0', '1.5.1'])
      assert.throws(
        () =>
          parseTokenPoolVersion({
            address: ADDR,
            contractType: 'SiloedLockReleaseTokenPool',
            version,
          }),
        (error: unknown) =>
          error instanceof CCTContractVersionUnsupportedError && error.context.address === ADDR,
        version,
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
  it('provides a cached ethers Interface for each family, at exactly the versions it shipped', () => {
    for (const family of TOKEN_POOL_FAMILIES)
      for (const iface of Object.values(TOKEN_POOL_INTERFACES[family]))
        assert.ok(iface instanceof Interface, family)
    const versions = (family: TokenPoolFamily) => Object.keys(TOKEN_POOL_INTERFACES[family])
    // 1.6.0 shipped only the siloed pool, and the siloed pool first shipped at 1.6.0
    assert.deepEqual(versions('BurnMint'), ['1.5.0', '1.5.1', '1.6.1', '2.0.0'])
    assert.deepEqual(versions('LockRelease'), ['1.5.0', '1.5.1', '1.6.1', '2.0.0'])
    assert.deepEqual(versions('SiloedLockRelease'), ['1.6.0', '1.6.1', '2.0.0'])
  })

  it('resolves distinct Interfaces per family at the same version', () => {
    assert.notEqual(
      TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V1_5_1],
      TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V1_5_1],
    )
    for (const version of [TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0])
      assert.notEqual(
        TOKEN_POOL_INTERFACES.SiloedLockRelease[version],
        TOKEN_POOL_INTERFACES.LockRelease[version],
        version,
      )
  })

  it('gives SiloedLockRelease the siloed ABI from 1.6.0 on: no single getLockBox(), no transferLiquidity', () => {
    for (const version of [TokenPoolVersion.V1_6_0, TokenPoolVersion.V1_6_1]) {
      const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease[version]
      assert.ok(iface.hasFunction('getUnsiloedLiquidity'), version)
      assert.equal(iface.hasFunction('transferLiquidity'), false, version)
    }
    const v2 = TOKEN_POOL_INTERFACES.SiloedLockRelease[TokenPoolVersion.V2_0_0]
    assert.ok(v2.getFunction('getLockBox(uint64)'))
    assert.equal(v2.getFunction('getLockBox()'), null)
    assert.deepEqual(
      v2.deploy.inputs.map((i) => i.name),
      ['token', 'localTokenDecimals', 'advancedPoolHooks', 'rmnProxy', 'router'],
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

/** The functions the LockRelease liquidity + rebalancer ops encode, checked against the ABIs. */
const LIQUIDITY_FUNCTIONS = [
  'provideLiquidity',
  'withdrawLiquidity',
  'transferLiquidity',
  'setRebalancer',
  'getRebalancer',
] as const

/** Every pool function a CCT op encodes through {@link getTokenPoolInterface}. */
const OP_ENCODED_FUNCTIONS = [
  'acceptOwnership',
  'addRemotePool',
  'applyAllowListUpdates',
  'applyChainUpdates',
  'applyTokenTransferFeeConfigUpdates',
  'provideLiquidity',
  'removeRemotePool',
  'setAllowedFinalityConfig',
  'setChainRateLimiterConfig',
  'setChainRateLimiterConfigs',
  'setDynamicConfig',
  'setRateLimitAdmin',
  'setRebalancer',
  'setRemotePool',
  'transferOwnership',
  'updateAdvancedPoolHooks',
  'withdrawFeeTokens',
  'withdrawLiquidity',
] as const

describe('SiloedLockRelease calldata parity', () => {
  // Siloed pools at 1.6.1 and 2.0.0 used to resolve to the LockRelease interface. Moving them to
  // their own family changes no calldata only while every op-encoded function stays declared
  // identically in both; this pins that against a future re-vendor. transferLiquidity is the one
  // exception, and transferLiquidity rejects siloed pools before encoding.
  for (const version of [TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0])
    it(`declares every op-encoded function identically to LockRelease at ${version}`, () => {
      // selector, output types and mutability: what encoding and decoding depend on. Parameter
      // names are not compared; they differ (setRebalancer's newRebalancer vs rebalancer at 1.6.1)
      // and ops encode positionally.
      const shape = (family: 'LockRelease' | 'SiloedLockRelease', fn: string) => {
        const f = TOKEN_POOL_INTERFACES[family][version].getFunction(fn)
        return f && [f.format('sighash'), f.outputs.map((o) => o.format()), f.stateMutability]
      }
      for (const fn of OP_ENCODED_FUNCTIONS)
        assert.deepEqual(
          shape('SiloedLockRelease', fn),
          shape('LockRelease', fn),
          `${fn} @ ${version}`,
        )
    })
})

describe('LockRelease liquidity surface', () => {
  /** The versions the liquidity ops floor-match a single 1.5.0 encoder across. */
  const V1_X = [TokenPoolVersion.V1_5_0, TokenPoolVersion.V1_5_1, TokenPoolVersion.V1_6_1] as const

  it('declares every liquidity function with an identical signature at v1.5.0–v1.6.1', () => {
    // this parity is what licenses one encoder entry at 1.5.0 instead of a per-version table
    for (const fn of LIQUIDITY_FUNCTIONS) {
      const [first, ...rest] = V1_X.map((version) =>
        TOKEN_POOL_INTERFACES.LockRelease[version].getFunction(fn)!.format('sighash'),
      )
      for (const sighash of rest) assert.equal(sighash, first, `${fn} diverged across v1.x`)
    }
  })

  it('declares the unsiloed liquidity functions on siloed v1.6.x with the v1.5.0 signatures', () => {
    // this parity licenses floor-matching siloed pools to the 1.5.x encoders
    const base = TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V1_5_0]
    for (const version of [TokenPoolVersion.V1_6_0, TokenPoolVersion.V1_6_1])
      for (const fn of ['provideLiquidity', 'withdrawLiquidity', 'setRebalancer', 'getRebalancer'])
        assert.equal(
          TOKEN_POOL_INTERFACES.SiloedLockRelease[version].getFunction(fn)!.format('sighash'),
          base.getFunction(fn)!.format('sighash'),
          `${fn} @ ${version}`,
        )
  })

  it('declares neither transferLiquidity nor canAcceptLiquidity on siloed v1.6.x', () => {
    for (const version of [TokenPoolVersion.V1_6_0, TokenPoolVersion.V1_6_1]) {
      const siloed = TOKEN_POOL_INTERFACES.SiloedLockRelease[version]
      assert.equal(siloed.hasFunction('transferLiquidity'), false, version)
      assert.equal(siloed.hasFunction('canAcceptLiquidity'), false, version)
    }
  })

  it('drops every liquidity function at v2.0.0, which escrows through a lockbox', () => {
    for (const family of ['LockRelease', 'SiloedLockRelease'] as const)
      for (const fn of LIQUIDITY_FUNCTIONS)
        assert.equal(
          TOKEN_POOL_INTERFACES[family][TokenPoolVersion.V2_0_0].hasFunction(fn),
          false,
          `${fn} unexpectedly present on ${family} 2.0.0`,
        )
  })

  it('declares no liquidity function on the BurnMint family at any version', () => {
    for (const [version, iface] of Object.entries(TOKEN_POOL_INTERFACES.BurnMint))
      for (const fn of LIQUIDITY_FUNCTIONS)
        assert.equal(
          iface.hasFunction(fn),
          false,
          `${fn} unexpectedly present on BurnMint ${version}`,
        )
  })

  it('declares canAcceptLiquidity only at v1.5.0 and v1.5.1', () => {
    assert.equal(
      TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V1_5_0].hasFunction('canAcceptLiquidity'),
      true,
    )
    assert.equal(
      TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V1_5_1].hasFunction('canAcceptLiquidity'),
      true,
    )
    // 1.6.1 dropped the immutable flag and always accepts deposits
    assert.equal(
      TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V1_6_1].hasFunction('canAcceptLiquidity'),
      false,
    )
  })
})

describe('assertLockReleasePool', () => {
  it('passes every lock-release type through', () => {
    for (const type of TOKEN_POOL_TYPES.filter(isLockReleaseTokenPoolType))
      assert.doesNotThrow(() => assertLockReleasePool('provideLiquidity', ADDR, type))
  })

  it('rejects every burn-mint type, naming the operation', () => {
    for (const type of TOKEN_POOL_TYPES.filter((t) => !isLockReleaseTokenPoolType(t)))
      assert.throws(
        () => assertLockReleasePool('provideLiquidity', ADDR, type),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === ADDR &&
          err.context.actual === type &&
          err.context.operation === 'provideLiquidity',
      )
  })
})

describe('assertNonSiloedLockReleasePool', () => {
  it('passes the one lock-release type that has a single lockbox', () => {
    assert.doesNotThrow(() =>
      assertNonSiloedLockReleasePool('getLockbox', ADDR, 'LockReleaseTokenPool'),
    )
  })

  it('rejects the siloed type, whose lockboxes are per lane', () => {
    assert.throws(
      () => assertNonSiloedLockReleasePool('getLockbox', ADDR, 'SiloedLockReleaseTokenPool'),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.address === ADDR &&
        err.context.expected === 'LockReleaseTokenPool' &&
        err.context.actual === 'SiloedLockReleaseTokenPool' &&
        err.context.operation === 'getLockbox',
    )
  })

  it('rejects every burn-mint type, deferring to assertLockReleasePool', () => {
    for (const type of TOKEN_POOL_TYPES.filter((t) => !isLockReleaseTokenPoolType(t)))
      assert.throws(
        () => assertNonSiloedLockReleasePool('getLockbox', ADDR, type),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.actual === type &&
          err.context.expected === 'LockRelease token pool',
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

  it('resolves SiloedLockReleaseTokenPool through its own family at the versions it shipped', () => {
    for (const [version, iface] of Object.entries(TOKEN_POOL_INTERFACES.SiloedLockRelease))
      assert.equal(
        getTokenPoolInterface('SiloedLockReleaseTokenPool', version as TokenPoolVersion),
        iface,
        version,
      )
  })

  it('throws for a family and version that never shipped together', () => {
    for (const [type, version] of [
      ['SiloedLockReleaseTokenPool', TokenPoolVersion.V1_5_1],
      ['BurnMintTokenPool', TokenPoolVersion.V1_6_0],
      ['LockReleaseTokenPool', TokenPoolVersion.V1_6_0],
    ] as const)
      assert.throws(
        () => getTokenPoolInterface(type, version),
        CCTContractVersionUnsupportedError,
        `${type} ${version}`,
      )
  })
})

describe('getTokenPoolArtifact', () => {
  it('gives SiloedLockReleaseTokenPool its own 5-arg constructor Interface (no lockBox)', () => {
    const artifact = getTokenPoolArtifact('SiloedLockReleaseTokenPool')
    assert.equal(artifact.contract, 'SiloedLockReleaseTokenPool')
    assert.deepEqual(
      artifact.iface.deploy.inputs.map((i) => i.name),
      ['token', 'localTokenDecimals', 'advancedPoolHooks', 'rmnProxy', 'router'],
    )
    assert.equal(artifact.bytecode, SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE)
  })

  it('deploys SiloedLockReleaseTokenPool with the same Interface its reads resolve to', () => {
    assert.equal(
      getTokenPoolArtifact('SiloedLockReleaseTokenPool').iface,
      TOKEN_POOL_INTERFACES.SiloedLockRelease[TokenPoolVersion.V2_0_0],
    )
  })

  it('keeps the non-siloed LockReleaseTokenPool constructor (with lockBox)', () => {
    assert.equal(getTokenPoolArtifact('LockReleaseTokenPool').iface.deploy.inputs.length, 6)
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

  it('inherits the lower version\u2019s encoder across every absent key above it', () => {
    // a single V1_5_0 entry \u2014 the shape `transfer-ownership.ts` uses \u2014 must cover every version
    const encoders = { [TokenPoolVersion.V1_5_0]: () => 'only' }
    for (const version of Object.values(TokenPoolVersion))
      assert.equal(resolveEncoder(encoders, version, 'op')(), 'only')
  })

  it('stops at an explicit null ceiling instead of inheriting the encoder downward', () => {
    // `applyAllowListUpdates`: present 1.5.0\u20131.6.1, removed outright in 2.0.0
    const encoders = {
      [TokenPoolVersion.V1_5_0]: () => 'allowList',
      [TokenPoolVersion.V2_0_0]: null,
    }
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_5_0, 'op')(), 'allowList')
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_5_1, 'op')(), 'allowList')
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_6_1, 'op')(), 'allowList')
    assert.throws(
      () => resolveEncoder(encoders, TokenPoolVersion.V2_0_0, 'op'),
      (error: unknown) =>
        error instanceof CCTOperationUnsupportedError &&
        error.context.operation === 'op' &&
        error.context.version === TokenPoolVersion.V2_0_0,
    )
  })

  it('applies a null ceiling to every version at or above it, not just the keyed one', () => {
    // a ceiling keyed below the top must not be escaped by asking for a higher version
    const encoders = {
      [TokenPoolVersion.V1_5_0]: () => 'a',
      [TokenPoolVersion.V1_6_1]: null,
    }
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_5_1, 'op')(), 'a')
    assert.throws(
      () => resolveEncoder(encoders, TokenPoolVersion.V1_6_1, 'op'),
      CCTOperationUnsupportedError,
    )
    assert.throws(
      () => resolveEncoder(encoders, TokenPoolVersion.V2_0_0, 'op'),
      CCTOperationUnsupportedError,
    )
  })

  it('lets a later version re-register an encoder above a null ceiling', () => {
    // the walk is downward-from-requested, so a re-added function is found before the ceiling
    const encoders = {
      [TokenPoolVersion.V1_5_0]: () => 'old',
      [TokenPoolVersion.V1_5_1]: null,
      [TokenPoolVersion.V2_0_0]: () => 'new',
    }
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V1_5_0, 'op')(), 'old')
    assert.throws(
      () => resolveEncoder(encoders, TokenPoolVersion.V1_6_1, 'op'),
      CCTOperationUnsupportedError,
    )
    assert.equal(resolveEncoder(encoders, TokenPoolVersion.V2_0_0, 'op')(), 'new')
  })

  it('throws when the requested version itself is the only null entry', () => {
    assert.throws(
      () => resolveEncoder({ [TokenPoolVersion.V1_5_0]: null }, TokenPoolVersion.V1_5_0, 'op'),
      CCTOperationUnsupportedError,
    )
  })

  it('throws on an empty table', () => {
    assert.throws(
      () => resolveEncoder({}, TokenPoolVersion.V1_6_1, 'op'),
      CCTOperationUnsupportedError,
    )
  })
})
