import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress } from 'ethers'

import { DeployPoolViaFactory } from './deploy-pool-via-factory.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { BURN_MINT_TOKEN_POOL_BYTECODE } from '../bytecodes/BurnMintTokenPool.ts'
import { LOCK_RELEASE_TOKEN_POOL_BYTECODE } from '../bytecodes/LockReleaseTokenPool.ts'
import { FACTORY_POOL_TYPE, tokenPoolFactoryInterface } from '../token-pool-factory-abi.ts'

const FACTORY = '0x1111111111111111111111111111111111111111'
const TOKEN = '0xa42ba090720aee0602ad4381fadcc9380ad3d888'
const LOCKBOX = '0xccccc17d24393eb02ecd2b1f2a0e78d5b1f0aa11'
const OWNER = '0xdddddddddddddddddddddddddddddddddddddddd'
const SALT = '0x' + '11'.repeat(32)

/** Minimal stub chain — buildUnsigned is pure encoding (no RPC / staticCall). */
function stubChain(): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as EVMChain
}

describe('EVM cct deployPoolViaFactory', () => {
  const op = new DeployPoolViaFactory()

  it('burn-mint: byte-identical factory-call calldata with a fixed salt', async () => {
    const unsigned = await op.generate(stubChain(), {
      factoryAddress: FACTORY,
      tokenAddress: TOKEN,
      decimals: 18,
      poolType: 'burn-mint',
      salt: SALT,
      futureOwner: OWNER,
    })
    const expected = tokenPoolFactoryInterface.encodeFunctionData(
      'deployTokenPoolWithExistingToken',
      [
        TOKEN,
        18,
        FACTORY_POOL_TYPE['burn-mint'],
        [],
        BURN_MINT_TOKEN_POOL_BYTECODE,
        ZeroAddress,
        SALT,
        OWNER,
      ],
    )
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, FACTORY)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('lock-release: passes the supplied lockBox and lock-release bytecode', async () => {
    const unsigned = await op.generate(stubChain(), {
      factoryAddress: FACTORY,
      tokenAddress: TOKEN,
      decimals: 8,
      poolType: 'lock-release',
      lockBoxAddress: LOCKBOX,
      salt: SALT,
      futureOwner: OWNER,
    })
    const expected = tokenPoolFactoryInterface.encodeFunctionData(
      'deployTokenPoolWithExistingToken',
      [
        TOKEN,
        8,
        FACTORY_POOL_TYPE['lock-release'],
        [],
        LOCK_RELEASE_TOKEN_POOL_BYTECODE,
        LOCKBOX,
        SALT,
        OWNER,
      ],
    )
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('arg assembly round-trips through the factory ABI decoder', async () => {
    const unsigned = await op.generate(stubChain(), {
      factoryAddress: FACTORY,
      tokenAddress: TOKEN,
      decimals: 6,
      poolType: 'burn-mint',
      salt: SALT,
      futureOwner: OWNER,
    })
    const decoded = tokenPoolFactoryInterface.decodeFunctionData(
      'deployTokenPoolWithExistingToken',
      unsigned.transactions[0]!.data!,
    )
    assert.equal((decoded[0] as string).toLowerCase(), TOKEN)
    assert.equal(Number(decoded[1]), 6)
    assert.equal(Number(decoded[2]), FACTORY_POOL_TYPE['burn-mint'])
    assert.equal((decoded[3] as unknown[]).length, 0)
    assert.equal(decoded[4] as string, BURN_MINT_TOKEN_POOL_BYTECODE)
    assert.equal(decoded[5] as string, ZeroAddress)
    assert.equal(decoded[6] as string, SALT)
    assert.equal((decoded[7] as string).toLowerCase(), OWNER)
  })

  it('requires futureOwner on the unsigned path', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          factoryAddress: FACTORY,
          tokenAddress: TOKEN,
          decimals: 18,
          poolType: 'burn-mint',
          salt: SALT,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'futureOwner',
    )
  })

  it('rejects an invalid poolType', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          factoryAddress: FACTORY,
          tokenAddress: TOKEN,
          decimals: 18,
          poolType: 'nonsense' as never,
          futureOwner: OWNER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolType',
    )
  })

  it('rejects a missing tokenAddress', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          factoryAddress: FACTORY,
          tokenAddress: '',
          decimals: 18,
          poolType: 'burn-mint',
          futureOwner: OWNER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'tokenAddress',
    )
  })
})
