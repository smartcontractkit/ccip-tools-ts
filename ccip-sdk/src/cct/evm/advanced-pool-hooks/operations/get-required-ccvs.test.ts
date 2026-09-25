import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetRequiredCCVs } from './get-required-ccvs.ts'

const HOOKS = '0x' + '11'.repeat(20)
const CCV = '0x' + '33'.repeat(20)
const IFACE = new Interface([
  'function getRequiredCCVs(address,uint64,uint256,bytes4,bytes,uint8) view returns (address[])',
])

function stubChain(): EVMChain {
  return {
    typeAndVersion: () => Promise.resolve(['AdvancedPoolHooks', '2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        const decoded = IFACE.decodeFunctionData('getRequiredCCVs', data)
        assert.equal(decoded[0], ZeroAddress)
        assert.equal(decoded[3], '0x00000000')
        assert.equal(decoded[4], '0x')
        assert.equal(decoded[5], 1n)
        return Promise.resolve(IFACE.encodeFunctionResult('getRequiredCCVs', [[CCV]]))
      },
    },
  } as unknown as EVMChain
}

const op = new GetRequiredCCVs()
const params = {
  advancedPoolHooks: HOOKS,
  remoteChainSelector: 1n,
  amount: 1n,
  direction: 'inbound' as const,
}

describe('GetRequiredCCVs (cct/evm advanced-pool-hooks)', () => {
  describe('query', () => {
    it('resolves the configured CCVs for a direction', async () => {
      assert.deepEqual(await op.query(stubChain(), params), [CCV])
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
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
