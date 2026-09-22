import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { GetLockbox } from './get-lockbox.ts'

const POOL = '0x' + '11'.repeat(20)
const LOCKBOX = '0x' + '22'.repeat(20)

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `getLockBox()` off the v2.0.0 LockRelease ABI. */
function stubChain({
  type = 'LockReleaseTokenPool',
  version = '2.0.0' as TokenPoolVersion,
  lockBox = LOCKBOX,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  lockBox?: string
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.LockRelease['2.0.0']
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = iface.getFunction(data.slice(0, 10))?.name
        if (fn !== 'getLockBox')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(fn)
        return Promise.resolve(iface.encodeFunctionResult(fn, [lockBox]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetLockbox()

describe('GetLockbox (cct/evm)', () => {
  it('reads the lockbox of a v2.0.0 LockRelease pool', async () => {
    const seen = newSeen()
    assert.equal(await op.query(stubChain({ seen }), { poolAddress: POOL }), LOCKBOX)
    assert.deepEqual(seen.calls, ['typeAndVersion', 'getLockBox'])
  })

  it('checksums the address the pool returns', async () => {
    const chain = stubChain({ lockBox: LOCKBOX.toLowerCase() })
    assert.equal(await op.query(chain, { poolAddress: POOL }), LOCKBOX)
  })

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getLockbox' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  it('rejects a BurnMint pool, which escrows nothing', async () => {
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'BurnMintTokenPool' }), {
          poolAddress: POOL,
        }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.address === POOL &&
        err.context.actual === 'BurnMintTokenPool',
    )
  })

  for (const version of ['1.5.0', '1.5.1', '1.6.1'] as const) {
    it(`rejects a ${version} pool, which holds its liquidity itself`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ version, seen }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'getLockbox' &&
          err.context.version === version,
      )
      // reported from the version alone; no call attempted against a getter that is not there
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  }

  it('rejects a siloed pool, whose lockboxes are per-lane', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'SiloedLockReleaseTokenPool', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.actual === 'SiloedLockReleaseTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

  it('reports an unset lockbox as the zero address rather than throwing', async () => {
    assert.equal(
      await op.query(stubChain({ lockBox: ZeroAddress }), { poolAddress: POOL }),
      ZeroAddress,
    )
  })
})
