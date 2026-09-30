import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetCCVConfig } from './get-ccv-config.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CCV = '0x' + 'ab'.repeat(20)
const IFACE = new Interface([
  'function getCCVConfig(uint64) view returns ((address[] outboundCCVs, address[] thresholdOutboundCCVs, address[] inboundCCVs, address[] thresholdInboundCCVs))',
])
const CONFIG = [[CCV], [], [], []]

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(data.slice(0, 10), IFACE.getFunction('getCCVConfig')!.selector)
        return Promise.resolve(IFACE.encodeFunctionResult('getCCVConfig', [CONFIG]))
      },
    },
  } as unknown as EVMChain
}

const op = new GetCCVConfig()

describe('GetCCVConfig (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it('reads one remote chain config', async () => {
      assert.deepEqual(
        await op.query(stubChain(), { advancedPoolHooks: HOOKS, remoteChainSelector: 1n }),
        {
          outboundCCVs: [getAddress(CCV)],
          thresholdOutboundCCVs: [],
          inboundCCVs: [],
          thresholdInboundCCVs: [],
        },
      )
    })
  })

  describe('validation', () => {
    for (const [params, param] of [
      [{ advancedPoolHooks: ZeroAddress, remoteChainSelector: 1n }, 'advancedPoolHooks'],
      [{ advancedPoolHooks: HOOKS, remoteChainSelector: -1n }, 'remoteChainSelector'],
    ] as const) {
      it(`rejects ${param} before RPC`, async () => {
        await assert.rejects(
          () => op.query(stubChain(), params),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      })
    }
  })
})
