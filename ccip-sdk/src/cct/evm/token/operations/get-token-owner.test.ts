import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetTokenOwner } from './get-token-owner.ts'

const TOKEN = '0x' + '11'.repeat(20)
// mixed-case, so `getAddress()` re-cases it: proves the op checksums rather than echoes raw bytes
const OWNER = '0xabcdef1234567890abcdef1234567890abcdef12'

/** Read results from a fresh Interface, never the SDK's cached one. */
const FRESH = new Interface(['function owner() view returns (address)'])

type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `owner()` with `owner`. */
function stubChain({
  owner = OWNER,
  seen = newSeen(),
}: {
  owner?: string
  seen?: Seen
} = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        seen.calls.push(fn)
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [owner]))
      },
    },
  } as unknown as EVMChain
}

const op = new GetTokenOwner()

describe('GetTokenOwner (cct/evm)', () => {
  it('reads and checksums the owner in one call', async () => {
    const seen = newSeen()
    const owner = await op.query(stubChain({ seen }), { tokenAddress: TOKEN })

    assert.equal(owner, getAddress(OWNER))
    assert.deepEqual(seen.calls, ['owner'])
  })

  it('checksums a lowercase owner', async () => {
    const owner = await op.query(stubChain({ owner: OWNER.toLowerCase() }), { tokenAddress: TOKEN })
    assert.equal(owner, getAddress(OWNER))
  })

  for (const value of ['not-an-address', ZeroAddress]) {
    it(`rejects tokenAddress = ${value} before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ seen }), { tokenAddress: value }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenOwner' &&
          err.context.param === 'tokenAddress',
      )
      assert.deepEqual(seen.calls, [])
    })
  }
})
