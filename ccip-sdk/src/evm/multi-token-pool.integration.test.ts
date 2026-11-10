/**
 * Read-only integration tests for multi-token pools (MTTP), against the live staging
 * `BurnMintMultiTokenPool 2.1.0-dev` on the robinhood-testnet <-> arbitrum-sepolia lane.
 *
 * Every SDK read is checked against a raw read of the same state through the generated
 * pool and PoolConfigManager (PCM) ABIs, in both directions. A pinned token transfer checks
 * the long (224-byte) pool data decode and the destination execution receipt.
 *
 * Staging is redeployed from time to time. When the pool is no longer a multi-token pool on
 * both chains, the tests skip (they do not fail); RPC errors still fail them.
 */
import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Contract, dataLength, getAddress } from 'ethers'

import { reachableRpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { type RateLimiterState, LaneFeature } from '../chain.ts'
import { CCIPLocalTokenRequiredError, CCIPTokenNotConfiguredError } from '../errors/index.ts'
import { getDestTokenAmount } from '../gas.ts'
import { ExecutionState } from '../types.ts'
import {
  decodeAddress,
  getSourceDecimalsFromExtraData,
  getSourceTokenFromExtraData,
} from '../utils.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const skip = !!process.env.SKIP_INTEGRATION_TESTS

await useResource(['robinhood-testnet', 'arbitrum-sepolia'])

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

// ── Staging deployment (same addresses on both chains for the pool and its PCM) ──
const POOL = '0xE6561fB319FF85f1ac19BB9d882120d655cA70b8'
const RH = {
  rpc: 'RPC_ROBINHOOD_TESTNET',
  selector: 2032988798112970440n,
  router: '0x55fC135F95cE915B609BE5746E6d39AA03918bAc',
  onRamp: '0x0663c54dffD95270B28Ca54C11dE52135b746f8c',
  token: '0x60244b08CBbfddb2bDa93B43A61C37A10188757f', // MTTP1
} as const
const ARB = {
  rpc: 'RPC_ARBITRUM_SEPOLIA',
  selector: 3478487238524512106n,
  router: '0x8F95FA37c55eF7beFdf05f6abDeC551773E17Fb4',
  onRamp: '0xcA5842B776Ea62712AE58A0d4D6363Cb51fB38d8',
  token: '0x40D55FeC015F7B54eCA0807CE33818C1C4d84D48', // MTTP1
} as const

// A token transfer ARB -> RH through the pool, executed on RH (state Success)
const PINNED = {
  messageId: '0x3c2e8cffcdf1a836b53f89280cef9b688d30106f9befe306e38943e0ec4ab323',
  sendTx: '0x8f34754782e1c61d017a04366426c2949fc06efcefedf7c2d62b74ae4eb8d83f',
  execTx: '0x911931564ad60606bd09ae43545c4599ccbd5ea23bc2413b4fd104c69c12f618',
  amount: 2n * 10n ** 18n,
}

/** A receiver with no code: the destination runs no ccipReceive. */
const EOA = '0x000000000000000000000000000000000000dEaD'

describe(
  'EVM multi-token pool integration (staging, read-only)',
  { skip, timeout: 300_000 },
  () => {
    let rh: EVMChain | undefined
    let arb: EVMChain | undefined
    let deployed = false

    before(async () => {
      const [rhRpc, arbRpc] = await Promise.all([
        reachableRpcEndpoint(RH.rpc),
        reachableRpcEndpoint(ARB.rpc),
      ])
      ;[rh, arb] = await Promise.all([
        EVMChain.fromUrl(rhRpc, { apiClient: null, logger: testLogger }),
        EVMChain.fromUrl(arbRpc, { apiClient: null, logger: testLogger }),
      ])
      const types = await Promise.all(
        [rh, arb].map((chain) =>
          chain.typeAndVersion(POOL).then(
            ([type]) => type,
            () => '',
          ),
        ),
      )
      deployed = types.every((type) => type.includes('MultiTokenPool'))
    })

    after(() => {
      rh?.provider.destroy()
      arb?.provider.destroy()
    })

    /** Both directions of the lane: [name, source, dest, source config, dest config]. */
    const directions = () =>
      [
        ['robinhood -> arbitrum', rh!, arb!, RH, ARB],
        ['arbitrum -> robinhood', arb!, rh!, ARB, RH],
      ] as const

    const raw = (chain: EVMChain) => ({
      pool: new Contract(POOL, interfaces.MultiTokenPool_v2_1, chain.provider),
      pcm: async () =>
        new Contract(
          (await new Contract(POOL, interfaces.MultiTokenPool_v2_1, chain.provider)
            .getFunction('getPoolConfigManager')
            .staticCall()) as string,
          interfaces.PoolConfigManager_v2_1,
          chain.provider,
        ),
    })

    it('throws CCIPLocalTokenRequiredError for pool reads without a token', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [, src] of directions()) {
        for (const read of [
          () => src.getTokenPoolConfig(POOL),
          () => src.getTokenPoolRemotes(POOL),
          () => src.getTokenForTokenPool(POOL),
        ])
          await assert.rejects(read(), CCIPLocalTokenRequiredError)
      }
    })

    it('throws CCIPTokenNotConfiguredError for a token the PCM does not register', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      assert.ok(rh && arb)
      await assert.rejects(rh.getTokenPoolConfig(POOL, { token: EOA }), CCIPTokenNotConfiguredError)
    })

    it("resolves the pool's TokenAdminRegistry, with and without a destination", async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [, src, , S, D] of directions()) {
        const viaRouter = await src.getTokenAdminRegistryFor(S.router, D.selector)
        assert.equal(await src.getTokenAdminRegistryFor(POOL), viaRouter)
        // the router has no lane to the default hub chain: the lookup falls back to its own lanes
        assert.equal(await src.getTokenAdminRegistryFor(S.router), viaRouter)
        assert.equal(
          (await src.getRegistryTokenConfig(viaRouter, S.token)).tokenPool,
          getAddress(POOL),
        )
      }
    })

    it('getTokenPoolConfig matches the raw pool and PCM state', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [name, src, , S, D] of directions()) {
        const { pool, pcm: getPcm } = raw(src)
        const pcm = await getPcm()
        const [[tokenConfig], staticConfig, router, rawFee] = await Promise.all([
          pcm.getFunction('getTokenConfigBatch').staticCall([S.token]),
          pcm.getFunction('getStaticConfig').staticCall(),
          pool.getFunction('getRouter').staticCall(),
          pool
            .getFunction('getTokenTransferFeeConfig')
            .staticCall(S.token, D.selector, '0x00000000', '0x'),
        ])
        const config = await src.getTokenPoolConfig(POOL, {
          token: S.token,
          destChainSelector: D.selector,
        })

        assert.equal(config.token, getAddress(S.token), name)
        assert.equal(config.router, router, name)
        assert.match(config.typeAndVersion, /^BurnMintMultiTokenPool /, name)
        assert.equal(config.decimals, Number(tokenConfig.localDecimals), name)
        assert.equal(config.poolConfigManager, await pcm.getAddress(), name)
        assert.equal(config.connectionPolicyStore, staticConfig[1], name)
        assert.equal(config.feePolicyStore, staticConfig[2], name)
        assert.equal(config.securityPolicyStore, staticConfig[3], name)
        // allowedFinalityConfig: bytes4 of (safe flag | block depth)
        const allowed = Number(tokenConfig.allowedFinalityConfig)
        assert.equal(config.finalityDepth ?? 0, allowed & 0xffff, name)
        assert.equal(!!config.finalitySafe, (allowed & 0x10000) !== 0, name)
        assert.deepEqual(
          config.tokenTransferFeeConfig,
          {
            destGasOverhead: Number(rawFee.destGasOverhead),
            destBytesOverhead: Number(rawFee.destBytesOverhead),
            finalityFeeUSDCents: Number(rawFee.finalityFeeUSDCents),
            fastFinalityFeeUSDCents: Number(rawFee.fastFinalityFeeUSDCents),
            finalityTransferFeeBps: Number(rawFee.finalityTransferFeeBps),
            fastFinalityTransferFeeBps: Number(rawFee.fastFinalityTransferFeeBps),
            isEnabled: rawFee.isEnabled,
          },
          name,
        )
        // a long pool data token transfer needs room for (decimals, source token, extra data)
        assert.ok(config.tokenTransferFeeConfig!.destBytesOverhead >= 192, name)
      }
    })

    it('getTokenPoolRemotes matches the raw lane connection and rate limits, both ways', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [name, src, dst, S, D] of directions()) {
        const pcm = await raw(src).pcm()
        const lane = [[S.token, D.selector]]
        const [[connection], [buckets], levels] = await Promise.all([
          pcm.getFunction('getLaneConnectionBatch').staticCall(lane),
          pcm.getFunction('getCurrentRateLimiterStateBatch').staticCall(lane),
          pcm.getFunction('getLaneRecordLevelBatch').staticCall(lane),
        ])
        const remotes = await src.getTokenPoolRemotes(POOL, D.selector, { token: S.token })
        const remote = Object.values(remotes)[0]!
        assert.equal(Object.keys(remotes).length, 1, name)
        assert.ok('fastOutboundRateLimiterState' in remote, `${name}: v2 remote shape`)
        assert.equal(remote.remoteToken, D.token, name)
        assert.equal(decodeAddress(connection.remoteToken, dst.network.family), D.token, name)
        assert.deepEqual(
          remote.remotePools,
          connection.remotePools.map((p: { remotePoolAddress: string }) =>
            decodeAddress(p.remotePoolAddress, dst.network.family),
          ),
          name,
        )

        // buckets: a disabled one reads null, an enabled one keeps its capacity and rate
        for (const [field, bucket] of [
          ['outboundRateLimiterState', buckets.outbound],
          ['inboundRateLimiterState', buckets.inbound],
          ['fastOutboundRateLimiterState', buckets.fastFinalityOutbound],
          ['fastInboundRateLimiterState', buckets.fastFinalityInbound],
        ] as const) {
          const state: RateLimiterState = remote[field]
          if (!bucket.isEnabled) {
            assert.equal(state, null, `${name} ${field}`)
            continue
          }
          assert.ok(state, `${name} ${field}`)
          assert.equal(state.capacity, bucket.capacity, `${name} ${field}`)
          assert.equal(state.rate, bucket.rate, `${name} ${field}`)
          assert.ok(state.tokens <= state.capacity, `${name} ${field}`)
        }

        // status: no pause flag and every transfer record present means `ok`
        const paused = [
          'isOutboundPaused',
          'isInboundPaused',
          'isGloballyPaused',
          'isTokenOutboundPaused',
          'isTokenInboundPaused',
          'isChainOutboundPaused',
          'isChainInboundPaused',
        ].some((flag) => connection[flag] as boolean)
        const complete = [...levels].every((level: bigint[]) => level.every((l) => l > 0n))
        if (!paused && complete) {
          assert.deepEqual(remote.outboundStatus, { status: 'ok' }, name)
          assert.deepEqual(remote.inboundStatus, { status: 'ok' }, name)
        } else
          assert.ok(
            remote.outboundStatus?.status !== 'ok' || remote.inboundStatus?.status !== 'ok',
            name,
          )

        // the remote side maps the token back
        const back = await dst.getTokenPoolRemote(POOL, S.selector, { token: D.token })
        assert.equal(back.remoteToken, S.token, name)
      }
    })

    it('getLaneFeatures reports the token lane status, finality and rate limits', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [name, src, , S, D] of directions()) {
        const [features, remote, config] = await Promise.all([
          src.getLaneFeatures({ router: S.router, destChainSelector: D.selector, token: S.token }),
          src.getTokenPoolRemote(POOL, D.selector, { token: S.token }),
          src.getTokenPoolConfig(POOL, { token: S.token }),
        ])
        assert.ok('fastOutboundRateLimiterState' in remote, `${name}: v2 remote shape`)
        assert.deepEqual(features[LaneFeature.LANE_STATUS], remote.outboundStatus, name)
        assert.equal(
          features[LaneFeature.RATE_LIMITS]?.capacity,
          remote.outboundRateLimiterState?.capacity,
          name,
        )
        // FAST_RATE_LIMITS only when the fast bucket is enabled
        assert.equal(
          LaneFeature.FAST_RATE_LIMITS in features,
          remote.fastOutboundRateLimiterState != null,
          name,
        )
        if (config.finalityDepth)
          assert.equal(features[LaneFeature.FINALITY_FAST], config.finalityDepth, name)
      }
    })

    it('getTotalFeesEstimate quotes a token transfer with the pool fee config', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [name, src, , S, D] of directions()) {
        const message = { receiver: EOA, tokenAmounts: [{ token: S.token, amount: 10n ** 18n }] }
        const [estimate, fee, config] = await Promise.all([
          src.getTotalFeesEstimate({ router: S.router, destChainSelector: D.selector, message }),
          src.getFee({ router: S.router, destChainSelector: D.selector, message }),
          src.getTokenPoolConfig(POOL, { token: S.token, destChainSelector: D.selector }),
        ])
        assert.ok(fee > 0n, name)
        assert.equal(estimate.ccipFee, fee, name)
        assert.ok(config.tokenTransferFeeConfig?.isEnabled, name)
        assert.equal(
          estimate.tokenTransferFee?.bps,
          config.tokenTransferFeeConfig!.finalityTransferFeeBps,
          name,
        )
      }
    })

    it('simulates lockOrBurn to long pool data the destination releaseOrMint accepts', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      for (const [name, src, dst, S, D] of directions()) {
        const amount = 10n ** 18n
        const sim = await src.simulateLockOrBurn({
          onRamp: S.onRamp,
          destChainSelector: D.selector,
          token: S.token,
          amount,
          originalSender: EOA,
          receiver: EOA,
        })
        assert.equal(sim.sourcePoolAddress, getAddress(POOL), name)
        assert.equal(decodeAddress(sim.destTokenAddress, dst.network.family), D.token, name)
        assert.ok(dataLength(sim.destPoolData) >= 192, `${name}: long pool data`)
        assert.equal(getSourceDecimalsFromExtraData(sim.destPoolData), 18, name)
        assert.equal(
          getSourceTokenFromExtraData(sim.destPoolData, src.network.family),
          S.token,
          name,
        )

        // the destination preflight simulates releaseOrMint with that pool data
        const [offRamp] = await dst.getOffRampsForRouter(D.router, S.selector)
        assert.ok(offRamp, name)
        assert.equal(
          await dst.checkExecute({
            offRamp,
            message: {
              sourceChainSelector: S.selector,
              receiver: EOA,
              onRampAddress: S.onRamp,
              tokenAmounts: [
                {
                  amount: sim.destTokenAmount,
                  sourceTokenAddress: S.token,
                  sourcePoolAddress: sim.sourcePoolAddress,
                  destTokenAddress: D.token,
                  extraData: sim.destPoolData,
                },
              ],
            },
          }),
          true,
          name,
        )
      }
    })

    it('decodes a sent token transfer and its execution receipt', async (t) => {
      if (!deployed) return t.skip('staging multi-token pool not deployed')
      assert.ok(rh && arb)
      const tx = await arb.getTransaction(PINNED.sendTx)
      const request = (await arb.getMessagesInTx(tx)).find(
        (r) => r.message.messageId === PINNED.messageId,
      )
      assert.ok(request, 'message in its send tx')
      assert.equal(request.lane.destChainSelector, RH.selector)
      const [tokenAmount] = request.message.tokenAmounts
      assert.ok(tokenAmount && 'extraData' in tokenAmount, 'token amount with pool data')
      assert.equal(dataLength(tokenAmount.extraData), 224)
      assert.equal(getSourceDecimalsFromExtraData(tokenAmount.extraData), 18)
      assert.equal(
        getSourceTokenFromExtraData(tokenAmount.extraData, arb.network.family),
        ARB.token,
      )
      assert.equal(tokenAmount.amount, PINNED.amount)

      assert.deepEqual(
        await getDestTokenAmount({
          source: arb,
          onRamp: request.lane.onRamp,
          dest: rh,
          tokenAmount: tokenAmount as never,
        }),
        { token: RH.token, amount: PINNED.amount },
      )

      const execTx = await rh.getTransaction(PINNED.execTx)
      const receipt = execTx.logs
        .map((log) => EVMChain.decodeReceipt(log))
        .find((r) => r?.messageId === PINNED.messageId)
      assert.ok(receipt, 'execution receipt in its tx')
      assert.equal(receipt.state, ExecutionState.Success)
      assert.equal(receipt.sourceChainSelector, ARB.selector)
    })
  },
)
