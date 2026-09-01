/**
 * Validate a deployed registry token pool end-to-end: pool config, TAR
 * registration, all 3 rate limiters (capacity/rate/enabled), and lane wiring —
 * printed as a clear pass/fail report. Built for showing a third party that a
 * deployment is fully and correctly configured, not just "it exists."
 *
 * Read-only — no wallet, no signing, no gateway approval. Reads the same
 * `CONFIG_JSON` pool.json as `deploy-pool-e2e.ts` (gateway creds, owner,
 * instrumentId, poolInstanceId, poolType, remote-chain settings). All ledger
 * access routes through the wallet gateway's `ledgerApi` proxy — no
 * participant JWT, no direct participant access.
 *
 * ```
 * CONFIG_JSON=pool.json node --experimental-strip-types ccip-sdk/scripts/validate-pool-deployment.ts
 * ```
 *
 * Exits 0 if every check passes, 1 otherwise — safe to wire into CI or a demo
 * script, not just eyeballed interactively.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'

import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import {
  GatewaySubmitError,
  ensureGatewaySession,
  fetchGatewayPrimaryParty,
} from '../src/cct/canton/gateway-submitter.ts'
import { deriveTokenConfigInstanceAddress } from '../src/cct/canton/token-admin-registry/shared.ts'
import type { PoolFactoryDeps } from '../src/cct/canton/token-pool/shared.ts'

/** The subset of pool.json this tool needs (mirrors deploy-pool-e2e.ts). */
interface PoolConfig {
  owner?: string
  admin?: string
  ccipOwner?: string
  chainId?: string
  ledgerUrl?: string
  edsUrl?: string
  gatewayUrl?: string
  gatewayAccessToken?: string
  instrumentId?: string
  decimals?: number
  poolType?: 'burnMint' | 'lockRelease'
  poolInstanceId?: string
  remoteChainSelector?: string
  remoteTokenAddress?: string
  remotePools?: string
  rlCapacity?: string
  rlRate?: string
  observers?: string
  deps?: Partial<PoolFactoryDeps>
}

function loadConfigFile(): PoolConfig {
  const path = process.env['CONFIG_JSON']?.trim()
  if (!path) throw new Error('Missing CONFIG_JSON (path to pool.json)')
  return JSON.parse(readFileSync(path, 'utf8')) as PoolConfig
}

/** Resolve a setting: environment variable wins over the config file. */
function setting(
  file: PoolConfig,
  envName: string,
  key: Exclude<keyof PoolConfig, 'deps'>,
): string | undefined {
  const env = process.env[envName]?.trim()
  if (env) return env
  const v = file[key]
  return v == null ? undefined : String(v)
}

/** One validation check's outcome. */
interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

const results: CheckResult[] = []

/** Run a check, catching thrown errors as a failure rather than crashing the report. */
async function check(
  name: string,
  run: () => Promise<{ pass: boolean; detail: string }>,
): Promise<void> {
  try {
    const { pass, detail } = await run()
    results.push({ name, pass, detail })
  } catch (err) {
    results.push({ name, pass: false, detail: err instanceof Error ? err.message : String(err) })
  }
}

async function main(): Promise<void> {
  const file = loadConfigFile()
  const chainId = setting(file, 'CANTON_CHAIN_ID', 'chainId') ?? 'canton:TestNet'
  const network = getCantonNetworkConfig(chainId)
  const ledgerUrl =
    setting(file, 'CANTON_LEDGER_URL', 'ledgerUrl') ??
    network?.ledgerUrl ??
    (() => {
      throw new Error(`No ledger URL for ${chainId}: set CANTON_LEDGER_URL`)
    })()
  const gatewayUrl = setting(file, 'GATEWAY_URL', 'gatewayUrl')
  const accessToken = setting(file, 'GATEWAY_ACCESS_TOKEN', 'gatewayAccessToken')
  if (!gatewayUrl || !accessToken) {
    throw new Error(
      'pool.json needs gatewayUrl + gatewayAccessToken (or GATEWAY_URL / GATEWAY_ACCESS_TOKEN env)',
    )
  }

  const owner =
    setting(file, 'OWNER', 'owner') ?? (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
  if (!owner) throw new Error('pool.json needs owner (or OWNER env)')
  const ccipOwner =
    setting(file, 'CCIP_OWNER', 'ccipOwner') ??
    network?.ccipOwner ??
    (() => {
      throw new Error(`No well-known ccipOwner for ${chainId}: set CCIP_OWNER`)
    })()
  const admin = setting(file, 'ADMIN', 'admin') ?? owner

  const gatewayNetworkId = process.env['GATEWAY_NETWORK_ID']?.trim() || 'canton:chainlink-testnet'
  try {
    await ensureGatewaySession({ gatewayUrl, accessToken, networkId: gatewayNetworkId })
  } catch (err) {
    const msg =
      err instanceof GatewaySubmitError
        ? `${err.message}\n   error data: ${JSON.stringify(err.data)}`
        : String(err)
    console.error(`   ⚠ ensureGatewaySession failed: ${msg} — reads will likely fail too.`)
  }

  const instrumentIdText = setting(file, 'INSTRUMENT_ID', 'instrumentId')
  if (!instrumentIdText) throw new Error('pool.json needs instrumentId')
  const instrumentId = { admin: owner, id: instrumentIdText }
  const decimals = setting(file, 'DECIMALS', 'decimals')
  const poolType = (setting(file, 'POOL_TYPE', 'poolType') ?? 'burnMint') as
    'burnMint' | 'lockRelease'
  const poolInstanceId =
    setting(file, 'POOL_INSTANCE_ID', 'poolInstanceId') ??
    `${instrumentIdText.toLowerCase()}-pool-001`
  const observers = (setting(file, 'OBSERVERS', 'observers') ?? ccipOwner)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const remoteChainSelectorText = setting(file, 'REMOTE_CHAIN_SELECTOR', 'remoteChainSelector')
  const remoteTokenAddress = setting(file, 'REMOTE_TOKEN_ADDRESS', 'remoteTokenAddress')
  const remotePools = setting(file, 'REMOTE_POOLS', 'remotePools')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const rlCapacity = setting(file, 'RL_CAPACITY', 'rlCapacity') ?? '1000000'
  const rlRate = setting(file, 'RL_RATE', 'rlRate') ?? '100'

  const tokenConfigAddress = deriveTokenConfigInstanceAddress(instrumentId, ccipOwner)
  const poolInstanceAddress = `${poolInstanceId}@${owner}`
  const rlInInstanceId = `${poolInstanceId}-rl-in-${remoteChainSelectorText}`
  const rlOutInstanceId = `${poolInstanceId}-rl-out-${remoteChainSelectorText}`
  const rlInCustomInstanceId = `${poolInstanceId}-rl-in-custom-${remoteChainSelectorText}`
  const rlInRaw = `${rlInInstanceId}@${owner}`
  const rlOutRaw = `${rlOutInstanceId}@${owner}`
  const rlInCustomRaw = `${rlInCustomInstanceId}@${owner}`

  console.error('Validating deployment:')
  console.error('  owner       ', owner)
  console.error('  instrumentId', `${instrumentId.admin}::${instrumentId.id}`)
  console.error('  pool        ', poolInstanceAddress)
  console.error('  observers   ', observers.join(', '))
  console.error('')

  const { CantonChain } = await import('../src/canton/index.ts')
  const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')
  const { CantonTokenManager } = await import('../src/cct/canton/index.ts')

  const ledgerFetch = createGatewayLedgerFetch({
    gatewayUrl,
    accessToken,
    ledgerBaseUrl: ledgerUrl,
  })
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
      ccipParty: ccipOwner,
      jwt: accessToken,
      edsUrl: setting(file, 'EDS_URL', 'edsUrl') ?? network?.edsUrl ?? 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
      chainId,
    },
  })
  const manager = CantonTokenManager.fromChain(chain)

  // ── Check 1: pool exists with the expected config ─────────────────────
  await check('Pool deployed with expected config', async () => {
    const state = await manager.getTokenPoolState({
      poolInstanceAddress,
      poolType,
      poolOwner: owner,
    })
    const mismatches: string[] = []
    if (state.poolOwner !== owner)
      mismatches.push(`poolOwner: got ${state.poolOwner}, want ${owner}`)
    if (decimals && String(state.decimals) !== decimals) {
      mismatches.push(`decimals: got ${state.decimals}, want ${decimals}`)
    }
    if (state.instrumentId.id !== instrumentId.id) {
      mismatches.push(`instrumentId: got ${state.instrumentId.id}, want ${instrumentId.id}`)
    }
    const missingObservers = observers.filter((o) => !state.observers.includes(o))
    if (missingObservers.length > 0) {
      mismatches.push(
        `observers: missing ${JSON.stringify(missingObservers)} (has ${JSON.stringify(state.observers)})`,
      )
    }
    return mismatches.length === 0
      ? {
          pass: true,
          detail: `owner=${state.poolOwner}, decimals=${state.decimals}, instrument=${state.instrumentId.id}, observers=${JSON.stringify(state.observers)}`,
        }
      : { pass: false, detail: mismatches.join('; ') }
  })

  // ── Check 2: TAR registration (SetPool) ────────────────────────────────
  await check('Pool registered in TAR (SetPool)', async () => {
    const tar = await manager.getTokenAdminRegistry({
      tokenConfigInstanceAddress: tokenConfigAddress,
      adminParty: owner,
    })
    if (tar.admin !== admin)
      return { pass: false, detail: `admin: got ${tar.admin ?? '(none)'}, want ${admin}` }
    if (tar.tokenPool?.poolInstanceId !== poolInstanceId) {
      return {
        pass: false,
        detail: `tokenPool.poolInstanceId: got ${tar.tokenPool?.poolInstanceId ?? '(not registered)'}, want ${poolInstanceId}`,
      }
    }
    return { pass: true, detail: `admin=${tar.admin}, tokenPool=${tar.tokenPool.poolInstanceId}` }
  })

  // ── Check 3: remote-chain lane wired ────────────────────────────────────
  if (remoteChainSelectorText) {
    await check(`Remote chain ${remoteChainSelectorText} wired (ApplyChainUpdates)`, async () => {
      const state = await manager.getTokenPoolState({
        poolInstanceAddress,
        poolType,
        poolOwner: owner,
      })
      const lane = state.remoteChainConfigs.find(
        (c) => c.remoteChainSelector === remoteChainSelectorText,
      )
      if (!lane)
        return { pass: false, detail: `no remoteChainConfigs entry for ${remoteChainSelectorText}` }
      const mismatches: string[] = []
      if (remoteTokenAddress && lane.remoteTokenAddress !== remoteTokenAddress) {
        mismatches.push(
          `remoteTokenAddress: got ${lane.remoteTokenAddress}, want ${remoteTokenAddress}`,
        )
      }
      if (remotePools && JSON.stringify(lane.remotePools) !== JSON.stringify(remotePools)) {
        mismatches.push(
          `remotePools: got ${JSON.stringify(lane.remotePools)}, want ${JSON.stringify(remotePools)}`,
        )
      }
      return mismatches.length === 0
        ? {
            pass: true,
            detail: `remotePools=${JSON.stringify(lane.remotePools)}, remoteTokenAddress=${lane.remoteTokenAddress}`,
          }
        : { pass: false, detail: mismatches.join('; ') }
    })
  }

  // ── Checks 4-6: rate limiters (in / out / in-custom) ────────────────────
  const rateLimiterChecks: Array<[string, string]> = [
    ['inbound rate limiter', rlInRaw],
    ['outbound rate limiter', rlOutRaw],
    ['inbound-custom-finality rate limiter', rlInCustomRaw],
  ]
  for (const [label, rawAddress] of rateLimiterChecks) {
    await check(`${label} deployed and enabled`, async () => {
      const rl = await manager.getRateLimiterState({
        rateLimiterInstanceAddress: rawAddress,
        poolOwner: owner,
      })
      const mismatches: string[] = []
      if (!rl.isEnabled) mismatches.push('isEnabled: got false, want true')
      if (rl.capacity !== rlCapacity)
        mismatches.push(`capacity: got ${rl.capacity}, want ${rlCapacity}`)
      if (rl.rate !== rlRate) mismatches.push(`rate: got ${rl.rate}, want ${rlRate}`)
      return mismatches.length === 0
        ? {
            pass: true,
            detail: `capacity=${rl.capacity}, rate=${rl.rate}, tokens=${rl.tokens}, enabled=${rl.isEnabled}`,
          }
        : { pass: false, detail: mismatches.join('; ') }
    })
  }

  // NOTE: `getRequiredCCVs` is intentionally NOT checked here. Unlike the reads
  // above (pure ACS queries), it exercises a nonconsuming ledger choice via
  // `submitAndWaitForTransaction` — a real command submission requiring `actAs`
  // signing rights for `owner`. The gateway's `ledgerApi` proxy only grants a
  // read-only service-account context, so this can never succeed through this
  // script's no-wallet setup; it would always report as a false failure that
  // has nothing to do with whether the deployment is actually correct.

  // ── Report ───────────────────────────────────────────────────────────
  console.error('════════════════════════════════════════════════════════')
  console.error(' Validation report')
  console.error('════════════════════════════════════════════════════════')
  for (const r of results) {
    console.error(` ${r.pass ? '✓' : '✗'} ${r.name}`)
    console.error(`   ${r.detail}`)
  }
  const failed = results.filter((r) => !r.pass)
  console.error('════════════════════════════════════════════════════════')
  if (failed.length === 0) {
    console.error(` ✓ All ${results.length} checks passed — deployment is fully configured.`)
  } else {
    console.error(` ✗ ${failed.length}/${results.length} checks failed.`)
    process.exitCode = 1
  }
  console.error('════════════════════════════════════════════════════════')
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
