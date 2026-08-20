/**
 * Deploy a token pool DIRECTLY (bare create, no factory) via the Wallet
 * Gateway — the pool analog of scripts/deploy-factory.ts. Fully offline
 * compose: NO participant JWT needed, no ACS reads, no disclosed contracts.
 *
 *   GATEWAY_URL=http://localhost:8400/api/v0/dapp GATEWAY_ACCESS_TOKEN=… \
 *   OWNER='u_d37a36efeda3::1220…' CCIP_OWNER='ccipOwner::1220…' \
 *   INSTRUMENT_ID=TESTTOKEN DECIMALS=8 \
 *   TAR_RAW='tokenadminregistry-nbehb@ccipOwner::1220…' \
 *   FEE_QUOTER_RAW='feequoter-koyox@ccipOwner::1220…' \
 *   RMN_REMOTE_RAW='rmn_remote-pttst@rmnOwner::1220…' \
 *     node --experimental-strip-types ccip-sdk/scripts/deploy-pool-direct.ts
 *
 * The pool's `ensure` requires instrumentId.admin == OWNER, so INSTRUMENT_ID
 * is treated as an instrument you admin (real or synthetic — nothing fetches
 * the token contract at deploy time).
 *
 * @packageDocumentation
 */

import { deployTokenPoolDirect } from '../src/cct/canton/deploy-pool-direct.ts'
import { submitViaGateway, GatewaySubmitError } from '../src/cct/canton/gateway-submitter.ts'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`)
  return v.trim()
}

async function main(): Promise<void> {
  const owner = requireEnv('OWNER')
  const ccipOwner = requireEnv('CCIP_OWNER')
  const instrumentId = { admin: owner, id: requireEnv('INSTRUMENT_ID') }
  const decimals = Number(process.env['DECIMALS']?.trim() || '8')
  const poolType = (process.env['POOL_TYPE']?.trim() || 'burnMint') as 'burnMint' | 'lockRelease'
  const instanceId = process.env['POOL_INSTANCE_ID']?.trim() || `${instrumentId.id.toLowerCase()}-pool-001`

  const unsigned = deployTokenPoolDirect({
    poolType,
    instanceId,
    poolOwner: owner,
    ccipOwner,
    instrumentId,
    decimals,
    deps: {
      tokenAdminRegistry: requireEnv('TAR_RAW'),
      feeQuoter: requireEnv('FEE_QUOTER_RAW'),
      rmnRemote: requireEnv('RMN_REMOTE_RAW'),
    },
  })
  console.log('Composed pool create (offline, no reads):')
  console.log(JSON.stringify(unsigned.commands, null, 2))
  console.log('\nPool instance address will be: keccak256("%s@%s")', instanceId, owner)

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
  console.log('════════════════════════════════════════════════════════')
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
