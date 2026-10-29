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
import { IsSupportedToken } from './is-supported-token.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = getAddress('0x' + 'b3'.repeat(20))
const OTHER_TOKEN = getAddress('0x' + 'd5'.repeat(20))

/** Independent oracle for the selector and argument encoding, not the SDK's cached ABI. */
const ORACLE = new Interface(['function isSupportedToken(address token) view returns (bool)'])

/** Every (type, version) pair a pool can resolve to; `isSupportedToken` is on all of them. */
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

/**
 * EVMChain stub answering `typeAndVersion` and `isSupportedToken`, `true` only for {@link TOKEN}
 * as decoded from the calldata, so a dropped or swapped argument changes the answer.
 */
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
        const [token] = ORACLE.decodeFunctionData(fn, data)
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, [token === TOKEN]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new IsSupportedToken()

describe('IsSupportedToken (cct/evm)', () => {
  for (const [type, version] of POOLS) {
    it(`reads true for the token of a ${type} ${version}`, async () => {
      const seen = newSeen()
      const chain = stubChain({ type, version, seen })
      assert.equal(await op.query(chain, { poolAddress: POOL, tokenAddress: TOKEN }), true)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'isSupportedToken'])
    })
  }

  it('reads false for any other token', async () => {
    assert.equal(
      await op.query(stubChain(), { poolAddress: POOL, tokenAddress: OTHER_TOKEN }),
      false,
    )
  })

  for (const param of ['poolAddress', 'tokenAddress'] as const) {
    it(`rejects a malformed ${param} before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          op.query(stubChain({ seen }), {
            poolAddress: POOL,
            tokenAddress: TOKEN,
            [param]: 'not-an-address',
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'isSupportedToken' &&
          err.context.param === param,
      )
      assert.deepEqual(seen.calls, [])
    })
  }

  it('rejects an unsupported pool type before calling isSupportedToken', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ type: 'USDCTokenPool', seen }), {
          poolAddress: POOL,
          tokenAddress: TOKEN,
        }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'USDCTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

  it('rejects an unknown version before calling isSupportedToken', async () => {
    const seen = newSeen()
    await assert.rejects(
      () =>
        op.query(stubChain({ version: '1.4.0', seen }), {
          poolAddress: POOL,
          tokenAddress: TOKEN,
        }),
      (err: unknown) =>
        err instanceof CCTContractVersionUnsupportedError && err.context.version === '1.4.0',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
