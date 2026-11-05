import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { GetRateLimitAdmin } from './get-rate-limit-admin.ts'

const POOL = '0x' + '11'.repeat(20)
const ROUTER = getAddress('0x' + '22'.repeat(20))
// mixed-case once checksummed, so a missing getAddress on the result fails the equality
const RATE_LIMIT_ADMIN = getAddress('0x' + 'c4'.repeat(20))
const FEE_ADMIN = getAddress('0x' + '44'.repeat(20))

/** Independent oracle for both getters, not the SDK's cached ABI. */
const ORACLE = new Interface([
  'function getRateLimitAdmin() view returns (address)',
  'function getDynamicConfig() view returns (address router, address rateLimitAdmin, address feeAdmin)',
])

/**
 * Every (type, version) pair a pool can resolve to, with the one getter it holds the role in:
 * standalone before v2.0.0, folded into `getDynamicConfig()` on v2.0.0.
 */
const POOLS = [
  ['BurnMintTokenPool', '1.5.0', 'getRateLimitAdmin'],
  ['BurnMintTokenPool', '1.5.1', 'getRateLimitAdmin'],
  ['BurnMintTokenPool', '1.6.1', 'getRateLimitAdmin'],
  ['BurnMintTokenPool', '2.0.0', 'getDynamicConfig'],
  ['LockReleaseTokenPool', '1.5.0', 'getRateLimitAdmin'],
  ['LockReleaseTokenPool', '1.5.1', 'getRateLimitAdmin'],
  ['LockReleaseTokenPool', '1.6.1', 'getRateLimitAdmin'],
  ['LockReleaseTokenPool', '2.0.0', 'getDynamicConfig'],
  ['SiloedLockReleaseTokenPool', '1.6.0', 'getRateLimitAdmin'],
  ['SiloedLockReleaseTokenPool', '1.6.1', 'getRateLimitAdmin'],
  ['SiloedLockReleaseTokenPool', '2.0.0', 'getDynamicConfig'],
] as const

/** The reads the op makes, in order, as function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub answering `typeAndVersion` and only the getter `version` declares, so a read
 * through the other version's getter reverts.
 */
function stubChain({
  type = 'BurnMintTokenPool',
  version = '1.5.0',
  admin = RATE_LIMIT_ADMIN.toLowerCase(),
  seen = newSeen(),
}: {
  type?: string
  version?: string
  admin?: string
  seen?: Seen
} = {}): EVMChain {
  const getter = version === '2.0.0' ? 'getDynamicConfig' : 'getRateLimitAdmin'
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = ORACLE.getFunction(data.slice(0, 10))
        if (fn?.name !== getter || getAddress(to) !== getAddress(POOL))
          throw makeError('execution reverted', 'CALL_EXCEPTION')
        seen.calls.push(fn.name)
        return Promise.resolve(
          ORACLE.encodeFunctionResult(
            fn,
            getter === 'getDynamicConfig' ? [ROUTER, admin, FEE_ADMIN] : [admin],
          ),
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

const op = new GetRateLimitAdmin()

describe('GetRateLimitAdmin (cct/evm)', () => {
  for (const [type, version, getter] of POOLS) {
    it(`reads the rate-limit admin of a ${type} ${version} through ${getter}()`, async () => {
      const seen = newSeen()
      assert.equal(
        await op.query(stubChain({ type, version, seen }), { poolAddress: POOL }),
        RATE_LIMIT_ADMIN,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion', getter])
    })
  }

  for (const version of ['1.5.1', '2.0.0'] as const) {
    it(`reports an unset ${version} admin as the zero address rather than throwing`, async () => {
      const chain = stubChain({ version, admin: ZeroAddress })
      assert.equal(await op.query(chain, { poolAddress: POOL }), ZeroAddress)
    })
  }

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getRateLimitAdmin' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  it('rejects an unsupported pool type before any getter', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ type: 'USDCTokenPool', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'USDCTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

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
