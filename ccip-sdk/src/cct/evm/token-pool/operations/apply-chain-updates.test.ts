import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError, toBeHex } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { type ApplyChainUpdatesParams, ApplyChainUpdates } from './apply-chain-updates.ts'

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
const REMOTE_POOL_2 = '0x' + 'cc'.repeat(32) // a 32-byte (non-EVM) remote pool

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

const DATA_V1_5_0 = FRESH_V1_5_0.encodeFunctionData('applyChainUpdates', [
  [
    {
      remoteChainSelector: SEL_A,
      allowed: true,
      remotePoolAddress: REMOTE_POOL_1,
      remoteTokenAddress: REMOTE_TOKEN,
      outboundRateLimiterConfig: ABI_OUTBOUND,
      inboundRateLimiterConfig: ABI_INBOUND,
    },
    {
      remoteChainSelector: SEL_B,
      allowed: false,
      remotePoolAddress: REMOTE_POOL_1,
      remoteTokenAddress: REMOTE_TOKEN,
      outboundRateLimiterConfig: ABI_OUTBOUND,
      inboundRateLimiterConfig: ABI_OUTBOUND,
    },
  ],
])

const DATA_V1_5_1 = FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
  [SEL_B],
  [
    {
      remoteChainSelector: SEL_A,
      remotePoolAddresses: [REMOTE_POOL_1, REMOTE_POOL_2],
      remoteTokenAddress: REMOTE_TOKEN,
      outboundRateLimiterConfig: ABI_OUTBOUND,
      inboundRateLimiterConfig: ABI_INBOUND,
    },
  ],
])

/** The v1.5.0 params whose expected calldata is {@link DATA_V1_5_0}. */
function paramsV1_5_0(overrides: Record<string, unknown> = {}): ApplyChainUpdatesParams {
  return {
    version: TokenPoolVersion.V1_5_0,
    poolAddress: POOL,
    sender: OWNER,
    chains: [
      {
        remoteChainSelector: SEL_A,
        allowed: true,
        remoteTokenAddress: REMOTE_TOKEN,
        remotePoolAddress: REMOTE_POOL_1,
        inboundRateLimiterConfig: INBOUND,
        outboundRateLimiterConfig: OUTBOUND,
      },
      {
        remoteChainSelector: SEL_B,
        allowed: false,
        remoteTokenAddress: REMOTE_TOKEN,
        remotePoolAddress: REMOTE_POOL_1,
        inboundRateLimiterConfig: OUTBOUND,
        outboundRateLimiterConfig: OUTBOUND,
      },
    ],
    ...overrides,
  }
}

/** The v1.5.1+ params whose expected calldata is {@link DATA_V1_5_1}. */
function paramsV1_5_1(overrides: Record<string, unknown> = {}): ApplyChainUpdatesParams {
  return {
    version: TokenPoolVersion.V1_5_1,
    poolAddress: POOL,
    sender: OWNER,
    remoteChainSelectorsToRemove: [SEL_B],
    chainsToAdd: [
      {
        remoteChainSelector: SEL_A,
        remoteTokenAddress: REMOTE_TOKEN,
        remotePoolAddresses: [REMOTE_POOL_1, REMOTE_POOL_2],
        inboundRateLimiterConfig: INBOUND,
        outboundRateLimiterConfig: OUTBOUND,
      },
    ],
    ...overrides,
  }
}

/** Pool contract type reported per ABI family, both of which exist at every supported version. */
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * The `owner()`/getter results `GetTokenPoolState` reads, encoded per version generation: v2.0.0
 * folds router + both admin roles into `getDynamicConfig` and adds the finality window, where the
 * legacy versions have standalone getters.
 */
function poolStateReads(version: TokenPoolVersion, family: TokenPoolFamily): Map<string, string> {
  const responses = new Map<string, string>()
  const iface = TOKEN_POOL_INTERFACES[family][version]
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
): Stub {
  let probes = 0
  const responses = poolStateReads(version, family)
  if (owner !== OWNER) {
    const iface = TOKEN_POOL_INTERFACES[family][version]
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
    typeAndVersion: () => {
      probes++
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
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

/** Every supported pool version, paired with the parameter shape and calldata it expects. */
const DISPATCH = [
  {
    version: TokenPoolVersion.V1_5_0,
    params: paramsV1_5_0,
    data: DATA_V1_5_0,
    otherParams: paramsV1_5_1,
  },
  {
    version: TokenPoolVersion.V1_5_1,
    params: paramsV1_5_1,
    data: DATA_V1_5_1,
    otherParams: paramsV1_5_0,
  },
  {
    version: TokenPoolVersion.V1_6_1,
    params: paramsV1_5_1,
    data: DATA_V1_5_1,
    otherParams: paramsV1_5_0,
  },
  {
    version: TokenPoolVersion.V2_0_0,
    params: paramsV1_5_1,
    data: DATA_V1_5_1,
    otherParams: paramsV1_5_0,
  },
] as const

describe('ApplyChainUpdates (cct/evm)', () => {
  describe('generate', () => {
    for (const { version, params, data } of DISPATCH) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes applyChainUpdates for a v${version} ${family} pool`, async () => {
          const { chain } = stubChain(version, family)
          const unsigned = await op.generate(chain, params())
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, data)
        })
      }

      it(`encodes identical calldata for both ABI families at v${version}`, async () => {
        const burnMint = await op.generate(stubChain(version, 'BurnMint').chain, params())
        const lockRelease = await op.generate(stubChain(version, 'LockRelease').chain, params())
        assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
        assert.equal(burnMint.transactions[0]!.data, data)
      })
    }

    it('omits from when sender is not supplied, and skips the owner probe', async () => {
      const { chain } = stubChain(TokenPoolVersion.V1_5_1, 'BurnMint', NOT_OWNER)
      // owner() reports NOT_OWNER, so this only builds because no sender was given to check
      const unsigned = await op.generate(chain, paramsV1_5_1({ sender: undefined }))
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, DATA_V1_5_1)
    })

    it('normalises 0x-less and upper-case hex remote addresses', async () => {
      const { chain } = stubChain()
      const unsigned = await op.generate(
        chain,
        paramsV1_5_1({
          chainsToAdd: [
            {
              remoteChainSelector: SEL_A,
              remoteTokenAddress: 'AA'.repeat(20),
              remotePoolAddresses: ['0X' + 'BB'.repeat(20), REMOTE_POOL_2],
              inboundRateLimiterConfig: INBOUND,
              outboundRateLimiterConfig: OUTBOUND,
            },
          ],
        }),
      )
      assert.equal(unsigned.transactions[0]!.data, DATA_V1_5_1)
    })

    it('accepts uint128 max for both rate-limit amounts', async () => {
      // the widest legal RateLimiter.Config; rate === capacity, so only a v1.6.1+ pool takes it
      const UINT128_MAX = 2n ** 128n - 1n
      const unsigned = await op.generate(
        stubChain(TokenPoolVersion.V1_6_1).chain,
        paramsV1_5_1({
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
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
              remotePoolAddresses: [REMOTE_POOL_1],
              remoteTokenAddress: REMOTE_TOKEN,
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
        () => op.generate(chain, paramsV1_5_1()),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('validation', () => {
    const cases: [string, ApplyChainUpdatesParams][] = [
      ['poolAddress', paramsV1_5_1({ poolAddress: 'not-an-address' })],
      ['sender', paramsV1_5_1({ sender: 'not-an-address' })],
      ['version', paramsV1_5_1({ version: '1.6.1' })],
      ['chainsToAdd', paramsV1_5_1({ chainsToAdd: 'nope' })],
      ['remoteChainSelectorsToRemove', paramsV1_5_1({ remoteChainSelectorsToRemove: 'nope' })],
      ['chainsToAdd', paramsV1_5_1({ chainsToAdd: [], remoteChainSelectorsToRemove: [] })],
      ['remoteChainSelectorsToRemove[0]', paramsV1_5_1({ remoteChainSelectorsToRemove: [1] })],
      ['chainsToAdd[0]', paramsV1_5_1({ chainsToAdd: [null] })],
      [
        'chainsToAdd[0].remoteChainSelector',
        paramsV1_5_1({
          chainsToAdd: [{ ...paramsV1_5_1AddEntry(), remoteChainSelector: -1n }],
        }),
      ],
      [
        'chainsToAdd[0].remotePoolAddresses',
        paramsV1_5_1({ chainsToAdd: [{ ...paramsV1_5_1AddEntry(), remotePoolAddresses: [] }] }),
      ],
      [
        'chainsToAdd[0].remotePoolAddresses[0]',
        paramsV1_5_1({
          chainsToAdd: [{ ...paramsV1_5_1AddEntry(), remotePoolAddresses: ['0xabc'] }],
        }),
      ],
      [
        'chainsToAdd[0].remotePoolAddresses[1]',
        paramsV1_5_1({
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
              remotePoolAddresses: [REMOTE_POOL_1, '0X' + 'BB'.repeat(20)],
            },
          ],
        }),
      ],
      [
        'chainsToAdd[0].remoteTokenAddress',
        paramsV1_5_1({ chainsToAdd: [{ ...paramsV1_5_1AddEntry(), remoteTokenAddress: '' }] }),
      ],
      [
        'chainsToAdd[0].inboundRateLimiterConfig.enabled',
        paramsV1_5_1({
          chainsToAdd: [{ ...paramsV1_5_1AddEntry(), inboundRateLimiterConfig: {} }],
        }),
      ],
      [
        'chainsToAdd[0].outboundRateLimiterConfig.rate',
        paramsV1_5_1({
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
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
        paramsV1_5_1({ remoteChainSelectorsToRemove: [2n ** 64n] }),
      ],
      [
        'chainsToAdd[0].remoteChainSelector',
        paramsV1_5_1({
          chainsToAdd: [{ ...paramsV1_5_1AddEntry(), remoteChainSelector: 2n ** 64n }],
        }),
      ],
      [
        'chainsToAdd[0].inboundRateLimiterConfig.capacity',
        paramsV1_5_1({
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
              inboundRateLimiterConfig: { enabled: true, capacity: 2n ** 128n, rate: 1n },
            },
          ],
        }),
      ],
      // an enabled config defaults nothing, so an omitted amount is blamed by the bound check
      [
        'chainsToAdd[0].inboundRateLimiterConfig.rate',
        paramsV1_5_1({
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
              inboundRateLimiterConfig: { enabled: true, capacity: 1n },
            },
          ],
        }),
      ],
      // a disabled config must be all-zero, and the whole direction is blamed, not one amount
      [
        'chainsToAdd[0].outboundRateLimiterConfig',
        paramsV1_5_1({
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
              outboundRateLimiterConfig: { enabled: false, capacity: 1n },
            },
          ],
        }),
      ],
      ['chains', paramsV1_5_0({ chains: [] })],
      ['chains[0]', paramsV1_5_0({ chains: ['nope'] })],
      [
        'chains[0].remoteChainSelector',
        paramsV1_5_0({ chains: [{ ...paramsV1_5_0Entry(), remoteChainSelector: 1 }] }),
      ],
      ['chains[0].allowed', paramsV1_5_0({ chains: [{ ...paramsV1_5_0Entry(), allowed: 'yes' }] })],
      [
        'chains[0].remotePoolAddress',
        paramsV1_5_0({ chains: [{ ...paramsV1_5_0Entry(), remotePoolAddress: '0x' }] }),
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

    /** A v1.5.0 lane whose rate limits are both disabled, so `allowed: false` stays legal. */
    const lane = (remoteChainSelector: bigint, allowed: boolean) => ({
      ...paramsV1_5_0Entry(),
      remoteChainSelector,
      allowed,
      inboundRateLimiterConfig: OUTBOUND,
      outboundRateLimiterConfig: OUTBOUND,
    })
    const add = (remoteChainSelector: bigint) => ({
      ...paramsV1_5_1AddEntry(),
      remoteChainSelector,
    })

    const cases: [string, string, ApplyChainUpdatesParams][] = [
      [
        'a hole in chainsToAdd',
        'chainsToAdd[1]',
        paramsV1_5_1({ chainsToAdd: sparse(add(SEL_A), add(SEL_B)) }),
      ],
      [
        'a hole in remoteChainSelectorsToRemove',
        'remoteChainSelectorsToRemove[1]',
        paramsV1_5_1({ remoteChainSelectorsToRemove: sparse(SEL_A, SEL_B) }),
      ],
      [
        "a hole in a lane's remotePoolAddresses",
        'chainsToAdd[0].remotePoolAddresses[1]',
        paramsV1_5_1({
          chainsToAdd: [
            {
              ...paramsV1_5_1AddEntry(),
              remotePoolAddresses: sparse(REMOTE_POOL_1, REMOTE_POOL_2),
            },
          ],
        }),
      ],
      [
        'a hole in the v1.5.0 chains array',
        'chains[1]',
        paramsV1_5_0({ chains: sparse(lane(SEL_A, true), lane(SEL_B, true)) }),
      ],
      [
        'a 0n selector in chainsToAdd',
        'chainsToAdd[0].remoteChainSelector',
        paramsV1_5_1({ chainsToAdd: [add(0n)] }),
      ],
      [
        'a 0n selector on a v1.5.0 lane being added',
        'chains[0].remoteChainSelector',
        paramsV1_5_0({ chains: [lane(0n, true)] }),
      ],
      [
        'a repeated selector in chainsToAdd',
        'chainsToAdd[1].remoteChainSelector',
        paramsV1_5_1({ chainsToAdd: [add(SEL_A), add(SEL_A)] }),
      ],
      [
        'a repeated selector in remoteChainSelectorsToRemove',
        'remoteChainSelectorsToRemove[1]',
        paramsV1_5_1({ remoteChainSelectorsToRemove: [SEL_A, SEL_A] }),
      ],
      [
        'a repeated selector in the v1.5.0 chains array',
        'chains[1].remoteChainSelector',
        paramsV1_5_0({ chains: [lane(SEL_A, true), lane(SEL_A, false)] }),
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
        paramsV1_5_1({ remoteChainSelectorsToRemove: [0n], chainsToAdd: [] }),
      )
      const [removals, adds] = FRESH_V1_5_1.decodeFunctionData(
        'applyChainUpdates',
        unsigned.transactions[0]!.data!,
      )
      assert.deepEqual([...(removals as bigint[])], [0n])
      assert.equal((adds as unknown[]).length, 0)
    })

    it('accepts a v1.5.0 removal of a 0n lane, where allowed: false is the removal', async () => {
      const { chain } = stubChain(TokenPoolVersion.V1_5_0)
      const unsigned = await op.generate(chain, paramsV1_5_0({ chains: [lane(0n, false)] }))
      const [chains] = FRESH_V1_5_0.decodeFunctionData(
        'applyChainUpdates',
        unsigned.transactions[0]!.data!,
      )
      const [entry] = chains as [{ remoteChainSelector: bigint; allowed: boolean }]
      assert.equal(entry.remoteChainSelector, 0n)
      assert.equal(entry.allowed, false)
    })

    it('keeps the wholesale-replace idiom: one selector in both arrays at once', async () => {
      const { chain } = stubChain()
      const unsigned = await op.generate(
        chain,
        paramsV1_5_1({ remoteChainSelectorsToRemove: [SEL_A], chainsToAdd: [add(SEL_A)] }),
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
        () => op.generate(chain, paramsV1_5_1({ poolAddress: ZeroAddress })),
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
          ...paramsV1_5_1({ sender: undefined }),
          wallet: fakeSigner(),
        }),
        { hash: HASH },
      )
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain().chain, {
            ...paramsV1_5_1({ sender: undefined }),
            wallet: fakeSigner(makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'applyChainUpdates',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain().chain, { ...paramsV1_5_1(), wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain().chain, {
            ...paramsV1_5_1({ sender: NOT_OWNER }),
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
            ...paramsV1_5_1({ sender: undefined }),
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
   * v1.5.0's `applyChainUpdates` validates BOTH directions with
   * `RateLimiter._validateTokenBucketConfig(config, mustBeDisabled: !update.allowed)`, which
   * reverts `RateLimitMustBeDisabled()` when `isEnabled && mustBeDisabled`. A removal carrying a
   * lane's current (enabled) limits — the obvious way to write one, by reading the lane back and
   * flipping `allowed` — therefore always reverts, so it has to fail locally instead.
   *
   * v1.5.1+ has no such rule: removals there are a separate `remoteChainSelectorsToRemove` array
   * and the shape has no `allowed` bit at all, so there is nothing to apply it to.
   */
  describe('v1.5.0 lane removal requires both rate limits disabled', () => {
    const removal = (overrides: Record<string, unknown>) =>
      paramsV1_5_0({
        chains: [{ ...paramsV1_5_0Entry(), allowed: false, ...overrides }],
      })

    for (const direction of ['inboundRateLimiterConfig', 'outboundRateLimiterConfig'] as const) {
      it(`rejects allowed: false with an enabled ${direction}, before any RPC`, async () => {
        const { chain, probes } = stubChain(TokenPoolVersion.V1_5_0)
        await assert.rejects(
          () =>
            op.generate(
              chain,
              removal({
                inboundRateLimiterConfig: { enabled: false },
                outboundRateLimiterConfig: { enabled: false },
                [direction]: { enabled: true, capacity: 100_000n, rate: 167n },
              }),
            ),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyChainUpdates' &&
            err.context.param === `chains[0].${direction}`,
        )
        assert.equal(probes(), 0, 'the rule needs no version, so it must fail before any RPC')
      })
    }

    it('accepts allowed: false when both directions are disabled', async () => {
      const { chain } = stubChain(TokenPoolVersion.V1_5_0)
      const unsigned = await op.generate(
        chain,
        removal({
          inboundRateLimiterConfig: { enabled: false },
          outboundRateLimiterConfig: { enabled: false },
        }),
      )
      assert.equal(unsigned.transactions[0]!.data!.slice(0, 10), '0xdb6327dc')
    })

    it('does not constrain enabled limits when allowed is true', async () => {
      const { chain } = stubChain(TokenPoolVersion.V1_5_0)
      const unsigned = await op.generate(
        chain,
        paramsV1_5_0({ chains: [{ ...paramsV1_5_0Entry(), allowed: true }] }),
      )
      assert.equal(unsigned.transactions[0]!.data!.slice(0, 10), '0xdb6327dc')
    })
  })

  /**
   * The enabled-bucket rate bound is version-dependent, so it is applied in the encoder (the first
   * place the pool version is known) rather than in `validate()`:
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
      it(`rejects ${label} on a v1.5.0 pool`, async () => {
        await assert.rejects(
          () =>
            op.generate(
              stubChain(TokenPoolVersion.V1_5_0).chain,
              paramsV1_5_0({
                chains: [{ ...paramsV1_5_0Entry(), inboundRateLimiterConfig: limit }],
              }),
            ),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyChainUpdates' &&
            err.context.param === 'chains[0].inboundRateLimiterConfig.rate',
        )
      })

      it(`rejects ${label} on a v1.5.1 pool`, async () => {
        await assert.rejects(
          () =>
            op.generate(
              stubChain(TokenPoolVersion.V1_5_1).chain,
              paramsV1_5_1({
                chainsToAdd: [{ ...paramsV1_5_1AddEntry(), inboundRateLimiterConfig: limit }],
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
            paramsV1_5_1({
              remoteChainSelectorsToRemove: [],
              chainsToAdd: [{ ...paramsV1_5_1AddEntry(), inboundRateLimiterConfig: limit }],
            }),
          )
          assert.equal(
            unsigned.transactions[0]!.data,
            FRESH_V1_5_1.encodeFunctionData('applyChainUpdates', [
              [],
              [
                {
                  remoteChainSelector: SEL_A,
                  remotePoolAddresses: [REMOTE_POOL_1],
                  remoteTokenAddress: REMOTE_TOKEN,
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

    it('still rejects rate > capacity on a v2.0.0 pool', async () => {
      await assert.rejects(
        () =>
          op.generate(
            stubChain(TokenPoolVersion.V2_0_0).chain,
            paramsV1_5_1({
              chainsToAdd: [
                {
                  ...paramsV1_5_1AddEntry(),
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
    for (const { version, params, data, otherParams } of DISPATCH) {
      const shape = version === TokenPoolVersion.V1_5_0 ? 'chains[]' : 'add/remove'

      it(`picks the ${shape} encoder for a v${version} pool`, async () => {
        const unsigned = await op.generate(stubChain(version).chain, params())
        assert.equal(unsigned.transactions[0]!.data, data)
        // the two signatures have different selectors, so this pins the encoder, not just the args
        assert.equal(
          unsigned.transactions[0]!.data.slice(0, 10),
          version === TokenPoolVersion.V1_5_0 ? '0xdb6327dc' : '0xe8a1da17',
        )
      })

      it(`rejects the wrong declared version for a v${version} pool`, async () => {
        await assert.rejects(
          () => op.generate(stubChain(version).chain, otherParams()),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyChainUpdates' &&
            err.context.param === 'version',
        )
      })
    }
  })
})

/** One valid v1.5.1 addition, to spread invalid fields over. */
function paramsV1_5_1AddEntry() {
  return {
    remoteChainSelector: SEL_A,
    remoteTokenAddress: REMOTE_TOKEN,
    remotePoolAddresses: [REMOTE_POOL_1],
    inboundRateLimiterConfig: INBOUND,
    outboundRateLimiterConfig: OUTBOUND,
  }
}

/** One valid v1.5.0 lane update, to spread invalid fields over. */
function paramsV1_5_0Entry() {
  return {
    remoteChainSelector: SEL_A,
    allowed: true,
    remoteTokenAddress: REMOTE_TOKEN,
    remotePoolAddress: REMOTE_POOL_1,
    inboundRateLimiterConfig: INBOUND,
    outboundRateLimiterConfig: OUTBOUND,
  }
}
