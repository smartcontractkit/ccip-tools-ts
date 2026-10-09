import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError, toBeHex, zeroPadValue } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
// registers the Solana chain family, for the lane whose remote is Solana
import '../../../../solana/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type TokenPoolFamily,
  type TokenPoolType,
  TokenPoolVersion,
  getTokenPoolInterface,
} from '../contracts.ts'
import { type ApplyChainUpdatesParams, ApplyChainUpdates } from './apply-chain-updates.ts'

const { V1_5_0, V1_5_1, V1_6_0, V1_6_1, V2_0_0 } = TokenPoolVersion

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const RMN_PROXY = '0x' + '55'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '66'.repeat(20)
const FEE_ADMIN = '0x' + '77'.repeat(20)
const LOCKBOX = '0x' + '88'.repeat(20)
const NOT_OWNER = '0x' + '99'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const SEL_A = 16015286601757825753n // ethereum-sepolia
const SEL_B = 3478487238524512106n // arbitrum-sepolia
const REMOTE_TOKEN = '0x' + 'aa'.repeat(20)
const REMOTE_POOL_1 = '0x' + 'bb'.repeat(20)
const REMOTE_POOL_2 = '0x' + 'cc'.repeat(20)
/** The pool stores every remote address left-padded to 32 bytes. */
const pad = (address: string) => zeroPadValue(address, 32)

const INBOUND = { enabled: true, capacity: 100_000n, rate: 167n } as const
const OUTBOUND = { enabled: false } as const

/** Both directions as the ABI spells them — `isEnabled`, with the disabled amounts defaulted. */
const ABI_INBOUND = { isEnabled: true, capacity: 100_000n, rate: 167n }
const ABI_OUTBOUND = { isEnabled: false, capacity: 0n, rate: 0n }

/**
 * Expected calldata is built from interfaces declared *here*, from the human-readable signatures
 * read off the vendored ABIs — not from the SDK's own cached `TOKEN_POOL_INTERFACES`, which would
 * make the parity assertions circular.
 */
const FRESH_V1_5_0 = new Interface([
  'function applyChainUpdates((uint64 remoteChainSelector, bool allowed, bytes remotePoolAddress, bytes remoteTokenAddress, (bool isEnabled, uint128 capacity, uint128 rate) outboundRateLimiterConfig, (bool isEnabled, uint128 capacity, uint128 rate) inboundRateLimiterConfig)[] chains)',
])
const FRESH_V1_5_1 = new Interface([
  'function applyChainUpdates(uint64[] remoteChainSelectorsToRemove, (uint64 remoteChainSelector, bytes[] remotePoolAddresses, bytes remoteTokenAddress, (bool isEnabled, uint128 capacity, uint128 rate) outboundRateLimiterConfig, (bool isEnabled, uint128 capacity, uint128 rate) inboundRateLimiterConfig)[] chainsToAdd)',
])

/**
 * {@link validParams} as a v1.5.0 pool takes them: the removal first, as an `allowed: false` lane
 * whose addresses go out empty and whose rate limits are disabled, then the addition.
 */
const DATA_V1_5_0 = FRESH_V1_5_0.encodeFunctionData('applyChainUpdates', [
  [
    {
      remoteChainSelector: SEL_B,
      allowed: false,
      remotePoolAddress: '0x',
      remoteTokenAddress: '0x',
      outboundRateLimiterConfig: ABI_OUTBOUND,
      inboundRateLimiterConfig: ABI_OUTBOUND,
    },
    {
      remoteChainSelector: SEL_A,
      allowed: true,
      remotePoolAddress: pad(REMOTE_POOL_1),
      remoteTokenAddress: pad(REMOTE_TOKEN),
      outboundRateLimiterConfig: ABI_OUTBOUND,
      inboundRateLimiterConfig: ABI_INBOUND,
    },
  ],
])

/** {@link validParams} as a v1.5.1+ pool takes them, the lane accepting `remotePools`. */
const dataV1_5_1 = (remotePools = [REMOTE_POOL_1]) =>
  FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
    [SEL_B],
    [
      {
        remoteChainSelector: SEL_A,
        remotePoolAddresses: remotePools.map(pad),
        remoteTokenAddress: pad(REMOTE_TOKEN),
        outboundRateLimiterConfig: ABI_OUTBOUND,
        inboundRateLimiterConfig: ABI_INBOUND,
      },
    ],
  ])
const DATA_V1_5_1 = dataV1_5_1()

/** The params every version takes; {@link DATA_V1_5_0} / {@link DATA_V1_5_1} is their calldata. */
function validParams(overrides: Record<string, unknown> = {}): ApplyChainUpdatesParams {
  return {
    poolAddress: POOL,
    sender: OWNER,
    remoteChainSelectorsToRemove: [SEL_B],
    chainsToAdd: [
      {
        remoteChainSelector: SEL_A,
        remoteTokenAddress: REMOTE_TOKEN,
        remotePoolAddresses: [REMOTE_POOL_1],
        inboundRateLimiterConfig: INBOUND,
        outboundRateLimiterConfig: OUTBOUND,
      },
    ],
    ...overrides,
  }
}

/** Pool contract type reported per ABI family. */
const POOL_TYPE: Record<TokenPoolFamily, TokenPoolType> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
  SiloedLockRelease: 'SiloedLockReleaseTokenPool',
}

/**
 * The `owner()`/getter results `GetTokenPoolState` reads, encoded per version generation: v2.0.0
 * folds router + both admin roles into `getDynamicConfig` and adds the finality window, where the
 * legacy versions have standalone getters.
 */
function poolStateReads(version: TokenPoolVersion, family: TokenPoolFamily): Map<string, string> {
  const responses = new Map<string, string>()
  const iface = getTokenPoolInterface(POOL_TYPE[family], version)
  const add = (fn: string, values: unknown[]) =>
    responses.set(iface.getFunction(fn)!.selector, iface.encodeFunctionResult(fn, values))

  add('getToken', [TOKEN])
  add('owner', [OWNER])
  add('getRmnProxy', [RMN_PROXY])
  add('getSupportedChains', [[SEL_A]])
  if (version === TokenPoolVersion.V2_0_0) {
    add('getTokenDecimals', [18])
    add('getDynamicConfig', [ROUTER, RATE_LIMIT_ADMIN, FEE_ADMIN])
    add('getAllowedFinalityConfig', [toBeHex(0, 4)])
    if (family === 'LockRelease') add('getLockBox', [LOCKBOX])
  } else {
    add('getRouter', [ROUTER])
    add('getRateLimitAdmin', [RATE_LIMIT_ADMIN])
  }
  return responses
}

type Stub = {
  chain: EVMChain
  /** How many times the op probed `typeAndVersion` — the first RPC any build makes. */
  probes: () => number
}

/**
 * EVMChain stub: reports `typeAndVersion` for the requested family/version and answers the pool's
 * own state getters off `eth_call`. Any other getter reverts.
 */
function stubChain(
  version: TokenPoolVersion = TokenPoolVersion.V1_5_1,
  family: TokenPoolFamily = 'BurnMint',
  owner = OWNER,
  type: string = POOL_TYPE[family],
): Stub {
  let probes = 0
  const responses = poolStateReads(version, family)
  if (owner !== OWNER) {
    const iface = getTokenPoolInterface(POOL_TYPE[family], version)
    responses.set(
      iface.getFunction('owner')!.selector,
      iface.encodeFunctionResult('owner', [owner]),
    )
  }
  const chain = {
    provider: {
      call: ({ data }: { data: string }) => {
        const encoded = responses.get(data.slice(0, 10))
        if (!encoded)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        return Promise.resolve(encoded)
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    typeAndVersion: () => {
      probes++
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
    getTokenInfo: () => Promise.resolve({ decimals: 18, symbol: 'TKN', name: 'Token' }),
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
  return { chain, probes: () => probes }
}

function fakeSigner(waitError?: Error, address = OWNER) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => (waitError ? Promise.reject(waitError) : Promise.resolve({ status: 1 })),
      }),
  }
}

const op = new ApplyChainUpdates()

/** Every supported pool version, paired with the calldata it expects for {@link validParams}. */
const DISPATCH = [
  { version: V1_5_0, data: DATA_V1_5_0 },
  { version: V1_5_1, data: DATA_V1_5_1 },
  { version: V1_6_1, data: DATA_V1_5_1 },
  { version: V2_0_0, data: DATA_V1_5_1 },
] as const

describe('ApplyChainUpdates (cct/evm)', () => {
  describe('generate', () => {
    for (const { version, data } of DISPATCH) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes applyChainUpdates for a v${version} ${family} pool`, async () => {
          const { chain } = stubChain(version, family)
          const unsigned = await op.generate(chain, validParams())
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, data)
        })
      }

      it(`encodes identical calldata for both ABI families at v${version}`, async () => {
        const burnMint = await op.generate(stubChain(version, 'BurnMint').chain, validParams())
        const lockRelease = await op.generate(
          stubChain(version, 'LockRelease').chain,
          validParams(),
        )
        assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
        assert.equal(burnMint.transactions[0]!.data, data)
      })
    }

    it('omits from when sender is not supplied, and skips the owner probe', async () => {
      const { chain } = stubChain(TokenPoolVersion.V1_5_1, 'BurnMint', NOT_OWNER)
      // owner() reports NOT_OWNER, so this only builds because no sender was given to check
      const unsigned = await op.generate(chain, validParams({ sender: undefined }))
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, DATA_V1_5_1)
    })

    it('normalises 0x-less, upper-case and padded EVM remote addresses', async () => {
      const { chain } = stubChain()
      const unsigned = await op.generate(
        chain,
        validParams({
          chainsToAdd: [
            {
              remoteChainSelector: SEL_A,
              remoteTokenAddress: 'AA'.repeat(20),
              remotePoolAddresses: ['0X' + 'BB'.repeat(20), pad(REMOTE_POOL_2)],
              inboundRateLimiterConfig: INBOUND,
              outboundRateLimiterConfig: OUTBOUND,
            },
          ],
        }),
      )
      assert.equal(unsigned.transactions[0]!.data, dataV1_5_1([REMOTE_POOL_1, REMOTE_POOL_2]))
    })

    it('encodes a Solana lane from base58, the 32-byte keys needing no padding', async () => {
      const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
      const token = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
      const tokenBytes = '0x6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'
      const poolBytes = '0x' + 'cd'.repeat(32)
      const unsigned = await op.generate(
        stubChain().chain,
        validParams({
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [
            {
              ...addEntry(),
              remoteChainSelector: SOLANA_SELECTOR,
              remoteTokenAddress: token,
              // the same key may also be given as its 32-byte hex
              remotePoolAddresses: [poolBytes],
            },
          ],
        }),
      )
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
          [],
          [
            {
              remoteChainSelector: SOLANA_SELECTOR,
              remotePoolAddresses: [poolBytes],
              remoteTokenAddress: tokenBytes,
              outboundRateLimiterConfig: ABI_OUTBOUND,
              inboundRateLimiterConfig: ABI_INBOUND,
            },
          ],
        ]),
      )
    })

    it('accepts uint128 max for both rate-limit amounts', async () => {
      // the widest legal RateLimiter.Config; rate === capacity, so only a v1.6.1+ pool takes it
      const UINT128_MAX = 2n ** 128n - 1n
      const unsigned = await op.generate(
        stubChain(TokenPoolVersion.V1_6_1).chain,
        validParams({
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [
            {
              ...addEntry(),
              inboundRateLimiterConfig: {
                enabled: true,
                capacity: UINT128_MAX,
                rate: UINT128_MAX,
              },
            },
          ],
        }),
      )
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
          [],
          [
            {
              remoteChainSelector: SEL_A,
              remotePoolAddresses: [pad(REMOTE_POOL_1)],
              remoteTokenAddress: pad(REMOTE_TOKEN),
              outboundRateLimiterConfig: ABI_OUTBOUND,
              inboundRateLimiterConfig: {
                isEnabled: true,
                capacity: UINT128_MAX,
                rate: UINT128_MAX,
              },
            },
          ],
        ]),
      )
    })

    it('rejects a sender that is not the pool owner', async () => {
      const { chain } = stubChain(TokenPoolVersion.V1_5_1, 'BurnMint', NOT_OWNER)
      await assert.rejects(
        () => op.generate(chain, validParams()),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('validation', () => {
    const cases: [string, ApplyChainUpdatesParams][] = [
      ['poolAddress', validParams({ poolAddress: 'not-an-address' })],
      ['sender', validParams({ sender: 'not-an-address' })],
      ['chainsToAdd', validParams({ chainsToAdd: 'nope' })],
      ['remoteChainSelectorsToRemove', validParams({ remoteChainSelectorsToRemove: 'nope' })],
      ['chainsToAdd', validParams({ chainsToAdd: [], remoteChainSelectorsToRemove: [] })],
      ['remoteChainSelectorsToRemove[0]', validParams({ remoteChainSelectorsToRemove: [1] })],
      ['chainsToAdd[0]', validParams({ chainsToAdd: [null] })],
      [
        'chainsToAdd[0].remoteChainSelector',
        validParams({
          chainsToAdd: [{ ...addEntry(), remoteChainSelector: -1n }],
        }),
      ],
      [
        'chainsToAdd[0].remotePoolAddresses',
        validParams({ chainsToAdd: [{ ...addEntry(), remotePoolAddresses: [] }] }),
      ],
      [
        'chainsToAdd[0].remotePoolAddresses[0]',
        validParams({
          chainsToAdd: [{ ...addEntry(), remotePoolAddresses: ['0xzz'] }],
        }),
      ],
      [
        'chainsToAdd[0].remotePoolAddresses[1]',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              remotePoolAddresses: [REMOTE_POOL_1, '0X' + 'BB'.repeat(20)],
            },
          ],
        }),
      ],
      [
        'chainsToAdd[0].remoteTokenAddress',
        validParams({ chainsToAdd: [{ ...addEntry(), remoteTokenAddress: '' }] }),
      ],
      [
        // a Solana address on an EVM lane
        'chainsToAdd[0].remoteTokenAddress',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              remoteTokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
            },
          ],
        }),
      ],
      [
        'chainsToAdd[0].inboundRateLimiterConfig.enabled',
        validParams({
          chainsToAdd: [{ ...addEntry(), inboundRateLimiterConfig: {} }],
        }),
      ],
      [
        'chainsToAdd[0].outboundRateLimiterConfig.rate',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              outboundRateLimiterConfig: { enabled: true, capacity: 1n, rate: 2n },
            },
          ],
        }),
      ],
      // ported from the deleted validate.test.ts: a selector must not be accepted just because it
      // fits a wider integer type — uint64 is the tighter bound, and uint128 amounts have a
      // ceiling of their own
      [
        'remoteChainSelectorsToRemove[0]',
        validParams({ remoteChainSelectorsToRemove: [2n ** 64n] }),
      ],
      [
        'chainsToAdd[0].remoteChainSelector',
        validParams({
          chainsToAdd: [{ ...addEntry(), remoteChainSelector: 2n ** 64n }],
        }),
      ],
      [
        'chainsToAdd[0].inboundRateLimiterConfig.capacity',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              inboundRateLimiterConfig: { enabled: true, capacity: 2n ** 128n, rate: 1n },
            },
          ],
        }),
      ],
      // an enabled config defaults nothing, so an omitted amount is blamed by the bound check
      [
        'chainsToAdd[0].inboundRateLimiterConfig.rate',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              inboundRateLimiterConfig: { enabled: true, capacity: 1n },
            },
          ],
        }),
      ],
      // a disabled config must be all-zero, and the whole direction is blamed, not one amount
      [
        'chainsToAdd[0].outboundRateLimiterConfig',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              outboundRateLimiterConfig: { enabled: false, capacity: 1n },
            },
          ],
        }),
      ],
      // the retired v1.5.0 `chains` shape is not a way to write a v1.5.0 pool
      [
        'chainsToAdd',
        validParams({
          chainsToAdd: undefined,
          remoteChainSelectorsToRemove: undefined,
          chains: [{ ...addEntry(), allowed: true, remotePoolAddress: REMOTE_POOL_1 }],
        }),
      ],
    ]

    for (const [param, params] of cases) {
      it(`rejects an invalid ${param} before any RPC`, async () => {
        const { chain, probes } = stubChain()
        await assert.rejects(
          () => op.generate(chain, params),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyChainUpdates' &&
            err.context.param === param,
        )
        assert.equal(probes(), 0, 'no RPC should be issued for an invalid param')
      })
    }
  })

  /**
   * Three guards that each exist because the *un*guarded outcome is worse than a local failure:
   *
   * - A **hole** survives element validation outright — `.forEach`/`.map` skip holes — so it used
   *   to reach ethers as `undefined` and surface as a bare `TypeError` with no
   *   `operation`/`param` context, and only after the `typeAndVersion` probe had been spent.
   * - A **`0n` selector** on an added lane is not guarded on-chain: `s_remoteChainSelectors.add(0)`
   *   succeeds, so the transaction *mines as a success* and leaves a permanently unroutable lane in
   *   `getSupportedChains()` that a second owner transaction has to remove.
   * - A **duplicate** reverts cleanly on-chain, so this one only saves a transaction — but the
   *   sibling ops (`setChainRateLimiterConfigs`, and `remotePoolAddresses` within a lane) already
   *   reject it, and consistency across the family is worth more than the one saved revert.
   *
   * Every rejection asserts `probes() === 0`: a guard that fires *after* the version probe has
   * already broken the "fail before RPC" promise, so the counter is the real subject here.
   */
  describe('array density, junk selectors and duplicates', () => {
    /** `[first, <hole>, last]` — length 3, index 1 absent, which every array method skips. */
    function sparse<T>(first: T, last: T): T[] {
      const array = [first]
      array[2] = last
      return array
    }

    const add = (remoteChainSelector: bigint) => ({
      ...addEntry(),
      remoteChainSelector,
    })

    const cases: [string, string, ApplyChainUpdatesParams][] = [
      [
        'a hole in chainsToAdd',
        'chainsToAdd[1]',
        validParams({ chainsToAdd: sparse(add(SEL_A), add(SEL_B)) }),
      ],
      [
        'a hole in remoteChainSelectorsToRemove',
        'remoteChainSelectorsToRemove[1]',
        validParams({ remoteChainSelectorsToRemove: sparse(SEL_A, SEL_B) }),
      ],
      [
        "a hole in a lane's remotePoolAddresses",
        'chainsToAdd[0].remotePoolAddresses[1]',
        validParams({
          chainsToAdd: [
            {
              ...addEntry(),
              remotePoolAddresses: sparse(REMOTE_POOL_1, REMOTE_POOL_2),
            },
          ],
        }),
      ],
      [
        'a 0n selector in chainsToAdd',
        'chainsToAdd[0].remoteChainSelector',
        validParams({ chainsToAdd: [add(0n)] }),
      ],
      [
        'a repeated selector in chainsToAdd',
        'chainsToAdd[1].remoteChainSelector',
        validParams({ chainsToAdd: [add(SEL_A), add(SEL_A)] }),
      ],
      [
        'a repeated selector in remoteChainSelectorsToRemove',
        'remoteChainSelectorsToRemove[1]',
        validParams({ remoteChainSelectorsToRemove: [SEL_A, SEL_A] }),
      ],
    ]

    for (const [name, param, params] of cases) {
      it(`rejects ${name} before any RPC`, async () => {
        const { chain, probes } = stubChain()
        await assert.rejects(
          () => op.generate(chain, params),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyChainUpdates' &&
            err.context.param === param,
        )
        assert.equal(probes(), 0, `${name} must fail before the typeAndVersion probe`)
      })
    }

    // The over-rejection side. Each of these is a legitimate call that the guards above must not
    // swallow, and each is the *only* way to express its intent.
    it('accepts a 0n selector in remoteChainSelectorsToRemove, so a polluted pool can be repaired', async () => {
      const { chain } = stubChain()
      const unsigned = await op.generate(
        chain,
        validParams({ remoteChainSelectorsToRemove: [0n], chainsToAdd: [] }),
      )
      const [removals, adds] = FRESH_V1_5_1.decodeFunctionData(
        'applyChainUpdates',
        unsigned.transactions[0]!.data!,
      )
      assert.deepEqual([...(removals as bigint[])], [0n])
      assert.equal((adds as unknown[]).length, 0)
    })

    it('keeps the wholesale-replace idiom: one selector in both arrays at once', async () => {
      const { chain } = stubChain()
      const unsigned = await op.generate(
        chain,
        validParams({ remoteChainSelectorsToRemove: [SEL_A], chainsToAdd: [add(SEL_A)] }),
      )
      const [removals, adds] = FRESH_V1_5_1.decodeFunctionData(
        'applyChainUpdates',
        unsigned.transactions[0]!.data!,
      )
      assert.deepEqual([...(removals as bigint[])], [SEL_A])
      const [entry] = adds as [{ remoteChainSelector: bigint }]
      assert.equal(entry.remoteChainSelector, SEL_A)
    })

    it('rejects the zero pool address before any RPC', async () => {
      const { chain, probes } = stubChain()
      await assert.rejects(
        () => op.generate(chain, validParams({ poolAddress: ZeroAddress })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'poolAddress',
      )
      assert.equal(probes(), 0)
    })
  })

  describe('execute', () => {
    it('signs and submits, resolving to the tx hash', async () => {
      assert.deepEqual(
        await op.execute(stubChain().chain, {
          ...validParams({ sender: undefined }),
          wallet: fakeSigner(),
        }),
        { hash: HASH },
      )
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain().chain, {
            ...validParams({ sender: undefined }),
            wallet: fakeSigner(makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'applyChainUpdates',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain().chain, { ...validParams(), wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain().chain, {
            ...validParams({ sender: NOT_OWNER }),
            wallet: fakeSigner(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool owner', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(TokenPoolVersion.V1_5_1, 'BurnMint', NOT_OWNER).chain, {
            ...validParams({ sender: undefined }),
            wallet: fakeSigner(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'sender',
      )
    })
  })

  /**
   * A v1.5.0 pool takes the same params as every other version, adapted to its `chains` array:
   * removals first, as `allowed: false` lanes, then additions as `allowed: true` ones.
   *
   * v1.5.0 validates BOTH directions with
   * `RateLimiter._validateTokenBucketConfig(config, mustBeDisabled: !update.allowed)`, which
   * reverts `RateLimitMustBeDisabled()` when `isEnabled && mustBeDisabled` — so a removal must go
   * out with both rate limits disabled. Its remote addresses are ignored on-chain, so they go out
   * empty, which keeps a lane of `0n` or of a chain the SDK does not know removable.
   */
  describe('v1.5.0 pools: params adapted to the legacy chains array', () => {
    type LegacyLane = {
      remoteChainSelector: bigint
      allowed: boolean
      remotePoolAddress: string
      remoteTokenAddress: string
      inboundRateLimiterConfig: { isEnabled: boolean; capacity: bigint; rate: bigint }
      outboundRateLimiterConfig: { isEnabled: boolean; capacity: bigint; rate: bigint }
    }
    const decode = (data: string) =>
      (FRESH_V1_5_0.decodeFunctionData('applyChainUpdates', data)[0] as LegacyLane[]).map(
        (lane) => ({
          remoteChainSelector: lane.remoteChainSelector,
          allowed: lane.allowed,
          remotePoolAddress: lane.remotePoolAddress,
          remoteTokenAddress: lane.remoteTokenAddress,
          inbound: lane.inboundRateLimiterConfig.isEnabled,
          outbound: lane.outboundRateLimiterConfig.isEnabled,
        }),
      )

    it('removes a 0n or unknown-chain lane, with empty addresses and both rate limits disabled', async () => {
      const unsigned = await op.generate(
        stubChain(V1_5_0).chain,
        validParams({ remoteChainSelectorsToRemove: [0n, 2n ** 63n], chainsToAdd: [] }),
      )
      const removal = { allowed: false, remotePoolAddress: '0x', remoteTokenAddress: '0x' }
      assert.deepEqual(decode(unsigned.transactions[0]!.data!), [
        { remoteChainSelector: 0n, ...removal, inbound: false, outbound: false },
        { remoteChainSelector: 2n ** 63n, ...removal, inbound: false, outbound: false },
      ])
    })

    it('keeps the wholesale-replace idiom: the removal precedes the re-add', async () => {
      const unsigned = await op.generate(
        stubChain(V1_5_0).chain,
        validParams({ remoteChainSelectorsToRemove: [SEL_A], chainsToAdd: [addEntry()] }),
      )
      assert.deepEqual(
        decode(unsigned.transactions[0]!.data!).map(({ remoteChainSelector, allowed }) => [
          remoteChainSelector,
          allowed,
        ]),
        [
          [SEL_A, false],
          [SEL_A, true],
        ],
      )
    })

    it('rejects a lane with several remote pools, before the owner probe', async () => {
      // owner() reports NOT_OWNER, so a `sender` error would mean the owner probe ran first
      await assert.rejects(
        () =>
          op.generate(
            stubChain(V1_5_0, 'BurnMint', NOT_OWNER).chain,
            validParams({
              chainsToAdd: [{ ...addEntry(), remotePoolAddresses: [REMOTE_POOL_1, REMOTE_POOL_2] }],
            }),
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'chainsToAdd[0].remotePoolAddresses',
      )
    })

    for (const version of [V1_5_1, V1_6_1, V2_0_0] as const) {
      it(`accepts several remote pools per lane on a v${version} pool`, async () => {
        const unsigned = await op.generate(
          stubChain(version).chain,
          validParams({
            chainsToAdd: [{ ...addEntry(), remotePoolAddresses: [REMOTE_POOL_1, REMOTE_POOL_2] }],
          }),
        )
        assert.equal(unsigned.transactions[0]!.data, dataV1_5_1([REMOTE_POOL_1, REMOTE_POOL_2]))
      })
    }
  })

  /**
   * The enabled-bucket rate bound is version-dependent, so it is applied in the encoder (the first
   * place the pool version is known) rather than in `prepare()`:
   *
   * - v1.5.0/v1.5.1 revert `InvalidRateLimitRate` unless `0 < rate < capacity`.
   * - v1.6.1/v2.0.0 only revert on `rate > capacity`, so `rate === capacity` and `rate === 0n` are
   *   legitimate — the accept-side cases below exist so nobody tightens the rule globally.
   */
  describe('version-specific rate-limit bounds', () => {
    const STRICT_CASES = [
      { label: 'rate === capacity', limit: { enabled: true, capacity: 10n, rate: 10n } },
      { label: 'a zero rate', limit: { enabled: true, capacity: 10n, rate: 0n } },
    ] as const

    for (const { label, limit } of STRICT_CASES) {
      for (const version of [V1_5_0, V1_5_1] as const) {
        it(`rejects ${label} on a v${version} pool`, async () => {
          await assert.rejects(
            () =>
              op.generate(
                stubChain(version).chain,
                validParams({
                  chainsToAdd: [{ ...addEntry(), inboundRateLimiterConfig: limit }],
                }),
              ),
            (err: unknown) =>
              err instanceof CCTParamsInvalidError &&
              err.context.operation === 'applyChainUpdates' &&
              err.context.param === 'chainsToAdd[0].inboundRateLimiterConfig.rate',
          )
        })
      }

      it(`rejects ${label} on a siloed v1.6.0 pool, which kept the strict bound`, async () => {
        await assert.rejects(
          () =>
            op.generate(
              stubChain(TokenPoolVersion.V1_6_0, 'SiloedLockRelease').chain,
              validParams({
                chainsToAdd: [{ ...addEntry(), inboundRateLimiterConfig: limit }],
              }),
            ),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyChainUpdates' &&
            err.context.param === 'chainsToAdd[0].inboundRateLimiterConfig.rate',
        )
      })

      for (const version of [TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0] as const) {
        it(`accepts ${label} on a v${version} pool`, async () => {
          const unsigned = await op.generate(
            stubChain(version).chain,
            validParams({
              remoteChainSelectorsToRemove: [],
              chainsToAdd: [{ ...addEntry(), inboundRateLimiterConfig: limit }],
            }),
          )
          assert.equal(
            unsigned.transactions[0]!.data,
            FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
              [],
              [
                {
                  remoteChainSelector: SEL_A,
                  remotePoolAddresses: [pad(REMOTE_POOL_1)],
                  remoteTokenAddress: pad(REMOTE_TOKEN),
                  outboundRateLimiterConfig: ABI_OUTBOUND,
                  inboundRateLimiterConfig: {
                    isEnabled: true,
                    capacity: limit.capacity,
                    rate: limit.rate,
                  },
                },
              ],
            ]),
          )
        })
      }
    }

    it('floor-matches a siloed v1.6.0 pool to the v1.5.1 shape', async () => {
      const valid = { enabled: true, capacity: 10n, rate: 9n } as const
      const unsigned = await op.generate(
        stubChain(TokenPoolVersion.V1_6_0, 'SiloedLockRelease').chain,
        validParams({
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [{ ...addEntry(), inboundRateLimiterConfig: valid }],
        }),
      )
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
          [],
          [
            {
              remoteChainSelector: SEL_A,
              remotePoolAddresses: [pad(REMOTE_POOL_1)],
              remoteTokenAddress: pad(REMOTE_TOKEN),
              outboundRateLimiterConfig: ABI_OUTBOUND,
              inboundRateLimiterConfig: { isEnabled: true, capacity: 10n, rate: 9n },
            },
          ],
        ]),
      )
    })

    it('still rejects rate > capacity on a v2.0.0 pool', async () => {
      await assert.rejects(
        () =>
          op.generate(
            stubChain(TokenPoolVersion.V2_0_0).chain,
            validParams({
              chainsToAdd: [
                {
                  ...addEntry(),
                  inboundRateLimiterConfig: { enabled: true, capacity: 10n, rate: 11n },
                },
              ],
            }),
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'chainsToAdd[0].inboundRateLimiterConfig.rate',
      )
    })
  })

  describe('version dispatch', () => {
    for (const { version, data } of DISPATCH) {
      const shape = version === TokenPoolVersion.V1_5_0 ? 'chains[]' : 'add/remove'

      it(`picks the ${shape} encoder for a v${version} pool`, async () => {
        const unsigned = await op.generate(stubChain(version).chain, validParams())
        assert.equal(unsigned.transactions[0]!.data, data)
        // the two signatures have different selectors, so this pins the encoder, not just the args
        assert.equal(
          unsigned.transactions[0]!.data.slice(0, 10),
          version === TokenPoolVersion.V1_5_0 ? '0xdb6327dc' : '0xe8a1da17',
        )
      })
    }
  })

  /**
   * The one param shape must reach the right signature for every recognized (pool type × version)
   * combination. The signature depends only on the version — v1.5.0 → the `chains` array,
   * everything from v1.5.1 up → the `chainsToAdd`/`remoteChainSelectorsToRemove` pair — but the
   * full type matrix is exercised so the pool-type resolution that picks it is covered for each.
   */
  describe('type × version matrix', () => {
    /** Every recognized pool type, with the versions it exists at and its ABI family. */
    const MATRIX = [
      { type: 'BurnMintTokenPool', family: 'BurnMint', versions: [V1_5_0, V1_5_1, V1_6_1, V2_0_0] },
      {
        type: 'BurnFromMintTokenPool',
        family: 'BurnMint',
        versions: [V1_5_0, V1_5_1, V1_6_1, V2_0_0],
      },
      {
        type: 'BurnWithFromMintTokenPool',
        family: 'BurnMint',
        versions: [V1_5_0, V1_5_1, V1_6_1, V2_0_0],
      },
      {
        type: 'LockReleaseTokenPool',
        family: 'LockRelease',
        versions: [V1_5_0, V1_5_1, V1_6_1, V2_0_0],
      },
      { type: 'BurnToAddressTokenPool', family: 'BurnMint', versions: [V1_5_1, V1_6_1, V2_0_0] },
      {
        type: 'BurnMintWithLockReleaseFlagTokenPool',
        family: 'BurnMint',
        versions: [V1_5_1, V1_6_1, V2_0_0],
      },
      {
        type: 'SiloedLockReleaseTokenPool',
        family: 'SiloedLockRelease',
        versions: [V1_6_0, V1_6_1, V2_0_0],
      },
    ] as const satisfies ReadonlyArray<{
      type: string
      family: TokenPoolFamily
      versions: readonly TokenPoolVersion[]
    }>

    for (const { type, family, versions } of MATRIX) {
      for (const version of versions) {
        it(`v${version} ${type}: encodes the v${version === V1_5_0 ? V1_5_0 : V1_5_1} signature`, async () => {
          const unsigned = await op.generate(
            stubChain(version, family, OWNER, type).chain,
            validParams(),
          )
          assert.equal(
            unsigned.transactions[0]!.data,
            version === V1_5_0 ? DATA_V1_5_0 : DATA_V1_5_1,
          )
        })
      }
    }
  })
})

/** One valid addition, to spread invalid fields over. */
function addEntry() {
  return {
    remoteChainSelector: SEL_A,
    remoteTokenAddress: REMOTE_TOKEN,
    remotePoolAddresses: [REMOTE_POOL_1],
    inboundRateLimiterConfig: INBOUND,
    outboundRateLimiterConfig: OUTBOUND,
  }
}
