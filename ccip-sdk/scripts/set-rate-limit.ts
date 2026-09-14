/**
 * Set rate-limit configs on a deployed Canton pool's rate limiters, via the CCT
 * SDK + Wallet Gateway.
 *
 * Rate-limiter capacity/rate are scaled to the pool's `decimals` (on-ledger
 * invariant — see RateLimiterV2: "Must be scaled according to the associated
 * token pool's decimals setting"). This script takes HUMAN token units and
 * scales them: with decimals=18, capacity "1000000" is sent as 1e6 * 10^18.
 *
 * Run:
 *   CONFIG_JSON=pool.json RL_CAPACITY=1000000 RL_RATE=100 node --experimental-strip-types ccip-sdk/scripts/set-rate-limit.ts
 *
 * pool.json: same file as deploy-pool-e2e.ts (instrumentId, decimals,
 * remoteChainSelector, gatewayUrl, gatewayAccessToken). RL_CAPACITY / RL_RATE
 * env vars override the 1M/100 defaults. NO_PROMPT=1 skips the approval pause.
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

interface RateLimitScriptConfig {
  owner?: string
  instrumentId?: string
  poolInstanceId?: string
  poolType?: string
  decimals?: number
  remoteChainSelector?: string
  gatewayUrl?: string
  gatewayAccessToken?: string
}

/** Canton Numerics can render with a trailing "." or ".0" — compare digit-wise. */
function numericEq(a: string | undefined, b: bigint): boolean {
  if (!a) return false
  const stripped = a.replace(/\.0*$/, '')
  return stripped === b.toString()
}

async function main(): Promise<void> {
  const file = JSON.parse(
    readFileSync(process.env['CONFIG_JSON'] ?? 'pool.json', 'utf8'),
  ) as RateLimitScriptConfig

  const chainId = 'canton:TestNet'
  const network = getCantonNetworkConfig(chainId)
  if (!network) throw new Error(`No network config for ${chainId}`)

  const gatewayUrl = file.gatewayUrl ?? 'http://localhost:8400/api/v0/dapp'
  const accessToken = file.gatewayAccessToken
  if (!accessToken) throw new Error('gatewayAccessToken missing from config')

  const owner = file.owner ?? (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
  const ccipOwner = network.ccipOwner
  const instrumentId = file.instrumentId ?? ''
  const poolInstanceId = file.poolInstanceId ?? `${instrumentId.toLowerCase()}-pool-001`
  const poolType = (file.poolType ?? 'burnMint') as 'burnMint' | 'lockRelease'
  const decimals = file.decimals ?? 10
  const remoteChainSelector = BigInt(file.remoteChainSelector ?? '')
  const poolInstanceAddress = `${poolInstanceId}@${owner}`

  // Human units → base units (scaled by the pool's decimals).
  const scale = 10n ** BigInt(decimals)
  const rlEnabled = process.env['RL_ENABLED'] !== 'false'
  // On-ledger invariant: a disabled config must carry zero capacity and rate.
  const capacity = rlEnabled ? BigInt(process.env['RL_CAPACITY'] ?? '1000000') * scale : 0n
  const rate = rlEnabled ? BigInt(process.env['RL_RATE'] ?? '100') * scale : 0n

  const gatewayNetworkId = process.env['GATEWAY_NETWORK_ID']?.trim() || 'canton:chainlink-testnet'
  await ensureGatewaySession({ gatewayUrl, accessToken, networkId: gatewayNetworkId })

  const { CantonChain } = await import('../src/canton/index.ts')
  const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')
  // All ledger access routes through the wallet gateway (see deploy-pool-e2e.ts).
  const ledgerUrl = network.ledgerUrl
  if (!ledgerUrl) throw new Error(`No ledger URL for ${chainId}`)
  const ledgerFetch = createGatewayLedgerFetch({
    gatewayUrl,
    accessToken,
    ledgerBaseUrl: ledgerUrl,
  })
  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: () => {},
      info: (...a: unknown[]) => console.error('[info]', ...a),
      warn: (...a: unknown[]) => console.error('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
    fetch: ledgerFetch,
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

  console.error('Set rate limits:')
  console.error('  pool      ', poolInstanceAddress)
  console.error('  chain     ', remoteChainSelector.toString())
  console.error('  capacity  ', `${capacity} (base units, ${decimals} decimals)`)
  console.error('  rate      ', `${rate} (base units/s)`)

  const rlIn = `${poolInstanceId}-rl-in-${remoteChainSelector}@${owner}`
  const rlOut = `${poolInstanceId}-rl-out-${remoteChainSelector}@${owner}`
  const rlInCustom = `${poolInstanceId}-rl-in-custom-${remoteChainSelector}@${owner}`

  // One submission per limiter: the gateway's interactive-submission prepare
  // rejects multi-command batches ("Preparing multiple commands is currently
  // not supported"). Includes the inbound custom-finality limiter (gates FTF
  // inbound transfers); the Daml choice targets any pool-configured limiter
  // by CID, so the in/out slots are just batching labels here.
  for (const [label, rlAddr, direction] of [
    [
      'inbound',
      rlIn,
      { inbound: { rateLimiterInstanceAddress: rlIn, capacity, rate, enabled: rlEnabled } },
    ],
    [
      'outbound',
      rlOut,
      { outbound: { rateLimiterInstanceAddress: rlOut, capacity, rate, enabled: rlEnabled } },
    ],
    [
      'inbound-custom-finality',
      rlInCustom,
      { inbound: { rateLimiterInstanceAddress: rlInCustom, capacity, rate, enabled: rlEnabled } },
    ],
  ] as const) {
    console.error(`\n══ set ${label} rate limit`)
    const unsigned = await manager.generateUnsignedSetRateLimitConfig({
      poolInstanceAddress,
      poolType,
      remoteChainSelector,
      ...direction,
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

    const state = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: rlAddr,
      poolOwner: owner,
    })
    console.error(
      `   ✓ ${label}: capacity=${state?.capacity} rate=${state?.rate} enabled=${state?.isEnabled}`,
    )
    if (!numericEq(state?.capacity, capacity) || !numericEq(state?.rate, rate)) {
      throw new Error(
        `${label} rate limiter did not confirm (got capacity=${state?.capacity} rate=${state?.rate})`,
      )
    }
  }
  console.error('✓ all rate limiters updated')
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
