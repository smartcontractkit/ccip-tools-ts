/**
 * Multi-token pools (`BurnMintMultiTokenPool`) serve many tokens and keep each token's configuration
 * in a PoolConfigManager (PCM). They have no `getToken()`/`getDynamicConfig()`, and their
 * single-argument lane getters revert, so pool reads must take the local token: without it they
 * throw the typed `CCIPLocalTokenRequiredError`; with it they read the token's resolved
 * configuration and lanes through the PCM batch views. The lane's pauses and record levels give
 * its `LaneStatus`, which the send and execute preflights and `getLaneFeatures` report.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type Interface,
  type JsonRpcApiProvider,
  getAddress,
  makeError,
  zeroPadValue,
} from 'ethers'

import { LaneFeature } from '../chain.ts'
import {
  CCIPError,
  CCIPFinalityNotAllowedError,
  CCIPLaneConfigIncompleteError,
  CCIPLaneNotFoundError,
  CCIPLocalTokenRequiredError,
  CCIPRateLimitExceededError,
  CCIPSourcePoolRevertError,
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTokenTransferPausedError,
} from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const POOL = '0x' + '11'.repeat(20)
const PCM = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const ONRAMP = '0x' + '99'.repeat(20)
const CONNECTION_STORE = '0x' + '66'.repeat(20)
const FEE_STORE = '0x' + '13'.repeat(20)
const SECURITY_STORE = '0x' + '77'.repeat(20)
const REGISTRY = '0x' + '88'.repeat(20)
const TOKEN = '0x8FE4D867DB59E38E7bA7D98DC14ac1826c79CF9f'
const REMOTE_TOKEN = '0x' + '44'.repeat(20)
const REMOTE_POOL = '0x' + '55'.repeat(20)
const SOURCE = networkInfo('ethereum-testnet-sepolia')
const DEST = networkInfo('avalanche-testnet-fuji')
const OTHER_DEST = networkInfo('ethereum-testnet-sepolia-arbitrum-1')

const mttp = interfaces.MultiTokenPool_v2_1
const pcm = interfaces.PoolConfigManager_v2_1
const tokenPool = interfaces.TokenPool_v2_0
const router = interfaces.Router

type Answer = string | { revert: string }

/** `eth_call` responder: answers from `answers[to][selector]`, or reverts. */
function stubProvider(
  answers: Record<string, Record<string, Answer>>,
): JsonRpcApiProvider & { calls: { to: string; selector: string }[] } {
  const calls: { to: string; selector: string }[] = []
  return {
    calls,
    call: async (tx: { to?: string; data?: string }) => {
      const to = (tx.to ?? '').toLowerCase()
      const selector = (tx.data ?? '').slice(0, 10)
      calls.push({ to, selector })
      const answer = answers[to]?.[selector]
      if (answer === undefined || typeof answer === 'object')
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: typeof answer === 'object' ? answer.revert : '0x',
          reason: null,
          transaction: { to: tx.to ?? null, data: tx.data ?? '0x' },
          invocation: null,
          revert: null,
        })
      return answer
    },
  } as unknown as JsonRpcApiProvider & { calls: { to: string; selector: string }[] }
}

const sel = (iface: Interface, name: string) => iface.getFunction(name)!.selector

const bucket = (tokens: bigint, isEnabled = true) => ({
  tokens,
  lastUpdated: 0n,
  isEnabled,
  capacity: 1000n,
  rate: 10n,
})

function tokenConfigResult({
  isRegistered = true,
  supportedChains = [DEST.chainSelector, OTHER_DEST.chainSelector],
  lockOrBurnFlavor = 0n,
  lockOrBurnAddress = '0x' + '00'.repeat(20),
} = {}) {
  return pcm.encodeFunctionResult('getTokenConfigBatch', [
    [
      {
        isRegistered,
        localDecimals: isRegistered ? 6n : 0n,
        lockOrBurnFlavor,
        // finalitySafe flag + 5 block confirmations for FTF
        allowedFinalityConfig: '0x00010005',
        lockOrBurnAddress,
        additionalPoolDataProvider: '0x' + '00'.repeat(20),
        supportedChains,
        connectionPolicyName: '0x' + '00'.repeat(32),
        remotePoolPolicyName: '0x' + '00'.repeat(32),
        rateLimitPolicyName: '0x' + '00'.repeat(32),
        feePolicyName: '0x' + '00'.repeat(32),
        destOverheadPolicyName: '0x' + '00'.repeat(32),
        securityPolicyName: '0x' + '00'.repeat(32),
      },
    ],
  ])
}

type Pauses = Partial<{
  isGloballyPaused: boolean
  isTokenOutboundPaused: boolean
  isTokenInboundPaused: boolean
  isChainOutboundPaused: boolean
  isChainInboundPaused: boolean
}>

function laneConnection(hasConnection: boolean, pauses: Pauses = {}) {
  const p = {
    isGloballyPaused: false,
    isTokenOutboundPaused: false,
    isTokenInboundPaused: false,
    isChainOutboundPaused: false,
    isChainInboundPaused: false,
    ...pauses,
  }
  return {
    hasConnection,
    isOutboundPaused: p.isGloballyPaused || p.isTokenOutboundPaused || p.isChainOutboundPaused,
    isInboundPaused: p.isGloballyPaused || p.isTokenInboundPaused || p.isChainInboundPaused,
    ...p,
    useLegacyPoolDataOnSend: false,
    remoteToken: hasConnection ? zeroPadValue(REMOTE_TOKEN, 32) : '0x',
    remotePools: hasConnection
      ? [{ remotePoolAddress: zeroPadValue(REMOTE_POOL, 32), allowLegacyPoolDataOnReceive: false }]
      : [],
  }
}

/** Record levels (1 = Inline) for every record type of each lane; `missing` lists types at None. */
function recordLevels(lanes: number, missing: string[] = []) {
  const types = ['connection', 'remotePool', 'rateLimit', 'fee', 'destOverhead', 'security']
  return pcm.encodeFunctionResult(
    'getLaneRecordLevelBatch',
    types.map((type) => Array<bigint>(lanes).fill(missing.includes(type) ? 0n : 1n)),
  )
}

function mttpProvider(
  pcmAnswers: Record<string, Answer> = {},
  poolAnswers: Record<string, Answer> = {},
  otherAnswers: Record<string, Record<string, Answer>> = {},
) {
  return stubProvider({
    [POOL]: {
      [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
        'BurnMintMultiTokenPool 2.1.0-dev',
      ]),
      [sel(mttp, 'getRouter')]: mttp.encodeFunctionResult('getRouter', [ROUTER]),
      [sel(mttp, 'getPoolConfigManager')]: mttp.encodeFunctionResult('getPoolConfigManager', [PCM]),
      ...poolAnswers,
    },
    [PCM]: {
      [sel(pcm, 'getTokenConfigBatch')]: tokenConfigResult(),
      [sel(pcm, 'getStaticConfig')]: pcm.encodeFunctionResult('getStaticConfig', [
        REGISTRY,
        CONNECTION_STORE,
        FEE_STORE,
        SECURITY_STORE,
      ]),
      ...pcmAnswers,
    },
    ...otherAnswers,
  })
}

/** A multi-token pool with one lane to DEST: its pauses, missing records, buckets and fee bps. */
function oneLaneProvider({
  pauses = {},
  missing = [],
  outbound = bucket(1000n),
  fastOutbound = bucket(1000n),
  finalityTransferFeeBps = 0n,
  fastFinalityTransferFeeBps = 0n,
  otherAnswers = {},
}: {
  pauses?: Pauses
  missing?: string[]
  outbound?: ReturnType<typeof bucket>
  fastOutbound?: ReturnType<typeof bucket>
  finalityTransferFeeBps?: bigint
  fastFinalityTransferFeeBps?: bigint
  otherAnswers?: Record<string, Record<string, Answer>>
} = {}) {
  return mttpProvider(
    {
      [sel(pcm, 'getLaneConnectionBatch')]: pcm.encodeFunctionResult('getLaneConnectionBatch', [
        [laneConnection(true, pauses)],
      ]),
      [sel(pcm, 'getCurrentRateLimiterStateBatch')]: pcm.encodeFunctionResult(
        'getCurrentRateLimiterStateBatch',
        [
          [
            {
              outbound,
              inbound: bucket(1000n),
              fastFinalityOutbound: fastOutbound,
              fastFinalityInbound: bucket(1000n),
            },
          ],
        ],
      ),
      [sel(pcm, 'getLaneRecordLevelBatch')]: recordLevels(1, missing),
    },
    {
      [sel(tokenPool, 'getTokenTransferFeeConfig')]: tokenPool.encodeFunctionResult(
        'getTokenTransferFeeConfig',
        [
          {
            destGasOverhead: 90_000n,
            destBytesOverhead: 192n,
            finalityFeeUSDCents: 25n,
            fastFinalityFeeUSDCents: 50n,
            finalityTransferFeeBps,
            fastFinalityTransferFeeBps,
            isEnabled: true,
          },
        ],
      ),
    },
    otherAnswers,
  )
}

/** A chain whose registry lookups resolve the token to {@link POOL}, and the router to ONRAMP. */
function chainWithRegistry(provider: JsonRpcApiProvider) {
  const chain = new EVMChain(provider, SOURCE)
  chain.getTokenAdminRegistryFor = async () => REGISTRY
  chain.getRegistryTokenConfig = async () => ({ administrator: ROUTER, tokenPool: POOL })
  chain.getOnRampForRouter = async () => ONRAMP
  return chain
}

const sendOpts = (amount: bigint, finality?: 'safe' | number) => ({
  router: ROUTER,
  destChainSelector: DEST.chainSelector,
  message: {
    tokenAmounts: [{ token: TOKEN, amount }],
    ...(finality != null && { extraArgs: { finality } }),
  },
})

describe('EVMChain multi-token pool reads', () => {
  it('getTokenPoolConfig throws the typed error without a token', async () => {
    const provider = mttpProvider()
    const chain = new EVMChain(provider, SOURCE)
    await assert.rejects(chain.getTokenPoolConfig(POOL), (err: unknown) => {
      assert.ok(err instanceof CCIPLocalTokenRequiredError)
      assert.equal(err.code, 'LOCAL_TOKEN_REQUIRED')
      assert.equal(err.isTransient, false)
      assert.equal(err.context.tokenPool, POOL)
      assert.equal(err.context.typeAndVersion, 'BurnMintMultiTokenPool 2.1.0-dev')
      return true
    })
    // never reached the single-token getters
    assert.ok(!provider.calls.some((c) => c.selector === sel(tokenPool, 'getToken')))
  })

  it("getTokenPoolConfig reads the token's resolved config through the PCM", async () => {
    const chain = new EVMChain(mttpProvider(), SOURCE)
    assert.deepEqual(await chain.getTokenPoolConfig(POOL, { token: TOKEN.toLowerCase() }), {
      token: TOKEN,
      router: ROUTER,
      typeAndVersion: 'BurnMintMultiTokenPool 2.1.0-dev',
      decimals: 6,
      poolConfigManager: PCM,
      connectionPolicyStore: CONNECTION_STORE,
      feePolicyStore: FEE_STORE,
      securityPolicyStore: SECURITY_STORE,
      finalityDepth: 5,
      finalitySafe: true,
    })
  })

  it("getTokenPoolConfig returns a Lock-flavor token's lock box", async () => {
    const LOCK_BOX = '0x' + '12'.repeat(20)
    const provider = mttpProvider({
      [sel(pcm, 'getTokenConfigBatch')]: tokenConfigResult({
        lockOrBurnFlavor: 4n,
        lockOrBurnAddress: LOCK_BOX,
      }),
    })
    const chain = new EVMChain(provider, SOURCE)
    assert.equal((await chain.getTokenPoolConfig(POOL, { token: TOKEN })).lockBox, LOCK_BOX)
    // a burn flavor's address (e.g. BurnToAddress) is not a lock box
    const burn = new EVMChain(
      mttpProvider({
        [sel(pcm, 'getTokenConfigBatch')]: tokenConfigResult({
          lockOrBurnFlavor: 3n,
          lockOrBurnAddress: LOCK_BOX,
        }),
      }),
      SOURCE,
    )
    assert.ok(!('lockBox' in (await burn.getTokenPoolConfig(POOL, { token: TOKEN }))))
  })

  it('getTokenPoolConfig omits the stores when the PCM has no getStaticConfig', async () => {
    // the stub reverts (CALL_EXCEPTION) on a selector without an answer
    const withoutStatic = stubProvider({
      [POOL]: {
        [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
          'BurnMintMultiTokenPool 2.1.0-dev',
        ]),
        [sel(mttp, 'getRouter')]: mttp.encodeFunctionResult('getRouter', [ROUTER]),
        [sel(mttp, 'getPoolConfigManager')]: mttp.encodeFunctionResult('getPoolConfigManager', [
          PCM,
        ]),
      },
      [PCM]: { [sel(pcm, 'getTokenConfigBatch')]: tokenConfigResult() },
    })
    const chain = new EVMChain(withoutStatic, SOURCE)
    const config = await chain.getTokenPoolConfig(POOL, { token: TOKEN })
    assert.equal(config.poolConfigManager, PCM)
    assert.ok(!('connectionPolicyStore' in config))
    assert.ok(!('feePolicyStore' in config))
    assert.ok(!('securityPolicyStore' in config))
  })

  it('getTokenPoolConfig also reads the fee config with destChainSelector', async () => {
    const chain = new EVMChain(
      oneLaneProvider({ finalityTransferFeeBps: 1n, fastFinalityTransferFeeBps: 2n }),
      SOURCE,
    )
    const { tokenTransferFeeConfig } = await chain.getTokenPoolConfig(POOL, {
      token: TOKEN,
      destChainSelector: DEST.chainSelector,
    })
    assert.deepEqual(tokenTransferFeeConfig, {
      destGasOverhead: 90_000,
      destBytesOverhead: 192,
      finalityFeeUSDCents: 25,
      fastFinalityFeeUSDCents: 50,
      finalityTransferFeeBps: 1,
      fastFinalityTransferFeeBps: 2,
      isEnabled: true,
    })
  })

  it('getTokenPoolConfig throws CCIPTokenNotConfiguredError for an unregistered token', async () => {
    const provider = mttpProvider({
      [sel(pcm, 'getTokenConfigBatch')]: tokenConfigResult({ isRegistered: false }),
    })
    const chain = new EVMChain(provider, SOURCE)
    await assert.rejects(chain.getTokenPoolConfig(POOL, { token: TOKEN }), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenNotConfiguredError)
      assert.equal(err.context.token, TOKEN)
      assert.equal(err.context.registry, PCM)
      return true
    })
  })

  it("getTokenPoolRemotes reads the token's lanes, buckets and record levels in one batch each", async () => {
    const provider = mttpProvider({
      [sel(pcm, 'getLaneConnectionBatch')]: pcm.encodeFunctionResult('getLaneConnectionBatch', [
        [laneConnection(true), laneConnection(true)],
      ]),
      [sel(pcm, 'getCurrentRateLimiterStateBatch')]: pcm.encodeFunctionResult(
        'getCurrentRateLimiterStateBatch',
        [
          [
            {
              outbound: bucket(100n),
              inbound: bucket(200n),
              fastFinalityOutbound: bucket(300n),
              fastFinalityInbound: bucket(0n, false),
            },
            {
              outbound: bucket(1n),
              inbound: bucket(2n),
              fastFinalityOutbound: bucket(3n),
              fastFinalityInbound: bucket(4n),
            },
          ],
        ],
      ),
      [sel(pcm, 'getLaneRecordLevelBatch')]: recordLevels(2),
    })
    const chain = new EVMChain(provider, SOURCE)
    const remotes = await chain.getTokenPoolRemotes(POOL, undefined, { token: TOKEN })
    assert.deepEqual(Object.keys(remotes), [DEST.name, OTHER_DEST.name])
    assert.deepEqual(remotes[DEST.name], {
      remoteToken: REMOTE_TOKEN,
      remotePools: [REMOTE_POOL],
      outboundRateLimiterState: { tokens: 100n, capacity: 1000n, rate: 10n },
      inboundRateLimiterState: { tokens: 200n, capacity: 1000n, rate: 10n },
      fastOutboundRateLimiterState: { tokens: 300n, capacity: 1000n, rate: 10n },
      fastInboundRateLimiterState: null,
      outboundStatus: { status: 'ok' },
      inboundStatus: { status: 'ok' },
    })
    for (const name of [
      'getLaneConnectionBatch',
      'getCurrentRateLimiterStateBatch',
      'getLaneRecordLevelBatch',
    ])
      assert.equal(provider.calls.filter((c) => c.selector === sel(pcm, name)).length, 1)
  })

  it('getTokenPoolRemote reports the broadest pause per direction', async () => {
    const statuses = async (pauses: Pauses) => {
      const chain = new EVMChain(oneLaneProvider({ pauses }), SOURCE)
      const { outboundStatus, inboundStatus } = await chain.getTokenPoolRemote(
        POOL,
        DEST.chainSelector,
        { token: TOKEN },
      )
      return { outboundStatus, inboundStatus }
    }
    assert.deepEqual(await statuses({ isGloballyPaused: true, isTokenOutboundPaused: true }), {
      outboundStatus: { status: 'paused', scope: 'global', direction: 'outbound' },
      inboundStatus: { status: 'paused', scope: 'global', direction: 'inbound' },
    })
    assert.deepEqual(await statuses({ isChainInboundPaused: true, isTokenInboundPaused: true }), {
      outboundStatus: { status: 'ok' },
      inboundStatus: { status: 'paused', scope: 'chain', direction: 'inbound' },
    })
    assert.deepEqual(await statuses({ isTokenOutboundPaused: true }), {
      outboundStatus: { status: 'paused', scope: 'token', direction: 'outbound' },
      inboundStatus: { status: 'ok' },
    })
  })

  it('getTokenPoolRemote reports missing records; inbound needs no fee records', async () => {
    const chain = new EVMChain(oneLaneProvider({ missing: ['fee', 'security'] }), SOURCE)
    const { outboundStatus, inboundStatus } = await chain.getTokenPoolRemote(
      POOL,
      DEST.chainSelector,
      { token: TOKEN },
    )
    assert.deepEqual(outboundStatus, { status: 'incomplete', missing: ['fee', 'security'] })
    assert.deepEqual(inboundStatus, { status: 'incomplete', missing: ['security'] })

    const noFees = new EVMChain(oneLaneProvider({ missing: ['destOverhead'] }), SOURCE)
    const remote = await noFees.getTokenPoolRemote(POOL, DEST.chainSelector, { token: TOKEN })
    assert.deepEqual(remote.inboundStatus, { status: 'ok' })
  })

  it('getTokenPoolRemote throws the typed errors without a token or a lane', async () => {
    const provider = mttpProvider({
      [sel(pcm, 'getLaneConnectionBatch')]: pcm.encodeFunctionResult('getLaneConnectionBatch', [
        [laneConnection(false)],
      ]),
      [sel(pcm, 'getCurrentRateLimiterStateBatch')]: pcm.encodeFunctionResult(
        'getCurrentRateLimiterStateBatch',
        [
          [
            {
              outbound: bucket(0n, false),
              inbound: bucket(0n, false),
              fastFinalityOutbound: bucket(0n, false),
              fastFinalityInbound: bucket(0n, false),
            },
          ],
        ],
      ),
      [sel(pcm, 'getLaneRecordLevelBatch')]: recordLevels(1, ['connection']),
    })
    const chain = new EVMChain(provider, SOURCE)
    await assert.rejects(
      chain.getTokenPoolRemote(POOL, DEST.chainSelector),
      CCIPLocalTokenRequiredError,
    )
    await assert.rejects(
      chain.getTokenPoolRemote(POOL, DEST.chainSelector, { token: TOKEN }),
      CCIPTokenPoolChainConfigNotFoundError,
    )
  })

  it("getTokenAdminRegistryFor reads the registry from the pool's PCM, without a token", async () => {
    const provider = mttpProvider()
    const chain = new EVMChain(provider, SOURCE)
    assert.equal(await chain.getTokenAdminRegistryFor(POOL), REGISTRY)
    // no router lane to guess, and no token-scoped read
    assert.ok(!provider.calls.some((c) => c.to === ROUTER))
    assert.ok(!provider.calls.some((c) => c.selector === sel(pcm, 'getTokenConfigBatch')))
  })

  it("getTokenAdminRegistryFor falls back to the pool's router for a PCM without getStaticConfig", async () => {
    // the router address answers as a TokenAdminRegistry, so resolution stops at the 2nd hop
    const provider = stubProvider({
      [POOL]: {
        [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
          'BurnMintMultiTokenPool 2.1.0-dev',
        ]),
        [sel(mttp, 'getRouter')]: mttp.encodeFunctionResult('getRouter', [ROUTER]),
        [sel(mttp, 'getPoolConfigManager')]: mttp.encodeFunctionResult('getPoolConfigManager', [
          PCM,
        ]),
      },
      [ROUTER]: {
        [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
          'TokenAdminRegistry 1.5.0',
        ]),
      },
    })
    const chain = new EVMChain(provider, SOURCE)
    assert.equal(await chain.getTokenAdminRegistryFor(POOL), ROUTER)
    assert.ok(!provider.calls.some((c) => c.selector === sel(tokenPool, 'getToken')))
  })
})

describe('EVMChain router OnRamp discovery without a destination', () => {
  const ARB_ONRAMP = getAddress('0x' + 'ab'.repeat(20))
  const onRamp = interfaces.OnRamp_v2_0
  /** A Router 1.2.0 with an OnRamp only to `onRamps` keys, and OffRamps from `offRampSources`. */
  function routerProvider(onRamps: Record<string, string>, offRampSources: bigint[]) {
    const provider = stubProvider({
      [ROUTER]: {
        [sel(router, 'typeAndVersion')]: router.encodeFunctionResult('typeAndVersion', [
          'Router 1.2.0',
        ]),
        [sel(router, 'getOffRamps')]: router.encodeFunctionResult('getOffRamps', [
          offRampSources.map((sourceChainSelector) => ({
            sourceChainSelector,
            offRamp: '0x' + 'cd'.repeat(20),
          })),
        ]),
      },
      [ARB_ONRAMP.toLowerCase()]: {
        [sel(onRamp, 'typeAndVersion')]: onRamp.encodeFunctionResult('typeAndVersion', [
          'OnRamp 2.0.0',
        ]),
      },
    })
    // getOnRamp(selector) answers per selector, so route it by calldata
    const call = provider.call.bind(provider)
    provider.call = (async (tx: { to?: string; data?: string }) => {
      if (tx.to?.toLowerCase() === ROUTER && tx.data?.startsWith(sel(router, 'getOnRamp'))) {
        const [selector] = router.decodeFunctionData('getOnRamp', tx.data)
        provider.calls.push({ to: ROUTER, selector: sel(router, 'getOnRamp') })
        return router.encodeFunctionResult('getOnRamp', [
          onRamps[(selector as bigint).toString()] ?? '0x' + '00'.repeat(20),
        ])
      }
      return call(tx as never)
    }) as typeof provider.call
    return provider
  }

  it('uses an OnRamp to a chain the router lists OffRamps from, when it has no Sepolia lane', async () => {
    // a robinhood-testnet-like router: one lane to Arbitrum Sepolia, none to Sepolia
    const provider = routerProvider({ [OTHER_DEST.chainSelector.toString()]: ARB_ONRAMP }, [
      OTHER_DEST.chainSelector,
    ])
    const chain = new EVMChain(provider, networkInfo('robinhood-testnet'))
    assert.equal(await chain._getSomeOnRampFor(ROUTER), ARB_ONRAMP)
  })

  it('throws CCIPLaneNotFoundError when the router has no OnRamp at all', async () => {
    const provider = routerProvider({}, [OTHER_DEST.chainSelector])
    const chain = new EVMChain(provider, networkInfo('robinhood-testnet'))
    await assert.rejects(chain._getSomeOnRampFor(ROUTER), (err: unknown) => {
      assert.ok(err instanceof CCIPLaneNotFoundError)
      assert.equal(err.context.router, ROUTER)
      return true
    })
  })

  it('keeps the explicit destination lane as is', async () => {
    const provider = routerProvider({ [DEST.chainSelector.toString()]: ARB_ONRAMP }, [])
    const chain = new EVMChain(provider, SOURCE)
    assert.equal(await chain._getSomeOnRampFor(ROUTER, DEST.chainSelector), ARB_ONRAMP)
    assert.ok(!provider.calls.some((c) => c.selector === sel(router, 'getOffRamps')))
  })
})

describe('EVMChain multi-token pool send preflight', () => {
  it('checkSendMessage throws CCIPTokenTransferPausedError on an outbound pause', async () => {
    const chain = chainWithRegistry(oneLaneProvider({ pauses: { isChainOutboundPaused: true } }))
    await assert.rejects(chain.checkSendMessage(sendOpts(1n)), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenTransferPausedError)
      assert.equal(err.code, 'TOKEN_TRANSFER_PAUSED')
      assert.equal(err.context.scope, 'chain')
      assert.equal(err.context.direction, 'outbound')
      assert.equal(err.context.token, TOKEN)
      assert.equal(err.context.tokenPool, POOL)
      assert.equal(err.context.destChainSelector, DEST.chainSelector)
      return true
    })
  })

  it('checkSendMessage throws CCIPLaneConfigIncompleteError for a missing record', async () => {
    const chain = chainWithRegistry(oneLaneProvider({ missing: ['destOverhead'] }))
    await assert.rejects(chain.checkSendMessage(sendOpts(1n)), (err: unknown) => {
      assert.ok(err instanceof CCIPLaneConfigIncompleteError)
      assert.equal(err.code, 'LANE_CONFIG_INCOMPLETE')
      assert.deepEqual(err.context.missing, ['destOverhead'])
      return true
    })
  })

  it("checkSendMessage throws CCIPFinalityNotAllowedError below the token's FTF depth", async () => {
    const chain = chainWithRegistry(oneLaneProvider())
    await assert.rejects(chain.checkSendMessage(sendOpts(1n, 3)), (err: unknown) => {
      assert.ok(err instanceof CCIPFinalityNotAllowedError)
      assert.equal(err.context.requested, 3)
      assert.deepEqual(err.context.allowed, { finalityDepth: 5, finalitySafe: true })
      assert.equal(err.context.tokenPool, POOL)
      assert.match(err.message, /TokenPool/)
      return true
    })
    // 'safe' and depth 5+ are allowed
    assert.equal(await chain.checkSendMessage(sendOpts(1n, 'safe')), true)
    assert.equal(await chain.checkSendMessage(sendOpts(1n, 7)), true)
  })

  it('checkSendMessage checks the fast bucket for the amount after the token fee', async () => {
    // 0.5% fast fee: 1000 → 995 fits the 995-token fast bucket; the default bucket is not used
    const chain = chainWithRegistry(
      oneLaneProvider({
        outbound: bucket(1n),
        fastOutbound: bucket(995n),
        fastFinalityTransferFeeBps: 50n,
      }),
    )
    assert.equal(await chain.checkSendMessage(sendOpts(1000n, 'safe')), true)
    await assert.rejects(chain.checkSendMessage(sendOpts(1001n, 'safe')), (err: unknown) => {
      assert.ok(err instanceof CCIPRateLimitExceededError)
      assert.equal(err.context.amount, 1001n - 5n)
      assert.equal(err.context.tokens, 995n)
      return true
    })
  })

  it('checkSendMessage uses the default bucket when the fast bucket is disabled', async () => {
    const chain = chainWithRegistry(
      oneLaneProvider({ outbound: bucket(100n), fastOutbound: bucket(0n, false) }),
    )
    await assert.rejects(chain.checkSendMessage(sendOpts(200n, 'safe')), (err: unknown) => {
      assert.ok(err instanceof CCIPRateLimitExceededError)
      assert.equal(err.context.tokens, 100n)
      return true
    })
  })

  it('checkSendMessage simulates lockOrBurn only with a sender', async () => {
    const chain = chainWithRegistry(oneLaneProvider({}))
    const calls: unknown[] = []
    chain.simulateLockOrBurn = async (opts) => {
      calls.push(opts)
      return {
        sourcePoolAddress: POOL,
        destTokenAddress: '0x',
        destPoolData: '0x',
        destTokenAmount: 1n,
      }
    }
    assert.equal(await chain.checkSendMessage(sendOpts(1n)), true)
    assert.equal(calls.length, 0)

    const RECEIVER = '0x' + 'ab'.repeat(20)
    const opts = sendOpts(5n, 'safe')
    const message = { ...opts.message, receiver: RECEIVER }
    assert.equal(await chain.checkSendMessage({ ...opts, message, sender: ROUTER }), true)
    assert.deepEqual(calls, [
      {
        onRamp: ONRAMP,
        destChainSelector: DEST.chainSelector,
        token: TOKEN,
        amount: 5n,
        originalSender: ROUTER,
        receiver: RECEIVER,
        tokenReceiver: undefined,
        tokenArgs: '0x',
        finality: 'safe',
      },
    ])
  })

  it('checkSendMessage throws a lockOrBurn revert, and skips a simulation that cannot run', async () => {
    const chain = chainWithRegistry(oneLaneProvider({}))
    const revert = new CCIPSourcePoolRevertError('SenderNotAllowed(address)', {
      context: { token: TOKEN },
    })
    chain.simulateLockOrBurn = () => Promise.reject(revert)
    await assert.rejects(chain.checkSendMessage({ ...sendOpts(1n), sender: ROUTER }), revert)

    chain.simulateLockOrBurn = () => Promise.reject(new Error('could not detect network'))
    assert.equal(await chain.checkSendMessage({ ...sendOpts(1n), sender: ROUTER }), true)
  })

  it('generateUnsignedSendMessage runs the preflight with the sender when a fee is given', async () => {
    const chain = chainWithRegistry(oneLaneProvider({}))
    const stop = new Error('stop after the preflight')
    let checked: { sender?: string } | undefined
    chain.checkSendMessage = (opts) => {
      checked = opts
      return Promise.reject(stop)
    }
    await assert.rejects(
      chain.generateUnsignedSendMessage({
        sender: ROUTER,
        router: ROUTER,
        destChainSelector: DEST.chainSelector,
        message: { receiver: REMOTE_TOKEN, tokenAmounts: [{ token: TOKEN, amount: 1n }], fee: 1n },
      }),
      stop,
    )
    assert.equal(checked?.sender, ROUTER)
  })

  it('checkExecute blocks a transfer the destination pool pauses inbound', async () => {
    // the source pool may still allow the send: each chain's pool keeps its own pauses
    const chain = chainWithRegistry(oneLaneProvider({ pauses: { isChainInboundPaused: true } }))
    const message = {
      sourceChainSelector: DEST.chainSelector,
      receiver: REMOTE_TOKEN,
      tokenAmounts: [{ token: TOKEN, amount: 1n }],
    }
    await assert.rejects(chain.checkExecute({ offRamp: ONRAMP, message }), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenTransferPausedError)
      assert.equal(err.context.scope, 'chain')
      assert.equal(err.context.direction, 'inbound')
      assert.equal(err.context.token, TOKEN)
      assert.equal(err.context.sourceChainSelector, DEST.chainSelector)
      return true
    })
  })

  it('checkSendMessage deducts the default-finality fee for a finalized send', async () => {
    // 10% fee: 110 → 99 fits the 100-token default bucket
    const chain = chainWithRegistry(
      oneLaneProvider({ outbound: bucket(100n), finalityTransferFeeBps: 1000n }),
    )
    assert.equal(await chain.checkSendMessage(sendOpts(110n)), true)
  })

  it('getLaneFeatures reports LANE_STATUS and omits a disabled FAST_RATE_LIMITS', async () => {
    const onRampAnswers = {
      [ONRAMP]: {
        [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
          'OnRamp 2.0.0',
        ]),
      },
    }
    const paused = chainWithRegistry(
      oneLaneProvider({
        pauses: { isTokenOutboundPaused: true },
        fastOutbound: bucket(0n, false),
        otherAnswers: onRampAnswers,
      }),
    )
    const features = await paused.getLaneFeatures({
      router: ROUTER,
      destChainSelector: DEST.chainSelector,
      token: TOKEN,
    })
    assert.deepEqual(features[LaneFeature.LANE_STATUS], {
      status: 'paused',
      scope: 'token',
      direction: 'outbound',
    })
    assert.equal(features[LaneFeature.FINALITY_FAST], 5)
    assert.deepEqual(features[LaneFeature.RATE_LIMITS], {
      tokens: 1000n,
      capacity: 1000n,
      rate: 10n,
    })
    assert.ok(!(LaneFeature.FAST_RATE_LIMITS in features))

    const ready = chainWithRegistry(oneLaneProvider({ otherAnswers: onRampAnswers }))
    const readyFeatures = await ready.getLaneFeatures({
      router: ROUTER,
      destChainSelector: DEST.chainSelector,
      token: TOKEN,
    })
    assert.deepEqual(readyFeatures[LaneFeature.LANE_STATUS], { status: 'ok' })
    assert.ok(LaneFeature.FAST_RATE_LIMITS in readyFeatures)
  })

  it('getFee maps a LaneFeeNotFound revert to CCIPLaneConfigIncompleteError', async () => {
    const revert = mttp.encodeErrorResult('LaneFeeNotFound', [TOKEN, DEST.chainSelector])
    const chain = chainWithRegistry(
      oneLaneProvider({
        otherAnswers: { [ROUTER]: { [sel(router, 'getFee')]: { revert } } },
      }),
    )
    await assert.rejects(
      chain.getFee({
        router: ROUTER,
        destChainSelector: DEST.chainSelector,
        message: { receiver: REMOTE_TOKEN, tokenAmounts: [{ token: TOKEN, amount: 1n }] },
      }),
      (err: unknown) => {
        assert.ok(err instanceof CCIPLaneConfigIncompleteError)
        assert.deepEqual(err.context.missing, ['fee', 'destOverhead'])
        assert.equal(err.context.token, TOKEN)
        assert.equal(err.context.revert, revert)
        assert.ok(CCIPError.isCCIPError(err))
        return true
      },
    )
  })
})
