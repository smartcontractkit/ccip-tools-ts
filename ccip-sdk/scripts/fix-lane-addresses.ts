/**
 * Re-wire a pool's remote lane with corrected addresses: removes the lane and
 * re-adds it in one `applyChainUpdates` call (single approval). Needed because
 * an earlier deploy stored `0x`-prefixed remoteTokenAddress/remotePools, which
 * the on-ledger message encoder rejects ("InvalidDestChainAddress: not valid
 * hex"). The SDK now strips the prefix; this script fixes lanes deployed before
 * that change.
 *
 * Run:
 *   CONFIG_JSON=pool.json node --experimental-strip-types ccip-sdk/scripts/fix-lane-addresses.ts
 *
 * pool.json: same file as deploy-pool-e2e.ts. The lane is re-added with the
 * same rate limiters (unchanged contracts) and the same remote token/pool —
 * just normalized to bare hex.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import * as readline from 'node:readline'

import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import {
  GatewaySubmitError,
  ensureGatewaySession,
  fetchGatewayPrimaryParty,
  submitViaGateway,
} from '../src/cct/canton/gateway-submitter.ts'
import { CantonTokenManager } from '../src/cct/canton/index.ts'

interface LaneFixConfig {
  owner?: string
  instrumentId?: string
  poolInstanceId?: string
  poolType?: string
  remoteChainSelector?: string
  remoteTokenAddress?: string
  remotePools?: string
  ccv?: string
  gatewayUrl?: string
  gatewayAccessToken?: string
}

async function main(): Promise<void> {
  const file = JSON.parse(
    readFileSync(process.env['CONFIG_JSON'] ?? 'pool.json', 'utf8'),
  ) as LaneFixConfig

  const chainId = 'canton:TestNet'
  const network = getCantonNetworkConfig(chainId)
  if (!network) throw new Error(`No network config for ${chainId}`)

  const gatewayUrl = file.gatewayUrl ?? 'http://localhost:8400/api/v0/dapp'
  const accessToken = file.gatewayAccessToken
  if (!accessToken) throw new Error('gatewayAccessToken missing from config')

  const owner = file.owner ?? (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
  const instrumentId = file.instrumentId ?? ''
  const poolInstanceId = file.poolInstanceId ?? `${instrumentId.toLowerCase()}-pool-001`
  const poolType = (file.poolType ?? 'burnMint') as 'burnMint' | 'lockRelease'
  const remoteChainSelector = BigInt(file.remoteChainSelector ?? '')
  const poolInstanceAddress = `${poolInstanceId}@${owner}`
  const remoteTokenAddress = file.remoteTokenAddress ?? ''
  const remotePools = (file.remotePools ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!remoteTokenAddress || remotePools.length === 0) {
    throw new Error('remoteTokenAddress and remotePools are required in the config')
  }
  // CCV(s) the pool mandates for this lane — REQUIRED for token-only transfers:
  // computeExecuteCCVs uses lane-mandated + pool CCVs only for those (the
  // receiver's own requiredCCVs are ignored), and empty pool CCVs fall back to
  // the lane defaults, which may not include the CCV that verifies this lane.
  const ccvs = (file.ccv ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ccvs.length === 0) throw new Error('ccv is required in the config (raw instance address)')

  const gatewayNetworkId = process.env['GATEWAY_NETWORK_ID']?.trim() || 'canton:chainlink-testnet'
  await ensureGatewaySession({ gatewayUrl, accessToken, networkId: gatewayNetworkId })

  const { CantonChain } = await import('../src/canton/index.ts')
  const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')
  const ledgerUrl = network.ledgerUrl
  if (!ledgerUrl) throw new Error(`No ledger URL for ${chainId}`)
  const ledgerFetch = createGatewayLedgerFetch({ gatewayUrl, accessToken, ledgerBaseUrl: ledgerUrl })
  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
    fetch: ledgerFetch,
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

  // Existing limiter addresses (unchanged contracts, re-referenced by the re-added lane).
  const rlIn = `${poolInstanceId}-rl-in-${remoteChainSelector}@${owner}`
  const rlOut = `${poolInstanceId}-rl-out-${remoteChainSelector}@${owner}`
  const rlInCustom = `${poolInstanceId}-rl-in-custom-${remoteChainSelector}@${owner}`

  console.error('Re-wire lane (remove + re-add, normalized hex):')
  console.error('  pool               ', poolInstanceAddress)
  console.error('  chain              ', remoteChainSelector.toString())
  console.error('  remoteTokenAddress ', remoteTokenAddress)
  console.error('  remotePools        ', remotePools.join(', '))

  const unsigned = await manager.generateUnsignedApplyChainUpdates({
    poolInstanceAddress,
    poolType,
    remoteChainSelectorsToRemove: [remoteChainSelector],
    chainsToAdd: [
      {
        remoteChainSelector,
        remotePools,
        remoteTokenAddress,
        inboundCCVs: ccvs,
        outboundCCVs: ccvs,
        inboundRateLimiter: rlIn,
        outboundRateLimiter: rlOut,
        inboundCustomBlockConfirmationsRateLimiter: rlInCustom,
      },
    ],
    sender: owner,
  })

  const result = await submitViaGateway({ gatewayUrl, accessToken, unsigned })
  console.error('   prepared. Approve at:', result.approveUrl ?? 'http://localhost:8400/approve/')
  if (process.env['NO_PROMPT'] !== '1') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    await new Promise<void>((resolve) =>
      rl.question('   press Enter after approving in the gateway… ', () => {
        rl.close()
        resolve()
      }),
    )
  }

  const state = await manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
  const lane = state?.remoteChainConfigs?.find(
    (c) => c.remoteChainSelector === remoteChainSelector.toString(),
  )
  if (!lane) throw new Error('lane missing after re-add')
  console.error('   ✓ lane re-added:', JSON.stringify(lane.remoteTokenAddress))
  if (lane.remoteTokenAddress?.startsWith('0x')) {
    throw new Error('remoteTokenAddress still 0x-prefixed on-ledger — normalization did not apply')
  }
  console.error('✓ lane addresses normalized (bare hex)')
}

main().catch((err) => {
  if (err instanceof GatewaySubmitError) {
    console.error('Fatal:', err.message)
    console.error('Gateway error data:', JSON.stringify(err.data, null, 2))
  } else {
    console.error('Fatal:', err instanceof Error ? err.message : err)
  }
  process.exitCode = 1
})
