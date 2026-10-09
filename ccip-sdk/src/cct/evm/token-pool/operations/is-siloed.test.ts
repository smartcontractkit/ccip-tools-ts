import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { IsSiloed } from './is-siloed.ts'

const POOL = '0x' + '11'.repeat(20)
/** A siloed lane. */
const SEL = 16015286601757825753n
/** A lane that shares the unsiloed bucket. */
const UNSILOED_SEL = 3478487238524512106n

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `isSiloed(selector)` off the siloed 1.6.1 ABI. */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const tx = iface.parseTransaction({ data })
        if (tx?.name !== 'isSiloed')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(tx.name)
        return Promise.resolve(iface.encodeFunctionResult(tx.name, [tx.args[0] === SEL]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new IsSiloed()

describe('IsSiloed (cct/evm)', () => {
  for (const version of ['1.6.0', '1.6.1'] as const)
    it(`reports a siloed lane at ${version}`, async () => {
      const seen = newSeen()
      const chain = stubChain({ version, seen })
      assert.equal(await op.query(chain, { poolAddress: POOL, remoteChainSelector: SEL }), true)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'isSiloed'])
    })

  it('reports an unsiloed lane, and selector 0, as not siloed', async () => {
    for (const remoteChainSelector of [UNSILOED_SEL, 0n])
      assert.equal(await op.query(stubChain(), { poolAddress: POOL, remoteChainSelector }), false)
  })

  for (const [param, value] of [
    ['poolAddress', 'not-an-address'],
    ['remoteChainSelector', -1n],
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
          err.context.operation === 'isSiloed' &&
          err.context.param === param,
      )
      assert.deepEqual(seen.calls, [])
    })

  it('rejects a BurnMint pool after typeAndVersion only', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'BurnMintTokenPool', version: '1.5.1', seen }), {
          poolAddress: POOL,
          remoteChainSelector: SEL,
        }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'BurnMintTokenPool',
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
        err instanceof CCTOperationUnsupportedError &&
        err.context.operation === 'isSiloed' &&
        err.context.version === '2.0.0',
    )
  })
})
