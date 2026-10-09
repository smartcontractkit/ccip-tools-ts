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
import { GetAvailableTokens } from './get-available-tokens.ts'

const POOL = '0x' + '11'.repeat(20)
/** A siloed lane. */
const SEL = 16015286601757825753n
/** A supported lane that shares the unsiloed bucket. */
const UNSILOED_SEL = 3478487238524512106n
/** A lane the pool does not support. */
const UNSUPPORTED = 5224473277236331295n

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub answering `typeAndVersion` and `getAvailableTokens(selector)` off the siloed 1.6.1
 * ABI: the silo's balance on a siloed lane, the unsiloed bucket on any other supported lane, and
 * `InvalidChainSelector` (or `revert`, when given) otherwise.
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  revert,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  /** Force this error name instead of answering. */
  revert?: 'ChainNotAllowed'
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  const reverting = (data: string, revertData: string) =>
    makeError('execution reverted', 'CALL_EXCEPTION', {
      action: 'call',
      data: revertData,
      reason: null,
      transaction: { to: POOL, data },
      invocation: null,
      revert: null,
    })
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const tx = iface.parseTransaction({ data })
        if (tx?.name !== 'getAvailableTokens') throw reverting(data, '0x')
        seen.calls.push(tx.name)
        const selector = tx.args[0] as bigint
        if (revert) throw reverting(data, iface.encodeErrorResult(revert, [selector]))
        if (selector !== SEL && selector !== UNSILOED_SEL)
          throw reverting(data, iface.encodeErrorResult('InvalidChainSelector', [selector]))
        return Promise.resolve(iface.encodeFunctionResult(tx.name, [selector === SEL ? 7n : 100n]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetAvailableTokens()

describe('GetAvailableTokens (cct/evm)', () => {
  for (const version of ['1.6.0', '1.6.1'] as const)
    it(`reads a siloed lane's own balance at ${version}`, async () => {
      const seen = newSeen()
      const chain = stubChain({ version, seen })
      assert.equal(await op.query(chain, { poolAddress: POOL, remoteChainSelector: SEL }), 7n)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getAvailableTokens'])
    })

  it('reads the shared unsiloed bucket on an unsiloed lane', async () => {
    const chain = stubChain()
    assert.equal(
      await op.query(chain, { poolAddress: POOL, remoteChainSelector: UNSILOED_SEL }),
      100n,
    )
  })

  it('reports an unsupported lane as a param error', async () => {
    await assert.rejects(
      () => op.query(stubChain(), { poolAddress: POOL, remoteChainSelector: UNSUPPORTED }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getAvailableTokens' &&
        err.context.param === 'remoteChainSelector' &&
        /not a supported lane/.test(err.message),
    )
  })

  it('propagates any other revert untouched', async () => {
    await assert.rejects(
      () =>
        op.query(stubChain({ revert: 'ChainNotAllowed' }), {
          poolAddress: POOL,
          remoteChainSelector: SEL,
        }),
      (err: unknown) => !(err instanceof CCTParamsInvalidError),
    )
  })

  for (const [param, value] of [
    ['poolAddress', 'not-an-address'],
    ['remoteChainSelector', -1n],
    ['remoteChainSelector', 1 as never],
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
          err.context.operation === 'getAvailableTokens' &&
          err.context.param === param,
      )
      assert.deepEqual(seen.calls, [])
    })

  for (const [type, version] of [
    ['LockReleaseTokenPool', '1.6.1'],
    ['BurnMintTokenPool', '1.5.1'],
  ] as const)
    it(`rejects a ${type} after typeAndVersion only`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          op.query(stubChain({ type, version, seen }), {
            poolAddress: POOL,
            remoteChainSelector: SEL,
          }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.actual === type &&
          err.context.operation === 'getAvailableTokens',
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })

  it('rejects a siloed 2.0.0 pool, whose silos are lockboxes', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ version: '2.0.0', seen }), {
          poolAddress: POOL,
          remoteChainSelector: SEL,
        }),
      (err: unknown) =>
        err instanceof CCTOperationUnsupportedError &&
        err.context.operation === 'getAvailableTokens' &&
        err.context.version === '2.0.0',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
