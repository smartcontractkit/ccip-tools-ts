import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type PoolStub, POOL, withPool } from '../pool.test.helpers.ts'
import { GetAllAdvancedPoolHooksAuthorizedCallers } from './get-all-advanced-pool-hooks-authorized-callers.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CALLER = '0x' + 'ab'.repeat(20)
const IFACE = new Interface(['function getAllAuthorizedCallers() view returns (address[])'])

/** {@link POOL} bound to {@link HOOKS}, which answer only `getAllAuthorizedCallers`. */
function stubChain(pool: Partial<PoolStub> = {}): EVMChain {
  return withPool(
    {
      typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
      provider: {
        call: ({ to, data }: { to: string; data: string }) => {
          assert.equal(to.toLowerCase(), HOOKS)
          assert.equal(data.slice(0, 10), IFACE.getFunction('getAllAuthorizedCallers')!.selector)
          return Promise.resolve(IFACE.encodeFunctionResult('getAllAuthorizedCallers', [[CALLER]]))
        },
      },
    } as unknown as EVMChain,
    { hooks: HOOKS, ...pool },
  )
}

const op = new GetAllAdvancedPoolHooksAuthorizedCallers()

describe('GetAllAdvancedPoolHooksAuthorizedCallers (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it("reads checksummed authorized callers from the pool's bound hooks", async () => {
      assert.deepEqual(await op.query(stubChain(), { poolAddress: POOL }), [getAddress(CALLER)])
    })

    it('rejects a pre-v2.0.0 pool as unsupported', async () => {
      await assert.rejects(
        () =>
          op.query(stubChain({ typeAndVersion: 'BurnMintTokenPool 1.6.1' }), {
            poolAddress: POOL,
          }),
        CCTOperationUnsupportedError,
      )
    })

    it('rejects a pool with no hooks bound', async () => {
      await assert.rejects(
        () => op.query(stubChain({ hooks: ZeroAddress }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'poolAddress',
      )
    })
  })

  describe('validation', () => {
    it('rejects a zero pool address before RPC', async () => {
      await assert.rejects(
        () => op.query(stubChain(), { poolAddress: ZeroAddress }),
        CCTParamsInvalidError,
      )
    })
  })
})
