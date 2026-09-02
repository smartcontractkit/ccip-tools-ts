import { spawn } from 'child_process'
import { fileURLToPath } from 'node:url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CLI_PATH = path.join(__dirname, '..', 'index.ts')

export const RPCS = [
  process.env['RPC_SEPOLIA'] || 'https://rpc.sepolia.ethpandaops.io',
  process.env['RPC_SEPOLIA_2'] || 'https://0xrpc.io/sep',
  process.env['RPC_SEPOLIA_3'] || 'https://gateway.tenderly.co/public/sepolia',
  process.env['RPC_AVAX'] || 'https://api.avax-test.network/ext/bc/C/rpc',
  // Aptos testnet fullnodes prune older txs/events; the archival endpoint
  // retains them, so it is the single default (kept alone on purpose: the
  // per-family race would otherwise let a pruned fullnode win the chain)
  process.env['RPC_APTOS'] || 'https://archive.testnet.aptoslabs.com/v1',
  // raced: first endpoint to resolve wins, so a throttled one doesn't stall
  // the suite; retention varies over time (as of 2026-08: onfinality prunes
  // signature history around ~1 month, api.devnet.solana.com/devnet.rpcpool.com
  // retain longer but 429 harder from cold starts) — keep fixtures fresher than
  // the shortest observed retention horizon
  process.env['RPC_SOLANA'] || 'https://solana-devnet.api.onfinality.io/public',
  process.env['RPC_SOLANA_2'] || 'https://devnet.rpcpool.com',
  process.env['RPC_SOLANA_3'] || 'https://api.devnet.solana.com',
  process.env['RPC_TON'] || 'https://testnet.toncenter.com/api/v2',
  // Quiet mainnet lane (soneium -> astar) used by the show format variants: the
  // scan-heavy `show` flow costs far less against a low-traffic dest with ~6.7s
  // blocks than against the testnet hubs, and both endpoints are keyless and
  // retentive. See show.e2e.test.ts.
  process.env['RPC_SONEIUM'] || 'https://rpc.soneium.org',
  process.env['RPC_ASTAR'] || 'https://evm.astar.network',
  // base -> polygon lane for the EVM->EVM show test. Polygon's public endpoints
  // vary wildly in eth_getLogs width — 1rpc caps at 50 blocks and then serves a
  // Cloudflare challenge under the resulting request burst — so this one is
  // chosen for serving the scan's full ~10k-block range in a single call.
  process.env['RPC_BASE'] || 'https://mainnet.base.org',
  process.env['RPC_POLYGON'] || 'https://gateway.tenderly.co/public/polygon',
  // bsc-testnet is the source of the EVM->Aptos fixtures (show + lane). NodeReal's
  // public demo endpoint is the only one found that serves a full ~10k-block
  // eth_getLogs here; BNB Chain's own data seeds answer `-32005 limit exceeded`
  // for any getLogs at all (even 1 block) and so trail as call-only fallbacks.
  // drpc's bsc-testnet endpoint is deliberately absent: it wins the chainId race
  // and then fails half of every batched eth_call with "Temporary internal
  // error", which surfaces as a bogus empty-revert.
  process.env['RPC_BSC_TESTNET'] ||
    'https://bsc-testnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3',
  process.env['RPC_BSC_TESTNET_2'] || 'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
  process.env['RPC_BSC_TESTNET_3'] || 'https://bsc-testnet-dataseed.bnbchain.org',
  // base-sepolia: source of the EVM->Solana show fixture and dest of the v2.0
  // lane fixture. Both serve a full ~10k-block eth_getLogs in one call (verified
  // against the onRamp), so the scan path stays available if the API-metadata
  // shortcut ever drops out; tenderly leads only as a tie-break, being the same
  // keyless gateway already trusted for the sepolia/polygon/mainnet entries.
  process.env['RPC_BASE_SEPOLIA'] || 'https://gateway.tenderly.co/public/base-sepolia',
  process.env['RPC_BASE_SEPOLIA_2'] || 'https://sepolia.base.org',
  // gnosis -> ethereum mainnet v1.5 lane config (call-only, no scanning): the
  // official Gnosis endpoint plus tenderly's keyless mainnet gateway, both of
  // which answer eth_call without rate-limiting a handful of requests.
  process.env['RPC_GNOSIS'] || 'https://rpc.gnosischain.com',
  process.env['RPC_ETHEREUM'] || 'https://gateway.tenderly.co/public/mainnet',
  // robinhood-testnet v2.0 lane config (call-only). This chain has exactly one
  // public endpoint — the operator's own, as published in its chain metadata —
  // and it is deliberately preferred over busier v2.0 pairs (ink -> arb-sepolia
  // was the alternative) because no other suite locks robinhood-testnet, so this
  // lane queues behind nothing.
  process.env['RPC_ROBINHOOD'] || 'https://rpc.testnet.chain.robinhood.com',
]

/**
 * Spawns the CLI in-process as a child of node, capturing its stdout/stderr.
 * Resolves with the captured output and exit code, or rejects if it hangs past
 * `timeout` (killing the child).
 */
export async function spawnCLI(
  args: string[],
  timeout = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], { env: { ...process.env } })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()))
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()))

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`CLI command timed out after ${timeout / 1e3}s`))
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      resolve({ stdout, stderr, exitCode: code })
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })
  })
}
