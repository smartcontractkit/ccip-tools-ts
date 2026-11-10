/**
 * Read-only integration tests for multi-token pools (MTTP), against the live staging
 * `BurnMintMultiTokenPool 2.1.0-dev` on the robinhood-testnet <-> arbitrum-sepolia lane.
 *
 * Every SDK read is checked against a raw read of the same state through the generated
 * pool and PoolConfigManager (PCM) ABIs, in both directions. A pinned, executed token transfer
 * in each direction checks the long (224-byte) pool data decode, the destination execution
 * receipt, and a receipt search by time on the destination.
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
  // a 4.0 MTTP1 transfer RH -> ARB through the pool, executed on ARB (state Success)
  sent: {
    messageId: '0x939d72cd1f157f7c6b6be33bfb03741b599d085b64baf8aa2c3bceda66aadce0',
    sendTx: '0xef482779c47ae60019044a6c00c246a84f66833be8f8a927e4d0049e6aacfdf6',
    execTx: '0x279444d8f8a22c206f7d3c9c446492d22efb4a73fd8b7aeaf407f534305cfe2d',
    amount: 4n * 10n ** 18n,
  },
} as const
const ARB = {
  rpc: 'RPC_ARBITRUM_SEPOLIA',
  selector: 3478487238524512106n,
  router: '0x8F95FA37c55eF7beFdf05f6abDeC551773E17Fb4',
  onRamp: '0xcA5842B776Ea62712AE58A0d4D6363Cb51fB38d8',
  token: '0x40D55FeC015F7B54eCA0807CE33818C1C4d84D48', // MTTP1
  // a 2.0 MTTP1 transfer ARB -> RH through the pool, executed on RH (state Success)
  sent: {
    messageId: '0x5fc643692aa88dfbafc98d79c3212b5c72c0b505662c1046f18c4daf9fc97999',
    sendTx: '0x9e668b46004743cd4b428c56016e3e9ae648826bdef7eaa286de7b112f3e9f1e',
    execTx: '0x09742e17915d0512c0fb34285c43ad6b317ca7f49bfba58bc4bfe7a499e6a28d',
    amount: 2n * 10n ** 18n,
  },
} as const

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
      for (const [name, src, dst, S, D] of directions()) {
        const sent = S.sent
        const tx = await src.getTransaction(sent.sendTx)
        const request = (await src.getMessagesInTx(tx)).find(
          (r) => r.message.messageId === sent.messageId,
        )
        assert.ok(request, `${name}: message in its send tx`)
        assert.equal(request.lane.destChainSelector, D.selector, name)
        const [tokenAmount] = request.message.tokenAmounts
        assert.ok(tokenAmount && 'extraData' in tokenAmount, `${name}: token amount with pool data`)
        assert.equal(dataLength(tokenAmount.extraData), 224, name)
        assert.equal(getSourceDecimalsFromExtraData(tokenAmount.extraData), 18, name)
        assert.equal(
          getSourceTokenFromExtraData(tokenAmount.extraData, src.network.family),
          S.token,
          name,
        )
        assert.equal(tokenAmount.amount, sent.amount, name)

        assert.deepEqual(
          await getDestTokenAmount({
            source: src,
            onRamp: request.lane.onRamp,
            dest: dst,
            tokenAmount: tokenAmount as never,
          }),
          { token: D.token, amount: sent.amount },
          name,
        )

        const execTx = await dst.getTransaction(sent.execTx)
        const execLog = execTx.logs.find(
          (log) => EVMChain.decodeReceipt(log)?.messageId === sent.messageId,
        )
        assert.ok(execLog, `${name}: execution receipt in its tx`)
        const receipt = EVMChain.decodeReceipt(execLog)!
        assert.equal(receipt.state, ExecutionState.Success, name)
        assert.equal(receipt.sourceChainSelector, S.selector, name)

        // A receipt search by time (as `show` without the API does) finds the execution, with
        // its block's real timestamp: an RPC that sends a `0x0` log blockTimestamp placeholder
        // (robinhood-testnet) must not date the log to 1970 and drop it. The range is bounded to
        // the blocks just before the execution, so the scan stays small as the fixture ages.
        const found = []
        for await (const log of dst.getLogs({
          address: execLog.address,
          topics: ['ExecutionStateChanged'],
          startTime: execTx.timestamp - 30,
          endBlock: execLog.blockNumber,
        }))
          if (EVMChain.decodeReceipt(log)?.messageId === sent.messageId) found.push(log)
        assert.equal(found.length, 1, `${name}: receipt found by a search from its time`)
        assert.equal(found[0]!.blockTimestamp, execTx.timestamp, name)
      }
    })
  },
)
