import assert from 'node:assert/strict'
import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Connection } from '@solana/web3.js'

import '../evm/index.ts' // register EVM chain family for cross-family message decoding
import { type NetworkInfo, ChainFamily, NetworkType } from '../types.ts'
import { SOLANA_TO_SEPOLIA } from './fork.test.data.ts'
import { SolanaChain } from './index.ts'

// ── Chain constants ──

const SOLANA_DEVNET_SELECTOR = 16423721717087811551n
const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

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

function createSurfpoolInstance(opts?: {
  network?: 'devnet' | 'mainnet' | 'testnet'
  rpcUrl?: string
  port?: number
  host?: string
}): SurfpoolInstance {
  const host = opts?.host ?? '127.0.0.1'
  const port = opts?.port ?? 8899
  const network = opts?.network ?? 'devnet'
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
      if (opts?.rpcUrl) {
        args.push('--rpc-url', opts.rpcUrl)
      } else {
        args.push('--network', network)
      }

      child = spawn('surfpool', args, { stdio: ['ignore', 'pipe', 'pipe'] })

      child.stdout?.on('data', (data: Buffer) => {
        if (process.env.VERBOSE) process.stdout.write(`[surfpool] ${String(data)}`)
      })
      child.stderr?.on('data', (data: Buffer) => {
        if (process.env.VERBOSE) process.stderr.write(`[surfpool] ${String(data)}`)
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

const testLogger = process.env.VERBOSE
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

    const networkInfo: NetworkInfo = {
      family: ChainFamily.Solana,
      chainId: SOLANA_DEVNET_GENESIS,
      name: 'solana-devnet',
      chainSelector: SOLANA_DEVNET_SELECTOR,
      networkType: NetworkType.Testnet,
    }

    solanaChain = new SolanaChain(connection, networkInfo, {
      apiClient: null,
      logger: testLogger,
    })
  })

  after(async () => {
    solanaChain?.destroy?.()
    await surfpoolInstance?.stop()
  })

  describe('getMessagesInTx', () => {
    it('should decode CCIP messages from a known Solana devnet transaction', async () => {
      assert.ok(solanaChain, 'solana chain should be initialized')

      const msg = SOLANA_TO_SEPOLIA[0]!
      const tx = await solanaChain.getTransaction(msg.txHash)
      const requests = await solanaChain.getMessagesInTx(tx)

      assert.ok(requests.length > 0, 'should find at least one CCIP message')
      const request = requests.find((r) => r.message.messageId === msg.messageId)
      assert.ok(request, `should find message ${msg.messageId}`)
      assert.ok(request.lane.sourceChainSelector, 'should have source chain selector')
      assert.ok(request.lane.destChainSelector, 'should have dest chain selector')
      assert.equal(
        request.lane.sourceChainSelector,
        SOLANA_DEVNET_SELECTOR,
        'source selector should be Solana devnet',
      )
    })
  })

  describe('getBalance', () => {
    it('should return native SOL balance for a known CCIP participant', async () => {
      assert.ok(solanaChain, 'solana chain should be initialized')

      // Use the sender from a known test message
      const msg = SOLANA_TO_SEPOLIA[0]!
      const tx = await solanaChain.getTransaction(msg.txHash)
      const requests = await solanaChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === msg.messageId)
      assert.ok(request, 'should find the message')

      const balance = await solanaChain.getBalance({ holder: request.message.sender })
      assert.ok(balance >= 0n, 'balance should be non-negative')
    })
  })

  describe('getTokenInfo', () => {
    it('should fetch token info for a token used in a CCIP transfer', async () => {
      assert.ok(solanaChain, 'solana chain should be initialized')

      // 24ZcsMnr7B1vTBEbHJwTwBrtXkTxxgJTarTjGrD6ub2C is the token from the first test message
      const tokenInfo = await solanaChain.getTokenInfo(
        '24ZcsMnr7B1vTBEbHJwTwBrtXkTxxgJTarTjGrD6ub2C',
      )

      assert.ok(tokenInfo.decimals >= 0, 'should have non-negative decimals')
      assert.equal(tokenInfo.symbol, 'UNKNOWN', 'devnet token without Metaplex metadata')
    })
  })
})
