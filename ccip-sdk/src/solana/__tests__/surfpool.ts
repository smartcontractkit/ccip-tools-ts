/**
 * Surfpool fork harness shared by the Solana fork suites (`solana/fork.test.ts`, `cct/solana/onboarding.fork.test.ts`).
 *
 * Surfpool forks a live cluster into a local SVM that lazily clones accounts on first read, and
 * exposes `surfnet_*` cheatcodes to overwrite accounts. Suites start one instance per describe
 * block, on a port of their own.
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process'

import { Connection, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'

/** Mirrors Surfpool's output to the console when set. */
export const VERBOSE = !!process.env.VERBOSE

export interface SurfpoolInstance {
  host: string
  port: number
  start(): Promise<void>
  stop(): Promise<void>
}

export function isSurfpoolAvailable(): boolean {
  try {
    execSync('surfpool --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function createSurfpoolInstance({
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

/**
 * Tears down the web3.js websocket BEFORE stopping surfpool. Sends confirm through it
 * (connection.confirmTransaction), and web3.js hands its client `max_reconnects: Infinity` — once
 * surfpool is gone the client would retry the dead socket every second forever, keeping the test
 * process alive long after every test has passed. There is no public accessor for the client, so
 * this pokes the private field, but only through its public CommonClient API
 * (setAutoReconnect/close).
 */
export function closeWebSocket(connection: Connection | undefined) {
  const wsClient = (
    connection as unknown as
      | {
          _rpcWebSocket?: {
            setAutoReconnect?: (enable: boolean) => void
            close?: (code?: number, data?: string) => void
          }
        }
      | undefined
  )?._rpcWebSocket
  wsClient?.setAutoReconnect?.(false)
  try {
    wsClient?.close?.(1000, 'fork tests done')
  } catch {
    // socket already gone
  }
}

/** Sends a raw JSON-RPC request to the fork, for the `surfnet_*` cheatcodes web3.js doesn't wrap. */
export async function surfnetRequest(
  connection: Connection,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch(connection.rpcEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`)
  return body.result
}

/**
 * Copies the upstream rent sysvar into the fork. Surfpool synthesizes rent from its local SVM
 * defaults instead of cloning the cluster's sysvar, so accounts created upstream can fail Anchor's
 * rent-exemption check on the fork.
 */
export async function syncRentSysvar(fork: Connection, upstreamUrl: string): Promise<void> {
  const rent = await new Connection(upstreamUrl, 'confirmed').getAccountInfo(SYSVAR_RENT_PUBKEY)
  if (!rent) throw new Error('upstream rent sysvar not found')
  await surfnetRequest(fork, 'surfnet_setAccount', [
    SYSVAR_RENT_PUBKEY.toBase58(),
    {
      data: rent.data.toString('hex'),
      lamports: rent.lamports,
      owner: rent.owner.toBase58(),
      executable: rent.executable,
    },
  ])
  const forkRent = await fork.getAccountInfo(SYSVAR_RENT_PUBKEY)
  if (!forkRent?.data.equals(rent.data)) throw new Error('fork rent sysvar does not match upstream')
}

/**
 * Starts Surfpool forking `upstreamUrl` and connects to it, with the upstream rent settings.
 * Call {@link stopFork} in `after`.
 */
export async function startFork({
  upstreamUrl,
  port,
}: {
  upstreamUrl: string
  port: number
}): Promise<{ surfpool: SurfpoolInstance; connection: Connection }> {
  const surfpool = createSurfpoolInstance({ rpcUrl: upstreamUrl, port })
  await surfpool.start()
  const connection = new Connection(`http://${surfpool.host}:${surfpool.port}`, {
    commitment: 'confirmed',
    wsEndpoint: `ws://${surfpool.host}:${surfpool.port + 1}`,
  })
  await syncRentSysvar(connection, upstreamUrl)
  return { surfpool, connection }
}

/** Closes the fork's websocket, then stops Surfpool; see {@link closeWebSocket}. */
export async function stopFork(fork: {
  surfpool?: SurfpoolInstance
  connection?: Connection
}): Promise<void> {
  closeWebSocket(fork.connection)
  await fork.surfpool?.stop()
}
