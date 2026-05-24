import { spawn } from 'child_process'
import { fileURLToPath } from 'node:url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CLI_PATH = path.join(__dirname, '..', 'index.ts')

export const RPCS = [
  process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com',
  process.env['RPC_AVAX'] || 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  process.env['RPC_APTOS'] || 'testnet',
  process.env['RPC_SOLANA'] || 'https://api.devnet.solana.com',
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
