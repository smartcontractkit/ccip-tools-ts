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
  // the suite; onfinality keeps the longest tx history but 429s hardest
  process.env['RPC_SOLANA'] || 'https://solana-devnet.api.onfinality.io/public',
  process.env['RPC_SOLANA_2'] || 'https://devnet.rpcpool.com',
  process.env['RPC_SOLANA_3'] || 'https://api.devnet.solana.com',
  process.env['RPC_TON'] || 'https://testnet.toncenter.com/api/v2',
]

export async function spawnCLI(
  args: string[],
  timeout = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], { env: { ...process.env } })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => (stdout += data.toString()))
    child.stderr.on('data', (data) => (stderr += data.toString()))

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
