/**
 * Multi-token pools (`BurnMintMultiTokenPool`) serve many tokens and keep each token's configuration
 * in a PoolConfigManager (PCM). They have no `getToken()`/`getDynamicConfig()`, and their
 * single-argument lane getters revert, so pool reads must take the local token: without it they
 * throw the typed `CCIPTokenPoolTokenRequiredError`; with it they read the token's resolved
 * configuration and lanes through the PCM batch views.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Interface, type JsonRpcApiProvider, makeError, zeroPadValue } from 'ethers'

import {
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTokenPoolTokenRequiredError,
} from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const POOL = '0x' + '11'.repeat(20)
const PCM = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const CONNECTION_STORE = '0x' + '66'.repeat(20)
const SECURITY_STORE = '0x' + '77'.repeat(20)
const REGISTRY = '0x' + '88'.repeat(20)
const TOKEN = '0x8FE4D867DB59E38E7bA7D98DC14ac1826c79CF9f'
const REMOTE_TOKEN = '0x' + '44'.repeat(20)
const REMOTE_POOL = '0x' + '55'.repeat(20)
const DEST = networkInfo('avalanche-testnet-fuji')
const OTHER_DEST = networkInfo('ethereum-testnet-sepolia-arbitrum-1')

const mttp = interfaces.MultiTokenPool_v2_1
const pcm = interfaces.PoolConfigManager_v2_1
const tokenPool = interfaces.TokenPool_v2_0

/** `eth_call` responder: answers from `answers[to][selector]`, or reverts. */
function stubProvider(
  answers: Record<string, Record<string, string>>,
): JsonRpcApiProvider & { calls: { to: string; selector: string }[] } {
  const calls: { to: string; selector: string }[] = []
  return {
    calls,
    call: async (tx: { to?: string; data?: string }) => {
      const to = (tx.to ?? '').toLowerCase()
      const selector = (tx.data ?? '').slice(0, 10)
      calls.push({ to, selector })
      const answer = answers[to]?.[selector]
      if (answer === undefined)
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
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
} = {}) {
  return pcm.encodeFunctionResult('getTokenConfigBatch', [
    [
      {
        isRegistered,
        localDecimals: isRegistered ? 6n : 0n,
        lockOrBurnFlavor: 0n,
        // finalitySafe flag + 5 block confirmations for FTF
        allowedFinalityConfig: '0x00010005',
        lockOrBurnAddress: '0x' + '00'.repeat(20),
        tokenIdentityMetadataProvider: '0x' + '00'.repeat(20),
        supportedChains,
        connectionPolicyName: '0x' + '00'.repeat(32),
        chainPolicyName: '0x' + '00'.repeat(32),
        rateLimitPolicyName: '0x' + '00'.repeat(32),
        feePolicyName: '0x' + '00'.repeat(32),
        securityPolicyName: '0x' + '00'.repeat(32),
      },
    ],
  ])
}

function laneConnection(hasConnection: boolean) {
  return {
    hasConnection,
    isOutboundPaused: false,
    isInboundPaused: false,
    isGloballyPaused: false,
    isTokenOutboundPaused: false,
    isTokenInboundPaused: false,
    isChainOutboundPaused: false,
    isChainInboundPaused: false,
    omitSourceTokenAddressOnSend: false,
    allowSourceTokenAddressMissingOnReceive: false,
    destGasOverhead: 90_000n,
    destBytesOverhead: 192n,
    remoteToken: hasConnection ? zeroPadValue(REMOTE_TOKEN, 32) : '0x',
    remotePools: hasConnection ? [zeroPadValue(REMOTE_POOL, 32)] : [],
  }
}

function mttpProvider(
  pcmAnswers: Record<string, string> = {},
  poolAnswers: Record<string, string> = {},
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
        SECURITY_STORE,
      ]),
      ...pcmAnswers,
    },
  })
}

describe('EVMChain multi-token pool reads', () => {
  it('getTokenPoolConfig throws the typed error without a token', async () => {
    const provider = mttpProvider()
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(chain.getTokenPoolConfig(POOL), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenPoolTokenRequiredError)
      assert.equal(err.code, 'TOKEN_POOL_TOKEN_REQUIRED')
      assert.equal(err.isTransient, false)
      assert.equal(err.context.tokenPool, POOL)
      assert.equal(err.context.typeAndVersion, 'BurnMintMultiTokenPool 2.1.0-dev')
      return true
    })
    // never reached the single-token getters
    assert.ok(!provider.calls.some((c) => c.selector === sel(tokenPool, 'getToken')))
  })

  it("getTokenPoolConfig reads the token's resolved config through the PCM", async () => {
    const chain = new EVMChain(mttpProvider(), networkInfo('ethereum-testnet-sepolia'))
    assert.deepEqual(await chain.getTokenPoolConfig(POOL, { token: TOKEN.toLowerCase() }), {
      token: TOKEN,
      router: ROUTER,
      typeAndVersion: 'BurnMintMultiTokenPool 2.1.0-dev',
      decimals: 6,
      poolConfigManager: PCM,
      connectionPolicyStore: CONNECTION_STORE,
      securityPolicyStore: SECURITY_STORE,
      finalityDepth: 5,
      finalitySafe: true,
    })
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
    const chain = new EVMChain(withoutStatic, networkInfo('ethereum-testnet-sepolia'))
    const config = await chain.getTokenPoolConfig(POOL, { token: TOKEN })
    assert.equal(config.poolConfigManager, PCM)
    assert.ok(!('connectionPolicyStore' in config))
    assert.ok(!('securityPolicyStore' in config))
  })

  it('getTokenPoolConfig also reads the fee config with destChainSelector', async () => {
    const feeConfig = {
      destGasOverhead: 90_000n,
      destBytesOverhead: 192n,
      finalityFeeUSDCents: 25n,
      fastFinalityFeeUSDCents: 50n,
      finalityTransferFeeBps: 1n,
      fastFinalityTransferFeeBps: 2n,
      isEnabled: true,
    }
    const provider = mttpProvider(
      {},
      {
        [sel(tokenPool, 'getTokenTransferFeeConfig')]: tokenPool.encodeFunctionResult(
          'getTokenTransferFeeConfig',
          [feeConfig],
        ),
      },
    )
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
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
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(chain.getTokenPoolConfig(POOL, { token: TOKEN }), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenNotConfiguredError)
      assert.equal(err.context.token, TOKEN)
      assert.equal(err.context.registry, PCM)
      return true
    })
  })

  it("getTokenPoolRemotes reads the token's lanes and buckets in one batch each", async () => {
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
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    const remotes = await chain.getTokenPoolRemotes(POOL, undefined, { token: TOKEN })
    assert.deepEqual(Object.keys(remotes), [DEST.name, OTHER_DEST.name])
    assert.deepEqual(remotes[DEST.name], {
      remoteToken: REMOTE_TOKEN,
      remotePools: [REMOTE_POOL],
      outboundRateLimiterState: { tokens: 100n, capacity: 1000n, rate: 10n },
      inboundRateLimiterState: { tokens: 200n, capacity: 1000n, rate: 10n },
      fastOutboundRateLimiterState: { tokens: 300n, capacity: 1000n, rate: 10n },
      fastInboundRateLimiterState: null,
    })
    assert.equal(
      provider.calls.filter((c) => c.selector === sel(pcm, 'getLaneConnectionBatch')).length,
      1,
    )
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
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(
      chain.getTokenPoolRemote(POOL, DEST.chainSelector),
      CCIPTokenPoolTokenRequiredError,
    )
    await assert.rejects(
      chain.getTokenPoolRemote(POOL, DEST.chainSelector, { token: TOKEN }),
      CCIPTokenPoolChainConfigNotFoundError,
    )
  })

  it("getTokenAdminRegistryFor resolves through the pool's router, without a token", async () => {
    // the router address answers as a TokenAdminRegistry, so resolution stops at the 2nd hop
    const provider = stubProvider({
      [POOL]: {
        [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
          'BurnMintMultiTokenPool 2.1.0-dev',
        ]),
        [sel(mttp, 'getRouter')]: mttp.encodeFunctionResult('getRouter', [ROUTER]),
      },
      [ROUTER]: {
        [sel(mttp, 'typeAndVersion')]: mttp.encodeFunctionResult('typeAndVersion', [
          'TokenAdminRegistry 1.5.0',
        ]),
      },
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    assert.equal(await chain.getTokenAdminRegistryFor(POOL), ROUTER)
    assert.ok(!provider.calls.some((c) => c.selector === sel(tokenPool, 'getToken')))
  })
})
