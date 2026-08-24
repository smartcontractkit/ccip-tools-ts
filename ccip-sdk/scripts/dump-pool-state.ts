/**
 * Verify / debug a deployed token pool's on-ledger state: fetch the pool's raw
 * `createArgument` from the ACS and dump the `remoteChainConfigs` field's JSON
 * shape + the decoded `getTokenPoolState` view, so you can confirm a lane is
 * correctly wired (remote chain, remote pools, rate limiters) or diagnose a
 * misconfigured pool.
 *
 * Reads the same `CONFIG_JSON` pool.json as deploy-pool-e2e.ts (gateway creds,
 * owner, instrumentId, poolInstanceId, poolType) — no separate env vars needed.
 * All ledger access routes through the wallet gateway (`ledgerApi` proxy); no
 * participant JWT, no direct participant access.
 *
 *   CONFIG_JSON=pool.json \
 *     node --experimental-strip-types ccip-sdk/scripts/dump-pool-state.ts
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import { fetchGatewayPrimaryParty } from '../src/cct/canton/gateway-submitter.ts'

/** The subset of pool.json this tool needs (mirrors deploy-pool-e2e.ts). */
interface PoolConfig {
  owner?: string
  chainId?: string
  ledgerUrl?: string
  gatewayUrl?: string
  gatewayAccessToken?: string
  instrumentId?: string
  poolType?: 'burnMint' | 'lockRelease'
  poolInstanceId?: string
}

function loadConfigFile(): PoolConfig {
  const path = process.env['CONFIG_JSON']?.trim()
  if (!path) throw new Error('Missing CONFIG_JSON (path to pool.json)')
  return JSON.parse(readFileSync(path, 'utf8')) as PoolConfig
}

/** Resolve a setting: environment variable wins over the config file. */
function setting(file: PoolConfig, envName: string, key: keyof PoolConfig): string | undefined {
  const env = process.env[envName]?.trim()
  if (env) return env
  const v = file[key]
  return v == null ? undefined : String(v)
}

async function main(): Promise<void> {
  const file = loadConfigFile()
  const chainId = setting(file, 'CANTON_CHAIN_ID', 'chainId') ?? 'canton:TestNet'
  const network = getCantonNetworkConfig(chainId)
  const ledgerUrl =
    setting(file, 'CANTON_LEDGER_URL', 'ledgerUrl') ??
    network?.ledgerUrl ??
    (() => { throw new Error('No ledger URL for ' + chainId + ': set CANTON_LEDGER_URL') })()
  const gatewayUrl = setting(file, 'GATEWAY_URL', 'gatewayUrl')
  const accessToken = setting(file, 'GATEWAY_ACCESS_TOKEN', 'gatewayAccessToken')
  if (!gatewayUrl || !accessToken) {
    throw new Error('pool.json needs gatewayUrl + gatewayAccessToken (or GATEWAY_URL / GATEWAY_ACCESS_TOKEN env)')
  }
  // Owner: explicit, else the gateway session's primary wallet (same as deploy-pool-e2e).
  const instrumentId = setting(file, 'INSTRUMENT_ID', 'instrumentId')
  const owner =
    setting(file, 'OWNER', 'owner') ??
    (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
  if (!owner) throw new Error('pool.json needs owner (or OWNER env)')
  if (!instrumentId) throw new Error('pool.json needs instrumentId')
  const poolType = (setting(file, 'POOL_TYPE', 'poolType') ?? 'burnMint') as 'burnMint' | 'lockRelease'
  const poolInstanceId =
    setting(file, 'POOL_INSTANCE_ID', 'poolInstanceId') ??
    `${instrumentId.toLowerCase()}-pool-001`
  const poolInstanceAddress = `${poolInstanceId}@${owner}`

  console.error('Looking up pool:', poolInstanceAddress, '(' + poolType + ')')

  const { CantonChain } = await import('../src/canton/index.ts')
  const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')

  // Route reads through the gateway `ledgerApi` proxy — no direct participant
  // access, no participant JWT. The proxy authenticates as the caller's token.
  const ledgerFetch = createGatewayLedgerFetch({ gatewayUrl, accessToken, ledgerBaseUrl: ledgerUrl })

  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (...a: unknown[]) => console.error('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
    fetch: ledgerFetch,
    cantonConfig: {
      party: owner,
      ccipParty: network?.ccipOwner ?? owner,
      // Unused for proxied reads; defaulted to the gateway credential.
      jwt: accessToken,
      edsUrl: 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
      chainId,
    },
  })

  const { BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID } =
    await import('../src/cct/canton/token-pool/shared.ts')
  const templateId = poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

  const contract = await chain.findActiveContractByInstanceAddress(
    templateId,
    poolInstanceAddress,
    [owner],
  )
  if (!contract) {
    console.error('Pool not found / not visible to', owner)
    process.exitCode = 1
    return
  }
  console.error('Pool contractId:', contract.contractId)
  console.error('Pool templateId:', contract.templateId)
  console.error('Signatories:', contract.signatories)
  console.error('\n=== full createArgument ===')
  console.error(JSON.stringify(contract.createArgument, null, 2))

  // Also decode via the manager to see what the decoder produces (this is what
  // the deploy-pool-e2e confirmation poll checks).
  const { CantonTokenManager } = await import('../src/cct/canton/index.ts')
  const manager = CantonTokenManager.fromChain(chain)
  const state = await manager
    .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
    .catch((e: unknown) => ({ error: String(e) }) as unknown)
  console.error('\n=== decoded getTokenPoolState ===')
  console.error(JSON.stringify(state, null, 2))
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
