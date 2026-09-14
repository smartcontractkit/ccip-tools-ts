import { spawn } from 'child_process'
import { fileURLToPath } from 'node:url'
import path from 'path'

import { rpcEndpoints } from '../../../scripts/test-endpoints.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CLI_PATH = path.join(__dirname, '..', 'index.ts')
// Spawned CLI children run with the ccip-cli package root as cwd — the same
// cwd the suite ran under when each workspace's tests were invoked separately.
// It matters for the CLI's cwd-relative defaults: `--rpcs-file` falls back to
// `./.env`, which must keep resolving against ccip-cli (where it lives) rather
// than the repo root (where a symlink to an infra RPC list sits) now that the
// whole tree runs from one root-level `node --test` invocation.
const CLI_CWD = path.join(__dirname, '..', '..')

// Per-network endpoint groups, resolved from RPC_* env vars with the central
// keyless defaults from scripts/test-endpoints.ts. Every e2e invocation passes
// ONLY the endpoints of the chains its fixture lives on (see
// buildShowArgs/buildLaneArgs): the CLI races `--rpc` endpoints per family, and
// an endpoint that never answers stalls every "not found on any chain"
// determination until it does — so racing twenty endpoints per invocation both
// slowed startup and made the whole list's health part of every test. A
// per-lane list also keeps a suite's requests inside the network locks it
// actually holds.

export const SEPOLIA_RPCS = rpcEndpoints('RPC_SEPOLIA')
export const FUJI_RPCS = rpcEndpoints('RPC_FUJI')
export const APTOS_TESTNET_RPCS = rpcEndpoints('RPC_APTOS_TESTNET')
export const SOLANA_DEVNET_RPCS = rpcEndpoints('RPC_SOLANA_DEVNET')
export const TON_TESTNET_RPCS = rpcEndpoints('RPC_TON_TESTNET')
// base -> polygon lane for the EVM->EVM show pretty-format test. Polygon's public
// endpoints vary wildly in eth_getLogs width — 1rpc caps at 50 blocks and then serves a
// Cloudflare challenge under the resulting request burst — so this one is
// chosen for serving the scan's full ~10k-block range in a single call.
export const BASE_MAINNET_RPCS = rpcEndpoints('RPC_BASE_MAINNET')
export const POLYGON_MAINNET_RPCS = rpcEndpoints('RPC_POLYGON_MAINNET')
// bsc-testnet: source of the EVM->Aptos show fixture (and of its lane) and of the
// show format variants' quiet lane (bsc -> base-sepolia).
export const BSC_TESTNET_RPCS = rpcEndpoints('RPC_BSC_TESTNET')
// base-sepolia: source of the EVM->Solana show fixture, dest of the quiet lane
// (bsc -> base-sepolia) and of the v2.0 lane fixture. Both serve a full
// ~10k-block eth_getLogs in one call (verified against the onRamp), so the scan
// path stays available if the API-metadata shortcut ever drops out; tenderly
// leads only as a tie-break, being the same keyless gateway already trusted for
// the sepolia/polygon/mainnet entries.
export const BASE_SEPOLIA_RPCS = rpcEndpoints('RPC_BASE_SEPOLIA')
// gnosis -> ethereum mainnet v1.5 lane config (call-only, no scanning).
export const GNOSIS_MAINNET_RPCS = rpcEndpoints('RPC_GNOSIS_MAINNET')
export const ETHEREUM_MAINNET_RPCS = rpcEndpoints('RPC_ETHEREUM_MAINNET')
// robinhood-testnet v2.0 lane config (call-only). This chain has exactly one
// public endpoint — the operator's own, as published in its chain metadata —
// and it is deliberately preferred over busier v2.0 pairs (ink -> arb-sepolia
// was the alternative) because no other suite locks robinhood-testnet, so this
// lane queues behind nothing.
export const ROBINHOOD_TESTNET_RPCS = rpcEndpoints('RPC_ROBINHOOD_TESTNET')

/**
 * Spawns the CLI in-process as a child of node, capturing its stdout/stderr.
 * Resolves with the captured output and exit code, or rejects if it hangs past
 * `timeout` (killing the child). The rejection carries the output captured so
 * far, because that output is otherwise lost exactly when it is most needed:
 * a CI hang is undiagnosable without it.
 */
export async function spawnCLI(
  args: string[],
  timeout = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], { cwd: CLI_CWD, env: { ...process.env } })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (progress) => {
      stdout += progress
    })
    child.stderr.on('data', (progress) => {
      stderr += progress
    })

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      // A wedged child may not act on SIGTERM; follow up so the run cannot
      // leak a live process past the test that gave up on it.
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }, 5_000)
      killTimer.unref()
      const tail = (text: string) => (text.length > 8_000 ? `…${text.slice(-8_000)}` : text)
      reject(
        new Error(
          `CLI command timed out after ${timeout / 1e3}s\n` +
            `--- child stdout (tail) ---\n${tail(stdout)}\n` +
            `--- child stderr (tail) ---\n${tail(stderr)}`,
        ),
      )
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
