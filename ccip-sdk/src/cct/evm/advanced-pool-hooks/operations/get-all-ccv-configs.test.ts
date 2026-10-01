import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type PoolStub, POOL, withPool } from '../pool.test.helpers.ts'
import { GetAllCCVConfigs } from './get-all-ccv-configs.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CCV = '0x' + 'ab'.repeat(20)
const IFACE = new Interface([
  'function getAllCCVConfigs() view returns ((uint64 remoteChainSelector, address[] outboundCCVs, address[] thresholdOutboundCCVs, address[] inboundCCVs, address[] thresholdInboundCCVs)[])',
])
const CONFIG = [1n, [CCV], [], [], []]

/** {@link POOL} bound to {@link HOOKS}, which answer only `getAllCCVConfigs`. */
function stubChain(pool: Partial<PoolStub> = {}): EVMChain {
  return withPool(
    {
      typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
      provider: {
        call: ({ to, data }: { to: string; data: string }) => {
          assert.equal(to.toLowerCase(), HOOKS)
          assert.equal(data.slice(0, 10), IFACE.getFunction('getAllCCVConfigs')!.selector)
          return Promise.resolve(IFACE.encodeFunctionResult('getAllCCVConfigs', [[CONFIG]]))
        },
      },
    } as unknown as EVMChain,
    { hooks: HOOKS, ...pool },
  )
}

const op = new GetAllCCVConfigs()

describe('GetAllCCVConfigs (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it("lists configured remote chain configs from the pool's bound hooks", async () => {
      assert.deepEqual(await op.query(stubChain(), { poolAddress: POOL }), [
        {
          remoteChainSelector: 1n,
          outboundCCVs: [getAddress(CCV)],
          thresholdOutboundCCVs: [],
          inboundCCVs: [],
          thresholdInboundCCVs: [],
        },
      ])
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
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'poolAddress',
      )
    })
  })
})
