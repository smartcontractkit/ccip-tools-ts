/**
 * Pool set-rate-limiter-config subcommand.
 * Updates rate limiter configurations on a CCIP token pool.
 */

import {
  type AptosChain,
  type Chain,
  type ChainRateLimiterConfig,
  type EVMChain,
  type RateLimiterConfig,
  type SetChainRateLimiterConfigParams,
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

export const command = 'set-rate-limiter-config'
export const describe = 'Update rate limiter configurations on a CCIP token pool'

// ── Config file schema ──

interface ConfigFile {
  chainConfigs: Array<{
    remoteChainSelector: string
    outboundRateLimiterConfig: RateLimiterConfig
    inboundRateLimiterConfig: RateLimiterConfig
    customBlockConfirmations?: boolean
  }>
}

// ── Generate config template ──

const CONFIG_TEMPLATE: ConfigFile = {
  chainConfigs: [
    {
      remoteChainSelector:
        '<CHAIN_NAME_OR_SELECTOR e.g. ethereum-testnet-sepolia or 16015286601757825753>',
      outboundRateLimiterConfig: {
        isEnabled: true,
        capacity: '100000000000000000000000',
        rate: '167000000000000000000',
      },
      inboundRateLimiterConfig: {
        isEnabled: true,
        capacity: '100000000000000000000000',
        rate: '167000000000000000000',
      },
      // customBlockConfirmations: true,
      // ^ Faster-Than-Finality (FTF) — set to true to apply these rate limiters
      //   to the FTF (customBlockConfirmations) path. EVM v2.0+ pools only.
    },
  ],
}

/**
 * Yargs builder for the pool set-rate-limiter-config subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be pool owner or rate-limit admin)',
    })
    .option('pool-address', {
      type: 'string',
      describe: 'Local pool address',
    })
    .option('config', {
      type: 'string',
      describe: 'Path to JSON config file with rate limiter configurations',
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
        'ccip-cli pool set-rate-limiter-config -n sepolia --pool-address 0x... --config config.json',
        'Set rate limiter config from a config file',
      ],
      [
        'ccip-cli pool set-rate-limiter-config --generate-config > config.json',
        'Generate a template config file',
      ],
    ])

/**
 * Handler for the pool set-rate-limiter-config subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  // Handle --generate-config
  if (argv.generateConfig) {
    console.log(JSON.stringify(CONFIG_TEMPLATE, null, 2))
    return
  }

  const [ctx, destroy] = getCtx(argv)
  return doSetRateLimiterConfig(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type SetRateLimiterArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Reads and parses config from file path or stdin. */
async function readConfig(argv: SetRateLimiterArgv): Promise<ConfigFile> {
  const { readFileSync } = await import('node:fs')

  if (argv.config) {
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
 */
function resolveChainSelector(input: string): bigint {
  return networkInfo(input).chainSelector
}

/** Converts a config file to SetChainRateLimiterConfigParams. */
function configToParams(poolAddress: string, config: ConfigFile): SetChainRateLimiterConfigParams {
  const chainConfigs: ChainRateLimiterConfig[] = config.chainConfigs.map((c) => ({
    remoteChainSelector: resolveChainSelector(c.remoteChainSelector),
    outboundRateLimiterConfig: c.outboundRateLimiterConfig,
    inboundRateLimiterConfig: c.inboundRateLimiterConfig,
    customBlockConfirmations: c.customBlockConfirmations,
  }))

  return { poolAddress, chainConfigs }
}

/** Calls setChainRateLimiterConfig on the appropriate chain-family admin. */
function setForChain(chain: Chain, wallet: unknown, params: SetChainRateLimiterConfigParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.setChainRateLimiterConfig(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.setChainRateLimiterConfig(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.setChainRateLimiterConfig(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doSetRateLimiterConfig(ctx: Ctx, argv: SetRateLimiterArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network!).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const config = await readConfig(argv)
  const params = configToParams(argv.poolAddress!, config)

  logger.debug(`Setting rate limiter config: ${params.chainConfigs.length} chain config(s)`)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await setForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: argv.poolAddress!,
    txHash: result.txHash,
    chainsConfigured: String(params.chainConfigs.length),
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Rate limiter config updated, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
