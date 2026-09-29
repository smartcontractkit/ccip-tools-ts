import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetThresholdAmount } from './get-threshold-amount.ts'

const HOOKS = '0x' + '11'.repeat(20)
const IFACE = new Interface(['function getThresholdAmount() view returns (uint256)'])

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(data.slice(0, 10), IFACE.getFunction('getThresholdAmount')!.selector)
        return Promise.resolve(IFACE.encodeFunctionResult('getThresholdAmount', [1_000n]))
      },
    },
  } as unknown as EVMChain
}

describe('GetThresholdAmount (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it('reads the additional-CCV threshold', async () => {
      assert.equal(
        await new GetThresholdAmount().query(stubChain(), { advancedPoolHooks: HOOKS }),
        1_000n,
      )
    })
  })

  describe('validation', () => {
    it('rejects a zero hooks address before RPC', async () => {
      await assert.rejects(
        () => new GetThresholdAmount().query(stubChain(), { advancedPoolHooks: ZeroAddress }),
        CCTParamsInvalidError,
      )
    })
  })
})
