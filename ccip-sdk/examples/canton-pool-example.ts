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
const chainId = 'canton:TestNet'
const network = getCantonNetworkConfig(chainId)!
const owner = cfg.owner ?? (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))

// ── Setup: chain + manager (all ledger access via the wallet gateway) ──────
await ensureGatewaySession({ gatewayUrl, accessToken, networkId: 'canton:chainlink-testnet' })
const { CantonChain } = await import('../src/canton/index.ts')
const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')
const chain = await CantonChain.fromUrl(network.ledgerUrl!, {
  fetch: createGatewayLedgerFetch({ gatewayUrl, accessToken, ledgerBaseUrl: network.ledgerUrl! }),
  cantonConfig: {
    party: owner,
    ccipParty: network.ccipOwner,
    jwt: accessToken,
    edsUrl: 'http://unused-here.local',
    transferInstructionUrl: 'http://unused-here.local',
    chainId,
  },
})
const manager = CantonTokenManager.fromChain(chain)

// ── Deploy: one atomic tx (create pool + Initialize: TAR registration, lane
//    wiring, 3 rate limiters, SetPool) ──────────────────────────────────────
const instrumentId = cfg.instrumentId
const decimals = Number(cfg.decimals)
const selector = BigInt(cfg.remoteChainSelector)
const poolInstanceId = `${instrumentId.toLowerCase()}-pool-001`
const scale = 10n ** BigInt(decimals)
const capacity = BigInt(cfg.rlCapacity ?? '1000000') * scale
const rate = BigInt(cfg.rlRate ?? '100') * scale

const unsigned = await manager.generateUnsignedDeployTokenPool({
  poolType: 'burnMint',
  instanceId: poolInstanceId,
  poolOwner: owner,
  ccipOwner: network.ccipOwner,
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
  poolType: 'burnMint',
  poolOwner: owner,
})
const tar = await manager.getTokenAdminRegistry({
  tokenConfigInstanceAddress: deriveTokenConfigInstanceAddress(
    { admin: owner, id: instrumentId },
    network.ccipOwner,
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
