/**
 * Deploy one Canton token pool end-to-end: SDK composes a `deployTokenPool`
 * (CCIPFactory.DeployBurnMintTokenPool) → Wallet Gateway approves + signs +
 * submits.
 *
 * Unlike setDynamicConfig, deploy CREATES a pool — so it doesn't require a
 * pre-existing pool, only a deployed CCIPFactory + TAR/FeeQuoter/RMNRemote.
 *
 *   CANTON_LEDGER_URL=… CANTON_JWT=… CANTON_PARTY=… \
 *   GATEWAY_URL=http://localhost:8400/api/v0/dapp GATEWAY_ACCESS_TOKEN=… \
 *   FACTORY_INSTANCE_ADDRESS=0x… \
 *   POOL_INSTANCE_ID=my-pool-001 POOL_OWNER=… CCIP_OWNER=… \
 *   INSTRUMENT_ID='admin::1220…::usdc' DECIMALS=6 \
 *   TAR_ADDR=0x… FEE_QUOTER_ADDR=0x… RMN_REMOTE_ADDR=0x… \
 *     node --experimental-strip-types ccip-sdk/scripts/send-one-tx.ts
 *
 * @packageDocumentation
 */

import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { submitViaGateway } from '../src/cct/canton/gateway-submitter.ts'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`)
  return v.trim()
}

async function main(): Promise<void> {
  // ── 1. Connect a Canton chain (read-only — for composing + factory resolution) ──
  const ledgerUrl = requireEnv('CANTON_LEDGER_URL')
  const jwt = requireEnv('CANTON_JWT')
  const party = requireEnv('CANTON_PARTY')
  const ccipParty = process.env['CANTON_CCIP_PARTY']?.trim() || party

  const { CantonChain } = await import('../src/canton/index.ts')
  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: (...a: unknown[]) => console.error('[chain debug]', ...a),
      info: (...a: unknown[]) => console.error('[chain info]', ...a),
      warn: (...a: unknown[]) => console.error('[chain warn]', ...a),
      error: (...a: unknown[]) => console.error('[chain error]', ...a),
    },
    cantonConfig: {
      party,
      ccipParty,
      jwt,
      edsUrl: 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
    },
  })
  const manager = CantonTokenManager.fromChain(chain)

  // ── 2. SDK composes the unsigned deployTokenPool tx (bare create — offline, no factory) ──
  const instanceId = requireEnv('POOL_INSTANCE_ID')
  const poolOwner = requireEnv('POOL_OWNER')
  const ccipOwner = requireEnv('CCIP_OWNER')
  const instrumentId = requireEnv('INSTRUMENT_ID')
  const decimals = Number(requireEnv('DECIMALS'))
  const poolType = (process.env['POOL_TYPE']?.trim() || 'burnMint') as 'burnMint' | 'lockRelease'
  const rateLimitAdmin = process.env['RATE_LIMIT_ADMIN']?.trim() || undefined

  const tokenAdminRegistry = requireEnv('TAR_ADDR')
  const feeQuoter = requireEnv('FEE_QUOTER_ADDR')
  const rmnRemote = requireEnv('RMN_REMOTE_ADDR')

  console.log('Composing unsigned deployTokenPool tx…')
  const unsigned = await manager.generateUnsignedDeployTokenPool({
    poolType,
    instanceId,
    poolOwner,
    ccipOwner,
    instrumentId,
    decimals,
    rateLimitAdmin,
    deps: { tokenAdminRegistry, feeQuoter, rmnRemote },
    poolReceiveContext: { values: [] },
    transferTimeout: { type: 'RelativeHours', hours: 24 },
    sender: poolOwner,
  })
  console.log('Unsigned commands:', JSON.stringify(unsigned.commands, null, 2))

  // ── 3. Submit via the Wallet Gateway (approve + sign + send) ──
  const gatewayUrl = requireEnv('GATEWAY_URL')
  const accessToken = requireEnv('GATEWAY_ACCESS_TOKEN')

  console.log('\nSubmitting to gateway', gatewayUrl, '(prepareExecute)…')
  const result = await submitViaGateway({ gatewayUrl, accessToken, unsigned })

  console.log('\n════════════════════════════════════════════════════════')
  console.log(' Tx prepared + pending on the gateway.')
  if (result.approveUrl) {
    console.log(' Approve it here:', result.approveUrl)
    console.log(' (or on the gateway Activities page: http://localhost:8400/approve/)')
  }
  console.log(' After approval, the gateway signs + submits to Canton CV1.')
  console.log('════════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
