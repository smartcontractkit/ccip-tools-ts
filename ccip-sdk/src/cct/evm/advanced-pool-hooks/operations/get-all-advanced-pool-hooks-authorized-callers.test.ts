import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetAllAdvancedPoolHooksAuthorizedCallers } from './get-all-advanced-pool-hooks-authorized-callers.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CALLER = '0x' + 'ab'.repeat(20)
const IFACE = new Interface(['function getAllAuthorizedCallers() view returns (address[])'])

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(data.slice(0, 10), IFACE.getFunction('getAllAuthorizedCallers')!.selector)
        return Promise.resolve(IFACE.encodeFunctionResult('getAllAuthorizedCallers', [[CALLER]]))
      },
    },
  } as unknown as EVMChain
}

describe('GetAllAdvancedPoolHooksAuthorizedCallers (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it('reads checksummed authorized callers', async () => {
      assert.deepEqual(
        await new GetAllAdvancedPoolHooksAuthorizedCallers().query(stubChain(), {
          advancedPoolHooks: HOOKS,
        }),
        [getAddress(CALLER)],
      )
    })
  })

  describe('validation', () => {
    it('rejects a zero hooks address before RPC', async () => {
      await assert.rejects(
        () =>
          new GetAllAdvancedPoolHooksAuthorizedCallers().query(stubChain(), {
            advancedPoolHooks: ZeroAddress,
          }),
        CCTParamsInvalidError,
      )
    })
  })
})
