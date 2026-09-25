import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetAllCCVConfigs } from './get-all-ccv-configs.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CCV = '0x' + '22'.repeat(20)
const IFACE = new Interface([
  'function getAllCCVConfigs() view returns ((uint64 remoteChainSelector, address[] outboundCCVs, address[] thresholdOutboundCCVs, address[] inboundCCVs, address[] thresholdInboundCCVs)[])',
])
const CONFIG = [1n, [CCV], [], [], []]

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(data.slice(0, 10), IFACE.getFunction('getAllCCVConfigs')!.selector)
        return Promise.resolve(IFACE.encodeFunctionResult('getAllCCVConfigs', [[CONFIG]]))
      },
    },
  } as unknown as EVMChain
}

const op = new GetAllCCVConfigs()

describe('GetAllCCVConfigs (cct/evm advanced-pool-hooks)', () => {
  it('lists configured remote chain configs', async () => {
    assert.deepEqual(await op.query(stubChain(), { advancedPoolHooks: HOOKS }), [
      {
        remoteChainSelector: 1n,
        outboundCCVs: [CCV],
        thresholdOutboundCCVs: [],
        inboundCCVs: [],
        thresholdInboundCCVs: [],
      },
    ])
  })

  it('rejects a zero hooks address before RPC', async () => {
    await assert.rejects(
      () => op.query(stubChain(), { advancedPoolHooks: ZeroAddress }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'advancedPoolHooks',
    )
  })
})
