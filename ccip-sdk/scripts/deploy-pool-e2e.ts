/**
 * End-to-end token-pool deploy + configure on Canton, driven through the CCT
 * SDK (`CantonTokenManager`) with signing via the Wallet Gateway.
 *
 * Sequence (each step: compose unsigned tx → gateway prepareExecute → human
 * approves in the gateway UI → ACS poll confirms the on-ledger effect):
 *
 *   1. register-admin   ProposeAdministrator (tokenConfigCid=None → creates TokenConfig)
 *   2. accept-admin     AcceptAdminRole (we become TokenConfig admin)
 *   3. deploy-pool      CCIPFactory.DeployBurnMint/LockReleaseTokenPool
 *   4. deploy-rl-in     CCIPFactory.DeployRateLimiter (inbound)
 *   5. deploy-rl-out    CCIPFactory.DeployRateLimiter (outbound)
 *   6. set-pool         TAR.SetPool (register pool on the TokenConfig)
 *   7. apply-chain-updates  pool.ApplyChainUpdates (remote chain + rate limiters)
 *
 * No real token contract is needed: TAR registration + pool deploy carry the
 * instrumentId as data only. Use a synthetic instrument whose admin is your
 * party (e.g. INSTRUMENT_ID=TESTTOKEN).
 *
 * ─── Prereqs ─────────────────────────────────────────────────────────────
 * - Self-hosted wallet gateway running (config.chainlink-testnet.json) with a
 *   session for OWNER. No factory needed — pool + rate limiters deploy as
 *   bare creates (offline compose, no reads).
 * - CANTON_JWT with actAs/readAs over OWNER **and readAs over CCIP_OWNER**
 *   (the TAR has no observer for token admins; its ACS blob is fetched under
 *   ccipOwner visibility for disclosure). Only the TAR steps (register-admin,
 *   accept-admin, set-pool) + confirmations need it.
 *
 * ─── Run ─────────────────────────────────────────────────────────────────
 *   CANTON_LEDGER_URL=https://testnet.cv1.bcy-v.metalhosts.com/api/json \
 *   CANTON_JWT=… GATEWAY_URL=http://localhost:8400/api/v0/dapp GATEWAY_ACCESS_TOKEN=… \
 *   OWNER='u_xxx::1220…' CCIP_OWNER='ccipOwner::1220…' \
 *   TAR_RAW='token-admin-registry@ccipOwner::1220…' \
 *   FEE_QUOTER_RAW='fee-quoter@ccipOwner::1220…' \
 *   RMN_REMOTE_RAW='rmn-remote@ccipOwner::1220…' \
 *   INSTRUMENT_ID=TESTTOKEN DECIMALS=8 \
 *   REMOTE_CHAIN_SELECTOR=16015286601757825753 REMOTE_TOKEN_ADDRESS=0x… \
 *     node --experimental-strip-types ccip-sdk/scripts/deploy-pool-e2e.ts
 *
 * Resume partway with FROM_STEP=deploy-pool (steps are idempotent-ish: the
 * ledger rejects duplicates, and the script skips a step whose confirmation
 * already holds when SKIP_IF_CONFIRMED=1).
 *
 * @packageDocumentation
 */

import * as readline from 'node:readline'
import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { deriveTokenConfigInstanceAddress } from '../src/cct/canton/token-admin-registry/shared.ts'
import { submitViaGateway, GatewaySubmitError } from '../src/cct/canton/gateway-submitter.ts'
import type { UnsignedCantonTx } from '../src/canton/types.ts'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`)
  return v.trim()
}

function envOr(name: string, fallback: string): string {
  const v = process.env[name]?.trim()
  return v ? v : fallback
}

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

async function prompt(question: string): Promise<void> {
  if (process.env['NO_PROMPT'] === '1') return
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  await new Promise<void>((resolve) => rl.question(question, () => { rl.close(); resolve() }))
}

async function pollUntil(label: string, check: () => Promise<boolean>, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await check()) return true
    } catch {
      /* keep polling — ACS propagation + approval latency */
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.error(`  ⚠ timed out waiting for: ${label}`)
  return false
}

async function main(): Promise<void> {
  const ledgerUrl = requireEnv('CANTON_LEDGER_URL')
  const jwt = requireEnv('CANTON_JWT')
  const gatewayUrl = requireEnv('GATEWAY_URL')
  const accessToken = requireEnv('GATEWAY_ACCESS_TOKEN')

  const owner = requireEnv('OWNER')
  const ccipOwner = requireEnv('CCIP_OWNER')

  const instrumentId = { admin: owner, id: requireEnv('INSTRUMENT_ID') }
  const decimals = Number(envOr('DECIMALS', '8'))
  const poolType = envOr('POOL_TYPE', 'burnMint') as 'burnMint' | 'lockRelease'
  const poolInstanceId = envOr('POOL_INSTANCE_ID', `${instrumentId.id.toLowerCase()}-pool-001`)

  const deps = {
    tokenAdminRegistry: requireEnv('TAR_RAW'),
    feeQuoter: requireEnv('FEE_QUOTER_RAW'),
    rmnRemote: requireEnv('RMN_REMOTE_RAW'),
  }

  const remoteChainSelector = BigInt(requireEnv('REMOTE_CHAIN_SELECTOR'))
  const remoteTokenAddress = requireEnv('REMOTE_TOKEN_ADDRESS')
  const remotePools = (process.env['REMOTE_POOLS']?.trim() || remoteTokenAddress)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const rlCapacity = BigInt(envOr('RL_CAPACITY', '1000000'))
  const rlRate = BigInt(envOr('RL_RATE', '100'))

  // Derived addresses (offline, deterministic).
  const tokenConfigAddress = deriveTokenConfigInstanceAddress(instrumentId, ccipOwner)
  const poolInstanceAddress = `${poolInstanceId}@${owner}`
  const rlInInstanceId = `${poolInstanceId}-rl-in-${remoteChainSelector}`
  const rlOutInstanceId = `${poolInstanceId}-rl-out-${remoteChainSelector}`
  const rlInRaw = `${rlInInstanceId}@${owner}`
  const rlOutRaw = `${rlOutInstanceId}@${owner}`

  console.error('Config:')
  console.error('  instrumentId        ', `${instrumentId.admin}::${instrumentId.id}`)
  console.error('  tokenConfig (derived)', tokenConfigAddress)
  console.error('  pool                 ', poolInstanceAddress)
  console.error('  rate limiters        ', rlInRaw, '/', rlOutRaw)

  const { CantonChain } = await import('../src/canton/index.ts')
  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: () => {},
      info: (...a: unknown[]) => console.error('[info]', ...a),
      warn: (...a: unknown[]) => console.error('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
    cantonConfig: {
      party: owner,
      ccipParty: ccipOwner,
      jwt,
      edsUrl: 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
    },
  })
  const manager = CantonTokenManager.fromChain(chain)

  const fromStep = (process.env['FROM_STEP']?.trim() || STEPS[0]) as Step
  const skipIfConfirmed = process.env['SKIP_IF_CONFIRMED'] === '1'
  let active = false

  async function runStep(
    step: Step,
    label: string,
    build: () => Promise<UnsignedCantonTx>,
    confirm: () => Promise<boolean>,
  ): Promise<void> {
    if (step === fromStep) active = true
    if (!active) {
      console.error(`── skip ${step} (before FROM_STEP=${fromStep})`)
      return
    }
    console.error(`\n══ ${step}: ${label}`)
    if (skipIfConfirmed && (await confirm().catch(() => false))) {
      console.error('   already confirmed on-ledger — skipping')
      return
    }
    const unsigned = await build()
    console.error('   composed; submitting to gateway…')
    const result = await submitViaGateway({ gatewayUrl, accessToken, unsigned })
    console.error('   prepared. Approve at:', result.approveUrl ?? 'http://localhost:8400/approve/')
    await prompt('   press Enter after approving in the gateway… ')
    const ok = await pollUntil(`${step} on-ledger effect`, confirm)
    if (!ok) throw new Error(`${step} did not confirm on-ledger; check the gateway Activities page`)
    console.error(`   ✓ ${step} confirmed`)
  }

  // 1. register-admin → TokenConfig created with pendingAdmin = owner
  await runStep(
    'register-admin',
    `ProposeAdministrator ${instrumentId.id} (admin=${owner.slice(0, 24)}…)`,
    () =>
      manager.generateUnsignedRegisterAdmin({
        instrumentId,
        newAdmin: owner,
        tarInstanceAddress: deps.tokenAdminRegistry,
        sender: owner,
      }),
    async () => {
      const view = await manager
        .getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner })
        .catch(() => null)
      return view?.pendingAdmin === owner
    },
  )

  // 2. accept-admin → admin = owner
  await runStep(
    'accept-admin',
    'AcceptAdminRole',
    () =>
      manager.generateUnsignedAcceptAdmin({
        instrumentId,
        tarInstanceAddress: deps.tokenAdminRegistry,
        sender: owner,
      }),
    async () => {
      const view = await manager
        .getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner })
        .catch(() => null)
      return view?.admin === owner
    },
  )

  // 3. deploy-pool (bare create — offline, no factory)
  await runStep(
    'deploy-pool',
    `create ${poolType} pool ${poolInstanceId}`,
    () =>
      manager.generateUnsignedDeployTokenPool({
        poolType,
        instanceId: poolInstanceId,
        poolOwner: owner,
        ccipOwner,
        instrumentId,
        decimals,
        deps,
        sender: owner,
      }),
    async () => {
      const state = await manager
        .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
        .catch(() => null)
      return state !== null
    },
  )

  // 4+5. deploy rate limiters (inbound + outbound; bare creates — offline)
  for (const [step, direction, rlInstanceId, rlRaw] of [
    ['deploy-rl-in', 'inbound', rlInInstanceId, rlInRaw],
    ['deploy-rl-out', 'outbound', rlOutInstanceId, rlOutRaw],
  ] as const) {
    await runStep(
      step,
      `create RateLimiter ${direction} (${rlInstanceId})`,
      () =>
        manager.generateUnsignedDeployRateLimiter({
          instanceId: rlInstanceId,
          poolInstanceId,
          poolOwner: owner,
          remoteChainSelector,
          direction,
          isEnabled: true,
          capacity: rlCapacity,
          rate: rlRate,
          sender: owner,
        }),
      async () => {
        const found = await chain.findActiveContractByInstanceAddress(
          '#ccip-rate-limiter-v2:CCIP.RateLimiterV2:RateLimiter',
          rlRaw,
          [owner],
        )
        return found !== null
      },
    )
  }

  // 6. set-pool → TokenConfig.tokenPool = {poolOwner, poolInstanceId}
  await runStep(
    'set-pool',
    'TAR.SetPool',
    () =>
      manager.generateUnsignedSetPool({
        instrumentId,
        poolRegistration: { poolOwner: owner, poolInstanceId },
        tarInstanceAddress: deps.tokenAdminRegistry,
        sender: owner,
      }),
    async () => {
      const view = await manager
        .getTokenAdminRegistry({ tokenConfigInstanceAddress: tokenConfigAddress, adminParty: owner })
        .catch(() => null)
      return view?.tokenPool?.poolInstanceId === poolInstanceId
    },
  )

  // 7. apply-chain-updates → remote chain config with both rate limiters
  await runStep(
    'apply-chain-updates',
    `pool.ApplyChainUpdates chain=${remoteChainSelector}`,
    () =>
      manager.generateUnsignedApplyChainUpdates({
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
      }),
    async () => {
      const state = await manager
        .getTokenPoolState({ poolInstanceAddress, poolType, poolOwner: owner })
        .catch(() => null)
      return Boolean(
        state?.remoteChainConfigs?.some(
          (c) => c.remoteChainSelector === remoteChainSelector.toString(),
        ),
      )
    },
  )

  console.error('\n════════════════════════════════════════════════════════')
  console.error(' E2E complete. Pool registered + configured:')
  console.error('   pool:', poolInstanceAddress)
  console.error('   TAR TokenConfig:', tokenConfigAddress)
  console.error('   remote chain:', remoteChainSelector.toString())
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
