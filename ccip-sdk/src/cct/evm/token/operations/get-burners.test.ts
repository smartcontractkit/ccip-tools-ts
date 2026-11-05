import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import { GetBurners } from './get-burners.ts'

const TOKEN = '0x' + '11'.repeat(20)
const HOLDER_A = '0x' + '22'.repeat(20)
const HOLDER_B = '0x' + '33'.repeat(20)

/** Read results from a fresh Interface, never the SDK's cached one. */
const FRESH = new Interface(['function getBurners() view returns (address[])'])

/** The `eth_call`s the op makes, in order, as decoded function names. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `getBurners()` with `holders`. */
function stubChain({
  holders = [HOLDER_A, HOLDER_B] as string[],
  callError,
  seen = newSeen(),
}: {
  holders?: string[]
  /** Fails every `eth_call`, standing in for a contract that is not a BurnMintERC677 token. */
  callError?: Error
  seen?: Seen
} = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        if (callError) return Promise.reject(callError)
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        seen.calls.push(fn)
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [holders]))
      },
    },
  } as unknown as EVMChain
}

const op = new GetBurners()

describe('GetBurners (cct/evm)', () => {
  it('lists the holders in one call', async () => {
    const seen = newSeen()
    const holders = await op.query(stubChain({ seen }), { tokenAddress: TOKEN })

    assert.deepEqual(holders, [HOLDER_A, HOLDER_B])
    assert.deepEqual(seen.calls, ['getBurners'])
  })

  it('returns an empty list when no account holds the role', async () => {
    assert.deepEqual(await op.query(stubChain({ holders: [] }), { tokenAddress: TOKEN }), [])
  })

  it('checksums the addresses the token returns', async () => {
    const chain = stubChain({ holders: [HOLDER_A.toLowerCase()] })
    assert.deepEqual(await op.query(chain, { tokenAddress: TOKEN }), [HOLDER_A])
  })

  for (const value of ['not-an-address', ZeroAddress]) {
    it(`rejects tokenAddress = ${value} before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ seen }), { tokenAddress: value }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getBurners' &&
          err.context.param === 'tokenAddress',
      )
      assert.deepEqual(seen.calls, [])
    })
  }

  it('rejects a contract that does not declare getBurners()', async () => {
    // a v2.0.0 CrossChainToken does not enumerate its AccessControl role members
    const revert = makeError('execution reverted', 'CALL_EXCEPTION', {
      action: 'call',
      data: '0x',
      reason: null,
      transaction: { to: TOKEN, data: '0x' },
      invocation: null,
      revert: null,
    })
    await assert.rejects(
      () => op.query(stubChain({ callError: revert }), { tokenAddress: TOKEN }),
      (err: unknown) => err instanceof CCTContractTypeInvalidError && err.context.address === TOKEN,
    )
  })
})
