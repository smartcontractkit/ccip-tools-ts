/**
 * Integration tests for `CantonTokenManager` reads against a live, previously
 * deployed token pool on Canton testnet — pool config, TAR registration, lane
 * wiring (addresses + CCVs + limiter references), factory wiring, and all 3
 * rate limiters. Read-only: no wallet, no signing.
 *
 * Requires `CANTON_TESTNET_POOL_CONFIG` (JSON, see {@link PoolConfig}) — the
 * suite skips if unset, same as an unconfigured RPC secret elsewhere.
 *
 * @packageDocumentation
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { getCantonNetworkConfig } from '../../canton/networks.ts'
import { ensureGatewaySession, fetchGatewayPrimaryParty } from './gateway.test.helpers.ts'
import { deriveTokenConfigInstanceAddress } from './token-admin-registry/shared.ts'
import { normalizeRemoteAddress } from './token-pool/shared.ts'
import { CantonTokenManager } from './index.ts'

interface PoolConfig {
  owner?: string
  ccipOwner?: string
  chainId?: string
  ledgerUrl?: string
  edsUrl?: string
  poolType?: 'burnMint' | 'lockRelease'
  poolInstanceId?: string
  instrumentId: string
  decimals?: number
  observers: string
  ccv?: string
  remoteChainSelector?: string
  remoteTokenAddress?: string
  remotePools?: string
  rlCapacity?: string
  rlRate?: string
  gatewayUrl: string
  gatewayAccessToken: string
}

const rawConfig = process.env['CANTON_TESTNET_POOL_CONFIG']
const skip = !!process.env.SKIP_INTEGRATION_TESTS || !rawConfig

describe(
  'CantonTokenManager reads against a deployed pool (live gateway, read-only)',
  { skip, timeout: 60_000 },
  () => {
    // Parsed only when the suite actually runs — an empty/malformed value
    // shouldn't fail suite collection when the whole thing is skipped anyway.
    const cfg = JSON.parse(rawConfig ?? '{}') as PoolConfig

    const chainId = cfg.chainId ?? 'canton:TestNet'
    const network = getCantonNetworkConfig(chainId)!
    const gatewayUrl = cfg.gatewayUrl
    const accessToken = cfg.gatewayAccessToken
    const ccipOwner = cfg.ccipOwner || network.ccipOwner
    const ledgerUrl = cfg.ledgerUrl ?? network.ledgerUrl
    const edsUrl = cfg.edsUrl ?? network.edsUrl

    const poolType = cfg.poolType ?? 'burnMint'
    const poolInstanceId = cfg.poolInstanceId || `${cfg.instrumentId.toLowerCase()}-pool-001`
    const observers = cfg.observers.split(',').map((s) => s.trim())
    const selector = cfg.remoteChainSelector ?? ''
    const ccvs = (cfg.ccv ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // Rate-limit capacity/rate are scaled to the pool's decimals on-ledger —
    // compare against the scaled form of the config's human-unit values.
    const rlScale = 10n ** BigInt(cfg.decimals ?? 10)
    const wantCapacity = (BigInt(cfg.rlCapacity ?? '1000000') * rlScale).toString()
    const wantRate = (BigInt(cfg.rlRate ?? '100') * rlScale).toString()

    let owner: string
    let instrumentId: { admin: string; id: string }
    let poolInstanceAddress: string
    let tokenConfigAddress: string
    let rlIn: string
    let rlOut: string
    let rlInCustom: string
    let manager: CantonTokenManager

    before(async () => {
      if (!ledgerUrl) throw new Error(`No ledger URL for ${chainId} — set ledgerUrl in the config`)
      owner = cfg.owner || (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
      instrumentId = { admin: owner, id: cfg.instrumentId }
      poolInstanceAddress = `${poolInstanceId}@${owner}`
      tokenConfigAddress = deriveTokenConfigInstanceAddress(instrumentId, ccipOwner)
      rlIn = `${poolInstanceId}-rl-in-${selector}@${owner}`
      rlOut = `${poolInstanceId}-rl-out-${selector}@${owner}`
      rlInCustom = `${poolInstanceId}-rl-in-custom-${selector}@${owner}`

      await ensureGatewaySession({ gatewayUrl, accessToken, networkId: 'canton:chainlink-testnet' })
      const { CantonChain } = await import('../../canton/index.ts')
      const { createGatewayLedgerFetch } = await import('./gateway.test.helpers.ts')
      const chain = await CantonChain.fromUrl(ledgerUrl, {
        fetch: createGatewayLedgerFetch({
          gatewayUrl,
          accessToken,
          ledgerBaseUrl: network.ledgerUrl!,
        }),
        cantonConfig: {
          party: owner,
          ccipParty: ccipOwner,
          jwt: accessToken,
          edsUrl: edsUrl ?? 'http://unused-here.local', // unused by these reads
          transferInstructionUrl: 'http://unused-here.local',
          chainId,
        },
      })
      manager = CantonTokenManager.fromChain(chain)
    })

    const getPool = () =>
      manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
    const getTar = () =>
      manager.getTokenAdminRegistry({
        tokenConfigInstanceAddress: tokenConfigAddress,
        adminParty: owner,
      })

    it('pool deployed with expected config', async () => {
      const state = await getPool()
      assert.equal(state.poolOwner, owner)
      if (cfg.decimals) assert.equal(state.decimals, cfg.decimals)
      assert.equal(state.instrumentId.id, instrumentId.id)
      for (const o of observers) assert.ok(state.observers.includes(o), `missing observer ${o}`)
    })

    it('pool registered in TAR (SetPool)', async () => {
      const tar = await getTar()
      assert.equal(tar.admin, owner)
      assert.equal(tar.tokenPool?.poolInstanceId, poolInstanceId)
    })

    it('remote chain wired', async () => {
      const state = await getPool()
      const lane = state.remoteChainConfigs.find((c) => c.remoteChainSelector === selector)
      assert.ok(lane, `no remoteChainConfigs entry for ${selector}`)
      if (cfg.remoteTokenAddress) {
        assert.equal(lane.remoteTokenAddress, normalizeRemoteAddress(cfg.remoteTokenAddress))
      }
      if (cfg.remotePools) {
        const wantPools = cfg.remotePools.split(',').map((s) => normalizeRemoteAddress(s.trim()))
        assert.deepEqual(lane.remotePools, wantPools)
      }
    })

    // Token-only transfers ignore the receiver's requiredCCVs — the pool's lane
    // CCVs are the entire execute-time requirement, so they must be non-empty.
    it('lane CCVs mandated', async () => {
      const state = await getPool()
      const lane = state.remoteChainConfigs.find((c) => c.remoteChainSelector === selector)
      assert.ok(lane, `no remoteChainConfigs entry for ${selector}`)
      assert.ok(lane.inboundCCVs.length > 0, 'inboundCCVs empty (falls back to lane defaults)')
      assert.ok(lane.outboundCCVs.length > 0, 'outboundCCVs empty (falls back to lane defaults)')
      for (const c of ccvs) {
        assert.ok(lane.inboundCCVs.includes(c), `inboundCCVs missing ${c}`)
        assert.ok(lane.outboundCCVs.includes(c), `outboundCCVs missing ${c}`)
      }
    })

    it('lane references the deployed rate limiters', async () => {
      const state = await getPool()
      const lane = state.remoteChainConfigs.find((c) => c.remoteChainSelector === selector)
      assert.ok(lane, `no remoteChainConfigs entry for ${selector}`)
      assert.equal(lane.inboundRateLimiter, rlIn)
      assert.equal(lane.outboundRateLimiter, rlOut)
      assert.equal(lane.inboundCustomBlockConfirmationsRateLimiter, rlInCustom)
    })

    // Without these, the pool's LockOrBurn/ReleaseFromTicket aborts on-ledger.
    it('token factories wired in TAR', async () => {
      const tar = await getTar()
      // Older TAR deployments predate the factory fields — nothing to check there.
      if (!tar.factoryFieldsSupported) return
      assert.ok(tar.burnMintFactorySet, 'burnMintFactory not set')
      assert.ok(tar.transferFactorySet, 'transferFactory not set')
    })

    for (const [label, addr] of [
      ['inbound', () => rlIn],
      ['outbound', () => rlOut],
      ['inbound-custom-finality', () => rlInCustom],
    ] as const) {
      it(`${label} rate limiter deployed and enabled`, async () => {
        const rl = await manager.getRateLimiterState({
          rateLimiterInstanceAddress: addr(),
          poolOwner: owner,
        })
        assert.ok(rl.isEnabled, 'not enabled')
        assert.equal(rl.capacity, wantCapacity)
        assert.equal(rl.rate, wantRate)
      })
    }
  },
)
