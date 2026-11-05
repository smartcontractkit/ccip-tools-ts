import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { GetTokenPoolTokenDecimals } from './get-token-pool-token-decimals.ts'

const POOL = '0x' + '11'.repeat(20)
// not 18, so a result taken from a default rather than the call fails
const DECIMALS = 6

/** Independent oracle for the selector and return encoding, not the SDK's cached ABI. */
const ORACLE = new Interface(['function getTokenDecimals() view returns (uint8)'])

/** Every (type, version) pair that declares `getTokenDecimals()`: all of them from v1.5.1. */
const POOLS = [
  ['BurnMintTokenPool', '1.5.1'],
  ['BurnMintTokenPool', '1.6.1'],
  ['BurnMintTokenPool', '2.0.0'],
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

/** EVMChain stub answering `typeAndVersion` and `getTokenDecimals()`; any other call reverts. */
function stubChain({
  type = 'BurnMintTokenPool',
  version = '1.5.1',
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
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, [DECIMALS]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetTokenPoolTokenDecimals()

describe('GetTokenPoolTokenDecimals (cct/evm)', () => {
  for (const [type, version] of POOLS) {
    it(`reads the decimals of a ${type} ${version} as a number`, async () => {
      const seen = newSeen()
      assert.equal(
        await op.query(stubChain({ type, version, seen }), { poolAddress: POOL }),
        DECIMALS,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getTokenDecimals'])
    })
  }

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getTokenPoolTokenDecimals' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  for (const type of ['BurnMintTokenPool', 'LockReleaseTokenPool'] as const) {
    it(`rejects a ${type} 1.5.0, which does not declare getTokenDecimals()`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ type, version: '1.5.0', seen }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'getTokenPoolTokenDecimals' &&
          err.context.version === '1.5.0',
      )
      // reported from the version alone; no call against a selector that is not there
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  }

  it('rejects an unsupported pool type before calling getTokenDecimals()', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ type: 'USDCTokenPool', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'USDCTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

  it('rejects an unknown version before calling getTokenDecimals()', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ version: '1.4.0', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractVersionUnsupportedError && err.context.version === '1.4.0',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
