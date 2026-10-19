import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTContractTypeInvalidError } from '../../../errors.ts'
import { resolveAdvancedPoolHooks } from '../../advanced-pool-hooks/contracts.ts'
import { EVMOperation } from '../../operation.ts'
import { EVMQuery } from '../../query.ts'
import * as ops from './index.ts'
import {
  AcceptPoolOwnership,
  AddRemotePool,
  ApplyAllowlistUpdates,
  ApplyChainUpdates,
  ApplyTokenTransferFeeConfigUpdates,
  ConfigureSiloedLockboxes,
  GetAdvancedPoolHooks,
  GetAllSiloedLockboxConfigs,
  GetAllowedFinalityConfig,
  GetAllowlist,
  GetAllowlistEnabled,
  GetAvailableTokens,
  GetBurnAddress,
  GetChainRebalancer,
  GetDynamicConfig,
  GetFee,
  GetLockbox,
  GetRebalancer,
  GetSiloedLockbox,
  GetTokenTransferFeeConfig,
  IsSiloed,
  ProvideLiquidity,
  ProvideSiloedLiquidity,
  RemoveRemotePool,
  SetAllowedFinalityConfig,
  SetChainRateLimiterConfigs,
  SetDynamicConfig,
  SetRateLimitAdmin,
  SetRebalancer,
  SetRemotePool,
  SetSiloRebalancer,
  TransferLiquidity,
  TransferPoolOwnership,
  UpdateAdvancedPoolHooks,
  UpdateSiloDesignations,
  WithdrawFeeTokens,
  WithdrawLiquidity,
  WithdrawSiloedLiquidity,
} from './index.ts'

/**
 * Every USDC/CCTP pool the SDK recognizes, as its bytecode reports it (a
 * `HybridLockReleaseUSDCTokenPool` reports `USDCTokenPool 1.6.2`), each with the way out its
 * rejection names, plus the proxy, which is not a pool at all.
 */
const REJECTED = [
  // a version no op knows still fails as the USDC type, not as an unsupported version
  ['USDCTokenPool 1.4.0', /getTokenPoolState/],
  ['USDCTokenPool 1.5.1', /getTokenPoolState/],
  ['USDCTokenPool 1.6.2', /getTokenPoolState/],
  ['USDCTokenPool 1.6.5', /getTokenPoolState/],
  ['USDCTokenPoolCCTPV2 1.6.5', /getTokenPoolState/],
  ['SiloedUSDCTokenPool 2.0.0', /getTokenPoolState/],
  ['CCTPThroughCCVTokenPool 2.0.0', /getTokenPoolState/],
  ['USDCTokenPoolProxy 2.0.0', /getPools/],
] as const

const POOL = '0x' + '11'.repeat(20)
const FROM = '0x' + '12'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const ACCOUNT = '0x' + '33'.repeat(20)
const NEW_OWNER = '0x' + '44'.repeat(20)
const LOCKBOX = '0x' + '55'.repeat(20)
const REMOTE_TOKEN = '0x' + '66'.repeat(20)
const REMOTE_POOL = '0x' + '77'.repeat(20)
/** Ethereum mainnet selector, a lane every USDC pool could plausibly serve. */
const SELECTOR = 5009297550715157269n

/**
 * EVMChain stub: `typeAndVersion` answers per address (parsed the way the real chain does) and
 * every `provider.call` throws, so `counts` pins "the guard runs before any other RPC".
 */
function stubChain(typeAndVersionByAddress: Record<string, string>) {
  const counts = { typeAndVersion: 0, calls: 0 }
  const chain = {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: () => {
        counts.calls++
        throw new Error('must not be called')
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: (address: string) => {
      counts.typeAndVersion++
      return Promise.resolve(parseTypeAndVersion(typeAndVersionByAddress[getAddress(address)]!))
    },
  } as unknown as EVMChain
  return { chain, counts }
}

/** One guarded op: its name, and a call with minimal valid params against `POOL`. */
type TestCase = { op: { name: string }; run: (chain: EVMChain) => Promise<unknown> }

/** Builds a {@link TestCase} for a write op, whose unsigned tx `generate` builds. */
const write = <P>(
  op: { name: string; generate: (chain: EVMChain, params: P) => Promise<unknown> },
  params: P,
): TestCase => ({ op, run: (chain) => op.generate(chain, params) })

/** Builds a {@link TestCase} for a read op. */
const read = <P>(
  op: { name: string; query: (chain: EVMChain, params: P) => Promise<unknown> },
  params: P,
): TestCase => ({ op, run: (chain) => op.query(chain, params) })

const remotePool = {
  poolAddress: POOL,
  remoteChainSelector: SELECTOR,
  remotePoolAddress: REMOTE_POOL,
}
const rateLimit = { enabled: false } as const

/** Every op in `index.ts` that resolves a pool, which is all but deploy, remotes and state. */
const testCases: TestCase[] = [
  write(new AcceptPoolOwnership(), { poolAddress: POOL }),
  write(new AddRemotePool(), remotePool),
  write(new ApplyAllowlistUpdates(), { poolAddress: POOL, adds: [ACCOUNT] }),
  write(new ApplyChainUpdates(), {
    poolAddress: POOL,
    remoteChainSelectorsToRemove: [],
    chainsToAdd: [
      {
        remoteChainSelector: SELECTOR,
        remoteTokenAddress: REMOTE_TOKEN,
        remotePoolAddresses: [REMOTE_POOL],
        inboundRateLimiterConfig: rateLimit,
        outboundRateLimiterConfig: rateLimit,
      },
    ],
  }),
  write(new ApplyTokenTransferFeeConfigUpdates(), { poolAddress: POOL, disables: [SELECTOR] }),
  write(new ConfigureSiloedLockboxes(), {
    poolAddress: POOL,
    lockboxConfigs: [{ remoteChainSelector: SELECTOR, lockbox: LOCKBOX }],
  }),
  read(new GetAdvancedPoolHooks(), { poolAddress: POOL }),
  read(new GetAllSiloedLockboxConfigs(), { poolAddress: POOL }),
  read(new GetAllowedFinalityConfig(), { poolAddress: POOL }),
  read(new GetAllowlist(), { poolAddress: POOL }),
  read(new GetAllowlistEnabled(), { poolAddress: POOL }),
  read(new GetAvailableTokens(), { poolAddress: POOL, remoteChainSelector: SELECTOR }),
  read(new GetBurnAddress(), { poolAddress: POOL }),
  read(new GetChainRebalancer(), { poolAddress: POOL, remoteChainSelector: SELECTOR }),
  read(new GetDynamicConfig(), { poolAddress: POOL }),
  read(new GetFee(), { poolAddress: POOL, remoteChainSelector: SELECTOR }),
  read(new GetLockbox(), { poolAddress: POOL }),
  read(new GetRebalancer(), { poolAddress: POOL }),
  read(new GetSiloedLockbox(), { poolAddress: POOL, remoteChainSelector: SELECTOR }),
  read(new GetTokenTransferFeeConfig(), { poolAddress: POOL, remoteChainSelector: SELECTOR }),
  read(new IsSiloed(), { poolAddress: POOL, remoteChainSelector: SELECTOR }),
  write(new ProvideLiquidity(), { poolAddress: POOL, amount: 1n }),
  write(new ProvideSiloedLiquidity(), {
    poolAddress: POOL,
    remoteChainSelector: SELECTOR,
    amount: 1n,
  }),
  write(new RemoveRemotePool(), remotePool),
  write(new SetAllowedFinalityConfig(), {
    poolAddress: POOL,
    allowedFinality: { finalityDepth: 10 },
  }),
  write(new SetChainRateLimiterConfigs(), {
    poolAddress: POOL,
    updates: [
      {
        remoteChainSelector: SELECTOR,
        inboundRateLimiterConfig: rateLimit,
        outboundRateLimiterConfig: rateLimit,
      },
    ],
  }),
  write(new SetDynamicConfig(), {
    poolAddress: POOL,
    router: ACCOUNT,
    rateLimitAdmin: ACCOUNT,
    feeAdmin: ACCOUNT,
  }),
  write(new SetRateLimitAdmin(), { poolAddress: POOL, newRateLimitAdmin: ACCOUNT }),
  write(new SetRebalancer(), { poolAddress: POOL, rebalancer: ACCOUNT }),
  write(new SetRemotePool(), remotePool),
  write(new SetSiloRebalancer(), {
    poolAddress: POOL,
    remoteChainSelector: SELECTOR,
    rebalancer: ACCOUNT,
  }),
  write(new TransferLiquidity(), { poolAddress: POOL, from: FROM, amount: 1n }),
  write(new TransferPoolOwnership(), { poolAddress: POOL, newOwner: NEW_OWNER, sender: OWNER }),
  write(new UpdateAdvancedPoolHooks(), { poolAddress: POOL, advancedPoolHooks: ACCOUNT }),
  write(new UpdateSiloDesignations(), {
    poolAddress: POOL,
    removes: [],
    adds: [{ remoteChainSelector: SELECTOR, rebalancer: ACCOUNT }],
  }),
  write(new WithdrawFeeTokens(), { poolAddress: POOL, feeTokens: [ACCOUNT], recipient: OWNER }),
  write(new WithdrawLiquidity(), { poolAddress: POOL, amount: 1n }),
  write(new WithdrawSiloedLiquidity(), {
    poolAddress: POOL,
    remoteChainSelector: SELECTOR,
    amount: 1n,
  }),
]

describe('USDC/CCTP pools are rejected by every op but getTokenPoolState (cct/evm)', () => {
  it('covers every pool-resolving op exactly once', () => {
    // the ops that never resolve the pool, or read a USDC pool on purpose
    const unguarded = new Set(['DeployTokenPool', 'GetTokenPoolState', 'GetTokenPoolRemotes'])
    const guarded = Object.entries(ops)
      .filter(
        ([name, value]) =>
          typeof value === 'function' &&
          (value.prototype instanceof EVMOperation || value.prototype instanceof EVMQuery) &&
          !unguarded.has(name),
      )
      .map(([name]) => name)
      .sort()
    const covered = testCases.map(({ op }) => op.constructor.name)
    assert.equal(new Set(covered).size, covered.length)
    assert.deepEqual(covered.sort(), guarded)
  })

  /** Asserts `run` rejects every {@link REJECTED} contract on its type, before any eth_call. */
  async function assertRejectsAll(name: string, run: (chain: EVMChain) => Promise<unknown>) {
    for (const [typeAndVersion, wayOut] of REJECTED) {
      const { chain, counts } = stubChain({ [getAddress(POOL)]: typeAndVersion })
      const [contractType] = parseTypeAndVersion(typeAndVersion)
      await assert.rejects(
        () => run(chain),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.actual === contractType &&
          err.context.address === POOL &&
          wayOut.test(err.message),
        `${name} on ${typeAndVersion}`,
      )
      assert.deepEqual(counts, { typeAndVersion: 1, calls: 0 }, `${name} on ${typeAndVersion}`)
    }
  }

  for (const { op, run } of testCases)
    it(`rejects every USDC pool and the proxy in ${op.name} before any eth_call`, () =>
      assertRejectsAll(op.name, run))

  // every AdvancedPoolHooks op given a { poolAddress } target resolves the pool through this
  it('rejects every USDC pool and the proxy in resolveAdvancedPoolHooks before any eth_call', () =>
    assertRejectsAll('resolveAdvancedPoolHooks', (chain) =>
      resolveAdvancedPoolHooks('applyAuthorizedCallerUpdates', chain, POOL),
    ))
})
