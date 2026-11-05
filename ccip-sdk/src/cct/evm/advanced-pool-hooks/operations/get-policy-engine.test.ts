import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetPolicyEngine } from './get-policy-engine.ts'

const HOOKS = '0x' + '11'.repeat(20)
const ENGINE = '0x' + 'ab'.repeat(20)
const IFACE = new Interface(['function getPolicyEngine() view returns (address)'])

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(data.slice(0, 10), IFACE.getFunction('getPolicyEngine')!.selector)
        return Promise.resolve(IFACE.encodeFunctionResult('getPolicyEngine', [ENGINE]))
      },
    },
  } as unknown as EVMChain
}

describe('GetPolicyEngine (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it('reads the checksummed policy engine', async () => {
      assert.equal(
        await new GetPolicyEngine().query(stubChain(), { advancedPoolHooks: HOOKS }),
        getAddress(ENGINE),
      )
    })
  })

  describe('validation', () => {
    it('rejects a zero hooks address before RPC', async () => {
      await assert.rejects(
        () => new GetPolicyEngine().query(stubChain(), { advancedPoolHooks: ZeroAddress }),
        CCTParamsInvalidError,
      )
    })
  })
})
