/**
 * CCIP Chain Discovery Command
 *
 * Lists and looks up CCIP chain configurations with support for:
 * - Single chain lookup by name, chainId, or selector
 * - Filtering by chain family, mainnet/testnet
 * - Search for chains by name
 * - Interactive search with type-ahead filtering
 * - JSON output for scripting
 * - Field extraction for specific values
 */

import { type Logger, ChainFamily, networkInfo } from '@chainlink/ccip-sdk/src/index.ts'
import { search } from '@inquirer/prompts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError } from './utils.ts'
import {
  type ChainInfo,
  type Environment,
  fetchAllChains,
  getAllChainsFlat,
  searchChainsAPI,
} from '../services/docs-config-api.ts'

export const command = 'chains [identifier]'
export const describe = 'List and lookup CCIP chain configuration'

/**
 * Yargs builder for the chains command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('identifier', {
      type: 'string',
      describe: 'Chain name, chainId, or selector to lookup',
    })
    .options({
      family: {
        type: 'string',
        choices: [
          ChainFamily.EVM,
          ChainFamily.Solana,
          ChainFamily.Aptos,
          ChainFamily.Sui,
          ChainFamily.TON,
        ] as const,
        describe: 'Filter by chain family (EVM, SVM, APTOS, SUI, TON)',
      },
      mainnet: { type: 'boolean', describe: 'Show only mainnets' },
      testnet: { type: 'boolean', describe: 'Show only testnets' },
      search: { alias: 's', type: 'string', describe: 'Search chains by name' },
      interactive: {
        alias: 'i',
        type: 'boolean',
        describe: 'Interactive search with type-ahead filtering',
      },
      count: { type: 'boolean', describe: 'Show count summary only' },
      field: { type: 'string', describe: 'Output only a specific field value' },
    })

/**
 * Handler for the chains command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return listChains(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

/**
 * Helper for BigInt serialization in JSON.
 */
function replacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}

async function listChains(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { logger } = ctx

  // Determine environment from flags (passthrough to API)
  const environment: Environment | undefined = argv.mainnet
    ? 'mainnet'
    : argv.testnet
      ? 'testnet'
      : undefined

  // 1. Fetch chains from API (passthrough environment and search to API)
  const searchTerm = argv.identifier ?? argv.search
  let chains: ChainInfo[]
  try {
    const responses = searchTerm
      ? await searchChainsAPI(searchTerm, environment, logger)
      : await fetchAllChains(environment, logger)
    chains = getAllChainsFlat(responses)
  } catch (err) {
    logger.error('Failed to fetch chains from API after retries:', (err as Error).message)
    process.exitCode = 1
    return
  }

  if (chains.length === 0) {
    logger.error(searchTerm ? `No chains found for: ${searchTerm}` : 'No chains found')
    process.exitCode = 1
    return
  }

  // 2. Apply family filter using SDK's networkInfo for consistent family values
  if (argv.family) {
    chains = chains.filter((chain) => {
      try {
        const info = networkInfo(BigInt(chain.chainSelector))
        return info.family === argv.family
      } catch {
        // Chain not in SDK - exclude from family filter results
        return false
      }
    })
  }

  // 3. Output
  if (argv.count) {
    logger.log(chains.length)
    return
  }

  if (argv.field) {
    for (const chain of chains) {
      logger.log(String(chain[argv.field as keyof ChainInfo]))
    }
    return
  }

  if (argv.format === Format.json) {
    logger.log(JSON.stringify(chains, replacer, 2))
    return
  }

  // 6. Interactive search mode
  if (argv.interactive) {
    const selected = await interactiveSearch(chains, environment, logger)
    if (selected) {
      logger.log(`\nName:        ${selected.name}`)
      logger.log(`DisplayName: ${selected.displayName}`)
      logger.log(`Selector:    ${selected.chainSelector}`)
      logger.log(`ChainId:     ${selected.chainId}`)
      logger.log(`Family:      ${selected.family}`)
      logger.log(`Environment: ${selected.environment}`)
      logger.log(`Supported:   ${selected.supported ? 'Yes' : 'No'}`)
    }
    return
  }

  // Table output
  const displayNameWidth = Math.min(
    25,
    Math.max(12, ...chains.map((n) => n.displayName.length)) + 2,
  )
  const nameWidth = Math.min(35, Math.max(20, ...chains.map((n) => n.name.length)) + 2)
  const selectorWidth = 22
  const familyWidth = 7
  const envWidth = 9
  const supportedWidth = 10

  logger.log(
    'DisplayName'.padEnd(displayNameWidth) +
      'Name'.padEnd(nameWidth) +
      'Selector'.padEnd(selectorWidth) +
      'Family'.padEnd(familyWidth) +
      'Network'.padEnd(envWidth) +
      'Supported',
  )
  logger.log(
    '-'.repeat(
      displayNameWidth + nameWidth + selectorWidth + familyWidth + envWidth + supportedWidth,
    ),
  )

  for (const n of chains) {
    logger.log(
      n.displayName.padEnd(displayNameWidth) +
        n.name.padEnd(nameWidth) +
        n.chainSelector.padEnd(selectorWidth) +
        n.family.padEnd(familyWidth) +
        n.environment.padEnd(envWidth) +
        (n.supported ? 'Yes' : 'No'),
    )
  }
  logger.log(`\nTotal: ${chains.length} chains`)
}

/**
 * Interactive search with type-ahead filtering using inquirer/prompts.
 * Uses API search on each keystroke (passthrough to API).
 */
async function interactiveSearch(
  initialChains: ChainInfo[],
  environment?: Environment,
  logger?: Logger,
): Promise<ChainInfo | undefined> {
  if (initialChains.length === 0) {
    return undefined
  }

  return search({
    message: 'Search and select a chain:',
    pageSize: 15,
    source: async (term) => {
      // Use API search when term provided, otherwise use initial chains (cached)
      const chains = term
        ? getAllChainsFlat(await searchChainsAPI(term, environment, logger))
        : initialChains

      if (chains.length === 0) {
        return []
      }

      const nameWidth = Math.min(30, Math.max(15, ...chains.map((c) => c.displayName.length)))
      const familyWidth = 8

      return chains.map((chain, i) => ({
        name: `${chain.displayName.padEnd(nameWidth)} ${chain.family.padEnd(familyWidth)}`,
        value: chain,
        short: chain.displayName,
        description: `${i + 1}/${chains.length} | selector: ${chain.chainSelector}`,
      }))
    },
  })
}
