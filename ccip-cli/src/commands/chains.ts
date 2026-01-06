/**
 * CCIP Chain Discovery Command
 *
 * Lists and looks up CCIP chain configurations with support for:
 * - Single chain lookup by name, chainId, or selector
 * - Filtering by chain family, mainnet/testnet, CCIP-enabled
 * - Fuzzy search for typo-tolerant lookups
 * - Interactive search with type-ahead filtering
 * - JSON output for scripting
 * - Field extraction for specific values
 */

import { getAllDeployments } from '@chainlink/ccip-config/src/index.ts'
import { type ChainFamily, networkInfo } from '@chainlink/ccip-sdk/src/index.ts'
import { search } from '@inquirer/prompts'
import Fuse from 'fuse.js'
import type { Argv } from 'yargs'

import '../config-loader.ts'
import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError } from './utils.ts'

export const command = 'chains [identifier]'
export const describe = 'List and lookup CCIP chain configuration'

type ChainsArgs = {
  identifier?: string
  family?: ChainFamily
  mainnet?: boolean
  testnet?: boolean
  ccipOnly?: boolean
  search?: string
  interactive?: boolean
  count?: boolean
  json?: boolean
  field?: string
}

/**
 * Yargs builder for the chains command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv): Argv<ChainsArgs> =>
  yargs
    .positional('identifier', {
      type: 'string',
      describe: 'Chain name, chainId, or selector to lookup',
    })
    .options({
      family: {
        type: 'string',
        choices: ['evm', 'solana', 'aptos', 'sui', 'ton'] as const,
        describe: 'Filter by chain family',
      },
      mainnet: { type: 'boolean', describe: 'Show only mainnets' },
      testnet: { type: 'boolean', describe: 'Show only testnets' },
      'ccip-only': { type: 'boolean', describe: 'Show only CCIP-enabled chains (with router)' },
      search: { alias: 's', type: 'string', describe: 'Fuzzy search chains by name' },
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

type ChainInfo = {
  name: string
  chainId: number | string
  chainSelector: bigint
  family: ChainFamily
  isTestnet: boolean
  displayName: string
  router?: string
}

async function listChains(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { logger } = ctx

  // 1. If identifier provided, do single lookup
  if (argv.identifier) {
    try {
      const network = networkInfo(argv.identifier)
      const deployment = getAllDeployments().find((d) => d.chainSelector === network.chainSelector)
      const result: ChainInfo = {
        ...network,
        displayName: deployment?.displayName ?? network.name,
        router: deployment?.router,
      }

      if (argv.field) {
        const value = result[argv.field as keyof ChainInfo]
        logger.log(value !== undefined ? String(value) : '')
        return
      }
      if (argv.format === Format.json) {
        logger.log(JSON.stringify(result, replacer, 2))
        return
      }
      // Pretty print
      logger.log(`Name:        ${result.name}`)
      logger.log(`DisplayName: ${result.displayName}`)
      logger.log(`Selector:    ${result.chainSelector}`)
      logger.log(`ChainId:     ${result.chainId}`)
      logger.log(`Family:      ${result.family}`)
      logger.log(`Testnet:     ${result.isTestnet}`)
      logger.log(`Router:      ${result.router ?? '(not configured)'}`)
      return
    } catch {
      logger.error(`Chain not found: ${argv.identifier}`)
      process.exitCode = 1
      return
    }
  }

  // 2. Get all deployments from ccip-config
  const deployments = getAllDeployments()

  // 3. Build chain info for each deployment
  let chains: ChainInfo[] = deployments.map((d) => {
    try {
      const network = networkInfo(d.chainSelector)
      return {
        ...network,
        displayName: d.displayName,
        router: d.router,
      }
    } catch {
      // If networkInfo fails, construct from deployment data
      return {
        name: d.displayName.toLowerCase().replace(/\s+/g, '-'),
        chainId: 'unknown',
        chainSelector: d.chainSelector,
        family: 'evm' as ChainFamily,
        isTestnet:
          d.displayName.toLowerCase().includes('test') ||
          d.displayName.toLowerCase().includes('sepolia'),
        displayName: d.displayName,
        router: d.router,
      }
    }
  })

  // 4. Apply filters
  if (argv.family) {
    chains = chains.filter((n) => n.family === argv.family)
  }
  if (argv.mainnet) {
    chains = chains.filter((n) => !n.isTestnet)
  }
  if (argv.testnet) {
    chains = chains.filter((n) => n.isTestnet)
  }
  if (argv.ccipOnly) {
    chains = chains.filter((n) => n.router !== undefined)
  }

  // 5. Fuzzy search if provided
  if (argv.search) {
    const fuse = new Fuse(chains, {
      keys: ['name', 'displayName'],
      threshold: 0.4, // Allow typos
    })
    chains = fuse.search(argv.search).map((r) => r.item)
  }

  // 6. Output
  if (argv.count) {
    logger.log(chains.length)
    return
  }

  if (argv.format === Format.json) {
    logger.log(JSON.stringify(chains, replacer, 2))
    return
  }

  // 7. Interactive search mode
  if (argv.interactive) {
    const selected = await interactiveSearch(chains)
    if (selected) {
      logger.log(`\nName:        ${selected.name}`)
      logger.log(`DisplayName: ${selected.displayName}`)
      logger.log(`Selector:    ${selected.chainSelector}`)
      logger.log(`ChainId:     ${selected.chainId}`)
      logger.log(`Family:      ${selected.family}`)
      logger.log(`Testnet:     ${selected.isTestnet}`)
      logger.log(`Router:      ${selected.router ?? '(not configured)'}`)
    }
    return
  }

  // Table output
  const nameWidth = Math.min(45, Math.max(20, ...chains.map((n) => n.displayName.length)) + 2)
  const selectorWidth = 24
  const familyWidth = 10

  logger.log(
    'Name'.padEnd(nameWidth) +
      'Selector'.padEnd(selectorWidth) +
      'Family'.padEnd(familyWidth) +
      'Router',
  )
  logger.log('-'.repeat(nameWidth + selectorWidth + familyWidth + 44))

  for (const n of chains) {
    logger.log(
      n.displayName.padEnd(nameWidth) +
        String(n.chainSelector).padEnd(selectorWidth) +
        n.family.padEnd(familyWidth) +
        (n.router ?? '-'),
    )
  }
  logger.log(`\nTotal: ${chains.length} chains`)
}

/**
 * Interactive search with type-ahead filtering using inquirer/prompts.
 * Allows users to filter chains as they type and select one to view details.
 */
async function interactiveSearch(chains: ChainInfo[]): Promise<ChainInfo | undefined> {
  if (chains.length === 0) {
    return undefined
  }

  return search({
    message: 'Search and select a chain:',
    pageSize: 15,
    source: (term) => {
      let filtered = chains
      if (term) {
        const fuse = new Fuse(chains, {
          keys: ['name', 'displayName', 'chainId'],
          threshold: 0.4,
        })
        filtered = fuse.search(term).map((r) => r.item)
      }

      const nameWidth = Math.min(30, Math.max(15, ...filtered.map((c) => c.displayName.length)))
      const familyWidth = 8

      return filtered.map((chain, i) => ({
        name: `${chain.displayName.padEnd(nameWidth)} ${chain.family.padEnd(familyWidth)} ${chain.router ? '✓' : '-'}`,
        value: chain,
        short: chain.displayName,
        description: `${i + 1}/${filtered.length} | selector: ${chain.chainSelector}`,
      }))
    },
  })
}
