import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, Interface } from 'ethers'

import { SetFeeAdmin } from './set-fee-admin.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const NEW_FEE_ADMIN = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const RL_ADMIN = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const OLD_FEE_ADMIN = '0x1F98431c8aD98523631AE4a59f267346ea31F984'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

/** Builds a stub EVMChain that reports `version` and serves getDynamicConfig. */
function makeChain(version: CCIPVersion): EVMChain {
  const dynamicConfig = AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'address'],
    [ROUTER, RL_ADMIN, OLD_FEE_ADMIN],
  )
  return {
    logger,
    typeAndVersion: () => Promise.resolve(['TokenPool', version, 'x'] as const),
    provider: { call: () => Promise.resolve(dynamicConfig) },
  } as unknown as EVMChain
}

describe('EVM cct setFeeAdmin', () => {
  const op = new SetFeeAdmin()

  it('v2.0 reads dynamic config and rewrites only feeAdmin — byte-identical to direct encode', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V2_0), {
      poolAddress: POOL,
      feeAdmin: NEW_FEE_ADMIN,
    })
    const expected = new Interface(TokenPool_2_0_ABI).encodeFunctionData('setDynamicConfig', [
      ROUTER,
      RL_ADMIN,
      NEW_FEE_ADMIN,
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V2_0), {
      poolAddress: POOL,
      feeAdmin: NEW_FEE_ADMIN,
      sender: NEW_FEE_ADMIN,
    })
    assert.equal(unsigned.transactions[0]!.from, NEW_FEE_ADMIN)
  })

  it('rejects pools below v2.0', async () => {
    await assert.rejects(
      () =>
        op.generate(makeChain(CCIPVersion.V1_6), { poolAddress: POOL, feeAdmin: NEW_FEE_ADMIN }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects invalid addresses before RPC', async () => {
    await assert.rejects(
      () => op.generate(makeChain(CCIPVersion.V2_0), { poolAddress: POOL, feeAdmin: 'nope' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'feeAdmin',
    )
  })
})
