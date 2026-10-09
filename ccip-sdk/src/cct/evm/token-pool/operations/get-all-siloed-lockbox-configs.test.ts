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
import { type LockboxConfig, type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { GetAllSiloedLockboxConfigs } from './get-all-siloed-lockbox-configs.ts'

const POOL = '0x' + '11'.repeat(20)
/** Lowercase, so the checksumming is observable. */
const LOCKBOX_A = '0x' + 'a1'.repeat(20)
const LOCKBOX_B = '0x' + 'b2'.repeat(20)
const SEL_A = 16015286601757825753n
const SEL_B = 3478487238524512106n
const SEL_C = 10344971235874465080n

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `getAllLockBoxConfigs()` off the siloed v2 ABI. */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '2.0.0' as TokenPoolVersion,
  configured = [] as LockboxConfig[],
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  configured?: LockboxConfig[]
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['2.0.0']
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = iface.getFunction(data.slice(0, 10))?.name
        if (fn !== 'getAllLockBoxConfigs')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(fn)
        return Promise.resolve(
          iface.encodeFunctionResult(fn, [
            configured.map((c) => [c.remoteChainSelector, c.lockbox]),
          ]),
        )
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetAllSiloedLockboxConfigs()

describe('GetAllSiloedLockboxConfigs (cct/evm)', () => {
  it('reads every lane binding in enumeration order, checksummed', async () => {
    const seen = newSeen()
    const configured = [
      { remoteChainSelector: SEL_B, lockbox: LOCKBOX_B },
      { remoteChainSelector: SEL_A, lockbox: LOCKBOX_A },
      // lanes may share a lockbox
      { remoteChainSelector: SEL_C, lockbox: LOCKBOX_A },
    ]
    assert.deepEqual(await op.query(stubChain({ configured, seen }), { poolAddress: POOL }), [
      { remoteChainSelector: SEL_B, lockbox: getAddress(LOCKBOX_B) },
      { remoteChainSelector: SEL_A, lockbox: getAddress(LOCKBOX_A) },
      { remoteChainSelector: SEL_C, lockbox: getAddress(LOCKBOX_A) },
    ])
    assert.deepEqual(seen.calls, ['typeAndVersion', 'getAllLockBoxConfigs'])
  })

  it('reads an empty array when no lane is bound', async () => {
    assert.deepEqual(await op.query(stubChain(), { poolAddress: POOL }), [])
  })

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getAllSiloedLockboxConfigs' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  for (const version of ['1.6.0', '1.6.1'] as const)
    it(`rejects a siloed ${version} pool, which holds silos itself`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ version, seen }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'getAllSiloedLockboxConfigs' &&
          err.context.version === version,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })

  it('rejects a non-siloed LockRelease pool, pointing at getLockbox', async () => {
    await assert.rejects(
      () => op.query(stubChain({ type: 'LockReleaseTokenPool' }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.actual === 'LockReleaseTokenPool' &&
        /getLockbox/.test(err.message),
    )
  })
})
