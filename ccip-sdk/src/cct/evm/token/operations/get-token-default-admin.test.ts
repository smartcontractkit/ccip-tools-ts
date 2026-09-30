import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetTokenDefaultAdmin } from './get-token-default-admin.ts'

const TOKEN = '0x' + '11'.repeat(20)
// mixed-case, so `getAddress()` re-cases them: proves the op checksums rather than echoes raw bytes
const DEFAULT_ADMIN = '0xabcdef1234567890abcdef1234567890abcdef12'
const PENDING_ADMIN = '0x1234567890abcdef1234567890abcdef12345678'
const SCHEDULE = 1_700_000_000n

/** Read results from a fresh Interface, never the SDK's cached one. */
const FRESH = new Interface([
  'function defaultAdmin() view returns (address)',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `defaultAdmin()` and `pendingDefaultAdmin()`. */
function stubChain({
  defaultAdmin = DEFAULT_ADMIN,
  pendingAdmin = PENDING_ADMIN,
  schedule = SCHEDULE,
  seen = newSeen(),
}: {
  defaultAdmin?: string
  pendingAdmin?: string
  schedule?: bigint
  seen?: Seen
} = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        seen.calls.push(fn)
        const result =
          fn === 'defaultAdmin'
            ? FRESH.encodeFunctionResult(fn, [defaultAdmin])
            : FRESH.encodeFunctionResult(fn, [pendingAdmin, schedule])
        return Promise.resolve(result)
      },
    },
  } as unknown as EVMChain
}

const op = new GetTokenDefaultAdmin()

describe('GetTokenDefaultAdmin (cct/evm)', () => {
  it('reports current defaultAdmin and a pending transfer together, checksummed', async () => {
    const seen = newSeen()
    const result = await op.query(stubChain({ seen }), { tokenAddress: TOKEN })

    assert.deepEqual(result, {
      defaultAdmin: getAddress(DEFAULT_ADMIN),
      pendingDefaultAdmin: { newAdmin: getAddress(PENDING_ADMIN), schedule: SCHEDULE },
    })
    assert.deepEqual(seen.calls.sort(), ['defaultAdmin', 'pendingDefaultAdmin'])
  })

  it('omits pendingDefaultAdmin when no transfer is scheduled (zero newAdmin)', async () => {
    const result = await op.query(stubChain({ pendingAdmin: ZeroAddress, schedule: 0n }), {
      tokenAddress: TOKEN,
    })

    assert.deepEqual(result, { defaultAdmin: getAddress(DEFAULT_ADMIN) })
    assert.ok(!('pendingDefaultAdmin' in result))
  })

  it('reports a renounced (zero) defaultAdmin without throwing', async () => {
    const result = await op.query(
      stubChain({ defaultAdmin: ZeroAddress, pendingAdmin: ZeroAddress, schedule: 0n }),
      { tokenAddress: TOKEN },
    )

    assert.equal(result.defaultAdmin, ZeroAddress)
  })

  for (const value of ['not-an-address', ZeroAddress]) {
    it(`rejects tokenAddress = ${value} before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ seen }), { tokenAddress: value }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenDefaultAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.deepEqual(seen.calls, [])
    })
  }
})
