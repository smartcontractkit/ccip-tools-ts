import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import { AcceptOwnership } from './accept-ownership.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as EVMChain

describe('EVM cct acceptOwnership', () => {
  const op = new AcceptOwnership()

  it('encodes acceptOwnership() byte-identical to a direct ethers encode', async () => {
    const unsigned = await op.generate(stubChain, { poolAddress: POOL })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('acceptOwnership', [])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(stubChain, { poolAddress: POOL, sender: POOL })
    assert.equal(unsigned.transactions[0]!.from, POOL)
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { poolAddress: 'nope' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })
})
