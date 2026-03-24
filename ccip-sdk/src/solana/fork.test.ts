import assert from 'node:assert/strict'
import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Connection } from '@solana/web3.js'

import '../evm/index.ts' // register EVM chain family for cross-family message decoding
import { networkInfo } from '../utils.ts'
import { SolanaChain } from './index.ts'

// ── Constants ──

const VERBOSE = !!process.env.VERBOSE

// ── Surfpool helpers ──

interface SurfpoolInstance {
  host: string
  port: number
  start(): Promise<void>
  stop(): Promise<void>
}

function isSurfpoolAvailable(): boolean {
  try {
    execSync('surfpool --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function createSurfpoolInstance({
  rpcUrl,
  network = 'devnet',
  host = '127.0.0.1',
  port = 8899,
}: {
  rpcUrl?: string
  network?: 'devnet' | 'mainnet' | 'testnet'
  port?: number
  host?: string
} = {}): SurfpoolInstance {
  let child: ChildProcess | undefined

  return {
    host,
    port,
    async start() {
      const args = [
        'start',
        '--port',
        String(port),
        '--host',
        host,
        '--no-tui',
        '--no-studio',
        '--no-deploy',
      ]
      if (rpcUrl) {
        args.push('--rpc-url', rpcUrl)
      } else {
        args.push('--network', network)
      }

      child = spawn('surfpool', args, { stdio: ['ignore', 'pipe', 'pipe'] })

      child.stdout?.on('data', (data: Buffer) => {
        if (VERBOSE) process.stdout.write(`[surfpool] ${String(data)}`)
      })
      child.stderr?.on('data', (data: Buffer) => {
        if (VERBOSE) process.stderr.write(`[surfpool] ${String(data)}`)
      })

      // Wait for RPC to become ready
      const url = `http://${host}:${port}`
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion', params: [] }),
          })
          if (res.ok) return
        } catch {
          // not ready yet
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error(`Surfpool did not become ready within 60s at ${url}`)
    },

    async stop() {
      if (!child) return
      const proc = child
      child = undefined

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 5_000)

        proc.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })

        proc.kill('SIGTERM')
      })
    },
  }
}

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isSurfpoolAvailable()

const testLogger = VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('Solana Fork Tests', { skip, timeout: 180_000 }, () => {
  let solanaChain: SolanaChain | undefined
  let surfpoolInstance: SurfpoolInstance | undefined

  before(async () => {
    surfpoolInstance = createSurfpoolInstance({
      network: 'devnet',
      port: 8647,
    })
    await surfpoolInstance.start()

    const connection = new Connection(
      `http://${surfpoolInstance.host}:${surfpoolInstance.port}`,
      'confirmed',
    )

    solanaChain = new SolanaChain(connection, networkInfo('solana-devnet'), {
      apiClient: null,
      logger: testLogger,
    })
  })

  after(async () => {
    solanaChain?.destroy?.()
    await surfpoolInstance?.stop()
  })

  it('should connect to the surfpool instance', async () => {
    assert.ok(solanaChain, 'solana chain should be initialized')
    const balance = await solanaChain.getBalance({
      holder: 'FJHKofcoXxVDFAAQQVpYg5Z6vw3UgBwUPgRabhqX6D7y',
    })
    assert.ok(balance >= 0n, 'should be able to query balance via surfpool')
  })

  // TODO: sendMessage Solana -> *
  // TODO: execute * -> Solana
})
