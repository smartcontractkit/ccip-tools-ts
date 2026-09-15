/**
 * Concise Canton token-pool example: deploy (one atomic tx) + validate.
 *
 * Shows the whole SDK surface an integrator needs:
 *   deploy   — generateUnsignedDeployTokenPool → wallet prepareExecute → approve
 *   validate — getTokenPoolState / getTokenAdminRegistry / getRateLimiterState
 *
 * Run:
 *   CONFIG_JSON=pool.json node --experimental-strip-types ccip-sdk/examples/canton-pool-example.ts
 *
 * pool.json fields: instrumentId, decimals, observers, ccv, remoteChainSelector,
 * remoteTokenAddress, remotePools, gatewayUrl, gatewayAccessToken.
 * See examples/pool.example.json for the shape.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import * as readline from 'node:readline'

import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import {
  ensureGatewaySession,
  fetchGatewayPrimaryParty,
  submitViaGateway,
} from '../src/cct/canton/gateway-submitter.ts'
import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { deriveTokenConfigInstanceAddress } from '../src/cct/canton/token-admin-registry/shared.ts'

interface PoolExampleConfig {
  owner?: string
  admin?: string
  ccipOwner?: string
  chainId?: string
  ledgerUrl?: string
  edsUrl?: string
  poolType?: 'burnMint' | 'lockRelease'
  poolInstanceId?: string
  instrumentId: string
  decimals: number
  observers: string
  ccv: string
  remoteChainSelector: string
  remoteTokenAddress: string
  remotePools: string
  rlCapacity?: string
  rlRate?: string
  gatewayUrl: string
  gatewayAccessToken: string
}

const cfg = JSON.parse(
  readFileSync(process.env['CONFIG_JSON'] ?? 'pool.json', 'utf8'),
) as PoolExampleConfig

const gatewayUrl = cfg.gatewayUrl
const accessToken = cfg.gatewayAccessToken
const chainId = cfg.chainId ?? 'canton:TestNet'
const network = getCantonNetworkConfig(chainId)!
const ledgerUrl = cfg.ledgerUrl ?? network.ledgerUrl
if (!ledgerUrl) throw new Error(`No ledger URL for ${chainId} — set ledgerUrl in the config`)
const edsUrl = cfg.edsUrl ?? network.edsUrl
if (!edsUrl) throw new Error(`No EDS URL for ${chainId} — set edsUrl in the config`)
const owner = cfg.owner || (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
const ccipOwner = cfg.ccipOwner || network.ccipOwner

// ── Setup: chain + manager (all ledger access via the wallet gateway) ──────
await ensureGatewaySession({ gatewayUrl, accessToken, networkId: 'canton:chainlink-testnet' })
const { CantonChain } = await import('../src/canton/index.ts')
const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')
const chain = await CantonChain.fromUrl(ledgerUrl, {
  fetch: createGatewayLedgerFetch({ gatewayUrl, accessToken, ledgerBaseUrl: ledgerUrl }),
  cantonConfig: {
    party: owner,
    ccipParty: ccipOwner,
    jwt: accessToken,
    // The EDS disclosure service — REQUIRED for external parties: the deploy
    // resolves the TAR contract through it (TAR is signatory-only to ccipOwner,
    // so no external party can ACS-read it; the EDS disclosure endpoint is
    // public and unauthenticated by design).
    edsUrl,
    transferInstructionUrl: 'http://unused-here.local', // unused by this flow
    chainId,
  },
})
const manager = CantonTokenManager.fromChain(chain)

// ── Deploy: one atomic tx (create pool + Initialize: TAR registration, lane
//    wiring, 3 rate limiters, SetPool) ──────────────────────────────────────
const instrumentId = cfg.instrumentId
const decimals = Number(cfg.decimals)
const selector = BigInt(cfg.remoteChainSelector)
const poolType = (cfg.poolType ?? 'burnMint') as 'burnMint' | 'lockRelease'
const poolInstanceId = cfg.poolInstanceId || `${instrumentId.toLowerCase()}-pool-001`
const scale = 10n ** BigInt(decimals)
const capacity = BigInt(cfg.rlCapacity ?? '1000000') * scale
const rate = BigInt(cfg.rlRate ?? '100') * scale

const unsigned = await manager.generateUnsignedDeployTokenPool({
  poolType,
  instanceId: poolInstanceId,
  poolOwner: owner,
  ccipOwner,
  instrumentId: { admin: owner, id: instrumentId },
  decimals,
  observers: String(cfg.observers).split(','),
  admin: owner,
  tokenAdminRegistryInstanceAddress: network.tokenAdminRegistry,
  lanes: [
    {
      remoteChainSelector: selector,
      remotePools: String(cfg.remotePools).split(','),
      remoteTokenAddress: cfg.remoteTokenAddress,
      inboundCCVs: String(cfg.ccv).split(','),
      outboundCCVs: String(cfg.ccv).split(','),
      inbound: {
        instanceId: `${poolInstanceId}-rl-in-${selector}`,
        isEnabled: true,
        capacity,
        rate,
      },
      outbound: {
        instanceId: `${poolInstanceId}-rl-out-${selector}`,
        isEnabled: true,
        capacity,
        rate,
      },
      inboundCustomFinality: {
        instanceId: `${poolInstanceId}-rl-in-custom-${selector}`,
        isEnabled: true,
        capacity,
        rate,
      },
    },
  ],
  sender: owner,
})

const { approveUrl } = await submitViaGateway({ gatewayUrl, accessToken, unsigned })
console.error('Approve at:', approveUrl)
const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
await new Promise<void>((r) =>
  rl.question('press Enter after approving… ', () => {
    rl.close()
    r()
  }),
)

// ── Validate: reads only, no wallet ────────────────────────────────────────
const poolInstanceAddress = `${poolInstanceId}@${owner}`
const pool = await manager.getTokenPoolState({
  poolInstanceAddress,
  poolType,
  poolOwner: owner,
})
const tar = await manager.getTokenAdminRegistry({
  tokenConfigInstanceAddress: deriveTokenConfigInstanceAddress(
    { admin: owner, id: instrumentId },
    ccipOwner,
  ),
  adminParty: owner,
})
const rlIn = await manager.getRateLimiterState({
  rateLimiterInstanceAddress: `${poolInstanceId}-rl-in-${selector}@${owner}`,
  poolOwner: owner,
})

console.error('\n── deployment state ──')
console.error(
  'pool:',
  pool.poolInstanceId,
  '| instrument:',
  pool.instrumentId.id,
  '| decimals:',
  pool.decimals,
  '| observers:',
  pool.observers,
)
console.error('lane:', JSON.stringify(pool.remoteChainConfigs, null, 1))
console.error(
  'TAR:',
  `admin=${tar.admin}`,
  `| pool=${tar.tokenPool?.poolInstanceId}`,
  `| factories: burnMint=${tar.burnMintFactorySet} transfer=${tar.transferFactorySet}`,
)
console.error(
  'rate limiter (in):',
  `enabled=${rlIn.isEnabled}`,
  `capacity=${rlIn.capacity}`,
  `rate=${rlIn.rate}`,
)
