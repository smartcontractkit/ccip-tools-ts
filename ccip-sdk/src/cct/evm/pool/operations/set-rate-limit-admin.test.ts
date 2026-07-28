import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, Interface } from 'ethers'

import { SetRateLimitAdmin } from './set-rate-limit-admin.ts'
import TokenPool_1_5_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const NEW_ADMIN = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const FEE_ADMIN = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const OLD_RL_ADMIN = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

/** Builds a stub EVMChain that reports `version` and (v2.0) serves getDynamicConfig. */
function makeChain(version: CCIPVersion): EVMChain {
  const dynamicConfig = AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'address'],
    [ROUTER, OLD_RL_ADMIN, FEE_ADMIN],
  )
  return {
    logger,
    typeAndVersion: () => Promise.resolve(['LockReleaseTokenPool', version, 'x'] as const),
    provider: { call: () => Promise.resolve(dynamicConfig) },
  } as unknown as EVMChain
}

describe('EVM cct setRateLimitAdmin', () => {
  const op = new SetRateLimitAdmin()

  it('v1.5 encodes standalone setRateLimitAdmin — byte-identical to a direct ethers encode', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V1_5), {
      poolAddress: POOL,
      rateLimitAdmin: NEW_ADMIN,
    })
    const expected = new Interface(TokenPool_1_5_ABI).encodeFunctionData('setRateLimitAdmin', [
      NEW_ADMIN,
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('v1.6 encodes standalone setRateLimitAdmin', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V1_6), {
      poolAddress: POOL,
      rateLimitAdmin: NEW_ADMIN,
    })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('setRateLimitAdmin', [
      NEW_ADMIN,
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('v2.0 reads dynamic config and rewrites only rateLimitAdmin', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V2_0), {
      poolAddress: POOL,
      rateLimitAdmin: NEW_ADMIN,
    })
    const expected = new Interface(TokenPool_2_0_ABI).encodeFunctionData('setDynamicConfig', [
      ROUTER,
      NEW_ADMIN,
      FEE_ADMIN,
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V1_6), {
      poolAddress: POOL,
      rateLimitAdmin: NEW_ADMIN,
      sender: NEW_ADMIN,
    })
    assert.equal(unsigned.transactions[0]!.from, NEW_ADMIN)
  })

  it('rejects invalid addresses before RPC', async () => {
    await assert.rejects(
      () =>
        op.generate(makeChain(CCIPVersion.V1_6), {
          poolAddress: 'nope',
          rateLimitAdmin: NEW_ADMIN,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
    await assert.rejects(
      () => op.generate(makeChain(CCIPVersion.V1_6), { poolAddress: POOL, rateLimitAdmin: 'nope' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'rateLimitAdmin',
    )
  })
})
