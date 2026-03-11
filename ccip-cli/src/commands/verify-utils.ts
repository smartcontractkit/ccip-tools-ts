/**
 * Shared helper for the in-CLI contract-verification flow.
 *
 * Used by the `--verify` flag on the deploy commands and by the standalone `verify` command.
 * The verify module (and its ~1.3MB bundled standard-json fixtures) is lazy-imported so it
 * only loads when verification is actually requested.
 */

import {
  CCIPArgumentInvalidError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { JsonRpcApiProvider } from 'ethers'

import type { Ctx } from './types.ts'

/** Lazy loaders for the deployable contracts' creation bytecode (used to derive ctor args). */
const BYTECODE_LOADERS: Record<string, () => Promise<string>> = {
  CrossChainToken: async () =>
    (await import('@chainlink/ccip-sdk/src/token-admin/evm/bytecodes/CrossChainToken.ts'))
      .CROSS_CHAIN_TOKEN_BYTECODE,
  CrossChainPoolToken: async () =>
    (await import('@chainlink/ccip-sdk/src/token-admin/evm/bytecodes/CrossChainPoolToken.ts'))
      .CROSS_CHAIN_POOL_TOKEN_BYTECODE,
  BurnMintTokenPool: async () =>
    (await import('@chainlink/ccip-sdk/src/token-admin/evm/bytecodes/BurnMintTokenPool.ts'))
      .BURN_MINT_TOKEN_POOL_BYTECODE,
  LockReleaseTokenPool: async () =>
    (await import('@chainlink/ccip-sdk/src/token-admin/evm/bytecodes/LockReleaseTokenPool.ts'))
      .LOCK_RELEASE_TOKEN_POOL_BYTECODE,
  ERC20LockBox: async () =>
    (await import('@chainlink/ccip-sdk/src/token-admin/evm/bytecodes/ERC20LockBox.ts'))
      .ERC20_LOCK_BOX_BYTECODE,
}

/** Asks the Etherscan-v2 directory for a contract's creation transaction hash. */
async function fetchCreationTxHash(
  chainId: number,
  address: string,
  apiKey: string,
): Promise<string> {
  const url = new URL('https://api.etherscan.io/v2/api')
  url.searchParams.set('chainid', String(chainId))
  url.searchParams.set('module', 'contract')
  url.searchParams.set('action', 'getcontractcreation')
  url.searchParams.set('contractaddresses', address)
  url.searchParams.set('apikey', apiKey)
  const res = await fetch(url)
  const json = (await res.json()) as { status: string; result?: Array<{ txHash?: string }> }
  const txHash = json.result?.[0]?.txHash
  if (json.status !== '1' || !txHash) {
    throw new CCIPArgumentInvalidError(
      'address',
      `could not find the creation transaction for ${address} via the explorer; pass --creation-tx or --constructor-args`,
    )
  }
  return txHash
}

/** One frame of a `callTracer` trace tree. */
interface CallFrame {
  type?: string
  to?: string
  input?: string
  calls?: CallFrame[]
}

/**
 * Walks a `callTracer` trace for the CREATE/CREATE2 frame that produced `address` and returns its
 * init code. Needed for factory deploys, where the contract is born in an internal call (so the
 * top-level tx input is the factory calldata, not the contract's init code).
 */
async function traceCreatedInitCode(
  provider: JsonRpcApiProvider,
  txHash: string,
  address: string,
): Promise<string | undefined> {
  const target = address.toLowerCase()
  const root = (await provider.send('debug_traceTransaction', [
    txHash,
    { tracer: 'callTracer' },
  ])) as CallFrame
  const stack: CallFrame[] = [root]
  while (stack.length) {
    const frame = stack.pop()!
    if (
      (frame.type === 'CREATE' || frame.type === 'CREATE2') &&
      frame.to?.toLowerCase() === target
    ) {
      return frame.input
    }
    if (frame.calls) stack.push(...frame.calls)
  }
  return undefined
}

/**
 * Recovers a deployed contract's ABI-encoded constructor args (for an ALREADY-deployed contract)
 * by reading its on-chain creation code and stripping the known SDK creation bytecode. Used by the
 * standalone `verify` command so users only supply `--contract` + `--address`.
 *
 * Handles both direct deploys (init code IS the creation tx input) and factory deploys (the
 * contract is created in an internal CREATE2 call — recovered via `debug_traceTransaction`).
 */
export async function deriveEncodedConstructorArgs(opts: {
  contract: string
  chainId: number
  address: string
  apiKey: string
  provider: JsonRpcApiProvider
  creationTx?: string
}): Promise<string> {
  const loader = BYTECODE_LOADERS[opts.contract]
  if (!loader) {
    throw new CCIPArgumentInvalidError(
      'contract',
      `cannot auto-derive constructor args for "${opts.contract}"; pass --constructor-args`,
    )
  }
  const bytecode = await loader()
  const txHash =
    opts.creationTx ?? (await fetchCreationTxHash(opts.chainId, opts.address, opts.apiKey))

  // Direct deploy: the creation tx input is the init code (bytecode || args).
  const tx = await opts.provider.getTransaction(txHash)
  let initCode = tx?.data ?? ''

  // Factory deploy: the contract is created in an internal CREATE2 call — recover via a trace.
  if (!initCode.startsWith(bytecode)) {
    const traced = await traceCreatedInitCode(opts.provider, txHash, opts.address).catch(
      () => undefined,
    )
    if (traced) initCode = traced
  }

  if (!initCode.startsWith(bytecode)) {
    throw new CCIPArgumentInvalidError(
      'contract',
      `could not recover ${opts.contract} init code from ${txHash} (wrong --contract/version, or the RPC lacks debug_traceTransaction for this factory deploy); pass --constructor-args`,
    )
  }
  return `0x${initCode.slice(bytecode.length)}`
}

/** A single contract to verify on a source-chain explorer. */
export interface VerifyTarget {
  /** Bundled verification-registry key, e.g. `CrossChainToken` (see SDK `listDeployableContracts()`). */
  contract: string
  /** Deployed contract address. */
  address: string
  /** ABI-encoded constructor args, `0x`-prefixed (omit / `'0x'` for no-arg constructors). */
  encodedConstructorArgs?: string
}

/**
 * Verifies one or more freshly-deployed contracts on the network's explorer (Etherscan v2 /
 * Blockscout / Sourcify, auto-routed by chainId). EVM-only; logs and skips otherwise.
 * Never throws — verification failures are reported but don't fail the deploy.
 */
export async function runVerification(
  ctx: Ctx,
  networkName: string,
  targets: readonly VerifyTarget[],
  opts: { etherscanApiKey?: string },
): Promise<void> {
  const net = networkInfo(networkName)
  if (net.family !== ChainFamily.EVM) {
    ctx.logger.warn(`verify: contract verification is EVM-only; skipping for ${networkName}`)
    return
  }
  const apiKey = opts.etherscanApiKey ?? process.env.ETHERSCAN_API_KEY
  if (!apiKey) {
    ctx.logger.warn(
      'verify: no Etherscan API key — pass --etherscan-api-key or set ETHERSCAN_API_KEY; skipping verification',
    )
    return
  }
  const chainId = Number(net.chainId)

  // Lazy-load the verify module (pulls the bundled fixtures) only when actually verifying.
  const { verifyDeployedContract } = await import('@chainlink/ccip-sdk/src/verify/index.ts')

  // A freshly-deployed contract isn't indexed by the explorer for a few seconds — retry the
  // submit on the "not yet indexed" error before giving up.
  const notIndexed = /unable to locate contractcode|does not exist|not.*found/i
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  for (const t of targets) {
    ctx.logger.info(`verify: submitting ${t.contract} at ${t.address} (chainId ${chainId})...`)
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await verifyDeployedContract({
          contract: t.contract,
          chainId,
          contractAddress: t.address,
          apiKey,
          constructorArgs: t.encodedConstructorArgs
            ? { kind: 'encoded', hex: t.encodedConstructorArgs }
            : { kind: 'none' },
        })
        const link = result.explorerUrl ? ` ${result.explorerUrl}` : ''
        ctx.output.write(
          `verify[${t.contract} @ ${t.address}]: ${result.status} — ${result.message}${link}`,
        )
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (notIndexed.test(msg) && attempt <= 8) {
          ctx.logger.info(
            `verify: contract not indexed yet, retrying in 8s (attempt ${attempt}/8)...`,
          )
          await sleep(8_000)
          continue
        }
        ctx.logger.error(`verify[${t.contract} @ ${t.address}] errored:`, msg)
        break
      }
    }
  }
}
