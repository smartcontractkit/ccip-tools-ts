/**
 * Deploy a CCIPFactory owned by your party — a real write tx via the Wallet
 * Gateway. Your party creates a factory it owns (bare `create`, no pre-existing
 * authority needed), so it's authorized as the factory `owner` going forward.
 *
 * This is the simplest authorized write on Canton CV1 for a non-governance
 * party: no MCMS, no existing contract ownership required.
 *
 *   GATEWAY_URL=http://localhost:8400/api/v0/dapp GATEWAY_ACCESS_TOKEN=… \
 *   OWNER='u_d37a36efeda3::1220…' INSTANCE_ID='my-factory-001' \
 *     node --experimental-strip-types ccip-sdk/scripts/deploy-factory.ts
 *
 * No participant JWT needed — factory create is pure local construction (no
 * disclosure fetch), the gateway signs + submits.
 *
 * @packageDocumentation
 */

import { deployCCIPFactory } from '../src/cct/canton/deploy-factory.ts'
import { submitViaGateway, GatewaySubmitError } from '../src/cct/canton/gateway-submitter.ts'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`)
  return v.trim()
}

async function main(): Promise<void> {
  const owner = requireEnv('OWNER')
  // mcmsParty defaults to owner (your party) — keeps governance with you for a
  // test factory. Set MCMS_PARTY to the real MCMS controller to wire it in.
  const mcmsParty = process.env['MCMS_PARTY']?.trim() || owner
  const instanceId = requireEnv('INSTANCE_ID')

  const gatewayUrl = requireEnv('GATEWAY_URL')
  const accessToken = requireEnv('GATEWAY_ACCESS_TOKEN')

  // 1. Compose the unsigned factory-create tx (offline — no chain needed).
  const unsigned = deployCCIPFactory({ instanceId, owner, mcmsParty })
  console.log('Composed CCIPFactory create:')
  console.log(JSON.stringify(unsigned.commands, null, 2))

  // 2. Submit via the gateway (approve + sign + send).
  console.log('\nSubmitting to gateway', gatewayUrl, '(prepareExecute)…')
  const result = await submitViaGateway({ gatewayUrl, accessToken, unsigned })

  console.log('\n════════════════════════════════════════════════════════')
  console.log(' Tx prepared + pending on the gateway.')
  if (result.approveUrl) {
    console.log(' Approve it here:', result.approveUrl)
    console.log(' (or on the gateway Activities page: http://localhost:8400/approve/)')
  }
  console.log(' After approval, the gateway signs + submits to Canton CV1.')
  console.log(' Track the result in the gateway Activities page (updateId).')
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
