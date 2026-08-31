import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import {
  type ChainRateLimitUpdate,
  type SetChainRateLimiterConfigsParams,
  SetChainRateLimiterConfigs,
} from './set-chain-rate-limiter-configs.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const RMN_PROXY = '0x' + '55'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '66'.repeat(20)
const FEE_ADMIN = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const ETHEREUM = 5009297550715157269n
const SEPOLIA = 16015286601757825753n

/** Two lanes: one enabled with amounts, one disabled with its amounts omitted. */
const UPDATES: ChainRateLimitUpdate[] = [
  {
    remoteChainSelector: ETHEREUM,
    outboundRateLimiterConfig: { enabled: true, capacity: 1_000_000n, rate: 100n },
    inboundRateLimiterConfig: { enabled: true, capacity: 2_000_000n, rate: 200n },
  },
  {
    remoteChainSelector: SEPOLIA,
    outboundRateLimiterConfig: { enabled: false },
    inboundRateLimiterConfig: { enabled: false },
  },
]

/**
 * Expected v1.5.1/v1.6.1 calldata, from a FRESH Interface written off the human-readable
 * signature — never the SDK's own cached one, which would make this a tautology.
 */
const BATCH_DATA = new Interface([
  'function setChainRateLimiterConfigs(uint64[] remoteChainSelectors, (bool isEnabled, uint128 capacity, uint128 rate)[] outboundConfigs, (bool isEnabled, uint128 capacity, uint128 rate)[] inboundConfigs)',
]).encodeFunctionData('setChainRateLimiterConfigs', [
  [ETHEREUM, SEPOLIA],
  [
    [true, 1_000_000n, 100n],
    [false, 0n, 0n],
  ],
  [
    [true, 2_000_000n, 200n],
    [false, 0n, 0n],
  ],
])

/** Expected v2.0.0 calldata, likewise from a fresh Interface; `fastFinality` defaults to false. */
const v2Data = (fastFinality: [boolean, boolean] = [false, false]) =>
  new Interface([
    'function setRateLimitConfig((uint64 remoteChainSelector, bool fastFinality, (bool isEnabled, uint128 capacity, uint128 rate) outboundRateLimiterConfig, (bool isEnabled, uint128 capacity, uint128 rate) inboundRateLimiterConfig)[] rateLimitConfigArgs)',
  ]).encodeFunctionData('setRateLimitConfig', [
    [
      [ETHEREUM, fastFinality[0], [true, 1_000_000n, 100n], [true, 2_000_000n, 200n]],
      [SEPOLIA, fastFinality[1], [false, 0n, 0n], [false, 0n, 0n]],
    ],
  ])

/**
 * Expected v1.5.0 calldata, from a fresh Interface off the singular signature. v1.5.0 sets one
 * lane per call, so this carries only the first of the two {@link UPDATES} lanes.
 */
const SINGLE_DATA_V1_5_0 = new Interface([
  'function setChainRateLimiterConfig(uint64 remoteChainSelector, (bool isEnabled, uint128 capacity, uint128 rate) outboundConfig, (bool isEnabled, uint128 capacity, uint128 rate) inboundConfig)',
]).encodeFunctionData('setChainRateLimiterConfig', [
  ETHEREUM,
  [true, 1_000_000n, 100n],
  [true, 2_000_000n, 200n],
])

/** Getters the role check reads, as `functionName -> return values` (ABI-encoded on demand). */
type Reads = Record<string, unknown[]>

/** v2.0.0 pool state: the rate-limit role comes out of `getDynamicConfig`. */
const readsV2_0_0 = (rateLimitAdmin = RATE_LIMIT_ADMIN, owner = OWNER): Reads => ({
  getToken: [TOKEN],
  owner: [owner],
  getRmnProxy: [RMN_PROXY],
  getTokenDecimals: [18],
  getSupportedChains: [[ETHEREUM, SEPOLIA]],
  getDynamicConfig: [ROUTER, rateLimitAdmin, FEE_ADMIN],
  getAllowedFinalityConfig: ['0x00000000'],
})

/**
 * Legacy (pre-2.0.0) pool state: the rate-limit role has its own standalone `getRateLimitAdmin()`
 * getter, decoded as a bare address rather than out of a `getDynamicConfig` triple.
 */
const readsLegacy = (rateLimitAdmin = RATE_LIMIT_ADMIN, owner = OWNER): Reads => ({
  getToken: [TOKEN],
  owner: [owner],
  getRouter: [ROUTER],
  getRmnProxy: [RMN_PROXY],
  getRateLimitAdmin: [rateLimitAdmin],
  getSupportedChains: [[ETHEREUM, SEPOLIA]],
})

/**
 * Just the two getters `buildUnsigned`'s owner-or-rateLimitAdmin pre-flight reads, per version
 * generation. The default for {@link stubChain}: since the role check moved out of `execute` and
 * into `buildUnsigned`, every `generate` with a `sender` needs them answered.
 */
const roleReads = (
  version: TokenPoolVersion,
  {
    owner = OWNER,
    rateLimitAdmin = RATE_LIMIT_ADMIN,
  }: { owner?: string; rateLimitAdmin?: string } = {},
): Reads =>
  version === TokenPoolVersion.V2_0_0
    ? { owner: [owner], getDynamicConfig: [ROUTER, rateLimitAdmin, FEE_ADMIN] }
    : { owner: [owner], getRateLimitAdmin: [rateLimitAdmin] }

const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * EVMChain stub: `typeAndVersion` reports the pool's own, and the provider answers `eth_call`
 * from `reads`, keyed by selector off that version's Interface. Any getter absent from `reads`
 * reverts, so a test that supplies none proves no RPC read was attempted.
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  reads = roleReads(version),
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  reads?: Reads
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  const responses = new Map(
    Object.entries(reads).map(([fn, values]) => [
      iface.getFunction(fn)!.selector,
      iface.encodeFunctionResult(fn, values),
    ]),
  )
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
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
        return encoded
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
    },
    getTokenInfo: () => Promise.resolve({ decimals: 18, symbol: 'TKN', name: 'Token' }),
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = OWNER, waitError?: Error) {
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

const op = new SetChainRateLimiterConfigs()

function generate(chain: EVMChain, overrides: Partial<SetChainRateLimiterConfigsParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    updates: UPDATES,
    sender: OWNER,
    ...overrides,
  })
}

describe('SetChainRateLimiterConfigs (cct/evm)', () => {
  describe('generate', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      for (const version of [TokenPoolVersion.V1_5_1, TokenPoolVersion.V1_6_1] as const) {
        it(`encodes the batch setChainRateLimiterConfigs for a ${version} ${family} pool`, async () => {
          const unsigned = await generate(stubChain({ family, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, BATCH_DATA)
        })
      }

      it(`encodes setRateLimitConfig for a 2.0.0 ${family} pool`, async () => {
        const unsigned = await generate(stubChain({ family, version: TokenPoolVersion.V2_0_0 }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, v2Data())
      })
    }

    it('encodes identically for the BurnMint and LockRelease families', async () => {
      for (const version of [
        TokenPoolVersion.V1_5_1,
        TokenPoolVersion.V1_6_1,
        TokenPoolVersion.V2_0_0,
      ] as const) {
        const burnMint = await generate(stubChain({ family: 'BurnMint', version }))
        const lockRelease = await generate(stubChain({ family: 'LockRelease', version }))
        assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
      }
    })

    it('carries per-entry fastFinality on a 2.0.0 pool', async () => {
      const unsigned = await generate(stubChain({ version: TokenPoolVersion.V2_0_0 }), {
        updates: [
          { ...UPDATES[0]!, fastFinality: true },
          { ...UPDATES[1]!, fastFinality: false },
        ],
      })
      assert.equal(unsigned.transactions[0]!.data, v2Data([true, false]))
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain(), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  /**
   * The offline / multisig builder is gated on the same owner-OR-rateLimitAdmin disjunction as
   * `execute`. Before this lived in `buildUnsigned`, `generateUnsignedSetChainRateLimiterConfigs`
   * with an arbitrary `sender` issued zero `eth_call`s and handed back a fully-formed transaction
   * with an unauthorized `from` — which reverts `Unauthorized` only after review and signing.
   */
  describe('generate role pre-flight', () => {
    for (const version of [
      TokenPoolVersion.V1_5_1,
      TokenPoolVersion.V1_6_1,
      TokenPoolVersion.V2_0_0,
    ] as const) {
      it(`rejects a sender that is neither the owner nor the rateLimitAdmin on v${version}`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version }), { sender: '0x' + '88'.repeat(20) }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setChainRateLimiterConfigs' &&
            err.context.param === 'sender',
        )
      })

      it(`accepts the rateLimitAdmin as sender on v${version}`, async () => {
        const unsigned = await generate(stubChain({ version }), { sender: RATE_LIMIT_ADMIN })
        assert.equal(unsigned.transactions[0]!.from, RATE_LIMIT_ADMIN)
      })
    }

    it('does not let a zero-address sender match an unset rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          generate(
            stubChain({
              reads: roleReads(TokenPoolVersion.V2_0_0, { rateLimitAdmin: ZeroAddress }),
            }),
            {
              sender: ZeroAddress,
            },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'sender',
      )
    })

    it('skips the role reads entirely when sender is omitted', async () => {
      let calls = 0
      // no `owner`/`getDynamicConfig` answers at all: any role read would revert
      const unsigned = await generate(stubChain({ reads: {}, onCall: () => calls++ }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.data, v2Data())
      assert.equal(calls, 1, 'only the typeAndVersion probe')
    })
  })

  describe('validation', () => {
    const cases: {
      name: string
      param: string
      overrides: Partial<SetChainRateLimiterConfigsParams>
      /** Set when only the version-specific encoder can reject it (so one RPC is expected). */
      version?: TokenPoolVersion
    }[] = [
      { name: 'an invalid poolAddress', param: 'poolAddress', overrides: { poolAddress: 'nope' } },
      // a tx to `0x0` hits no code, so it would mine as a successful no-op rather than reverting
      {
        name: 'the zero poolAddress',
        param: 'poolAddress',
        overrides: { poolAddress: ZeroAddress },
      },
      // `.map` skips holes, so without the density guard this used to reach ethers as `undefined`
      {
        name: 'a hole in updates',
        param: 'updates[1]',
        overrides: {
          updates: (() => {
            const sparse = [UPDATES[0]!]
            sparse[2] = UPDATES[1]!
            return sparse
          })(),
        },
      },
      { name: 'an invalid sender', param: 'sender', overrides: { sender: 'nope' } },
      { name: 'empty updates', param: 'updates', overrides: { updates: [] } },
      {
        name: 'a non-array updates',
        param: 'updates',
        overrides: { updates: undefined },
      },
      {
        name: 'a duplicate remoteChainSelector',
        param: 'updates[1].remoteChainSelector',
        overrides: { updates: [UPDATES[0]!, { ...UPDATES[1]!, remoteChainSelector: ETHEREUM }] },
      },
      {
        name: 'a non-uint64 remoteChainSelector',
        param: 'updates[0].remoteChainSelector',
        overrides: { updates: [{ ...UPDATES[0]!, remoteChainSelector: -1n }] },
      },
      {
        name: 'rate above capacity while enabled',
        param: 'updates[0].outboundRateLimiterConfig.rate',
        overrides: {
          updates: [
            {
              ...UPDATES[0]!,
              outboundRateLimiterConfig: { enabled: true, capacity: 10n, rate: 11n },
            },
          ],
        },
      },
      {
        name: 'a non-zero capacity while disabled',
        param: 'updates[0].inboundRateLimiterConfig',
        overrides: {
          updates: [{ ...UPDATES[0]!, inboundRateLimiterConfig: { enabled: false, capacity: 1n } }],
        },
      },
      {
        name: 'a missing enabled discriminant',
        param: 'updates[0].inboundRateLimiterConfig.enabled',
        overrides: {
          updates: [
            {
              ...UPDATES[0]!,
              inboundRateLimiterConfig:
                {} as unknown as ChainRateLimitUpdate['inboundRateLimiterConfig'],
            },
          ],
        },
      },
      {
        name: 'a non-boolean fastFinality',
        param: 'updates[0].fastFinality',
        overrides: {
          updates: [{ ...UPDATES[0]!, fastFinality: 'yes' as unknown as boolean }],
        },
      },
      {
        name: 'fastFinality on a pre-2.0.0 pool',
        param: 'updates[0].fastFinality',
        overrides: { updates: [{ ...UPDATES[0]!, fastFinality: true }] },
        version: TokenPoolVersion.V1_5_1,
      },
      {
        name: 'fastFinality: false on a pre-2.0.0 pool',
        param: 'updates[0].fastFinality',
        overrides: { updates: [{ ...UPDATES[0]!, fastFinality: false }] },
        version: TokenPoolVersion.V1_5_1,
      },
    ]

    for (const { name, param, overrides, version } of cases) {
      it(`rejects ${name}`, async () => {
        let calls = 0
        await assert.rejects(
          () => generate(stubChain({ version, onCall: () => calls++ }), overrides),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setChainRateLimiterConfigs' &&
            err.context.param === param,
        )
        // params-only failures short-circuit before any RPC; the version-gated ones need exactly
        // the one `typeAndVersion` probe that resolved the encoder
        assert.equal(calls, version === undefined ? 0 : 1)
      })
    }
  })

  describe('version dispatch', () => {
    it('encodes the singular setChainRateLimiterConfig for a 1.5.0 pool, one lane per tx', async () => {
      const unsigned = await generate(stubChain({ version: TokenPoolVersion.V1_5_0 }), {
        updates: [UPDATES[0]!],
      })
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, POOL)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, SINGLE_DATA_V1_5_0)
    })

    it('rejects a multi-lane batch on a 1.5.0 pool rather than fanning out to N transactions', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: TokenPoolVersion.V1_5_0 })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'updates',
      )
    })

    for (const version of [
      TokenPoolVersion.V1_5_1,
      TokenPoolVersion.V1_6_1,
      TokenPoolVersion.V2_0_0,
    ] as const) {
      it(`supports a ${version} pool`, async () => {
        const unsigned = await generate(stubChain({ version }))
        assert.equal(
          unsigned.transactions[0]!.data,
          version === TokenPoolVersion.V2_0_0 ? v2Data() : BATCH_DATA,
        )
      })
    }
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, updates: UPDATES }

    it('signs and submits as the pool owner, resolving to the tx hash', async () => {
      assert.deepEqual(
        await op.execute(stubChain({ reads: readsV2_0_0() }), {
          ...params,
          wallet: fakeSigner(OWNER),
        }),
        { hash: HASH },
      )
    })

    it('accepts the rateLimitAdmin as well as the owner', async () => {
      assert.deepEqual(
        await op.execute(stubChain({ reads: readsV2_0_0() }), {
          ...params,
          wallet: fakeSigner(RATE_LIMIT_ADMIN),
        }),
        { hash: HASH },
      )
    })

    it('accepts a legacy (1.5.1) pool, reading its standalone getRateLimitAdmin', async () => {
      assert.deepEqual(
        await op.execute(
          stubChain({
            version: TokenPoolVersion.V1_5_1,
            reads: {
              getToken: [TOKEN],
              owner: [OWNER],
              getRouter: [ROUTER],
              getRmnProxy: [RMN_PROXY],
              getRateLimitAdmin: [RATE_LIMIT_ADMIN],
              getSupportedChains: [[ETHEREUM, SEPOLIA]],
            },
          }),
          { ...params, wallet: fakeSigner(RATE_LIMIT_ADMIN) },
        ),
        { hash: HASH },
      )
    })

    it('rejects a sender that is neither the owner nor the rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ reads: readsV2_0_0() }), {
            ...params,
            wallet: fakeSigner('0x' + '88'.repeat(20)),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'sender',
      )
    })

    it('does not let a zero-address sender match an unset rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ reads: readsV2_0_0(ZeroAddress) }), {
            ...params,
            wallet: fakeSigner(ZeroAddress),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'sender',
      )
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ reads: readsV2_0_0() }), {
            ...params,
            sender: RATE_LIMIT_ADMIN,
            wallet: fakeSigner(OWNER),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'sender',
      )
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ reads: readsV2_0_0() }), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'setChainRateLimiterConfigs',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain({ reads: readsV2_0_0() }), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })
  })

  /**
   * The legacy `getRateLimitAdmin()` branch of the role read. Every case in `execute` above runs
   * on a 2.0.0 stub, where `rateLimitAdmin` is instead decoded out of `getDynamicConfig()`'s
   * `(router, rateLimitAdmin, feeAdmin)` triple — so the pre-2.0.0 getter and its single-address
   * decode would otherwise have no coverage, including the zero-address guard.
   */
  describe('execute on a legacy (pre-2.0.0) pool', () => {
    const params = { poolAddress: POOL, updates: UPDATES }
    const legacyPool = (reads: Reads) => stubChain({ version: TokenPoolVersion.V1_6_1, reads })

    it('accepts the rateLimitAdmin read from the standalone getRateLimitAdmin()', async () => {
      assert.deepEqual(
        await op.execute(legacyPool(readsLegacy()), {
          ...params,
          wallet: fakeSigner(RATE_LIMIT_ADMIN),
        }),
        { hash: HASH },
      )
    })

    it('accepts the pool owner', async () => {
      assert.deepEqual(
        await op.execute(legacyPool(readsLegacy()), { ...params, wallet: fakeSigner(OWNER) }),
        { hash: HASH },
      )
    })

    it('rejects a sender that is neither the owner nor the rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          op.execute(legacyPool(readsLegacy()), {
            ...params,
            wallet: fakeSigner('0x' + '88'.repeat(20)),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'sender',
      )
    })

    it('does not let a zero-address sender match an unset rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          op.execute(legacyPool(readsLegacy(ZeroAddress)), {
            ...params,
            wallet: fakeSigner(ZeroAddress),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimiterConfigs' &&
          err.context.param === 'sender',
      )
    })
  })
})
