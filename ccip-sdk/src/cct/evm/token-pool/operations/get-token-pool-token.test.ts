import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { GetTokenPoolToken } from './get-token-pool-token.ts'

const POOL = '0x' + '11'.repeat(20)
// mixed-case once checksummed, so a missing getAddress on the result fails the equality
const TOKEN = getAddress('0x' + 'b3'.repeat(20))

/** Independent oracle for the selector and return encoding, not the SDK's cached ABI. */
const ORACLE = new Interface(['function getToken() view returns (address)'])

/** Every (type, version) pair a pool can resolve to; `getToken()` is on all of them. */
const POOLS = [
  ['BurnMintTokenPool', '1.5.0'],
  ['BurnMintTokenPool', '1.5.1'],
  ['BurnMintTokenPool', '1.6.1'],
  ['BurnMintTokenPool', '2.0.0'],
  ['LockReleaseTokenPool', '1.5.0'],
  ['LockReleaseTokenPool', '1.5.1'],
  ['LockReleaseTokenPool', '1.6.1'],
  ['LockReleaseTokenPool', '2.0.0'],
  ['SiloedLockReleaseTokenPool', '1.6.0'],
  ['SiloedLockReleaseTokenPool', '1.6.1'],
  ['SiloedLockReleaseTokenPool', '2.0.0'],
] as const

/** The reads the op makes, in order, as function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `getToken()`; any other call reverts. */
function stubChain({
  type = 'BurnMintTokenPool',
  version = '1.5.0',
  seen = newSeen(),
}: {
  type?: string
  version?: string
  seen?: Seen
} = {}): EVMChain {
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = ORACLE.getFunction(data.slice(0, 10))
        if (!fn || getAddress(to) !== getAddress(POOL))
          throw makeError('execution reverted', 'CALL_EXCEPTION')
        seen.calls.push(fn.name)
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, [TOKEN.toLowerCase()]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetTokenPoolToken()

describe('GetTokenPoolToken (cct/evm)', () => {
  for (const [type, version] of POOLS) {
    it(`reads the checksummed token address of a ${type} ${version}`, async () => {
      const seen = newSeen()
      // strictly the address: no contract handle rides along on the result
      assert.equal(await op.query(stubChain({ type, version, seen }), { poolAddress: POOL }), TOKEN)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getToken'])
    })
  }

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getTokenPoolToken' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  it('rejects an unsupported pool type before calling getToken()', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ type: 'USDCTokenPool', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'USDCTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

  // 1.4.0 was never a CCT pool; a siloed pool never shipped at 1.5.1
  for (const [type, version] of [
    ['BurnMintTokenPool', '1.4.0'],
    ['SiloedLockReleaseTokenPool', '1.5.1'],
  ] as const) {
    it(`rejects an unknown ${type} ${version} before calling getToken()`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ type, version, seen }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTContractVersionUnsupportedError && err.context.version === version,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  }
})
