import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type PoolStub, POOL, withPool } from '../pool.test.helpers.ts'
import { GetRequiredCCVs } from './get-required-ccvs.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CCV = '0x' + 'ab'.repeat(20)
const IFACE = new Interface([
  'function getRequiredCCVs(address,uint64,uint256,bytes4,bytes,uint8) view returns (address[])',
])

/**
 * {@link POOL} bound to {@link HOOKS}, which answer only `getRequiredCCVs` — asserting the
 * neutral arguments, and that `amount` reaches the hooks unchanged.
 */
function stubChain(pool: Partial<PoolStub> = {}): EVMChain {
  return withPool(
    {
      typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
      provider: {
        call: ({ to, data }: { to: string; data: string }) => {
          assert.equal(to.toLowerCase(), HOOKS)
          const decoded = IFACE.decodeFunctionData('getRequiredCCVs', data)
          assert.equal(decoded[0], ZeroAddress)
          assert.equal(decoded[2], params.amount)
          assert.equal(decoded[3], '0x00000000')
          assert.equal(decoded[4], '0x')
          assert.equal(decoded[5], 1n)
          return Promise.resolve(IFACE.encodeFunctionResult('getRequiredCCVs', [[CCV]]))
        },
      },
    } as unknown as EVMChain,
    { hooks: HOOKS, ...pool },
  )
}

const op = new GetRequiredCCVs()
const params = {
  poolAddress: POOL,
  remoteChainSelector: 1n,
  amount: 1_234n,
  direction: 'inbound' as const,
}

describe('GetRequiredCCVs (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it("resolves the configured CCVs for a direction from the pool's bound hooks", async () => {
      assert.deepEqual(await op.query(stubChain(), params), [getAddress(CCV)])
    })

    it('rejects a pre-v2.0.0 pool as unsupported', async () => {
      await assert.rejects(
        () => op.query(stubChain({ typeAndVersion: 'BurnMintTokenPool 1.6.1' }), params),
        CCTOperationUnsupportedError,
      )
    })

    it('rejects a pool with no hooks bound', async () => {
      await assert.rejects(
        () => op.query(stubChain({ hooks: ZeroAddress }), params),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'poolAddress',
      )
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ poolAddress: ZeroAddress }, 'poolAddress'],
      [{ amount: -1n }, 'amount'],
      [{ direction: 'sideways' }, 'direction'],
    ] as const) {
      it(`rejects ${param} before RPC`, async () => {
        await assert.rejects(
          () => op.query(stubChain(), { ...params, ...overrides } as never),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      })
    }
  })
})
