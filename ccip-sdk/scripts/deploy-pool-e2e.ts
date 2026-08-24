/**
 * End-to-end token-pool deploy + configure on Canton, driven through the CCT
 * SDK (`CantonTokenManager`) with signing via the Wallet Gateway.
 *
 * Sequence (7 gateway approvals across 3 phases — each step is its own
 * approval because the interactive-submission `prepare` step the gateway uses
 * rejects multi-command submissions):
 *
 *   Phase "tar" (2 approvals — also NOT batchable by CID dependency:
 *   AcceptAdminRole needs the TokenConfig CID that ProposeAdministrator
 *   creates; CIDs are assigned at execution time, and TokenConfig has no
 *   contract key for exerciseByKey):
 *     1. register-admin        ProposeAdministrator (tokenConfigCid=None → creates TokenConfig)
 *     2. accept-admin          AcceptAdminRole (we become TokenConfig admin)
 *   Phase "deploy" (3 approvals — 3 independent Creates, one per approval):
 *     3. deploy-pool           burnMint/lockRelease pool
 *     4. deploy-rl-in          inbound rate limiter
 *     5. deploy-rl-out         outbound rate limiter
 *   Phase "configure" (2 approvals — 2 exercises on pre-existing contracts;
 *   set-pool must precede apply-chain-updates):
 *     6. set-pool              SetPool (register pool in TAR's TokenConfig)
 *     7. apply-chain-updates   wire remote chain (pools, token, rate limiters)
 *
 * No real token contract is needed: TAR registration + pool deploy carry the
 * instrumentId as data only. Use a synthetic instrument whose admin is your
 * party (e.g. INSTRUMENT_ID=TESTTOKEN).
 *
 * ─── Prereqs ─────────────────────────────────────────────────────────────
 * - Self-hosted wallet gateway running (config.chainlink-testnet.json).
 *   EVERYTHING routes through the wallet gateway — both submissions
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
 *       each tx in the gateway UI. The access token expires ~1h (Okta issues no
 *       refresh token without `offline_access`, which isn't configured) —
 *       re-paste + re-run when it does; SKIP_IF_CONFIRMED=1 skips done steps.
 *     • OR a gateway **API key** (`ApiKey <key>`, gateway UI /api-keys/ or
 *       `generateApiKey`) — auto-provisions a session + swaps in the network
 *       service account (broad readAs, no TTL) and auto-approves (straight-
 *       through sign+execute). The automation persona; no 1h re-paste.
 *
 * ─── Run ─────────────────────────────────────────────────────────────────
 * Minimal: a small config file with just the per-token settings —
 *
 *   CONFIG_JSON=pool.json \
 *     node --experimental-strip-types ccip-sdk/scripts/deploy-pool-e2e.ts
 *
 *   pool.json: { "instrumentId": "TESTTOKEN", "decimals": 10,
 *                "remoteChainSelector": "16015286601757825753",
 *                "remoteTokenAddress": "0x…",
 *                "remotePools": "0x…",
 *                "gatewayUrl": "http://localhost:8400/api/v0/dapp",
 *                "gatewayAccessToken": "…" }
 *
 * Everything else auto-derives: owner ← gateway session (getPrimaryAccount),
 * ccipOwner/ledgerUrl/TAR/FeeQuoter/RMNRemote ← well-known network constants
 * for CANTON_CHAIN_ID (default canton:TestNet → CV1). Environment variables
 * (OWNER, CCIP_OWNER, TAR_RAW, FEE_QUOTER_RAW, RMN_REMOTE_RAW, …) override
 * file entries and constants — needed for devnet / synthetic testing.
 *
 * Two run modes:
 * - **Interactive menu** (default): `CONFIG_JSON=pool.json node …deploy-pool-e2e.ts`
 *   → a terminal menu lists the 7 steps with live [done]/[ ] status. Pick a
 *   number to run that step (compose → submit → shows the approve URL → press
 *   Enter after approving in the gateway → confirms on-ledger → returns to
 *   menu). `r` refreshes status; `a` runs all pending in order; `q` quits.
 * - **Batch** (CI / scripted): set `FROM_STEP=<step>` (and optionally
 *   `TO_STEP=<step>`, `SKIP_IF_CONFIRMED=1`) to walk the range linearly with no
 *   menu. Steps: register-admin, accept-admin, deploy-pool, deploy-rl-in,
 *   deploy-rl-out, set-pool, apply-chain-updates. Steps are idempotent-ish:
 *   the ledger rejects duplicates, and SKIP_IF_CONFIRMED=1 skips steps
 *   already on-ledger.
 *
 * @packageDocumentation
 */

import * as readline from 'node:readline'
import { readFileSync } from 'node:fs'
import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { type PoolFactoryDeps, RATE_LIMITER_TEMPLATE_ID } from '../src/cct/canton/token-pool/shared.ts'
import { deriveTokenConfigInstanceAddress } from '../src/cct/canton/token-admin-registry/shared.ts'
import { getCantonNetworkConfig } from '../src/canton/networks.ts'
import {
  ensureGatewaySession,
  fetchGatewayPrimaryParty,
  GatewaySubmitError,
  submitViaGateway,
} from '../src/cct/canton/gateway-submitter.ts'
import type { UnsignedCantonTx } from '../src/canton/types.ts'

// Phases (each phase = one gateway approval / one atomic tx):
//   tar       — register-admin + accept-admin  (two exercises on the TAR;
//               NOT batchable into one tx — AcceptAdminRole needs the TokenConfig
//               CID that ProposeAdministrator creates, and CIDs are assigned at
//               execution time, not compose time. TokenConfig has no contract key,
//               so exerciseByKey intra-tx isn't available either.)
//   deploy    — pool + inbound RL + outbound RL  (three independent Creates)
//   configure — set-pool + apply-chain-updates   (two exercises on pre-existing
//               contracts; the pool is carried as data, not a CID reference)
const PHASES = ['tar', 'deploy', 'configure'] as const
type Phase = (typeof PHASES)[number]

// Fine-grained steps within phases, for FROM_STEP / TO_STEP / SKIP_IF_CONFIRMED.
const STEPS = [
  'register-admin',
  'accept-admin',
  'deploy-pool',
  'deploy-rl-in',
  'deploy-rl-out',
  'set-pool',
  'apply-chain-updates',
] as const
type Step = (typeof STEPS)[number]

/** Map a fine-grained step to its containing phase. */
const STEP_PHASE: Record<Step, Phase> = {
  'register-admin': 'tar',
  'accept-admin': 'tar',
  'deploy-pool': 'deploy',
  'deploy-rl-in': 'deploy',
  'deploy-rl-out': 'deploy',
  'set-pool': 'configure',
  'apply-chain-updates': 'configure',
}

async function prompt(question: string): Promise<void> {
  if (process.env['NO_PROMPT'] === '1') return
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  await new Promise<void>((resolve) => rl.question(question, () => { rl.close(); resolve() }))
}

async function pollUntil(label: string, check: () => Promise<boolean>, attempts = 40): Promise<boolean> {
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
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? '(no error — check never returned true)')
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
  const setting = (envName: string, fileKey: keyof PoolDeployConfig): string | undefined => {
    const env = process.env[envName]?.trim()
    if (env) return env
    const v = file[fileKey]
    return v == null ? undefined : String(v)
  }
  const requireSetting = (envName: string, fileKey: keyof PoolDeployConfig): string => {
    const v = setting(envName, fileKey)
    if (!v) throw new Error(`Missing required setting: ${envName} (env) or ${fileKey} (CONFIG_JSON)`)
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
    setting('OWNER', 'owner') ??
    (await fetchGatewayPrimaryParty({ gatewayUrl, accessToken }))
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
    const msg = err instanceof GatewaySubmitError
      ? `${err.message}\n   error data: ${JSON.stringify(err.data)}`
      : String(err)
    console.error(`   ⚠ ensureGatewaySession failed: ${msg}`)
    console.error(`   ⚠ prepareExecute will likely fail too (no session). ` +
      `Common causes: wrong GATEWAY_NETWORK_ID (got "${gatewayNetworkId}"), ` +
      `token aud/issuer/scope mismatch with the gateway network config, ` +
      `or expired token.`)
  }

  const instrumentId = { admin: owner, id: requireSetting('INSTRUMENT_ID', 'instrumentId') }
  const decimals = Number(setting('DECIMALS', 'decimals') ?? '10')
  const poolType = (setting('POOL_TYPE', 'poolType') ?? 'burnMint') as 'burnMint' | 'lockRelease'
  const poolInstanceId =
    setting('POOL_INSTANCE_ID', 'poolInstanceId') ?? `${instrumentId.id.toLowerCase()}-pool-001`

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
  const rlInRaw = `${rlInInstanceId}@${owner}`
  const rlOutRaw = `${rlOutInstanceId}@${owner}`

  console.error('Config:')
  console.error('  chainId             ', chainId)
  console.error('  owner               ', owner)
  console.error('  instrumentId        ', `${instrumentId.admin}::${instrumentId.id}`)
  console.error('  tokenConfig (derived)', tokenConfigAddress)
  console.error('  pool                 ', poolInstanceAddress)
  console.error('  rate limiters        ', rlInRaw, '/', rlOutRaw)

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
      edsUrl:
        setting('EDS_URL', 'edsUrl') ?? network?.edsUrl ?? 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
      // Pin the chain ID (see above) so network detection and well-known
      // deps resolution work despite CV1's generic synchronizer alias.
      chainId,
    },
  })
  const manager = CantonTokenManager.fromChain(chain)

  // TAR address for the on-ledger confirmation reads: explicit override,
  // else the well-known constant for the connected network (mirrors
  // deployTokenPool's deps resolution).
  const tarInstanceAddressRaw =
    deps.tokenAdminRegistry ?? getCantonNetworkConfig(String(chain.network.chainId))?.tokenAdminRegistry
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
    if (!ok) throw new Error(`${label} did not confirm on-ledger; check the gateway Activities page`)
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
      .catch(() => null)
  }

  // ── Per-step run functions (each = one gateway approval) ─────────────
  // register-admin and accept-admin CANNOT be batched: AcceptAdminRole needs
  // the TokenConfig CID created by ProposeAdministrator, and CIDs are assigned
  // at execution time. TokenConfig has no contract key → no exerciseByKey.
  // Each deploy create is also its own approval: interactive-submission
  // `prepare` rejects multi-command submissions ("Preparing multiple commands
  // is currently not supported"). set-pool must precede apply-chain-updates.

  async function runRegisterAdmin(): Promise<void> {
    const label = `register-admin: ProposeAdministrator ${instrumentId.id}`
    // register-admin is done if pendingAdmin OR admin is set to owner (the
    // latter after accept-admin cleared pendingAdmin). Either → skip.
    const cfg = await readTokenConfig()
    if (cfg?.pendingAdmin === owner || cfg?.admin === owner) {
      console.error('── skip register-admin (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedRegisterAdmin({
      instrumentId,
      newAdmin: owner,
      tarInstanceAddress,
      sender: owner,
    })
    // Confirms once pendingAdmin is set (register-admin's on-ledger effect).
    await submitAndConfirm(label, unsigned, async () =>
      (await readTokenConfig())?.pendingAdmin === owner)
  }

  async function runAcceptAdmin(): Promise<void> {
    const label = 'accept-admin: AcceptAdminRole'
    if ((await readTokenConfig())?.admin === owner) {
      console.error('── skip accept-admin (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedAcceptAdmin({
      instrumentId,
      tarInstanceAddress,
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, async () =>
      (await readTokenConfig())?.admin === owner)
  }

  async function runDeployPool(): Promise<void> {
    const label = `deploy: ${poolType} pool`
    if (await manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
        .then((s) => s !== null).catch(() => false)) {
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
      deps,
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, async () =>
      manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
        .then((s) => s !== null).catch(() => false))
  }

  /** Does the RateLimiter at `rlRaw` exist on-ledger? (Used for skip + confirm.) */
  async function rlExists(rlRaw: string): Promise<boolean> {
    return (await chain
      .findActiveContractByInstanceAddress(RATE_LIMITER_TEMPLATE_ID, rlRaw, [owner])
      .catch(() => null)) != null
  }

  async function runDeployRlIn(): Promise<void> {
    const label = `deploy: inbound rate limiter (chain=${remoteChainSelector})`
    if (await rlExists(rlInRaw)) {
      console.error('── skip deploy-rl-in (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedDeployRateLimiter({
      instanceId: rlInInstanceId,
      poolInstanceId,
      poolOwner: owner,
      remoteChainSelector,
      direction: 'inbound',
      isEnabled: true,
      capacity: rlCapacity,
      rate: rlRate,
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, () => rlExists(rlInRaw))
  }

  async function runDeployRlOut(): Promise<void> {
    const label = `deploy: outbound rate limiter (chain=${remoteChainSelector})`
    if (await rlExists(rlOutRaw)) {
      console.error('── skip deploy-rl-out (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedDeployRateLimiter({
      instanceId: rlOutInstanceId,
      poolInstanceId,
      poolOwner: owner,
      remoteChainSelector,
      direction: 'outbound',
      isEnabled: true,
      capacity: rlCapacity,
      rate: rlRate,
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, () => rlExists(rlOutRaw))
  }

  async function runSetPool(): Promise<void> {
    const label = `configure: set-pool (register pool in TAR)`
    if (await manager
        .getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner })
        .then((r) => Boolean(r?.tokenPool?.poolInstanceId === poolInstanceId)).catch(() => false)) {
      console.error('── skip set-pool (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedSetPool({
      instrumentId,
      poolRegistration: { poolOwner: owner, poolInstanceId },
      tarInstanceAddress,
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, async () =>
      manager.getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner })
        .then((r) => Boolean(r?.tokenPool?.poolInstanceId === poolInstanceId)).catch(() => false))
  }

  async function runApplyChainUpdates(): Promise<void> {
    const label = `configure: apply-chain-updates (chain=${remoteChainSelector})`
    if (await manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
        .then((s) => Boolean(s?.remoteChainConfigs?.some(
          (c) => c.remoteChainSelector === remoteChainSelector.toString()))).catch(() => false)) {
      console.error('── skip apply-chain-updates (already confirmed)')
      return
    }
    const unsigned = await manager.generateUnsignedApplyChainUpdates({
      poolInstanceAddress,
      poolType,
      chainsToAdd: [
        {
          remoteChainSelector,
          remotePools,
          remoteTokenAddress,
          inboundRateLimiter: rlInRaw,
          outboundRateLimiter: rlOutRaw,
        },
      ],
      sender: owner,
    })
    await submitAndConfirm(label, unsigned, async () =>
      manager.getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
        .then((s) => Boolean(s?.remoteChainConfigs?.some(
          (c) => c.remoteChainSelector === remoteChainSelector.toString()))).catch(() => false))
  }

  /** Map each step to its run function. */
  const RUN: Record<Step, () => Promise<void>> = {
    'register-admin': runRegisterAdmin,
    'accept-admin': runAcceptAdmin,
    'deploy-pool': runDeployPool,
    'deploy-rl-in': runDeployRlIn,
    'deploy-rl-out': runDeployRlOut,
    'set-pool': runSetPool,
    'apply-chain-updates': runApplyChainUpdates,
  }

  /** On-ledger status of a step (the same predicate used by submitAndConfirm),
   *  WITHOUT submitting — powers the menu's [done]/[ ] markers. */
  async function stepStatus(step: Step): Promise<'done' | 'pending'> {
    try {
      switch (step) {
        case 'register-admin':
          // pendingAdmin was set by register-admin, then cleared by accept-admin
          // (which sets admin = owner). Either state proves register-admin ran.
          {
            const cfg = await readTokenConfig()
            return cfg?.pendingAdmin === owner || cfg?.admin === owner ? 'done' : 'pending'
          }
        case 'accept-admin':
          return (await readTokenConfig())?.admin === owner ? 'done' : 'pending'
        case 'deploy-pool':
          return (await manager
            .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })) != null
            ? 'done' : 'pending'
        case 'deploy-rl-in':
        case 'deploy-rl-out': {
          // Check the actual RateLimiter contract exists (NOT the pool's
          // remoteChainConfigs — that's apply-chain-updates' predicate and is
          // true regardless of whether the RLs were deployed).
          const rlAddr = step === 'deploy-rl-in' ? rlInRaw : rlOutRaw
          const rl = await chain
            .findActiveContractByInstanceAddress(RATE_LIMITER_TEMPLATE_ID, rlAddr, [owner])
            .catch(() => null)
          return rl != null ? 'done' : 'pending'
        }
        case 'set-pool':
          return (await manager
            .getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner }))
            ?.tokenPool?.poolInstanceId === poolInstanceId ? 'done' : 'pending'
        case 'apply-chain-updates':
          return Boolean((await manager
            .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner }))
            ?.remoteChainConfigs?.some((c) => c.remoteChainSelector === remoteChainSelector.toString()))
            ? 'done' : 'pending'
      }
    } catch {
      return 'pending'
    }
  }

  // ── Dispatch: batch (FROM_STEP set) or interactive menu ──────────────
  const fromStep = process.env['FROM_STEP']?.trim() as Step | undefined
  const toStep = process.env['TO_STEP']?.trim() as Step | undefined

  if (fromStep) {
    // Linear batch mode (CI / scripted): walk [fromStep, toStep] in order.
    const skipIfConfirmed = process.env['SKIP_IF_CONFIRMED'] === '1'
    const from = STEPS.indexOf(fromStep)
    const to = toStep ? STEPS.indexOf(toStep) : STEPS.length - 1
    for (let i = from; i <= to; i++) {
      const step = STEPS[i]
      if (skipIfConfirmed && (await stepStatus(step)) === 'done') {
        console.error(`── skip ${step} (already confirmed)`)
        continue
      }
      await RUN[step]()
    }
    await printSummary()
    return
  }

  // ── Interactive menu mode (default when no FROM_STEP) ────────────────
  // Print the step menu with live [done]/[ ] status markers.
  async function printMenu(): Promise<void> {
    console.error('\n────────────────────────────────────────────────────────────')
    console.error(' Canton token-pool deploy — interactive')
    console.error(` Pool: ${poolInstanceAddress}`)
    console.error(` Instrument: ${instrumentId.admin}::${instrumentId.id}`)
    console.error(` Remote chain: ${remoteChainSelector.toString()}`)
    console.error('────────────────────────────────────────────────────────────')
    for (let i = 0; i < STEPS.length; i++) {
      const mark = (await stepStatus(STEPS[i])) === 'done' ? '[done]' : '[ ]  '
      console.error(`  ${i + 1}. ${mark} ${STEPS[i]}`)
    }
    console.error('  r. refresh status')
    console.error('  a. run all pending (in order)')
    console.error('  q. quit')
    console.error('────────────────────────────────────────────────────────────')
  }

  // The REPL: pick a step, run it (compose → submit → approve → confirm),
  // then return to the menu. `ask` (module-level) reads stdin.
  while (true) {
    await printMenu()
    const choice = await ask('Pick: ')
    if (!choice || choice === 'q') break
    if (choice === 'r') continue // reprint (loop re-runs printMenu)
    if (choice === 'a') {
      for (const step of STEPS) {
        if ((await stepStatus(step)) === 'done') continue
        try {
          await RUN[step]()
        } catch (err) {
          console.error(`Fatal on step ${step}:`, err instanceof Error ? err.message : err)
          break
        }
      }
      continue
    }
    const idx = Number(choice) - 1
    if (Number.isInteger(idx) && idx >= 0 && idx < STEPS.length) {
      const step = STEPS[idx]
      try {
        await RUN[step]()
      } catch (err) {
        console.error(`⚠ ${step} failed:`, err instanceof Error ? err.message : err)
      }
    } else {
      console.error(`  ⚠ invalid choice "${choice}"`)
    }
  }

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
    console.error('\n════════════════════════════════════════════════════════')
    console.error(` Pool deployed:        ${finalState ? 'yes' : 'no'}`)
    console.error(` Pool in TAR (set-pool): ${poolRegistered ? 'yes' : 'no'}`)
    console.error(` Remote chain wired:    ${remoteConfigured ? 'yes' : 'no'}`)
    console.error('   pool:', poolInstanceAddress)
    console.error('   TAR TokenConfig:', tokenConfigAddress)
    console.error('   remote chain:', remoteChainSelector.toString())
    if (!remoteConfigured) {
      console.error(' ⚠ Not fully configured yet — run the remaining steps.')
    }
    console.error('════════════════════════════════════════════════════════')
  }
}

/** Ask a question on stdin and return the trimmed answer (module-level util). */
async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await new Promise<string>((resolve) =>
      rl.question(question, (answer) => { resolve(answer.trim()) }),
    )
  } finally {
    rl.close()
  }
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
