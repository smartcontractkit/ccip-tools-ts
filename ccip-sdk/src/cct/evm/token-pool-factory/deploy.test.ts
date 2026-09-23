import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../errors.ts'
import { FACTORY_POOL_TYPE, TOKEN_POOL_FACTORY_INTERFACE } from './contracts.ts'
import {
  deployTokenAndTokenPoolViaFactory,
  deployTokenAndTokenPoolViaFactoryUnchecked,
  deployTokenPoolWithExistingTokenViaFactory,
  deployTokenPoolWithExistingTokenViaFactoryUnchecked,
} from './deploy.ts'
import {
  buildPoolInitArgs,
  guardFactorySalt,
  normalizeFactorySalt,
  predictFactoryLockBox,
  predictFactoryPool,
  predictFactoryToken,
} from './predict.ts'

const FACTORY = getAddress('0x00000000000000000000000000000000000000fa')
const SENDER = getAddress('0x1111111111111111111111111111111111111111')
const RMN = getAddress('0x00000000000000000000000000000000000000b2')
const ROUTER = getAddress('0x00000000000000000000000000000000000000c3')
const TAR = getAddress('0x00000000000000000000000000000000000000e5')
const RMOC = getAddress('0x00000000000000000000000000000000000000e6')
const EXISTING_TOKEN = getAddress('0x00000000000000000000000000000000000000a1')
const USER_LOCKBOX = getAddress('0x00000000000000000000000000000000000000d4')
const SALT = '0x' + '00'.repeat(31) + '2a'
const TOKEN = { name: 'X', symbol: 'X', decimals: 18, maxSupply: 0n }

/** Stub EVMChain: typeAndVersion reports the factory, provider.call answers getStaticConfig, getCode is empty. */
function stubChain({
  type = 'TokenPoolFactory',
  version = '2.0.0',
  rmnProxy = RMN,
  router = ROUTER,
  occupied = false,
}: {
  type?: string
  version?: string
  rmnProxy?: string
  router?: string
  occupied?: boolean
} = {}): EVMChain {
  const selector = TOKEN_POOL_FACTORY_INTERFACE.getFunction('getStaticConfig')!.selector
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        if (data.slice(0, 10) !== selector)
          return Promise.reject(
            makeError('execution reverted', 'CALL_EXCEPTION', {
              action: 'call',
              data: '0x',
              reason: null,
              transaction: { to: null, data },
              invocation: null,
              revert: null,
            }),
          )
        return Promise.resolve(
          TOKEN_POOL_FACTORY_INTERFACE.encodeFunctionResult('getStaticConfig', [
            rmnProxy,
            TAR,
            RMOC,
            router,
          ]),
        )
      },
      getCode: () => Promise.resolve(occupied ? '0x60016002' : '0x'),
    },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(`${type} ${version}`)),
  } as unknown as EVMChain
}

/** Decodes the built factory calldata for assertions. */
function decode(fn: 'deployTokenAndTokenPool' | 'deployTokenPoolWithExistingToken', data: string) {
  return TOKEN_POOL_FACTORY_INTERFACE.decodeFunctionData(fn, data)
}

const guarded = guardFactorySalt(normalizeFactorySalt('t', SALT), SENDER)

describe('deployTokenAndTokenPoolViaFactory', () => {
  it('BurnMint: deploys CrossChainToken + BurnMintTokenPool, predicts both, encodes PoolType=BURN_MINT', async () => {
    const r = await deployTokenAndTokenPoolViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'BurnMintTokenPool',
      token: TOKEN,
    })
    assert.ok(r.token && r.pool)
    assert.equal(r.lockBox, undefined) // BurnMint has no lockbox
    const call = decode('deployTokenAndTokenPool', r.transaction.transactions[0]!.data as string)
    assert.equal(call.localPoolType, BigInt(FACTORY_POOL_TYPE.BurnMint))
    assert.equal(call.lockBox, '0x0000000000000000000000000000000000000000')
    assert.equal(call.salt, SALT) // the *user* salt, not the guarded one
    // token predicts from the exact tokenInitCode that was sent
    assert.equal(predictFactoryToken(FACTORY, guarded, call.tokenInitCode as string), r.token)
    // pool predicts from the sent pool bytecode + BurnMint (5-arg) init args
    const args = buildPoolInitArgs('BurnMint', {
      token: r.token!,
      decimals: 18,
      rmnProxy: RMN,
      router: ROUTER,
    })
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })

  it('LockRelease with an explicit lockBox: 6-arg init args, no auto lockbox returned', async () => {
    const r = await deployTokenAndTokenPoolViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'LockReleaseTokenPool',
      token: TOKEN,
      lockBox: USER_LOCKBOX,
    })
    assert.equal(r.lockBox, undefined) // caller-supplied, not auto-deployed
    const call = decode('deployTokenAndTokenPool', r.transaction.transactions[0]!.data as string)
    assert.equal(call.localPoolType, BigInt(FACTORY_POOL_TYPE.LockRelease))
    assert.equal(getAddress(call.lockBox as string), USER_LOCKBOX)
    const args = buildPoolInitArgs('LockRelease', {
      token: r.token!,
      decimals: 18,
      rmnProxy: RMN,
      router: ROUTER,
      lockBox: USER_LOCKBOX,
    })
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })

  it('LockRelease with no lockBox: predicts the auto-deployed lockbox and uses it in the pool init args', async () => {
    const r = await deployTokenAndTokenPoolViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'LockReleaseTokenPool',
      token: TOKEN,
    })
    assert.ok(r.token && r.lockBox)
    assert.equal(r.lockBox, predictFactoryLockBox(FACTORY, guarded, r.token!))
    const call = decode('deployTokenAndTokenPool', r.transaction.transactions[0]!.data as string)
    assert.equal(call.lockBox, '0x0000000000000000000000000000000000000000') // factory deploys it
    const args = buildPoolInitArgs('LockRelease', {
      token: r.token!,
      decimals: 18,
      rmnProxy: RMN,
      router: ROUTER,
      lockBox: r.lockBox!,
    })
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })
})

describe('deployTokenPoolWithExistingTokenViaFactory', () => {
  it('existing CrossChainToken + BurnMint: predicts the pool, no token deployed', async () => {
    const r = await deployTokenPoolWithExistingTokenViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'BurnMintTokenPool',
      token: EXISTING_TOKEN,
      localTokenDecimals: 18,
    })
    assert.equal(r.token, undefined)
    const call = decode(
      'deployTokenPoolWithExistingToken',
      r.transaction.transactions[0]!.data as string,
    )
    assert.equal(getAddress(call.token as string), EXISTING_TOKEN)
    const args = buildPoolInitArgs('BurnMint', {
      token: EXISTING_TOKEN,
      decimals: 18,
      rmnProxy: RMN,
      router: ROUTER,
    })
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })

  it('existing NON-CrossChainToken ERC20 + BurnMint: works identically, no CrossChainToken check', async () => {
    const plainErc20 = getAddress('0x00000000000000000000000000000000dead0001')
    const r = await deployTokenPoolWithExistingTokenViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'BurnMintTokenPool',
      token: plainErc20,
      localTokenDecimals: 8,
    })
    const call = decode(
      'deployTokenPoolWithExistingToken',
      r.transaction.transactions[0]!.data as string,
    )
    assert.equal(getAddress(call.token as string), plainErc20)
    const args = buildPoolInitArgs('BurnMint', {
      token: plainErc20,
      decimals: 8,
      rmnProxy: RMN,
      router: ROUTER,
    })
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })

  it('existing NON-CrossChainToken ERC20 + LockRelease, explicit lockBox', async () => {
    const plainErc20 = getAddress('0x00000000000000000000000000000000dead0002')
    const r = await deployTokenPoolWithExistingTokenViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'LockReleaseTokenPool',
      token: plainErc20,
      localTokenDecimals: 8,
      lockBox: USER_LOCKBOX,
    })
    assert.equal(r.lockBox, undefined)
    const call = decode(
      'deployTokenPoolWithExistingToken',
      r.transaction.transactions[0]!.data as string,
    )
    assert.equal(getAddress(call.lockBox as string), USER_LOCKBOX)
    const args = buildPoolInitArgs('LockRelease', {
      token: plainErc20,
      decimals: 8,
      rmnProxy: RMN,
      router: ROUTER,
      lockBox: USER_LOCKBOX,
    })
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })

  it('existing NON-CrossChainToken ERC20 + LockRelease, auto lockBox', async () => {
    const plainErc20 = getAddress('0x00000000000000000000000000000000dead0003')
    const r = await deployTokenPoolWithExistingTokenViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'LockReleaseTokenPool',
      token: plainErc20,
      localTokenDecimals: 8,
    })
    assert.equal(r.lockBox, predictFactoryLockBox(FACTORY, guarded, plainErc20))
    const args = buildPoolInitArgs('LockRelease', {
      token: plainErc20,
      decimals: 8,
      rmnProxy: RMN,
      router: ROUTER,
      lockBox: r.lockBox!,
    })
    const call = decode(
      'deployTokenPoolWithExistingToken',
      r.transaction.transactions[0]!.data as string,
    )
    assert.equal(
      predictFactoryPool(FACTORY, guarded, call.tokenPoolInitCode as string, args),
      r.pool,
    )
  })
})

describe('token-pool-factory deploy — security hardening', () => {
  it('expectedStaticConfig mismatch → throws (pinned prediction, TOB-CLCCT-7/#4)', async () => {
    await assert.rejects(
      () =>
        deployTokenAndTokenPoolViaFactory(stubChain({ rmnProxy: RMN, router: ROUTER }), {
          factory: FACTORY,
          sender: SENDER,
          salt: SALT,
          type: 'BurnMintTokenPool',
          token: TOKEN,
          expectedStaticConfig: { rmnProxy: TAR, router: ROUTER }, // wrong rmnProxy
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError && e.context.param === 'expectedStaticConfig',
    )
  })

  it('expectedStaticConfig match → builds', async () => {
    const r = await deployTokenAndTokenPoolViaFactory(stubChain(), {
      factory: FACTORY,
      sender: SENDER,
      salt: SALT,
      type: 'BurnMintTokenPool',
      token: TOKEN,
      expectedStaticConfig: { rmnProxy: RMN, router: ROUTER },
    })
    assert.ok(r.pool)
  })

  it('non-factory address → assertTokenPoolFactory throws (TOB-CLCCT-3)', async () => {
    await assert.rejects(
      () =>
        deployTokenAndTokenPoolViaFactory(stubChain({ type: 'LockReleaseTokenPool' }), {
          factory: FACTORY,
          sender: SENDER,
          salt: SALT,
          type: 'BurnMintTokenPool',
          token: TOKEN,
        }),
      (e: unknown) =>
        e instanceof CCTContractTypeInvalidError && e.context.expected === 'TokenPoolFactory',
    )
  })

  it('unsupported factory version → throws', async () => {
    await assert.rejects(
      () =>
        deployTokenAndTokenPoolViaFactory(stubChain({ version: '1.0.0' }), {
          factory: FACTORY,
          sender: SENDER,
          salt: SALT,
          type: 'BurnMintTokenPool',
          token: TOKEN,
        }),
      (e: unknown) => e instanceof CCTContractVersionUnsupportedError,
    )
  })

  it('already-occupied predicted address → throws (reused salt)', async () => {
    await assert.rejects(
      () =>
        deployTokenAndTokenPoolViaFactory(stubChain({ occupied: true }), {
          factory: FACTORY,
          sender: SENDER,
          salt: SALT,
          type: 'BurnMintTokenPool',
          token: TOKEN,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'salt',
    )
  })

  it('zero factory → validateNonZeroAddress throws (TOB-CLCCT-11)', () => {
    assert.throws(
      () =>
        deployTokenAndTokenPoolViaFactoryUnchecked(
          {
            factory: '0x0000000000000000000000000000000000000000',
            sender: SENDER,
            salt: SALT,
            type: 'BurnMintTokenPool',
            token: TOKEN,
          },
          { rmnProxy: RMN, router: ROUTER },
        ),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'factory',
    )
  })

  it('zero existing token → validateNonZeroAddress throws (TOB-CLCCT-11)', () => {
    assert.throws(
      () =>
        deployTokenPoolWithExistingTokenViaFactoryUnchecked(
          {
            factory: FACTORY,
            sender: SENDER,
            salt: SALT,
            type: 'BurnMintTokenPool',
            token: '0x0000000000000000000000000000000000000000',
            localTokenDecimals: 18,
          },
          { rmnProxy: RMN, router: ROUTER },
        ),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'token',
    )
  })

  it('futureOwner zero is allowed (factory uses msg.sender) — encoded as zero, builds fine', () => {
    const r = deployTokenAndTokenPoolViaFactoryUnchecked(
      {
        factory: FACTORY,
        sender: SENDER,
        salt: SALT,
        type: 'BurnMintTokenPool',
        token: TOKEN,
      },
      { rmnProxy: RMN, router: ROUTER },
    )
    const call = decode('deployTokenAndTokenPool', r.transaction.transactions[0]!.data as string)
    assert.equal(call.futureOwner, '0x0000000000000000000000000000000000000000')
  })
})

describe('remote address handling (pre-encoded bytes, like applyChainUpdates)', () => {
  const REMOTE_POOL = getAddress('0x2222222222222222222222222222222222222222')
  // the bytes form the pool stores: abi.encode(address) — the caller pre-encodes, we do not
  const encoded = (a: string) => AbiCoder.defaultAbiCoder().encode(['address'], [a])
  const remote = (pool?: string, token?: string) => ({
    remoteChainSelector: 99n,
    remotePoolAddress: pool,
    remoteChainConfig: {
      remotePoolFactory: FACTORY,
      remoteRouter: ROUTER,
      remoteRMNProxy: RMN,
      remoteLockBox: '0x0000000000000000000000000000000000000000',
      remoteTokenDecimals: 18,
    },
    poolType: 'BurnMint' as const,
    remoteTokenAddress: token,
  })
  const buildRemote = (pool?: string, token?: string) =>
    decode(
      'deployTokenPoolWithExistingToken',
      deployTokenPoolWithExistingTokenViaFactoryUnchecked(
        {
          factory: FACTORY,
          sender: SENDER,
          salt: SALT,
          type: 'BurnMintTokenPool',
          token: EXISTING_TOKEN,
          localTokenDecimals: 18,
          remoteTokenPools: [remote(pool, token)],
        },
        { rmnProxy: RMN, router: ROUTER },
      ).transaction.transactions[0]!.data as string,
    ).remoteTokenPools[0]

  it('passes a pre-encoded 32-byte remote pool/token through unchanged (the form the pool matches on)', () => {
    const pre = encoded(REMOTE_POOL)
    const rt = buildRemote(pre, pre)
    assert.equal(rt.remotePoolAddress, pre)
    assert.equal(rt.remoteTokenAddress, pre)
  })

  it('does NOT auto-encode: a caller-supplied value is validated and passed through verbatim', () => {
    // a raw 20-byte address is valid hex bytes, so it passes through as-is — NOT abi-encoded.
    // Callers must pre-encode an EVM remote via encodeAddressToAny; the SDK never encodes for them.
    const rt = buildRemote(REMOTE_POOL.toLowerCase(), REMOTE_POOL.toLowerCase())
    assert.equal(rt.remotePoolAddress, REMOTE_POOL.toLowerCase())
    assert.notEqual(rt.remotePoolAddress, encoded(REMOTE_POOL))
  })

  it('leaves an omitted (or 0x) remote address as 0x for the factory to predict', () => {
    assert.equal(buildRemote(undefined, undefined).remotePoolAddress, '0x')
    assert.equal(buildRemote('0x', '0x').remoteTokenAddress, '0x')
  })

  it('rejects a malformed remote address (non-whole-byte hex) with CCTParamsInvalidError', () => {
    assert.throws(
      () => buildRemote('0xabc', encoded(REMOTE_POOL)),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'remotePoolAddress',
    )
  })
})
