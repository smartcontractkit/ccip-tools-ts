import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetCCIPAdmin } from './get-ccip-admin.ts'

const TOKEN = '0x' + '11'.repeat(20)
// mixed-case, so `getAddress()` re-cases it: proves the op checksums rather than echoes raw bytes
const ADMIN = '0xabcdef1234567890abcdef1234567890abcdef12'

/** Read results from a fresh Interface, never the SDK's cached one. */
const FRESH = new Interface(['function getCCIPAdmin() view returns (address ccipAdmin)'])

type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `getCCIPAdmin()` with `admin`. */
function stubChain({
  admin = ADMIN,
  seen = newSeen(),
}: {
  admin?: string
  seen?: Seen
} = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        seen.calls.push(fn)
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [admin]))
      },
    },
  } as unknown as EVMChain
}

const op = new GetCCIPAdmin()

describe('GetCCIPAdmin (cct/evm)', () => {
  it('reads and checksums the CCIP admin in one call', async () => {
    const seen = newSeen()
    const admin = await op.query(stubChain({ seen }), { tokenAddress: TOKEN })

    assert.equal(admin, getAddress(ADMIN))
    assert.deepEqual(seen.calls, ['getCCIPAdmin'])
  })

  it('reports a zero CCIP admin rather than throwing', async () => {
    const admin = await op.query(stubChain({ admin: ZeroAddress }), { tokenAddress: TOKEN })
    assert.equal(admin, ZeroAddress)
  })

  for (const value of ['not-an-address', ZeroAddress]) {
    it(`rejects tokenAddress = ${value} before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ seen }), { tokenAddress: value }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getCCIPAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.deepEqual(seen.calls, [])
    })
  }
})
