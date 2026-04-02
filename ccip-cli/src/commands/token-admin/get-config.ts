/**
 * Get config subcommand.
 * Queries the TokenAdminRegistry for a token's admin configuration.
 */

import {
  type Chain,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'get-config'
export const describe = 'Query token admin configuration from the TokenAdminRegistry'

/**
 * Yargs builder for the get-config subcommand.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address to query config for',
    })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe:
        'CCIP Router address (EVM/Aptos: discovers registry; Solana: router is the registry)',
    })
    .example([
      [
        'ccip-cli token-admin get-config -n ethereum-testnet-sepolia --token-address 0xa42B... --router-address 0x0BF3...',
        'Query token admin config on Sepolia',
      ],
      [
        'ccip-cli token-admin get-config -n solana-devnet --token-address J6fE... --router-address Ccip...',
        'Query token admin config on Solana devnet',
      ],
    ])

/**
 * Handler for the get-config subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doGetConfig(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type GetConfigArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Queries the TokenAdminRegistry for a token's config. */
async function getConfigForChain(chain: Chain, argv: GetConfigArgv) {
  switch (chain.network.family) {
    case ChainFamily.EVM:
    case ChainFamily.Solana:
    case ChainFamily.Aptos: {
      const registryAddress = await chain.getTokenAdminRegistryFor(argv.routerAddress)
      return {
        registryAddress,
        ...(await chain.getRegistryTokenConfig(registryAddress, argv.tokenAddress)),
      }
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doGetConfig(ctx: Ctx, argv: GetConfigArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const result = await getConfigForChain(chain, argv)

  const output: Record<string, string> = {
    network: networkName,
    registryAddress: result.registryAddress,
    administrator: result.administrator,
  }
  if (result.pendingAdministrator) {
    output.pendingAdministrator = result.pendingAdministrator
  }
  if (result.tokenPool) {
    output.tokenPool = result.tokenPool
  }
  if (result.poolLookupTable) {
    output.poolLookupTable = result.poolLookupTable
  }

  switch (argv.format) {
    case Format.json:
      logger.log(
        JSON.stringify(
          result.poolLookupTableEntries
            ? { ...output, poolLookupTableEntries: result.poolLookupTableEntries }
            : output,
          null,
          2,
        ),
      )
      return
    case Format.log:
      logger.log('administrator:', result.administrator)
      if (result.pendingAdministrator)
        logger.log('pendingAdministrator:', result.pendingAdministrator)
      if (result.tokenPool) logger.log('tokenPool:', result.tokenPool)
      if (output.poolLookupTable) logger.log('poolLookupTable:', output.poolLookupTable)
      if (result.poolLookupTableEntries) {
        logger.log('poolLookupTableEntries:')
        result.poolLookupTableEntries.forEach((entry, i) => logger.log(`  [${i}]: ${entry}`))
      }
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
