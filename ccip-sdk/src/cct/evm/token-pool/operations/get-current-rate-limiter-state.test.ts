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
import type { TokenBucket } from '../contracts.ts'
import {
  type GetCurrentRateLimiterStateParams,
  GetCurrentRateLimiterState,
} from './get-current-rate-limiter-state.ts'

const POOL = '0x' + '11'.repeat(20)
const SELECTOR = 16015286601757825753n

const BUCKET =
  '(uint128 tokens, uint32 lastUpdated, bool isEnabled, uint128 capacity, uint128 rate)'

/** Independent oracle for every getter the op may call, not the SDK's cached ABI. */
const ORACLE = new Interface([
  `function getCurrentInboundRateLimiterState(uint64 remoteChainSelector) view returns (${BUCKET})`,
  `function getCurrentOutboundRateLimiterState(uint64 remoteChainSelector) view returns (${BUCKET})`,
  `function getCurrentRateLimiterState(uint64 remoteChainSelector, bool fastFinality) view returns (${BUCKET} outboundRateLimiterState, ${BUCKET} inboundRateLimiterState)`,
  'function isSupportedChain(uint64 remoteChainSelector) view returns (bool)',
])

// Distinct values in every field and per bucket: a swapped (inbound, outbound) pair, a dropped
// field or a finalized bucket served for a fast-finality read must all fail deep equality.
const INBOUND: TokenBucket = {
  tokens: 1_000n,
  lastUpdated: 1_700_000_001,
  isEnabled: true,
  capacity: 5_000n,
  rate: 10n,
}
const OUTBOUND: TokenBucket = {
  tokens: 2_000n,
  lastUpdated: 1_700_000_002,
  isEnabled: false,
  capacity: 6_000n,
  rate: 20n,
}
const FAST_INBOUND: TokenBucket = {
  tokens: 3_000n,
  lastUpdated: 1_700_000_003,
  isEnabled: true,
  capacity: 7_000n,
  rate: 30n,
}
const FAST_OUTBOUND: TokenBucket = {
  tokens: 4_000n,
  lastUpdated: 1_700_000_004,
  isEnabled: true,
  capacity: 8_000n,
  rate: 40n,
}

/** Every (type, version) pair a pool can resolve to. */
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

const PRE_V2 = POOLS.filter(([, version]) => version !== '2.0.0')

/** The reads the op makes: function name and decoded arguments (`typeAndVersion` has none). */
type Seen = { calls: { name: string; args: unknown[] }[] }
const newSeen = (): Seen => ({ calls: [] })
const names = (seen: Seen) => seen.calls.map(({ name }) => name)

/**
 * EVMChain stub answering `typeAndVersion`, `isSupportedChain` and only the rate-limiter getters
 * `version` declares, so a read through the other version's getters reverts.
 */
function stubChain({
  type = 'BurnMintTokenPool',
  version = '1.5.0',
  isSupported = true,
  seen = newSeen(),
}: {
  type?: string
  version?: string
  isSupported?: boolean
  seen?: Seen
} = {}): EVMChain {
  const getters =
    version === '2.0.0'
      ? ['getCurrentRateLimiterState']
      : ['getCurrentInboundRateLimiterState', 'getCurrentOutboundRateLimiterState']
  const result = (name: string, args: unknown[]): unknown[] => {
    if (name === 'isSupportedChain') return [isSupported]
    if (name === 'getCurrentInboundRateLimiterState') return [INBOUND]
    if (name === 'getCurrentOutboundRateLimiterState') return [OUTBOUND]
    // the v2.0.0 getter returns (outbound, inbound), in that order
    return args[1] === true ? [FAST_OUTBOUND, FAST_INBOUND] : [OUTBOUND, INBOUND]
  }
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = ORACLE.getFunction(data.slice(0, 10))
        if (
          !fn ||
          (fn.name !== 'isSupportedChain' && !getters.includes(fn.name)) ||
          getAddress(to) !== getAddress(POOL)
        )
          throw makeError('execution reverted', 'CALL_EXCEPTION')
        const args = Array.from(ORACLE.decodeFunctionData(fn, data))
        seen.calls.push({ name: fn.name, args })
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, result(fn.name, args)))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push({ name: 'typeAndVersion', args: [] })
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetCurrentRateLimiterState()
const query = (chain: EVMChain, overrides: Partial<GetCurrentRateLimiterStateParams> = {}) =>
  op.query(chain, { poolAddress: POOL, remoteChainSelector: SELECTOR, ...overrides })

/** Matches a {@link CCTParamsInvalidError} from this op on `param`. */
const paramsError = (param: string) => (err: unknown) =>
  err instanceof CCTParamsInvalidError &&
  err.context.operation === 'getCurrentRateLimiterState' &&
  err.context.param === param

describe('GetCurrentRateLimiterState (cct/evm)', () => {
  for (const [type, version] of PRE_V2) {
    it(`reads both raw buckets of a ${type} ${version} through the per-direction getters`, async () => {
      const seen = newSeen()
      assert.deepEqual(await query(stubChain({ type, version, seen })), {
        inbound: INBOUND,
        outbound: OUTBOUND,
      })
      assert.deepEqual(seen.calls, [
        { name: 'typeAndVersion', args: [] },
        { name: 'isSupportedChain', args: [SELECTOR] },
        { name: 'getCurrentInboundRateLimiterState', args: [SELECTOR] },
        { name: 'getCurrentOutboundRateLimiterState', args: [SELECTOR] },
      ])
    })
  }

  for (const [type, version] of POOLS.filter(([, v]) => v === '2.0.0')) {
    it(`reads the finalized buckets of a ${type} 2.0.0 by default, inbound and outbound not swapped`, async () => {
      const seen = newSeen()
      assert.deepEqual(await query(stubChain({ type, version, seen })), {
        inbound: INBOUND,
        outbound: OUTBOUND,
      })
      assert.deepEqual(seen.calls, [
        { name: 'typeAndVersion', args: [] },
        { name: 'isSupportedChain', args: [SELECTOR] },
        { name: 'getCurrentRateLimiterState', args: [SELECTOR, false] },
      ])
    })

    it(`reads the fast-finality buckets of a ${type} 2.0.0 when fastFinality is true`, async () => {
      const seen = newSeen()
      assert.deepEqual(await query(stubChain({ type, version, seen }), { fastFinality: true }), {
        inbound: FAST_INBOUND,
        outbound: FAST_OUTBOUND,
      })
      assert.deepEqual(seen.calls.at(-1), {
        name: 'getCurrentRateLimiterState',
        args: [SELECTOR, true],
      })
    })
  }

  it('passes an explicit fastFinality false through on a 2.0.0 pool', async () => {
    const seen = newSeen()
    const chain = stubChain({ version: '2.0.0', seen })
    assert.deepEqual(await query(chain, { fastFinality: false }), {
      inbound: INBOUND,
      outbound: OUTBOUND,
    })
    assert.deepEqual(seen.calls.at(-1), {
      name: 'getCurrentRateLimiterState',
      args: [SELECTOR, false],
    })
  })

  it('returns lastUpdated as a number and the uint128 fields as bigints', async () => {
    const { inbound } = await query(stubChain({ version: '1.5.1' }))
    assert.equal(typeof inbound.lastUpdated, 'number')
    assert.equal(typeof inbound.tokens, 'bigint')
    assert.equal(typeof inbound.capacity, 'bigint')
    assert.equal(typeof inbound.rate, 'bigint')
  })

  for (const version of ['1.5.1', '2.0.0'] as const) {
    it(`rejects a ${version} lane the pool does not support, naming the selector, instead of returning its zeroed buckets`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () => query(stubChain({ version, isSupported: false, seen })),
        (err: unknown) =>
          paramsError('remoteChainSelector')(err) &&
          err instanceof Error &&
          err.message.includes(String(SELECTOR)),
      )
      // the lane check runs alongside the bucket read, so the getters are called too
      assert.deepEqual(names(seen).slice(0, 2), ['typeAndVersion', 'isSupportedChain'])
    })
  }

  for (const [type, version] of PRE_V2) {
    for (const fastFinality of [true, false]) {
      it(`rejects fastFinality ${fastFinality} on a ${type} ${version}, which has no fast-finality buckets, before any getter`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => query(stubChain({ type, version, seen }), { fastFinality }),
          paramsError('fastFinality'),
        )
        assert.deepEqual(names(seen), ['typeAndVersion'])
      })
    }
  }

  const badParams: [string, Partial<Record<keyof GetCurrentRateLimiterStateParams, unknown>>][] = [
    ['poolAddress', { poolAddress: 'not-an-address' }],
    ['remoteChainSelector', { remoteChainSelector: -1n }],
    ['remoteChainSelector', { remoteChainSelector: 2n ** 64n }],
    ['remoteChainSelector', { remoteChainSelector: 1 }],
    ['fastFinality', { fastFinality: 'true' }],
  ]
  for (const [param, overrides] of badParams) {
    it(`rejects an invalid ${param} (${String(Object.values(overrides)[0])}) before any RPC`, async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          op.query(stubChain({ version: '2.0.0', seen }), {
            poolAddress: POOL,
            remoteChainSelector: SELECTOR,
            ...overrides,
          } as GetCurrentRateLimiterStateParams),
        paramsError(param),
      )
      assert.deepEqual(seen.calls, [])
    })
  }

  it('rejects an unsupported pool type before any getter', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => query(stubChain({ type: 'USDCTokenPool', seen })),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError && err.context.actual === 'USDCTokenPool',
    )
    assert.deepEqual(names(seen), ['typeAndVersion'])
  })

  it('rejects an unknown version before any getter', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => query(stubChain({ version: '1.4.0', seen })),
      (err: unknown) =>
        err instanceof CCTContractVersionUnsupportedError && err.context.version === '1.4.0',
    )
    assert.deepEqual(names(seen), ['typeAndVersion'])
  })
})
