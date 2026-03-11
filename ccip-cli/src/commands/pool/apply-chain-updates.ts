/**
 * Pool apply-chain-updates subcommand.
 * Configures remote chains on a CCIP token pool.
 */

import {
  type ApplyChainUpdatesParams,
  type AptosChain,
  type Chain,
  type EVMChain,
  type RateLimiterConfig,
  type RemoteChainConfig,
  type SolanaChain,
  CCIPArgumentInvalidError,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { AptosTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/aptos/index.ts'
import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import { SolanaTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/solana/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'apply-chain-updates'
export const describe = 'Configure remote chains on a CCIP token pool'

// ── Config file schema ──

interface ConfigFile {
  chainsToRemove?: string[]
  chainsToAdd?: Array<{
    remoteChainSelector: string
    remotePoolAddresses: string[]
    remoteTokenAddress: string
    remoteTokenDecimals?: number
    outboundRateLimiterConfig?: RateLimiterConfig
    inboundRateLimiterConfig?: RateLimiterConfig
  }>
}

// ── Generate config template ──

const CONFIG_TEMPLATE: ConfigFile = {
  chainsToRemove: [],
  chainsToAdd: [
    {
      remoteChainSelector:
        '<CHAIN_NAME_OR_SELECTOR e.g. ethereum-testnet-sepolia or 16015286601757825753>',
      remotePoolAddresses: ['<REMOTE_POOL_ADDRESS>'],
      remoteTokenAddress: '<REMOTE_TOKEN_ADDRESS>',
      remoteTokenDecimals: 18,
      outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
      inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
    },
  ],
}

/**
 * Yargs builder for the pool apply-chain-updates subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key (must be pool owner)',
    })
    .option('pool-address', {
      type: 'string',
      describe: 'Local pool address',
    })
    .option('config', {
      type: 'string',
      describe: 'Path to JSON config file with remote chain configurations',
    })
    .option('generate-config', {
      type: 'boolean',
      describe: 'Output a sample JSON config template to stdout',
    })
    .check((argv) => {
      if (!argv.generateConfig) {
        if (!argv.network)
          throw new CCIPArgumentInvalidError('network', 'required argument missing')
        if (!argv.poolAddress)
          throw new CCIPArgumentInvalidError('pool-address', 'required argument missing')
      }
      return true
    })
    .example([
      [
        'ccip-cli pool apply-chain-updates -n sepolia --pool-address 0x... --config config.json',
        'Apply chain updates from a config file',
      ],
      [
        'ccip-cli pool apply-chain-updates --generate-config > config.json',
        'Generate a template config file',
      ],
      [
        'cat config.json | ccip-cli pool apply-chain-updates -n sepolia --pool-address 0x...',
        'Read config from stdin',
      ],
    ])

/**
 * Handler for the pool apply-chain-updates subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  // Handle --generate-config
  if (argv.generateConfig) {
    console.log(JSON.stringify(CONFIG_TEMPLATE, null, 2))
    return
  }

  const [ctx, destroy] = getCtx(argv)
  return doApplyChainUpdates(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type ApplyArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Reads and parses config from file path or stdin. */
async function readConfig(argv: ApplyArgv): Promise<ConfigFile> {
  const { readFileSync } = await import('node:fs')

  if (argv.config) {
    // Read from file
    const raw = readFileSync(argv.config, 'utf8')
    return JSON.parse(raw) as ConfigFile
  }

  // Try stdin (piped input)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer)
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    return JSON.parse(raw) as ConfigFile
  }

  throw new CCIPArgumentInvalidError(
    'config',
    'No config provided. Use --config <path> or pipe JSON via stdin. Use --generate-config to see the expected format.',
  )
}

/**
 * Resolves a chain identifier (name, chainId, or selector) to a numeric selector string.
 * Uses `networkInfo()` which accepts all three formats.
 */
function resolveChainSelector(input: string): string {
  return networkInfo(input).chainSelector.toString()
}

/** Converts a config file to ApplyChainUpdatesParams. */
function configToParams(poolAddress: string, config: ConfigFile): ApplyChainUpdatesParams {
  const defaultRateLimit: RateLimiterConfig = { isEnabled: false, capacity: '0', rate: '0' }

  const chainsToAdd: RemoteChainConfig[] = (config.chainsToAdd ?? []).map((c) => ({
    remoteChainSelector: resolveChainSelector(c.remoteChainSelector),
    remotePoolAddresses: c.remotePoolAddresses,
    remoteTokenAddress: c.remoteTokenAddress,
    remoteTokenDecimals: c.remoteTokenDecimals,
    outboundRateLimiterConfig: c.outboundRateLimiterConfig ?? defaultRateLimit,
    inboundRateLimiterConfig: c.inboundRateLimiterConfig ?? defaultRateLimit,
  }))

  return {
    poolAddress,
    remoteChainSelectorsToRemove: (config.chainsToRemove ?? []).map(resolveChainSelector),
    chainsToAdd,
  }
}

/** Calls applyChainUpdates on the appropriate chain-family admin. */
function applyForChain(chain: Chain, wallet: unknown, params: ApplyChainUpdatesParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.applyChainUpdates(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.applyChainUpdates(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.applyChainUpdates(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doApplyChainUpdates(ctx: Ctx, argv: ApplyArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network!).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const config = await readConfig(argv)
  const params = configToParams(argv.poolAddress!, config)

  logger.debug(
    `Applying chain updates: ${params.chainsToAdd.length} add(s), ${params.remoteChainSelectorsToRemove.length} remove(s)`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await applyForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: argv.poolAddress!,
    txHash: result.txHash,
    chainsAdded: String(params.chainsToAdd.length),
    chainsRemoved: String(params.remoteChainSelectorsToRemove.length),
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Chain updates applied, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
