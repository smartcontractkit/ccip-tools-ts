/**
 * Read required CCVs for the existing LINKv2 pool on Canton CV1 — a read-only
 * ledger round-trip that any party can trigger (`GetRequiredCCVs` is
 * `controller caller`, no authorization assert).
 *
 * This is the simplest real Canton tx to trigger end-to-end: SDK composes the
 * `GetRequiredCCVs` read-choice exercise, submits it to the participant ledger
 * (via `submitReadChoice`), and decodes the returned CCV instance addresses.
 * No signing, no gateway, no state mutation, no authorization required.
 *
 *   CANTON_LEDGER_URL=… CANTON_JWT=… CANTON_PARTY=… CANTON_CCIP_PARTY=… \
 *   POOL_INSTANCE_ADDRESS=0x… POOL_OWNER=… POOL_TYPE=burnMint \
 *   REMOTE_CHAIN_SELECTOR=16015286601757825753 DIRECTION=Inbound \
 *     node --experimental-strip-types ccip-sdk/scripts/read-required-ccvs.ts
 *
 * @packageDocumentation
 */

import { CantonTokenManager } from '../src/cct/canton/index.ts'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`)
  return v.trim()
}

async function main(): Promise<void> {
  const ledgerUrl = requireEnv('CANTON_LEDGER_URL')
  const jwt = requireEnv('CANTON_JWT')
  const party = requireEnv('CANTON_PARTY')
  const ccipParty = process.env['CANTON_CCIP_PARTY']?.trim() || party
  const poolInstanceAddress = requireEnv('POOL_INSTANCE_ADDRESS')
  const poolOwner = requireEnv('POOL_OWNER')
  const poolType = (process.env['POOL_TYPE']?.trim() || 'burnMint') as 'burnMint' | 'lockRelease'
  const remoteChainSelector = BigInt(requireEnv('REMOTE_CHAIN_SELECTOR'))
  const direction = (process.env['DIRECTION']?.trim() || 'Inbound') as 'Inbound' | 'Outbound'

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

  console.log(`Reading required CCVs for pool ${poolInstanceAddress} (${poolType}),`)
  console.log(`  remoteChainSelector=${remoteChainSelector}, direction=${direction}, caller=${party}`)

  const result = await manager.getRequiredCCVs({
    poolInstanceAddress,
    poolOwner,
    poolType,
    caller: party,
    remoteChainSelector,
    direction,
  })

  console.log('\n════════════════════════════════════════════════════════')
  console.log(` Required CCVs (${result.ccvs.length}):`)
  for (const ccv of result.ccvs) console.log('  -', ccv)
  console.log('════════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
