/**
 * CCIP Token Discovery Service
 *
 * Discovers and validates tokens that can be transferred between chains using Chainlink's CCIP.
 * The service handles pagination, parallel processing, and comprehensive error collection.
 *
 * Architecture:
 * 1. Chain & Contract Setup: Validates cross-chain paths and initializes core contracts
 * 2. Token Discovery: Fetches all registered tokens with pagination
 * 3. Support Validation: Checks token support for destination chain
 * 4. Detail Collection: Gathers token and pool information in parallel
 *
 * Performance Considerations:
 * - Uses batching to prevent RPC timeouts (configurable batch sizes)
 * - Implements parallel processing with rate limiting
 * - Memory-efficient token processing through pagination
 *
 * Error Handling:
 * - Individual token failures don't halt the process
 * - Errors are collected and reported comprehensively
 * - Detailed error reporting for debugging
 */

import {
  type Chain,
  type RateLimiterState,
  CCIPTokenNotConfiguredError,
  bigIntReplacer,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { search } from '@inquirer/prompts'
import { formatUnits } from 'ethers'
import type { Argv } from 'yargs'

import { type Ctx, Format } from './types.ts'
import { formatDuration, getCtx, logParsedError, prettyTable } from './utils.ts'
import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = ['getSupportedTokens <source> <address> [token]']
export const describe =
  'List supported tokens in a given Router/OnRamp/TokenAdminRegistry, and/or show info about token/pool'

/**
 * Yargs builder for the supported-tokens command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('source', {
      type: 'string',
      demandOption: true,
      describe: 'source network, chainId or name',
      example: 'ethereum-testnet-sepolia',
    })
    .positional('address', {
      type: 'string',
      demandOption: true,
      describe: 'router/onramp/tokenAdminRegistry/tokenPool contract address on source',
    })
    .positional('token', {
      type: 'string',
      demandOption: false,
      describe:
        'If address is router/onramp/tokenAdminRegistry, token may be used to pre-select a token from the supported list',
    })

/**
 * Handler for the supported-tokens command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return getSupportedTokens(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function getSupportedTokens(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx
  const sourceNetwork = networkInfo(argv.source)
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const source = await getChain(sourceNetwork.name)
  let registry
  try {
    registry = await source.getTokenAdminRegistryFor(argv.address)
  } catch (_) {
    // ignore
  }

  let info, tokenPool, poolConfigs, registryConfig
  if (registry && !argv.token) {
    const feeTokens = await source.getFeeTokens(argv.address)
    switch (argv.format) {
      case Format.pretty:
        logger.info('Fee Tokens:')
        logger.table(feeTokens)
        break
      case Format.json:
        logger.log(JSON.stringify(feeTokens, null, 2))
        break
      default:
        logger.log('feeTokens:', feeTokens)
    }

    // router + interactive list
    info = await listTokens(ctx, source, registry, argv)
    if (!info) return // format != pretty
    registryConfig = await source.getRegistryTokenConfig(registry, info.token)
    tokenPool = registryConfig.tokenPool
    if (!tokenPool) throw new CCIPTokenNotConfiguredError(info.token, registry)
    poolConfigs = await source.getTokenPoolConfigs(tokenPool)
  } else {
    if (!argv.token) {
      // tokenPool
      tokenPool = argv.address
      poolConfigs = await source.getTokenPoolConfigs(tokenPool)
      registry ??= await source.getTokenAdminRegistryFor(poolConfigs.router)
      ;[info, registryConfig] = await Promise.all([
        source.getTokenInfo(poolConfigs.token),
        source.getRegistryTokenConfig(registry, poolConfigs.token),
      ])
    } else {
      registry ??= await source.getTokenAdminRegistryFor(argv.address)
      // router|ramp|registry + token
      info = await source.getTokenInfo(argv.token)

      registryConfig = await source.getRegistryTokenConfig(registry, argv.token)
      tokenPool = registryConfig.tokenPool
      if (!tokenPool) throw new CCIPTokenNotConfiguredError(argv.token, registry)
      poolConfigs = await source.getTokenPoolConfigs(tokenPool)
    }

    if (argv.format === Format.json) {
      logger.log(JSON.stringify({ ...info, tokenPool, ...poolConfigs }, bigIntReplacer, 2))
      return
    } else if (argv.format === Format.log) {
      logger.log('Token:', poolConfigs.token, info)
      logger.log('Token Pool:', tokenPool)
      logger.log('Pool Configs:', poolConfigs)
      return
    }
  }
  const remotes = await source.getTokenPoolRemotes(tokenPool)

  prettyTable.call(ctx, {
    network: `${source.network.name} [${source.network.chainSelector}]`,
    token: poolConfigs.token,
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    tokenPool,
    typeAndVersion: poolConfigs.typeAndVersion,
    router: poolConfigs.router,
    tokenAdminRegistry: registry,
    administrator: registryConfig.administrator,
    ...(registryConfig.pendingAdministrator && {
      pendingAdministrator: registryConfig.pendingAdministrator,
    }),
  })
  const remotesLen = Object.keys(remotes).length
  if (remotesLen > 0) logger.info('Remotes [', remotesLen, ']:')
  for (const [network, remote] of Object.entries(remotes))
    prettyTable.call(ctx, {
      remoteNetwork: `${network} [${networkInfo(network).chainSelector}]`,
      remoteToken: remote.remoteToken,
      remotePool: remote.remotePools,
      inbound: prettyRateLimiter(remote.inboundRateLimiterState, info),
      outbound: prettyRateLimiter(remote.outboundRateLimiterState, info),
    })
}

async function listTokens({ logger }: Ctx, source: Chain, registry: string, argv: GlobalOpts) {
  const tokens = await source.getSupportedTokens(registry)
  const infos: { token: string; symbol: string; decimals: number; name?: string }[] = []
  const batch = 500
  for (let i = 0; i < tokens.length; i += batch) {
    const infos_ = (
      await Promise.all(
        tokens.slice(i, i + batch).map((token) =>
          source.getTokenInfo(token).then(
            (info) => {
              const res = { token, ...info }
              if (argv.format === Format.log) {
                // Format.log prints out-of-order, as it fetches data, concurrently
                logger.info(token, '=', info)
              }
              return res
            },
            (err) => {
              logger.debug(`getTokenInfo errored`, token, err)
            },
          ),
        ),
      )
    ).filter((e) => e !== undefined)
    if (argv.format === Format.json) {
      // Format.json keeps order, prints newline-separated objects
      for (const info of infos_) {
        logger.log(JSON.stringify(info))
      }
    }
    infos.push(...infos_)
  }
  if (argv.format !== Format.pretty) return // Format.pretty interactive search and details

  return search({
    message: 'Select a token to know more:',
    pageSize: 20,
    source: (term) => {
      const filtered = infos.filter(
        (info) =>
          !term ||
          `${info.token} ${info.symbol} ${info.name ?? ''} ${info.decimals}`
            .toLowerCase()
            .includes(term.toLowerCase()),
      )
      const symbolPad = Math.min(Math.max(...filtered.map(({ symbol }) => symbol.length)), 10)
      const decimalsPad = Math.max(...filtered.map(({ decimals }) => decimals.toString().length))
      return filtered.map((info, i) => ({
        name: `${info.token}\t[${info.decimals.toString().padStart(decimalsPad)}] ${info.symbol.padEnd(symbolPad)}\t${info.name ?? ''}`,
        value: info,
        short: `${info.token} [${info.symbol}]`,
        description: `${i + 1} / ${filtered.length} / ${tokens.length}`,
      }))
    },
  })
}

function prettyRateLimiter(
  state: RateLimiterState,
  { decimals, symbol }: { decimals: number; symbol: string },
) {
  if (!state) return null
  return {
    capacity: formatUnits(state.capacity, decimals) + ' ' + symbol,
    tokens: `${formatUnits(state.tokens, decimals)} (${Math.round((Number(state.tokens) / Number(state.capacity)) * 100)}%)`,
    rate: `${formatUnits(state.rate, decimals)}/s (0-to-full in ${formatDuration(Number(state.capacity / state.rate))})`,
    ...(state.tokens < state.capacity && {
      timeToFull: formatDuration(Number(state.capacity - state.tokens) / Number(state.rate)),
    }),
  }
}
