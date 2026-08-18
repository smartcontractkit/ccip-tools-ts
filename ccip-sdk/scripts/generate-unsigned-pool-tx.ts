/**
 * Generate an unsigned Canton token-pool tx (`setDynamicConfig`) against a live
 * participant — Go-deployment-equivalent ergonomics.
 *
 * You supply: participant URL + JWT + acting party + pool InstanceAddress +
 * (optional) rateLimitAdmin. The op resolves the pool's contract ID +
 * disclosure blob + synchronizer from the ACS itself (mirrors Go
 * `FindActiveContractByInstanceAddress` with `IncludeCreatedEventBlob: true`)
 * — you never touch `createdEventBlob` or the contract ID.
 *
 * No signing, no submit — returns the unsigned `UnsignedCantonTx` ready to hand
 * to a signer (local key / Wallet Gateway / WalletConnect).
 *
 * ─── Run ─────────────────────────────────────────────────────────────────
 *   CANTON_LEDGER_URL=… CANTON_JWT=… CANTON_PARTY=… \
 *   POOL_INSTANCE_ADDRESS=0x… [POOL_TYPE=burnMint] [RATE_LIMIT_ADMIN=…] \
 *     node --experimental-strip-types ccip-sdk/scripts/generate-unsigned-pool-tx.ts
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
  const poolType = (process.env['POOL_TYPE']?.trim() || 'burnMint') as 'burnMint' | 'lockRelease'
  const rateLimitAdmin = process.env['RATE_LIMIT_ADMIN']?.trim() || undefined

  const { CantonChain } = await import('../src/canton/index.ts')
  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: (...a: unknown[]) => console.error('[debug]', ...a),
      info: (...a: unknown[]) => console.error('[info]', ...a),
      warn: (...a: unknown[]) => console.error('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
    cantonConfig: {
      party,
      ccipParty,
      jwt,
      // Reads/generate for pool ops only touch the Ledger API client
      // (getActiveContracts/getLedgerEnd); EDS + transfer-instruction clients
      // are constructed by fromUrl but never invoked here.
      edsUrl: 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
    },
  })

  const manager = CantonTokenManager.fromChain(chain)

  const unsigned = await manager.generateUnsignedSetDynamicConfig({
    poolInstanceAddress,
    poolType,
    rateLimitAdmin,
    sender: party,
  })

  console.log('══════════════════════════════════════════════════════════════════')
  console.log(' Unsigned Canton tx — setDynamicConfig')
  console.log('══════════════════════════════════════════════════════════════════')
  console.log(JSON.stringify(unsigned, null, 2))
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
