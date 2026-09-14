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
import { GetRebalancer } from './get-rebalancer.ts'

const POOL = '0x' + '11'.repeat(20)
const REBALANCER = '0x' + '22'.repeat(20)

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `getRebalancer()` off the LockRelease interface. */
function stubChain({
  type = 'LockReleaseTokenPool',
  version = '1.5.0' as TokenPoolVersion,
  rebalancer = REBALANCER,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  rebalancer?: string
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.LockRelease['1.5.1']
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = iface.getFunction(data.slice(0, 10))?.name
        if (fn !== 'getRebalancer')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(fn)
        return Promise.resolve(iface.encodeFunctionResult(fn, [rebalancer]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetRebalancer()

describe('GetRebalancer (cct/evm)', () => {
  for (const version of ['1.5.0', '1.5.1', '1.6.1'] as const) {
    it(`reads the rebalancer of a LockRelease ${version} pool`, async () => {
      const seen = newSeen()
      assert.equal(await op.query(stubChain({ version, seen }), { poolAddress: POOL }), REBALANCER)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getRebalancer'])
    })
  }

  it('reads the unsiloed rebalancer of a siloed pool', async () => {
    const chain = stubChain({ type: 'SiloedLockReleaseTokenPool', version: '1.6.1' })
    assert.equal(await op.query(chain, { poolAddress: POOL }), REBALANCER)
  })

  it('checksums the address the pool returns', async () => {
    const chain = stubChain({ rebalancer: REBALANCER.toLowerCase() })
    assert.equal(await op.query(chain, { poolAddress: POOL }), REBALANCER)
  })

  it('reports an unset rebalancer as the zero address rather than throwing', async () => {
    assert.equal(
      await op.query(stubChain({ rebalancer: ZeroAddress }), { poolAddress: POOL }),
      ZeroAddress,
    )
  })

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getRebalancer' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  it('rejects a BurnMint pool, which has no rebalancer', async () => {
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'BurnMintTokenPool', version: '1.5.1' }), {
          poolAddress: POOL,
        }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.address === POOL &&
        err.context.actual === 'BurnMintTokenPool',
    )
  })

  it('rejects a 2.0.0 pool, which escrows through a lockbox instead', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ version: '2.0.0', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTOperationUnsupportedError &&
        err.context.operation === 'getRebalancer' &&
        err.context.version === '2.0.0',
    )
    // reported from the version alone; no call attempted against a selector that is not there
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
