import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import { IsMinter } from './is-minter.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ACCOUNT = '0x' + '22'.repeat(20)

/** Read results from a fresh Interface, never the SDK's cached one. */
const FRESH = new Interface(['function isMinter(address) view returns (bool)'])

/** The `eth_call`s the op makes, in order, as decoded function names. */
type Seen = { calls: string[]; args: string[] }
const newSeen = (): Seen => ({ calls: [], args: [] })

/** EVMChain stub answering `isMinter(address)` with `holds`. */
function stubChain({
  holds = true,
  callError,
  seen = newSeen(),
}: {
  holds?: boolean
  /** Fails every `eth_call`, standing in for a contract that is not a BurnMintERC677 token. */
  callError?: Error
  seen?: Seen
} = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        if (callError) return Promise.reject(callError)
        const fn = FRESH.getFunction(data.slice(0, 10))!
        seen.calls.push(fn.name)
        seen.args.push(FRESH.decodeFunctionData(fn, data)[0] as string)
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [holds]))
      },
    },
  } as unknown as EVMChain
}

const op = new IsMinter()

describe('IsMinter (cct/evm)', () => {
  it('answers true for a role holder in one call', async () => {
    const seen = newSeen()
    const holds = await op.query(stubChain({ seen }), { tokenAddress: TOKEN, account: ACCOUNT })

    assert.equal(holds, true)
    assert.deepEqual(seen.calls, ['isMinter'])
    assert.deepEqual(seen.args, [ACCOUNT])
  })

  it('answers false for an account without the role', async () => {
    const chain = stubChain({ holds: false })
    assert.equal(await op.query(chain, { tokenAddress: TOKEN, account: ACCOUNT }), false)
  })

  for (const param of ['tokenAddress', 'account'] as const) {
    for (const value of ['not-an-address', ZeroAddress]) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        const seen = newSeen()
        const params = { tokenAddress: TOKEN, account: ACCOUNT, [param]: value }
        await assert.rejects(
          () => op.query(stubChain({ seen }), params),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'isMinter' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  }

  it('rejects a contract that does not declare isMinter(address)', async () => {
    // a v2.0.0 CrossChainToken gates minting through AccessControl instead
    const revert = makeError('execution reverted', 'CALL_EXCEPTION', {
      action: 'call',
      data: '0x',
      reason: null,
      transaction: { to: TOKEN, data: '0x' },
      invocation: null,
      revert: null,
    })
    await assert.rejects(
      () => op.query(stubChain({ callError: revert }), { tokenAddress: TOKEN, account: ACCOUNT }),
      (err: unknown) => err instanceof CCTContractTypeInvalidError && err.context.address === TOKEN,
    )
  })
})
