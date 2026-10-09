import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { GetChainRebalancer } from './get-chain-rebalancer.ts'

const POOL = '0x' + '11'.repeat(20)
/** Lowercase, so the checksumming is observable. */
const SILO_REBALANCER = '0x' + 'aa'.repeat(20)
const UNSILOED_REBALANCER = '0x' + '44'.repeat(20)
/** A siloed lane. */
const SEL = 16015286601757825753n
/** A lane that shares the unsiloed bucket. */
const UNSILOED_SEL = 3478487238524512106n

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub answering `typeAndVersion` and `getChainRebalancer(selector)` off the siloed 1.6.1
 * ABI: the silo's rebalancer on a siloed lane, the unsiloed one on any other.
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  siloRebalancer = SILO_REBALANCER,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  siloRebalancer?: string
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const tx = iface.parseTransaction({ data })
        if (tx?.name !== 'getChainRebalancer')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(tx.name)
        const rebalancer = tx.args[0] === SEL ? siloRebalancer : UNSILOED_REBALANCER
        return Promise.resolve(iface.encodeFunctionResult(tx.name, [rebalancer]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetChainRebalancer()

describe('GetChainRebalancer (cct/evm)', () => {
  for (const version of ['1.6.0', '1.6.1'] as const)
    it(`reads a silo's rebalancer, checksummed, at ${version}`, async () => {
      const seen = newSeen()
      const chain = stubChain({ version, seen })
      const rebalancer = await op.query(chain, { poolAddress: POOL, remoteChainSelector: SEL })
      assert.equal(rebalancer, getAddress(SILO_REBALANCER))
      assert.notEqual(rebalancer, SILO_REBALANCER)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getChainRebalancer'])
    })

  it('reads the unsiloed rebalancer on an unsiloed lane', async () => {
    assert.equal(
      await op.query(stubChain(), { poolAddress: POOL, remoteChainSelector: UNSILOED_SEL }),
      UNSILOED_REBALANCER,
    )
  })

  it('reports a revoked silo rebalancer as the zero address', async () => {
    assert.equal(
      await op.query(stubChain({ siloRebalancer: ZeroAddress }), {
        poolAddress: POOL,
        remoteChainSelector: SEL,
      }),
      ZeroAddress,
    )
  })

  for (const [param, value] of [
    ['poolAddress', 'not-an-address'],
    ['remoteChainSelector', 2n ** 64n],
  ] as const)
    it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          op.query(stubChain({ seen }), {
            poolAddress: POOL,
            remoteChainSelector: SEL,
            [param]: value,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getChainRebalancer' &&
          err.context.param === param,
      )
      assert.deepEqual(seen.calls, [])
    })

  it('rejects a non-siloed LockRelease pool after typeAndVersion only', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'LockReleaseTokenPool', seen }), {
          poolAddress: POOL,
          remoteChainSelector: SEL,
        }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'LockReleaseTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

  it('rejects a siloed 2.0.0 pool', async () => {
    await assert.rejects(
      () =>
        op.query(stubChain({ version: '2.0.0' }), {
          poolAddress: POOL,
          remoteChainSelector: SEL,
        }),
      (err: unknown) =>
        err instanceof CCTOperationUnsupportedError && err.context.version === '2.0.0',
    )
  })
})
