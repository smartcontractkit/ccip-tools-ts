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
import { CanAcceptLiquidity } from './can-accept-liquidity.ts'

const POOL = '0x' + '11'.repeat(20)

/** Independent oracle for the selector and return encoding, not the SDK's cached ABI. */
const ORACLE = new Interface(['function canAcceptLiquidity() view returns (bool)'])

/** The reads the op makes, in order, as function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `canAcceptLiquidity()`; any other call reverts. */
function stubChain({
  type = 'LockReleaseTokenPool',
  version = '1.5.1',
  accepts = true,
  seen = newSeen(),
}: {
  type?: string
  version?: string
  accepts?: boolean
  seen?: Seen
} = {}): EVMChain {
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = ORACLE.getFunction(data.slice(0, 10))
        if (!fn || getAddress(to) !== getAddress(POOL))
          throw makeError('execution reverted', 'CALL_EXCEPTION')
        seen.calls.push(fn.name)
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, [accepts]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new CanAcceptLiquidity()

describe('CanAcceptLiquidity (cct/evm)', () => {
  // the only pools that declare it: the flag was dropped at v1.6.x, and siloed pools start there
  for (const version of ['1.5.0', '1.5.1'] as const) {
    for (const accepts of [true, false]) {
      it(`reads ${accepts} from a LockReleaseTokenPool ${version}`, async () => {
        const seen = newSeen()
        assert.equal(
          await op.query(stubChain({ version, accepts, seen }), { poolAddress: POOL }),
          accepts,
        )
        assert.deepEqual(seen.calls, ['typeAndVersion', 'canAcceptLiquidity'])
      })
    }
  }

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'canAcceptLiquidity' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  for (const [type, version] of [
    ['BurnMintTokenPool', '1.5.0'],
    ['BurnMintTokenPool', '1.5.1'],
    ['BurnFromMintTokenPool', '1.6.1'],
    ['BurnMintTokenPool', '2.0.0'],
  ] as const) {
    it(`rejects a ${type} ${version}, which has no liquidity, before any getter`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ type, version, seen }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === POOL &&
          err.context.actual === type,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  }

  for (const [type, version] of [
    ['LockReleaseTokenPool', '1.6.1'],
    ['LockReleaseTokenPool', '2.0.0'],
    ['SiloedLockReleaseTokenPool', '1.6.0'],
    ['SiloedLockReleaseTokenPool', '1.6.1'],
    ['SiloedLockReleaseTokenPool', '2.0.0'],
  ] as const) {
    it(`rejects a ${type} ${version}, which declares no flag, before any getter`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => op.query(stubChain({ type, version, seen }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'canAcceptLiquidity' &&
          err.context.version === version,
      )
      // reported from the version alone; no call against a selector that is not there
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  }

  it('rejects an unknown version before any getter', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ version: '1.4.0', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractVersionUnsupportedError && err.context.version === '1.4.0',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
