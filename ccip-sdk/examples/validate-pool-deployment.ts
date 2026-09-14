/**
 * Validate a deployed token pool end-to-end: pool config, TAR registration,
 * lane wiring (addresses + CCVs + limiter references), factory wiring, and all
 * 3 rate limiters — as a pass/fail report. Read-only: no wallet, no signing.
 *
 *   CONFIG_JSON=pool.json node --experimental-strip-types ccip-sdk/examples/validate-pool-deployment.ts
 *
 * Exits 0 if every check passes, 1 otherwise.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'

import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import {
  ensureGatewaySession,
  fetchGatewayPrimaryParty,
} from '../src/cct/canton/gateway-submitter.ts'
import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { deriveTokenConfigInstanceAddress } from '../src/cct/canton/token-admin-registry/shared.ts'
import { normalizeRemoteAddress } from '../src/cct/canton/token-pool/shared.ts'

interface PoolConfig {
  owner?: string
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

const cfg = JSON.parse(
  readFileSync(process.env['CONFIG_JSON'] ?? 'pool.json', 'utf8'),
) as PoolConfig

const chainId = 'canton:TestNet'
const network = getCantonNetworkConfig(chainId)!
const gatewayUrl = cfg.gatewayUrl
const accessToken = cfg.gatewayAccessToken
const owner = cfg.owner ?? (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
const ccipOwner = network.ccipOwner

const instrumentId = { admin: owner, id: cfg.instrumentId }
const poolType = 'burnMint' as const
const poolInstanceId = `${cfg.instrumentId.toLowerCase()}-pool-001`
const poolInstanceAddress = `${poolInstanceId}@${owner}`
const observers = cfg.observers.split(',').map((s) => s.trim())
const selector = cfg.remoteChainSelector ?? ''
const ccvs = (cfg.ccv ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const wantCapacity = cfg.rlCapacity ?? '1000000'
const wantRate = cfg.rlRate ?? '100'
const tokenConfigAddress = deriveTokenConfigInstanceAddress(instrumentId, ccipOwner)
const rlIn = `${poolInstanceId}-rl-in-${selector}@${owner}`
const rlOut = `${poolInstanceId}-rl-out-${selector}@${owner}`
const rlInCustom = `${poolInstanceId}-rl-in-custom-${selector}@${owner}`

await ensureGatewaySession({ gatewayUrl, accessToken, networkId: 'canton:chainlink-testnet' })
const { CantonChain } = await import('../src/canton/index.ts')
const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')
const chain = await CantonChain.fromUrl(network.ledgerUrl!, {
  fetch: createGatewayLedgerFetch({ gatewayUrl, accessToken, ledgerBaseUrl: network.ledgerUrl! }),
  cantonConfig: {
    party: owner,
    ccipParty: ccipOwner,
    jwt: accessToken,
    edsUrl: 'http://unused-here.local',
    transferInstructionUrl: 'http://unused-here.local',
    chainId,
  },
})
const manager = CantonTokenManager.fromChain(chain)

// ── Checks ─────────────────────────────────────────────────────────────────

let failures = 0
async function check(name: string, run: () => Promise<{ pass: boolean; detail: string }>) {
  try {
    const { pass, detail } = await run()
    console.error(` ${pass ? '✓' : '✗'} ${name}\n   ${detail}`)
    if (!pass) failures++
  } catch (err) {
    console.error(` ✗ ${name}\n   ${err instanceof Error ? err.message : String(err)}`)
    failures++
  }
}

const getPool = () => manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
const getTar = () =>
  manager.getTokenAdminRegistry({
    tokenConfigInstanceAddress: tokenConfigAddress,
    adminParty: owner,
  })

await check('Pool deployed with expected config', async () => {
  const state = await getPool()
  const bad: string[] = []
  if (state.poolOwner !== owner) bad.push(`poolOwner: got ${state.poolOwner}, want ${owner}`)
  if (cfg.decimals && state.decimals !== cfg.decimals)
    bad.push(`decimals: got ${state.decimals}, want ${cfg.decimals}`)
  if (state.instrumentId.id !== instrumentId.id)
    bad.push(`instrumentId: got ${state.instrumentId.id}, want ${instrumentId.id}`)
  const missing = observers.filter((o) => !state.observers.includes(o))
  if (missing.length > 0) bad.push(`observers missing: ${missing.join(', ')}`)
  return bad.length === 0
    ? {
        pass: true,
        detail: `owner=${state.poolOwner}, decimals=${state.decimals}, observers=${JSON.stringify(state.observers)}`,
      }
    : { pass: false, detail: bad.join('; ') }
})

await check('Pool registered in TAR (SetPool)', async () => {
  const tar = await getTar()
  if (tar.admin !== owner)
    return { pass: false, detail: `admin: got ${tar.admin ?? '(none)'}, want ${owner}` }
  if (tar.tokenPool?.poolInstanceId !== poolInstanceId)
    return {
      pass: false,
      detail: `tokenPool: got ${tar.tokenPool?.poolInstanceId ?? '(none)'}, want ${poolInstanceId}`,
    }
  return { pass: true, detail: `admin=${tar.admin}, tokenPool=${tar.tokenPool.poolInstanceId}` }
})

await check(`Remote chain ${selector} wired`, async () => {
  const state = await getPool()
  const lane = state.remoteChainConfigs.find((c) => c.remoteChainSelector === selector)
  if (!lane) return { pass: false, detail: `no remoteChainConfigs entry for ${selector}` }
  const bad: string[] = []
  if (
    cfg.remoteTokenAddress &&
    lane.remoteTokenAddress !== normalizeRemoteAddress(cfg.remoteTokenAddress)
  )
    bad.push(
      `remoteTokenAddress: got ${lane.remoteTokenAddress}, want ${normalizeRemoteAddress(cfg.remoteTokenAddress)}`,
    )
  const wantPools = (cfg.remotePools ?? '').split(',').map((s) => normalizeRemoteAddress(s.trim()))
  if (cfg.remotePools && JSON.stringify(lane.remotePools) !== JSON.stringify(wantPools))
    bad.push(
      `remotePools: got ${JSON.stringify(lane.remotePools)}, want ${JSON.stringify(wantPools)}`,
    )
  return bad.length === 0
    ? {
        pass: true,
        detail: `remotePools=${JSON.stringify(lane.remotePools)}, remoteTokenAddress=${lane.remoteTokenAddress}`,
      }
    : { pass: false, detail: bad.join('; ') }
})

// Token-only transfers ignore the receiver's requiredCCVs — the pool's lane
// CCVs are the entire execute-time requirement, so they must be non-empty.
await check('Lane CCVs mandated', async () => {
  const lane = (await getPool()).remoteChainConfigs.find((c) => c.remoteChainSelector === selector)
  if (!lane) return { pass: false, detail: `no remoteChainConfigs entry for ${selector}` }
  const bad: string[] = []
  if (lane.inboundCCVs.length === 0) bad.push('inboundCCVs empty (falls back to lane defaults)')
  if (lane.outboundCCVs.length === 0) bad.push('outboundCCVs empty (falls back to lane defaults)')
  for (const c of ccvs) {
    if (!lane.inboundCCVs.includes(c)) bad.push(`inboundCCVs missing ${c}`)
    if (!lane.outboundCCVs.includes(c)) bad.push(`outboundCCVs missing ${c}`)
  }
  return bad.length === 0
    ? {
        pass: true,
        detail: `inbound=${JSON.stringify(lane.inboundCCVs)}, outbound=${JSON.stringify(lane.outboundCCVs)}`,
      }
    : { pass: false, detail: bad.join('; ') }
})

await check('Lane references the deployed rate limiters', async () => {
  const lane = (await getPool()).remoteChainConfigs.find((c) => c.remoteChainSelector === selector)
  if (!lane) return { pass: false, detail: `no remoteChainConfigs entry for ${selector}` }
  const bad: string[] = []
  if (lane.inboundRateLimiter !== rlIn)
    bad.push(`inbound: got ${lane.inboundRateLimiter}, want ${rlIn}`)
  if (lane.outboundRateLimiter !== rlOut)
    bad.push(`outbound: got ${lane.outboundRateLimiter}, want ${rlOut}`)
  if (lane.inboundCustomBlockConfirmationsRateLimiter !== rlInCustom)
    bad.push(
      `inboundCustomFinality: got ${lane.inboundCustomBlockConfirmationsRateLimiter}, want ${rlInCustom}`,
    )
  return bad.length === 0
    ? { pass: true, detail: 'all 3 limiter references match' }
    : { pass: false, detail: bad.join('; ') }
})

// Without these, the pool's LockOrBurn/ReleaseFromTicket aborts on-ledger.
await check('Token factories wired in TAR', async () => {
  const tar = await getTar()
  const missing: string[] = []
  if (!tar.burnMintFactorySet) missing.push('burnMintFactory')
  if (!tar.transferFactorySet) missing.push('transferFactory')
  return missing.length === 0
    ? { pass: true, detail: 'burnMintFactory + transferFactory set' }
    : { pass: false, detail: `not set: ${missing.join(', ')}` }
})

for (const [label, addr] of [
  ['inbound rate limiter', rlIn],
  ['outbound rate limiter', rlOut],
  ['inbound-custom-finality rate limiter', rlInCustom],
] as const) {
  await check(`${label} deployed and enabled`, async () => {
    const rl = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: addr,
      poolOwner: owner,
    })
    const bad: string[] = []
    if (!rl.isEnabled) bad.push('not enabled')
    if (rl.capacity !== wantCapacity) bad.push(`capacity: got ${rl.capacity}, want ${wantCapacity}`)
    if (rl.rate !== wantRate) bad.push(`rate: got ${rl.rate}, want ${wantRate}`)
    return bad.length === 0
      ? { pass: true, detail: `capacity=${rl.capacity}, rate=${rl.rate}, enabled=${rl.isEnabled}` }
      : { pass: false, detail: bad.join('; ') }
  })
}

console.error(failures === 0 ? '\n✓ All 9 checks passed' : `\n✗ ${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
