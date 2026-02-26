/**
 * CCIP CLI Lane Latency Command
 *
 * Queries real-time lane latency statistics between source and destination chains
 * using the CCIP API. Shows average, median, and percentile latencies.
 *
 * @example
 * ```bash
 * # Get latency between Ethereum and Arbitrum
 * ccip-cli lane-latency ethereum-mainnet arbitrum-mainnet
 *
 * # Use custom API URL
 * ccip-cli lane-latency sepolia fuji --api-url https://custom-api.example.com
 * ```
 *
 * @packageDocumentation
 */

import {
  CCIPAPIClient,
  CCIPApiClientNotAvailableError,
  bigIntReplacer,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { formatDuration, getCtx, logParsedError, prettyTable } from './utils.ts'

export const command = ['laneLatency <source> <dest>', 'lane-latency <source> <dest>']
export const describe = 'Query real-time lane latency between source and destination chains'
export const aliases = ['latency']

/**
 * Yargs builder for the lane-latency command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('source', {
      type: 'string',
      demandOption: true,
      describe: 'Source network (chainId, selector, or name). Example: ethereum-mainnet',
    })
    .positional('dest', {
      type: 'string',
      demandOption: true,
      describe: 'Destination network (chainId, selector, or name). Example: arbitrum-mainnet',
    })
    .option('api-url', {
      type: 'string',
      describe: 'Custom CCIP API URL (defaults to api.ccip.chain.link)',
    })

/**
 * Handler for the lane-latency command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return getLaneLatencyCmd(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

/** Exported for testing */
export async function getLaneLatencyCmd(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx

  // Respect --no-api flag - this command requires API access
  if (argv.noApi) {
    throw new CCIPApiClientNotAvailableError({
      context: {
        reason:
          'The lane-latency command requires API access. Remove --no-api flag to use this command.',
      },
    })
  }

  const sourceNetwork = networkInfo(argv.source)
  const destNetwork = networkInfo(argv.dest)

  const apiClient = CCIPAPIClient.fromUrl(argv.apiUrl, { logger })

  const result = await apiClient.getLaneLatency(
    sourceNetwork.chainSelector,
    destNetwork.chainSelector,
  )

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(result, bigIntReplacer, 2))
      break
    case Format.log:
      logger.log('Lane Latency:', result)
      break
    default: {
      prettyTable.call(ctx, {
        Source: `${sourceNetwork.name} [${sourceNetwork.chainSelector}]`,
        Destination: `${destNetwork.name} [${destNetwork.chainSelector}]`,
        'Estimated Delivery': `~${formatDuration(result.totalMs / 1000)}`,
        'Latency (ms)': result.totalMs.toLocaleString(),
      })
    }
  }
}
