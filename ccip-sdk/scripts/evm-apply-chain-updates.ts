/**
 * Apply a remote-chain update to an EVM TokenPool (CCIP 2.0) — the "reverse
 * link" for a Canton pool: tells the EVM pool about the Canton chain, the
 * Canton pool's instance address, and the Canton's encoded instrument ID.
 *
 * Run:
 *   EVM_PRIVATE_KEY=0x… CONFIG_JSON=evm-pool.json node --experimental-strip-types ccip-sdk/scripts/evm-apply-chain-updates.ts
 *
 * Config (evm-pool.json):
 *
 * ```
 * {
 *   "rpcUrl": "https://ethereum-sepolia-rpc.publicnode.com",
 *   "poolAddress": "0x36e5…",                    // the EVM TokenPool
 *   "remoteChainSelector": "9268731218649498074", // Canton testnet
 *   "instrumentId": "TestLINK",                   // Canton instrument id
 *   "cantonPoolOwner": "u_…::1220…",              // Canton poolOwner party
 *   "poolInstanceId": "testlink-pool-001",        // optional, default below
 *   "capacity": "1000000", "rate": "100",         // human token units
 *   "decimals": 18,                               // EVM token decimals
 *   "rateLimitsEnabled": true                     // optional, default true
 * }
 * ```
 *
 * The Canton-side values are derived, not pasted:
 * `remotePoolAddress = keccak256("<poolInstanceId>@<cantonPoolOwner>")` and
 * `remoteTokenAddress = keccak256("<instrumentId>@<cantonPoolOwner>")`,
 * matching contracts.EncodeInstrumentID / instance-address derivation in Go.
 * Override either with "remotePoolAddress" / "remoteTokenAddress" in config.
 *
 * `applyChainUpdates` is `onlyOwner` on the EVM pool — EVM_PRIVATE_KEY must be
 * the pool owner's key. If EVM_PRIVATE_KEY is unset, prints the encoded
 * calldata instead of sending (dry run).
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'

import { Contract, JsonRpcProvider, Wallet, id as keccak256Utf8, parseUnits } from 'ethers'

const TOKEN_POOL_ABI = [
  'function applyChainUpdates(uint64[] remoteChainSelectorsToRemove, tuple(uint64 remoteChainSelector, bytes[] remotePoolAddresses, bytes remoteTokenAddress, tuple(bool isEnabled, uint128 capacity, uint128 rate) outboundRateLimiterConfig, tuple(bool isEnabled, uint128 capacity, uint128 rate) inboundRateLimiterConfig)[] chainsToAdd) external',
  'function getRemoteChains() view returns (uint64[])',
  'function getSupportedChains() view returns (uint64[])',
  'function getRemotePools(uint64) view returns (bytes[])',
  'function getRemoteToken(uint64) view returns (bytes)',
  'function owner() view returns (address)',
]

interface EvmChainUpdateConfig {
  rpcUrl: string
  poolAddress: string
  remoteChainSelector: string
  instrumentId?: string
  cantonPoolOwner?: string
  poolInstanceId?: string
  remotePoolAddress?: string
  remoteTokenAddress?: string
  capacity?: string
  rate?: string
  decimals?: number
  rateLimitsEnabled?: boolean
}

function loadConfig(): EvmChainUpdateConfig {
  const path = process.env['CONFIG_JSON'] ?? 'evm-pool.json'
  return JSON.parse(readFileSync(path, 'utf8')) as EvmChainUpdateConfig
}

async function main(): Promise<void> {
  const cfg = loadConfig()

  const owner = cfg.cantonPoolOwner
  const instrumentId = cfg.instrumentId
  if (!owner || !instrumentId) {
    if (!cfg.remotePoolAddress || !cfg.remoteTokenAddress) {
      throw new Error(
        'provide either instrumentId+cantonPoolOwner (to derive) or explicit remotePoolAddress+remoteTokenAddress',
      )
    }
  }

  const poolInstanceId = cfg.poolInstanceId ?? `${instrumentId!.toLowerCase()}-pool-001`
  const remotePoolAddress =
    cfg.remotePoolAddress ?? keccak256Utf8(`${poolInstanceId}@${owner}`).toLowerCase()
  const remoteTokenAddress =
    cfg.remoteTokenAddress ?? keccak256Utf8(`${instrumentId}@${owner}`).toLowerCase()

  const decimals = cfg.decimals ?? 18
  const enabled = cfg.rateLimitsEnabled ?? true
  const rateLimit = {
    isEnabled: enabled,
    capacity: parseUnits(cfg.capacity ?? '1000000', decimals),
    rate: parseUnits(cfg.rate ?? '100', decimals),
  }

  const update = {
    remoteChainSelector: BigInt(cfg.remoteChainSelector),
    remotePoolAddresses: [remotePoolAddress],
    remoteTokenAddress,
    outboundRateLimiterConfig: rateLimit,
    inboundRateLimiterConfig: rateLimit,
  }

  console.error('applyChainUpdates on EVM pool:')
  console.error('  pool                ', cfg.poolAddress)
  console.error('  remoteChainSelector ', cfg.remoteChainSelector)
  console.error(
    '  remotePoolAddress   ',
    remotePoolAddress,
    ` (keccak of "${poolInstanceId}@<owner>")`,
  )
  console.error(
    '  remoteTokenAddress  ',
    remoteTokenAddress,
    ` (keccak of "${instrumentId}@<owner>")`,
  )
  console.error(
    '  rate limits         ',
    `enabled=${enabled} capacity=${rateLimit.capacity} rate=${rateLimit.rate}`,
  )

  const privateKey = process.env['EVM_PRIVATE_KEY']
  const provider = new JsonRpcProvider(cfg.rpcUrl)
  const pool = new Contract(cfg.poolAddress, TOKEN_POOL_ABI, provider)

  const poolOwner = (await pool.owner!()) as string
  console.error('  pool owner          ', poolOwner)

  // The EVM pool rejects adding a chain that already has a config — if this
  // selector is already wired, remove it first (same tx) to replace it.
  // 2.0 pools call it getRemoteChains; 1.5.x pools call it getSupportedChains.
  let existingChains: bigint[]
  try {
    existingChains = (await pool.getRemoteChains!()) as bigint[]
  } catch {
    existingChains = (await pool.getSupportedChains!()) as bigint[]
  }
  const removals = existingChains.includes(update.remoteChainSelector)
    ? [update.remoteChainSelector]
    : []
  if (removals.length > 0) {
    console.error('  note                ', 'selector already wired — removing first, then re-adding')
  }

  if (!privateKey) {
    console.error('\nEVM_PRIVATE_KEY not set — dry run, encoded calldata:')
    console.error(pool.interface.encodeFunctionData('applyChainUpdates', [removals, [update]]))
    return
  }

  const wallet = new Wallet(privateKey, provider)
  if (wallet.address.toLowerCase() !== poolOwner.toLowerCase()) {
    throw new Error(`key ${wallet.address} is not the pool owner (${poolOwner})`)
  }

  const tx = (await (pool.connect(wallet) as Contract).applyChainUpdates!(
    removals,
    [update],
  )) as { hash: string; wait(): Promise<{ blockNumber: number }> }
  console.error(`\n⏳ sent: ${tx.hash}`)
  const receipt = await tx.wait()
  console.error(`✓ mined in block ${receipt.blockNumber}`)

  // Read back to confirm
  const remoteToken = (await pool.getRemoteToken!(update.remoteChainSelector)) as string
  const remotePools = (await pool.getRemotePools!(update.remoteChainSelector)) as string[]
  console.error(
    `  on-chain now: remoteToken=${remoteToken.toLowerCase()} remotePools=[${remotePools.map((p) => p.toLowerCase()).join(', ')}]`,
  )
  if (
    remoteToken.toLowerCase() !== remoteTokenAddress ||
    !remotePools.some((p) => p.toLowerCase() === remotePoolAddress)
  ) {
    throw new Error('on-chain readback does not match what was sent — check the pool state')
  }
  console.error('✓ readback matches')
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
