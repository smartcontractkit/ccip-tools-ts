import assert from 'node:assert/strict'
import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Wallet as AnchorWallet } from '@coral-xyz/anchor'
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import '../evm/index.ts' // register EVM chain family for cross-family message decoding
import { networkInfo } from '../utils.ts'
import { SolanaChain } from './index.ts'

// ── Constants ──

const VERBOSE = !!process.env.VERBOSE

const SOLANA_ROUTER = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
const ETH_MAINNET_SELECTOR = 5009297550715157269n

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
  network = 'mainnet',
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
        '--ws-port',
        String(port + 1),
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
  let connection: Connection | undefined
  let wallet: AnchorWallet | undefined

  before(async () => {
    surfpoolInstance = createSurfpoolInstance({
      network: 'mainnet',
      port: 8647,
    })
    await surfpoolInstance.start()

    connection = new Connection(`http://${surfpoolInstance.host}:${surfpoolInstance.port}`, {
      commitment: 'confirmed',
      wsEndpoint: `ws://${surfpoolInstance.host}:${surfpoolInstance.port + 1}`,
    })

    solanaChain = new SolanaChain(connection, networkInfo('solana-mainnet'), {
      apiClient: null,
      logger: testLogger,
    })

    // Create and fund a wallet for send tests
    const keypair = Keypair.generate()
    wallet = new AnchorWallet(keypair)
    const airdropSig = await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(airdropSig)
  })

  after(async () => {
    solanaChain?.destroy?.()
    await surfpoolInstance?.stop()
  })

  it('should connect to the surfpool instance', async () => {
    assert.ok(solanaChain, 'solana chain should be initialized')
    assert.ok(wallet, 'wallet should be initialized')
    const balance = await solanaChain.getBalance({ holder: wallet.publicKey.toBase58() })
    assert.ok(balance > 0n, 'wallet should have SOL balance from airdrop')
  })

  describe('sendMessage', () => {
    it('should send a data-only message (Solana -> Ethereum)', async () => {
      assert.ok(solanaChain, 'chain should be initialized')
      assert.ok(wallet, 'wallet should be initialized')

      const request = await solanaChain.sendMessage({
        router: SOLANA_ROUTER,
        destChainSelector: ETH_MAINNET_SELECTOR,
        message: {
          receiver: '0x9eC0e4A4c411493773E01e2ABF4D42395788846b',
          data: '0x1337',
          extraArgs: { gasLimit: 0n },
        },
        wallet,
      })

      // Message ID assertions
      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)

      // Lane assertions
      assert.equal(
        request.lane.sourceChainSelector,
        networkInfo('solana-mainnet').chainSelector,
        'source selector should be Solana mainnet',
      )
      assert.equal(
        request.lane.destChainSelector,
        ETH_MAINNET_SELECTOR,
        'dest selector should be Ethereum mainnet',
      )

      // Transaction assertions
      assert.ok(request.tx.hash, 'tx hash should be defined')

      // Message data round-trip
      assert.ok(
        String(request.message.data).includes('1337'),
        'message data should contain sent payload',
      )

      // Verify the CCIPMessageSent event log from the router
      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.address, SOLANA_ROUTER, 'log should be from the CCIP router')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')

      // Re-read the transaction and verify the message can be decoded from logs
      const tx = await solanaChain.getTransaction(request.tx.hash)
      const requests = await solanaChain.getMessagesInTx(tx)
      assert.equal(requests.length, 1, 'should find exactly one CCIP message in tx')
      assert.equal(
        requests[0]!.message.messageId,
        request.message.messageId,
        'decoded messageId should match',
      )
    })
  })

  // TODO: execute * -> Solana
})
