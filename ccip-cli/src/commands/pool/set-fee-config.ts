/**
 * Pool set-fee-config subcommand.
 * Sets per-destination token-transfer fee configs on a CCIP token pool (EVM v2.0+ only).
 */

import {
  type Chain,
  type EVMChain,
  type SetTokenTransferFeeConfigParams,
  type TokenTransferFeeConfigUpdate,
  CCIPArgumentInvalidError,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'set-fee-config'
export const describe =
  'Set per-destination token-transfer fee configs on a CCIP token pool (EVM v2.0+ only)'

// ── Config file schema ──

interface FeeConfigEntry {
  remoteChainSelector: string
  destGasOverhead: number
  destBytesOverhead: number
  finalityFeeUSDCents: number
  fastFinalityFeeUSDCents: number
  finalityTransferFeeBps: number
  fastFinalityTransferFeeBps: number
  isEnabled: boolean
}

interface ConfigFile {
  feeConfigs: FeeConfigEntry[]
  disable?: string[]
}

// ── Generate config template ──

const CONFIG_TEMPLATE: ConfigFile = {
  feeConfigs: [
    {
      remoteChainSelector:
        '<CHAIN_NAME_OR_SELECTOR e.g. avalanche-testnet-fuji or 14767482510784806043>',
      destGasOverhead: 90000,
      destBytesOverhead: 32,
      finalityFeeUSDCents: 10,
      fastFinalityFeeUSDCents: 50,
      finalityTransferFeeBps: 5,
      fastFinalityTransferFeeBps: 25,
      isEnabled: true,
    },
  ],
  disable: [],
}

/**
 * Yargs builder for the pool set-fee-config subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be pool owner or fee admin)',
    })
    .option('pool-address', {
      type: 'string',
      describe: 'Local pool address',
    })
    .option('config', {
      type: 'string',
      describe: 'Path to JSON config file with token-transfer fee configurations',
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
        'ccip-cli pool set-fee-config -n sepolia --pool-address 0x... --config config.json',
        'Set token-transfer fee config from a config file',
      ],
      [
        'ccip-cli pool set-fee-config --generate-config > config.json',
        'Generate a template config file',
      ],
    ])

/**
 * Handler for the pool set-fee-config subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  // Handle --generate-config
  if (argv.generateConfig) {
    ctx.output.write(JSON.stringify(CONFIG_TEMPLATE, null, 2))
    destroy()
    return
  }

  return doSetFeeConfig(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type SetFeeConfigArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Reads and parses config from file path or stdin. */
async function readConfig(argv: SetFeeConfigArgv): Promise<ConfigFile> {
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
 * Resolves a chain identifier (name, chainId, or selector) to a numeric selector.
 */
function resolveChainSelector(input: string): bigint {
  return networkInfo(input).chainSelector
}

/** Converts a config file to SetTokenTransferFeeConfigParams. */
function configToParams(poolAddress: string, config: ConfigFile): SetTokenTransferFeeConfigParams {
  const updates: TokenTransferFeeConfigUpdate[] = config.feeConfigs.map((c) => ({
    remoteChainSelector: resolveChainSelector(c.remoteChainSelector),
    config: {
      destGasOverhead: c.destGasOverhead,
      destBytesOverhead: c.destBytesOverhead,
      finalityFeeUSDCents: c.finalityFeeUSDCents,
      fastFinalityFeeUSDCents: c.fastFinalityFeeUSDCents,
      finalityTransferFeeBps: c.finalityTransferFeeBps,
      fastFinalityTransferFeeBps: c.fastFinalityTransferFeeBps,
      isEnabled: c.isEnabled,
    },
  }))
  const disable = (config.disable ?? []).map(resolveChainSelector)

  return { poolAddress, updates, disable }
}

/** Calls setTokenTransferFeeConfig on the appropriate chain-family admin (EVM v2.0+ only). */
function setForChain(chain: Chain, wallet: unknown, params: SetTokenTransferFeeConfigParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.setTokenTransferFeeConfig(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doSetFeeConfig(ctx: Ctx, argv: SetFeeConfigArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network!).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const config = await readConfig(argv)
  const params = configToParams(argv.poolAddress!, config)

  logger.debug(
    `Setting token transfer fee config: ${params.updates.length} update(s), ${params.disable?.length ?? 0} disable(s)`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await setForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: argv.poolAddress!,
    txHash: result.txHash,
    updatesApplied: String(params.updates.length),
    disabled: String(params.disable?.length ?? 0),
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Token transfer fee config updated, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
