import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, toBeHex } from 'ethers'

import { SetAllowedFinalityConfig } from './set-allowed-finality-config.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { encodeFinality } from '../../../../extra-args.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

/** Builds a stub EVMChain that reports `version`. */
function makeChain(version: CCIPVersion): EVMChain {
  return {
    logger,
    typeAndVersion: () => Promise.resolve(['TokenPool', version, 'x'] as const),
  } as unknown as EVMChain
}

describe('EVM cct setAllowedFinalityConfig', () => {
  const op = new SetAllowedFinalityConfig()

  for (const finality of ['finalized', 'safe', 5] as const) {
    it(`v2.0 encodes bytes4 finality (${finality}) — byte-identical to direct encode`, async () => {
      const unsigned = await op.generate(makeChain(CCIPVersion.V2_0), {
        poolAddress: POOL,
        finality,
      })
      const allowedFinality = toBeHex(encodeFinality(finality), 4)
      const expected = new Interface(TokenPool_2_0_ABI).encodeFunctionData(
        'setAllowedFinalityConfig',
        [allowedFinality],
      )
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, POOL)
      assert.equal(unsigned.transactions[0]!.data, expected)
    })
  }

  it('applies sender to from', async () => {
    const unsigned = await op.generate(makeChain(CCIPVersion.V2_0), {
      poolAddress: POOL,
      finality: 'finalized',
      sender: POOL,
    })
    assert.equal(unsigned.transactions[0]!.from, POOL)
  })

  it('rejects pools below v2.0', async () => {
    await assert.rejects(
      () => op.generate(makeChain(CCIPVersion.V1_6), { poolAddress: POOL, finality: 'finalized' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects an out-of-range block-depth finality', async () => {
    await assert.rejects(
      () => op.generate(makeChain(CCIPVersion.V2_0), { poolAddress: POOL, finality: 70_000 }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'finality',
    )
  })

  it('rejects invalid pool address before RPC', async () => {
    await assert.rejects(
      () =>
        op.generate(makeChain(CCIPVersion.V2_0), { poolAddress: 'nope', finality: 'finalized' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })
})
