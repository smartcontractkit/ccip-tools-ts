import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { GetSiloedLockbox } from './get-siloed-lockbox.ts'

const POOL = '0x' + '11'.repeat(20)
/** Lowercase, so the checksumming is observable. */
const LOCKBOX = '0x' + 'a1'.repeat(20)
/** A lane bound to {@link LOCKBOX}. */
const SEL = 16015286601757825753n
/** A lane with no lockbox. */
const UNBOUND = 3478487238524512106n

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub answering `typeAndVersion` and `getLockBox(selector)` off the siloed 2.0.0 ABI:
 * the lockbox for {@link SEL}, `LockBoxNotConfigured` (or `revert`, when given) otherwise.
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '2.0.0' as TokenPoolVersion,
  revert,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  /** Force this error name instead of answering. */
  revert?: 'ChainNotAllowed'
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['2.0.0']
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
        if (tx?.name !== 'getLockBox') throw reverting(data, '0x')
        seen.calls.push(tx.name)
        const selector = tx.args[0] as bigint
        if (revert) throw reverting(data, iface.encodeErrorResult(revert, [selector]))
        if (selector !== SEL)
          throw reverting(data, iface.encodeErrorResult('LockBoxNotConfigured', [selector]))
        return Promise.resolve(iface.encodeFunctionResult(tx.name, [LOCKBOX]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetSiloedLockbox()

describe('GetSiloedLockbox (cct/evm)', () => {
  it("reads a lane's lockbox, checksummed", async () => {
    const seen = newSeen()
    assert.equal(
      await op.query(stubChain({ seen }), { poolAddress: POOL, remoteChainSelector: SEL }),
      getAddress(LOCKBOX),
    )
    assert.deepEqual(seen.calls, ['typeAndVersion', 'getLockBox'])
  })

  it('reports an unbound lane as a param error naming configureSiloedLockboxes', async () => {
    await assert.rejects(
      () => op.query(stubChain(), { poolAddress: POOL, remoteChainSelector: UNBOUND }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getSiloedLockbox' &&
        err.context.param === 'remoteChainSelector' &&
        /LockBoxNotConfigured/.test(err.message) &&
        /configureSiloedLockboxes/.test(err.message),
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
          err.context.operation === 'getSiloedLockbox' &&
          err.context.param === param,
      )
      assert.deepEqual(seen.calls, [])
    })

  for (const version of ['1.6.0', '1.6.1'] as const)
    it(`rejects a siloed ${version} pool`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          op.query(stubChain({ version, seen }), {
            poolAddress: POOL,
            remoteChainSelector: SEL,
          }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'getSiloedLockbox' &&
          err.context.version === version,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })

  it('rejects a non-siloed LockRelease pool, pointing at getLockbox', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'LockReleaseTokenPool', seen }), {
          poolAddress: POOL,
          remoteChainSelector: SEL,
        }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.actual === 'LockReleaseTokenPool' &&
        /getLockbox/.test(err.message),
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
