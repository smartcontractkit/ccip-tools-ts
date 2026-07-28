import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import { TransferOwnership } from './transfer-ownership.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const NEW_OWNER = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as EVMChain

describe('EVM cct transferOwnership', () => {
  const op = new TransferOwnership()

  it('encodes transferOwnership(newOwner) byte-identical to a direct ethers encode', async () => {
    const unsigned = await op.generate(stubChain, { poolAddress: POOL, newOwner: NEW_OWNER })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('transferOwnership', [
      NEW_OWNER,
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(stubChain, {
      poolAddress: POOL,
      newOwner: NEW_OWNER,
      sender: NEW_OWNER,
    })
    assert.equal(unsigned.transactions[0]!.from, NEW_OWNER)
  })

  it('rejects an invalid newOwner before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { poolAddress: POOL, newOwner: 'nope' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'newOwner',
    )
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { poolAddress: 'nope', newOwner: NEW_OWNER }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })
})
