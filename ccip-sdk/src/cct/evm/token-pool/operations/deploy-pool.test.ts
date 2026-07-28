import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, ZeroAddress, concat } from 'ethers'

import { DeployPool } from './deploy-pool.ts'
import { BURN_MINT_TOKEN_POOL_BYTECODE } from '../bytecodes/BurnMintTokenPool.ts'
import { LOCK_RELEASE_TOKEN_POOL_BYTECODE } from '../bytecodes/LockReleaseTokenPool.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const RMN = '0x411dd1e5c9b2a6ded3eb8b7edcab0b9ea9c8cde1'
const LOCKBOX = '0xccccc17d24393eb02ecd2b1f2a0e78d5b1f0aa11'
const coder = AbiCoder.defaultAbiCoder()

/** Stub chain whose router.getArmProxy() returns a fixed rmnProxy. */
function stubChain(): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      // ethers Contract.getArmProxy() → provider.call(); return the ABI-encoded address
      call: async () => coder.encode(['address'], [RMN]),
    },
  } as unknown as EVMChain
}

describe('EVM cct deployPool', () => {
  const op = new DeployPool()

  it('burn-mint: byte-identical creation data with derived rmnProxy', async () => {
    const unsigned = await op.generate(stubChain(), {
      poolType: 'burn-mint',
      tokenAddress: TOKEN,
      localTokenDecimals: 18,
      routerAddress: ROUTER,
    })
    const expected = concat([
      BURN_MINT_TOKEN_POOL_BYTECODE,
      coder.encode(
        ['address', 'uint8', 'address', 'address', 'address'],
        [TOKEN, 18, ZeroAddress, RMN, ROUTER],
      ),
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, null)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('lock-release: byte-identical creation data (with lockBox in constructor)', async () => {
    const unsigned = await op.generate(stubChain(), {
      poolType: 'lock-release',
      tokenAddress: TOKEN,
      localTokenDecimals: 8,
      routerAddress: ROUTER,
      lockBoxAddress: LOCKBOX,
      advancedPoolHooks: ZeroAddress,
    })
    const expected = concat([
      LOCK_RELEASE_TOKEN_POOL_BYTECODE,
      coder.encode(
        ['address', 'uint8', 'address', 'address', 'address', 'address'],
        [TOKEN, 8, ZeroAddress, RMN, ROUTER, LOCKBOX],
      ),
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('requires lockBoxAddress on the unsigned lock-release path', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          poolType: 'lock-release',
          tokenAddress: TOKEN,
          localTokenDecimals: 18,
          routerAddress: ROUTER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'lockBoxAddress',
    )
  })

  it('rejects an invalid poolType', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          poolType: 'nonsense' as never,
          tokenAddress: TOKEN,
          localTokenDecimals: 18,
          routerAddress: ROUTER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolType',
    )
  })
})
