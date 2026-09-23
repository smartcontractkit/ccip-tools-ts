import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, ZeroAddress, concat, getCreate2Address, keccak256, toUtf8Bytes } from 'ethers'

import { CCTParamsInvalidError } from '../../errors.ts'
import { LOCKBOX_BYTECODE } from '../lockbox/contracts.ts'
import {
  assertNonEmptyInitCode,
  buildPoolInitArgs,
  guardFactorySalt,
  normalizeFactorySalt,
  predictFactoryLockBox,
  predictFactoryPool,
  predictFactoryToken,
} from './predict.ts'

// Fixed inputs; the frozen literals below were computed independently with raw ethers primitives
// (see the module PR notes), so a drift in arg order / types / concat order in predict.ts is caught.
const FACTORY = '0x00000000000000000000000000000000000000fa'
const SENDER = '0x1111111111111111111111111111111111111111'
const SALT = '0x' + '00'.repeat(31) + '2a'
const GUARDED = '0x9b2a314b2cda0dbc9b607df7f15122c7509137a773a081221a94a0c28784d261'
const TOKEN = '0x00000000000000000000000000000000000000a1'
const RMN = '0x00000000000000000000000000000000000000b2'
const ROUTER = '0x00000000000000000000000000000000000000c3'
const LOCKBOX = '0x00000000000000000000000000000000000000d4'
const POOL_INIT = '0x60ff' // synthetic pool bytecode

describe('token-pool-factory predict (golden vectors)', () => {
  it('guardFactorySalt = keccak256(abi.encodePacked(salt, sender))', () => {
    assert.equal(guardFactorySalt(SALT, SENDER), GUARDED)
  })

  it('predictFactoryToken = getCreate2Address(factory, guardedSalt, keccak256(tokenInitCode))', () => {
    assert.equal(
      predictFactoryToken(FACTORY, GUARDED, '0x6001600255'),
      '0xcC872325F49e805F8Dd5BC01A6cd0Ee8c5372A1c',
    )
  })

  it('buildPoolInitArgs BurnMint = abi.encode(token, decimals, address(0), rmnProxy, router)', () => {
    assert.equal(
      buildPoolInitArgs('BurnMint', {
        token: TOKEN,
        decimals: 18,
        rmnProxy: RMN,
        router: ROUTER,
      }),
      AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint8', 'address', 'address', 'address'],
        [TOKEN, 18, ZeroAddress, RMN, ROUTER],
      ),
    )
  })

  it('buildPoolInitArgs LockRelease appends lockBox as the 6th arg', () => {
    assert.equal(
      buildPoolInitArgs('LockRelease', {
        token: TOKEN,
        decimals: 6,
        rmnProxy: RMN,
        router: ROUTER,
        lockBox: LOCKBOX,
      }),
      AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint8', 'address', 'address', 'address', 'address'],
        [TOKEN, 6, ZeroAddress, RMN, ROUTER, LOCKBOX],
      ),
    )
  })

  it('predictFactoryPool BurnMint (5-arg init args) matches the frozen vector', () => {
    const args = buildPoolInitArgs('BurnMint', {
      token: TOKEN,
      decimals: 18,
      rmnProxy: RMN,
      router: ROUTER,
    })
    assert.equal(
      predictFactoryPool(FACTORY, GUARDED, POOL_INIT, args),
      '0x313611eB8c458a6CdF7965946F3244B92c6c70d1',
    )
  })

  it('predictFactoryPool LockRelease (6-arg init args) matches the frozen vector', () => {
    const args = buildPoolInitArgs('LockRelease', {
      token: TOKEN,
      decimals: 6,
      rmnProxy: RMN,
      router: ROUTER,
      lockBox: LOCKBOX,
    })
    assert.equal(
      predictFactoryPool(FACTORY, GUARDED, POOL_INIT, args),
      '0x5c01c558d255Ea54A74706f182d5Da328467633F',
    )
  })

  it('predictFactoryLockBox = getCreate2Address(factory, guardedSalt, keccak256(LOCKBOX_BYTECODE ‖ abi.encode(token)))', () => {
    const expected = getCreate2Address(
      FACTORY,
      GUARDED,
      keccak256(
        concat([LOCKBOX_BYTECODE, AbiCoder.defaultAbiCoder().encode(['address'], [TOKEN])]),
      ),
    )
    assert.equal(predictFactoryLockBox(FACTORY, GUARDED, TOKEN), expected)
  })
})

describe('token-pool-factory predict (salt + init-code guards)', () => {
  it('normalizeFactorySalt passes a 32-byte hex salt through unchanged', () => {
    assert.equal(normalizeFactorySalt('op', SALT), SALT)
  })

  it('normalizeFactorySalt hashes a non-hex label into a bytes32', () => {
    assert.equal(normalizeFactorySalt('op', 'my-lane-v1'), keccak256(toUtf8Bytes('my-lane-v1')))
  })

  it('normalizeFactorySalt rejects the empty string', () => {
    assert.throws(
      () => normalizeFactorySalt('op', ''),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'salt',
    )
  })

  it('normalizeFactorySalt rejects a wrong-length hex string', () => {
    assert.throws(
      () => normalizeFactorySalt('op', '0x1234'),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'salt',
    )
  })

  it('assertNonEmptyInitCode rejects 0x / empty', () => {
    for (const bad of ['0x', '']) {
      assert.throws(
        () => assertNonEmptyInitCode('op', 'tokenInitCode', bad),
        (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'tokenInitCode',
      )
    }
  })

  it('assertNonEmptyInitCode accepts real creation code', () => {
    assert.doesNotThrow(() => assertNonEmptyInitCode('op', 'tokenInitCode', '0x6001'))
  })
})
