/**
 * End-to-end token-pool deploy on Canton, driven through the CCT SDK
 * (`CantonTokenManager`) with signing via the Wallet Gateway.
 *
 * ONE gateway approval: `deployTokenPool` builds a single atomic
 * `CreateAndExercise` — create the registry-pools BurnMintTokenPool /
 * LockReleaseTokenPool AND exercise `Initialize` on it in the same
 * transaction. `Initialize` internally does what used to be 6 separate
 * approvals in this script: ProposeAdministrator + AcceptAdminRole (TAR
 * registration), deploying the lane's 3 rate limiters (inbound / outbound /
 * inbound-custom-finality), ApplyChainUpdates (wiring the lane), and SetPool
 * (registering the pool in the TAR). Because it's one Daml transaction, it's
 * all-or-nothing — there's no partial-progress state to resume from
 * mid-flight, unlike the old 7-step phased flow this script used to drive.
 *
 * No real token contract is needed: TAR registration + pool deploy carry the
 * instrumentId as data only. Use a synthetic instrument whose admin is your
 * party (e.g. INSTRUMENT_ID=TESTTOKEN).
 *
 * ─── Prereqs ─────────────────────────────────────────────────────────────
 * - Self-hosted wallet gateway running (config.chainlink-testnet.json).
 *   EVERYTHING routes through the wallet gateway — both submission
 *   (`prepareExecute` → human Approve → signing driver signs → execute) AND
 *   ledger reads (the `ledgerApi` proxy, via the network service account). The
 *   script never contacts the Canton participant directly and holds no
 *   participant JWT / CanReadAs grant. The gateway is the sole auth + signing
 *   seam.
 * - A gateway credential in `gatewayAccessToken`:
 *     • A raw Bearer/Okta **access token** (the user flow). The script calls
 *       `ensureGatewaySession` at startup to self-provision the gateway session
 *       row that `prepareExecute` + the `ledgerApi` proxy require (the user-API
 *       `addSession` RPC, headless — no browser login needed). Human approves
 *       the tx in the gateway UI. The access token expires ~1h (Okta issues no
 *       refresh token without `offline_access`, which isn't configured) —
 *       re-paste + re-run when it does; SKIP_IF_CONFIRMED=1 skips a re-run if
 *       the pool is already deployed.
 *     • OR a gateway **API key** (`ApiKey <key>`, gateway UI /api-keys/ or
 *       `generateApiKey`) — auto-provisions a session + swaps in the network
 *       service account (broad readAs, no TTL) and auto-approves (straight-
 *       through sign+execute). The automation persona; no 1h re-paste.
 *
 * ─── Run ─────────────────────────────────────────────────────────────────
 * Minimal: a small config file with just the per-token settings —
 *
 * ```
 * CONFIG_JSON=pool.json node --experimental-strip-types ccip-sdk/scripts/deploy-pool-e2e.ts
 * ```
 *
 * pool.json:
 * ```
 * {
 *   "instrumentId": "TESTTOKEN", "decimals": 10,
 *   "remoteChainSelector": "16015286601757825753",
 *   "remoteTokenAddress": "0x…",
 *   "remotePools": "0x…",
 *   "gatewayUrl": "http://localhost:8400/api/v0/dapp",
 *   "gatewayAccessToken": "…"
 * }
 * ```
 *
 * Everything else auto-derives: owner ← gateway session (getPrimaryAccount),
 * ccipOwner/ledgerUrl/TAR/FeeQuoter/RMNRemote ← well-known network constants
 * for CANTON_CHAIN_ID (default canton:TestNet → CV1). `admin` defaults to
 * `owner` (self-issued instrument: `instrumentId.admin == poolOwner == admin`,
 * satisfying `ProposeAdministrator`'s `isOwner || isAdmin` check). `observers`
 * (mandatory on the registry pool template) defaults to `[ccipOwner]`.
 * Environment variables (OWNER, ADMIN, CCIP_OWNER, TAR_RAW, FEE_QUOTER_RAW,
 * RMN_REMOTE_RAW, OBSERVERS, …) override file entries and constants — needed
 * for devnet / synthetic testing.
 *
 * SKIP_IF_CONFIRMED=1 skips the deploy (no-ops) if the pool already exists
 * on-ledger — safe to re-run after a partial gateway approval timeout.
 * NO_PROMPT=1 skips the "press Enter after approving" pause (CI / API-key
 * auto-approve flows, where there's no human to prompt).
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import * as readline from 'node:readline'

import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import type { UnsignedCantonTx } from '../src/canton/types.ts'
import {
  GatewaySubmitError,
  ensureGatewaySession,
  fetchGatewayPrimaryParty,
  submitViaGateway,
} from '../src/cct/canton/gateway-submitter.ts'
import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { deriveTokenConfigInstanceAddress } from '../src/cct/canton/token-admin-registry/shared.ts'
import {
  type PoolFactoryDeps,
  RATE_LIMITER_TEMPLATE_ID,
} from '../src/cct/canton/token-pool/shared.ts'

async function prompt(question: string): Promise<void> {
  if (process.env['NO_PROMPT'] === '1') return
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  await new Promise<void>((resolve) =>
    rl.question(question, () => {
      rl.close()
      resolve()
    }),
  )
}

/** Safely stringify a caught `unknown` value that isn't an `Error` (avoids `[object Object]`). */
function describeUnknown(value: unknown): string {
  if (value === undefined) return '(no error — check never returned true)'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return '(unstringifiable error value)'
  }
}

async function pollUntil(
  label: string,
  check: () => Promise<boolean>,
  attempts = 40,
): Promise<boolean> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      if (await check()) return true
      process.stderr.write('.') // alive — still polling (not hung)
    } catch (err) {
      // Keep polling (ACS propagation + approval latency), but remember the
      // error so a timeout isn't silent — "nothing happens" usually means the
      // read keeps failing (expired token, missing readAs, wrong address).
      lastErr = err
      process.stderr.write('x') // read errored this attempt
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  process.stderr.write('\n')
  const detail = lastErr instanceof Error ? lastErr.message : describeUnknown(lastErr)
  console.error(`  ⚠ timed out waiting for: ${label}`)
  console.error(`     last poll error: ${detail}`)
  return false
}

/**
 * User-facing config file shape (CONFIG_JSON). The genuinely per-token inputs
 * are `instrumentId`, `remoteChainSelector`, `remoteTokenAddress`, and
 * `remotePools` (the remote EVM pool contract address — distinct from the
 * token); everything else derives from the network constants (ccipOwner,
 * ledgerUrl, deps) or the gateway session (owner). Environment variables
 * override file entries. No participant JWT field — all auth is via the
 * gateway (`gatewayAccessToken`).
 */
interface PoolDeployConfig {
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
  /** Comma-separated remote EVM pool contract address(es) (NOT the token). Required. */
  remotePools?: string
  rlCapacity?: string
  rlRate?: string
  /** Comma-separated observer parties for EDS auto-detection. Defaults to `[ccipOwner]`. */
  observers?: string
  deps?: Partial<PoolFactoryDeps>
}

function loadConfigFile(): PoolDeployConfig {
  const path = process.env['CONFIG_JSON']?.trim()
  if (!path) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as PoolDeployConfig
}

async function main(): Promise<void> {
  const file = loadConfigFile()
  /** Resolve a setting: environment variable wins over the config file. */
  const setting = (
    envName: string,
    fileKey: Exclude<keyof PoolDeployConfig, 'deps'>,
  ): string | undefined => {
    const env = process.env[envName]?.trim()
    if (env) return env
    const v = file[fileKey]
    return v == null ? undefined : String(v)
  }
  const requireSetting = (
    envName: string,
    fileKey: Exclude<keyof PoolDeployConfig, 'deps'>,
  ): string => {
    const v = setting(envName, fileKey)
    if (!v)
      throw new Error(`Missing required setting: ${envName} (env) or ${fileKey} (CONFIG_JSON)`)
    return v
  }

  // Chain ID first — it keys the well-known network constants. CV1's ledger
  // reports a generic synchronizer alias ('global'), so auto-detection would
  // fall back to canton:DevNet; default to canton:TestNet instead.
  const chainId = setting('CANTON_CHAIN_ID', 'chainId') ?? 'canton:TestNet'
  const network = getCantonNetworkConfig(chainId)

  const gatewayUrl = requireSetting('GATEWAY_URL', 'gatewayUrl')
  const accessToken = requireSetting('GATEWAY_ACCESS_TOKEN', 'gatewayAccessToken')
  // ALL ledger access — both submissions (prepareExecute) and reads (the
  // `ledgerApi` proxy) — routes through the wallet gateway. The script never
  // talks to the Canton participant directly and holds no participant JWT; the
  // gateway holds the credential and proxies reads via its service account
  // (broad readAs, no participant-side grant needed). The only credential here
  // is `accessToken`, sent to the gateway as the Authorization header.
  const ledgerUrl =
    setting('CANTON_LEDGER_URL', 'ledgerUrl') ??
    network?.ledgerUrl ??
    (() => {
      throw new Error(`No ledger URL for ${chainId}: set CANTON_LEDGER_URL`)
    })()

  // Acting party: explicit setting, else the gateway session's primary wallet.
  const owner =
    setting('OWNER', 'owner') ?? (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
  const ccipOwner =
    setting('CCIP_OWNER', 'ccipOwner') ??
    network?.ccipOwner ??
    (() => {
      throw new Error(`No well-known ccipOwner for ${chainId}: set CCIP_OWNER`)
    })()

  // Self-provision a gateway session for the pasted Bearer token. The gateway's
  // prepareExecute / ledgerApi proxy require a stored session row keyed by
  // (userId, accessToken); a raw access token has none outside the browser
  // login flow. addSession creates one headlessly from any token whose claims
  // match the network, and tolerates an already-existing session. Override the
  // gateway networkId with GATEWAY_NETWORK_ID if the gateway's network label
  // differs from the default.
  const gatewayNetworkId = process.env['GATEWAY_NETWORK_ID']?.trim() || 'canton:chainlink-testnet'
  try {
    await ensureGatewaySession({ gatewayUrl, accessToken, networkId: gatewayNetworkId })
    console.error('   gateway session ensured')
  } catch (err) {
    // A real failure here (not a duplicate-session, which is handled inside
    // ensureGatewaySession) means prepareExecute will fail too — surface it so
    // the cause is visible rather than a later opaque "No session found".
    const msg =
      err instanceof GatewaySubmitError
        ? `${err.message}\n   error data: ${JSON.stringify(err.data)}`
        : String(err)
    console.error(`   ⚠ ensureGatewaySession failed: ${msg}`)
    console.error(
      `   ⚠ prepareExecute will likely fail too (no session). ` +
        `Common causes: wrong GATEWAY_NETWORK_ID (got "${gatewayNetworkId}"), ` +
        `token aud/issuer/scope mismatch with the gateway network config, ` +
        `or expired token.`,
    )
  }

  const instrumentId = { admin: owner, id: requireSetting('INSTRUMENT_ID', 'instrumentId') }
  // Initialize's controller is `poolOwner, admin` — defaulting admin to owner
  // matches the self-issued-instrument assumption above (instrumentId.admin ==
  // poolOwner == admin), which satisfies ProposeAdministrator's internal
  // `isOwner || isAdmin` check without a separate propose/accept round trip.
  const admin = setting('ADMIN', 'admin') ?? owner
  const decimals = Number(setting('DECIMALS', 'decimals') ?? '10')
  const poolType = (setting('POOL_TYPE', 'poolType') ?? 'burnMint') as 'burnMint' | 'lockRelease'
  const poolInstanceId =
    setting('POOL_INSTANCE_ID', 'poolInstanceId') ?? `${instrumentId.id.toLowerCase()}-pool-001`
  // Observers are mandatory on the registry pool template (EDS auto-detection;
  // the on-ledger ensure clause rejects an empty list). Default to ccipOwner.
  const observers = (setting('OBSERVERS', 'observers') ?? ccipOwner)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // deps overrides are optional: unset fields fall back to the well-known
  // contracts registered for the chain ID (canton:TestNet → CV1 constants).
  const deps: Partial<PoolFactoryDeps> = { ...file.deps }
  if (process.env['TAR_RAW']?.trim()) deps.tokenAdminRegistry = process.env['TAR_RAW'].trim()
  if (process.env['FEE_QUOTER_RAW']?.trim()) deps.feeQuoter = process.env['FEE_QUOTER_RAW'].trim()
  if (process.env['RMN_REMOTE_RAW']?.trim()) deps.rmnRemote = process.env['RMN_REMOTE_RAW'].trim()

  const remoteChainSelector = BigInt(requireSetting('REMOTE_CHAIN_SELECTOR', 'remoteChainSelector'))
  const remoteTokenAddress = requireSetting('REMOTE_TOKEN_ADDRESS', 'remoteTokenAddress')
  // remotePools is the address(es) of the pool contract(s) deployed on the REMOTE
  // EVM chain — distinct from remoteTokenAddress (the token). Required as its own
  // field; do NOT default to the token address (that silently misconfigures the
  // lane — Canton→EVM sends would route to a nonexistent pool). Comma-separated.
  const remotePools = requireSetting('REMOTE_POOLS', 'remotePools')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const rlCapacity = BigInt(setting('RL_CAPACITY', 'rlCapacity') ?? '1000000')
  const rlRate = BigInt(setting('RL_RATE', 'rlRate') ?? '100')

  // Derived addresses (offline, deterministic).
  const tokenConfigAddress = deriveTokenConfigInstanceAddress(instrumentId, ccipOwner)
  const poolInstanceAddress = `${poolInstanceId}@${owner}`
  const rlInInstanceId = `${poolInstanceId}-rl-in-${remoteChainSelector}`
  const rlOutInstanceId = `${poolInstanceId}-rl-out-${remoteChainSelector}`
  const rlInCustomInstanceId = `${poolInstanceId}-rl-in-custom-${remoteChainSelector}`
  const rlInRaw = `${rlInInstanceId}@${owner}`
  const rlOutRaw = `${rlOutInstanceId}@${owner}`
  const rlInCustomRaw = `${rlInCustomInstanceId}@${owner}`

  console.error('Config:')
  console.error('  chainId             ', chainId)
  console.error('  owner               ', owner)
  console.error('  admin               ', admin)
  console.error('  observers           ', observers.join(', '))
  console.error('  instrumentId        ', `${instrumentId.admin}::${instrumentId.id}`)
  console.error('  tokenConfig (derived)', tokenConfigAddress)
  console.error('  pool                 ', poolInstanceAddress)
  console.error('  rate limiters        ', rlInRaw, '/', rlOutRaw, '/', rlInCustomRaw)

  const { CantonChain } = await import('../src/canton/index.ts')
  const { createGatewayLedgerFetch } = await import('../src/canton/gateway-ledger-fetch.ts')

  // Route ALL ledger reads through the gateway's `ledgerApi` proxy. The
  // gateway holds the credential and proxies reads via the network service
  // account (broad readAs — no participant-side CanReadAs grant needed). The
  // script never contacts the Canton participant directly.
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
      // No participant JWT — reads go through the gateway proxy, submissions
      // via prepareExecute. The gateway holds the auth; this field is unused
      // for direct calls because the proxy intercepts them.
      jwt: accessToken,
      // EDS provides the TAR disclosure (service-first resolution).
      edsUrl: setting('EDS_URL', 'edsUrl') ?? network?.edsUrl ?? 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
      // Pin the chain ID (see above) so network detection and well-known
      // deps resolution work despite CV1's generic synchronizer alias.
      chainId,
    },
  })
  const manager = CantonTokenManager.fromChain(chain)

  // TAR address, both for `deployTokenPool`'s Initialize and the on-ledger
  // confirmation reads: explicit override, else the well-known constant for
  // the connected network (mirrors deployTokenPool's deps resolution).
  const tarInstanceAddressRaw =
    deps.tokenAdminRegistry ??
    getCantonNetworkConfig(String(chain.network.chainId))?.tokenAdminRegistry
  if (!tarInstanceAddressRaw) {
    throw new Error('TAR address unknown: set TAR_RAW or use a registered CANTON_CHAIN_ID')
  }
  const tarInstanceAddress: string = tarInstanceAddressRaw

  // ── Shared helpers ───────────────────────────────────────────────────

  /** Submit one unsigned tx via the gateway and poll until `confirm` holds. */
  async function submitAndConfirm(
    label: string,
    unsigned: UnsignedCantonTx,
    confirm: () => Promise<boolean>,
  ): Promise<void> {
    console.error(`\n══ ${label}`)
    console.error('   submitting to gateway…')
    const result = await submitViaGateway({ gatewayUrl, accessToken, unsigned })
    console.error('   prepared. Approve at:', result.approveUrl ?? 'http://localhost:8400/approve/')
    await prompt('   press Enter after approving in the gateway… ')
    const ok = await pollUntil(`${label} on-ledger effect`, confirm)
    if (!ok)
      throw new Error(`${label} did not confirm on-ledger; check the gateway Activities page`)
    console.error(`   ✓ ${label} confirmed`)
  }

  /** Read the TokenConfig view; null on any error (polls use this).
   *  Reads are proxied through the gateway's `ledgerApi` as the caller's Bearer
   *  token, which has CanReadAs(owner) but NOT CanReadAs(ccipOwner) — so the
   *  ACS query MUST key on `owner` (the user IS a TokenConfig observer via
   *  pendingAdmin/admin/poolOwner), never ccipOwner. */
  async function readTokenConfig() {
    return manager
      .getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner })
      .catch((err: unknown) => {
        // Surface the reason instead of silently reporting "not registered" —
        // e.g. "multiple active contracts match" (a stale duplicate TokenConfig
        // from an earlier attempt at this instrumentId) looks identical to "not
        // registered yet" if swallowed here, which is misleading in the summary.
        console.error(
          `   ⚠ readTokenConfig failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        return null
      })
  }

  /** Does the pool exist on-ledger? Since `Initialize` is atomic, the pool's
   *  existence alone proves the ENTIRE transaction succeeded (TAR
   *  registration, all 3 rate limiters, and the lane wiring included). */
  async function poolExists(): Promise<boolean> {
    return manager
      .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
      .then((s) => s !== null)
      .catch(() => false)
  }

  // ── Deploy: one atomic create + Initialize (one gateway approval) ────

  async function runDeployPool(): Promise<void> {
    const label = `deploy: ${poolType} pool (atomic Initialize — TAR registration + lane + 3 rate limiters in one tx)`
    if (process.env['SKIP_IF_CONFIRMED'] === '1' && (await poolExists())) {
      console.error('── skip deploy-pool (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedDeployTokenPool({
      poolType,
      instanceId: poolInstanceId,
      poolOwner: owner,
      ccipOwner,
      instrumentId,
      decimals,
      observers,
      deps,
      tokenAdminRegistryInstanceAddress: tarInstanceAddress,
      admin,
      lanes: [
        {
          remoteChainSelector,
          remotePools,
          remoteTokenAddress,
          inbound: {
            instanceId: rlInInstanceId,
            isEnabled: true,
            capacity: rlCapacity,
            rate: rlRate,
          },
          outbound: {
            instanceId: rlOutInstanceId,
            isEnabled: true,
            capacity: rlCapacity,
            rate: rlRate,
          },
          inboundCustomFinality: {
            instanceId: rlInCustomInstanceId,
            isEnabled: true,
            capacity: rlCapacity,
            rate: rlRate,
          },
        },
      ],
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, poolExists)
  }

  await runDeployPool()

  /** Final summary of pool deploy state. */
  async function printSummary(): Promise<void> {
    const finalState = await manager
      .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
      .catch(() => null)
    const tarView = await readTokenConfig()
    const poolRegistered = Boolean(tarView?.tokenPool?.poolInstanceId === poolInstanceId)
    const remoteConfigured = Boolean(
      finalState?.remoteChainConfigs?.some(
        (c) => c.remoteChainSelector === remoteChainSelector.toString(),
      ),
    )
    const rlExists = async (rlRaw: string) =>
      (await chain
        .findActiveContractByInstanceAddress(RATE_LIMITER_TEMPLATE_ID, rlRaw, [owner])
        .catch(() => null)) != null
    const [rlIn, rlOut, rlInCustom] = await Promise.all([
      rlExists(rlInRaw),
      rlExists(rlOutRaw),
      rlExists(rlInCustomRaw),
    ])
    console.error('\n════════════════════════════════════════════════════════')
    console.error(` Pool deployed:          ${finalState ? 'yes' : 'no'}`)
    console.error(` Pool in TAR (SetPool):  ${poolRegistered ? 'yes' : 'no'}`)
    console.error(` Remote chain wired:     ${remoteConfigured ? 'yes' : 'no'}`)
    console.error(
      ` Rate limiters deployed: in=${rlIn ? 'yes' : 'no'} out=${rlOut ? 'yes' : 'no'} in-custom=${rlInCustom ? 'yes' : 'no'}`,
    )
    console.error('   pool:', poolInstanceAddress)
    console.error('   TAR TokenConfig:', tokenConfigAddress)
    console.error('   remote chain:', remoteChainSelector.toString())
    if (!finalState || !poolRegistered || !remoteConfigured) {
      console.error(' ⚠ Not fully deployed — check the gateway Activities page and re-run.')
    }
    console.error('════════════════════════════════════════════════════════')
  }

  await printSummary()
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
