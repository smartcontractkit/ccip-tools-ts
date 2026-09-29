import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetAllLockboxAuthorizedCallers } from './get-all-lockbox-authorized-callers.ts'

const LOCKBOX = '0x' + '11'.repeat(20)
const CALLER = '0x' + 'ab'.repeat(20)
const IFACE = new Interface(['function getAllAuthorizedCallers() view returns (address[])'])

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['ERC20LockBox', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(data.slice(0, 10), IFACE.getFunction('getAllAuthorizedCallers')!.selector)
        return Promise.resolve(IFACE.encodeFunctionResult('getAllAuthorizedCallers', [[CALLER]]))
      },
    },
  } as unknown as EVMChain
}

describe('GetAllLockboxAuthorizedCallers (cct/evm lockbox)', () => {
  describe('query', () => {
    it('reads checksummed authorized callers', async () => {
      assert.deepEqual(
        await new GetAllLockboxAuthorizedCallers().query(stubChain(), { lockbox: LOCKBOX }),
        [getAddress(CALLER)],
      )
    })
  })

  describe('validation', () => {
    it('rejects a zero lockbox address before RPC', async () => {
      await assert.rejects(
        () => new GetAllLockboxAuthorizedCallers().query(stubChain(), { lockbox: ZeroAddress }),
        CCTParamsInvalidError,
      )
    })
  })
})
