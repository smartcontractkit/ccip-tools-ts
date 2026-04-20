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
  type TokenInfo,
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

export const command = ['getSupportedTokens', 'get-supported-tokens']
export const describe =
  'List supported tokens in a given Router/OnRamp/TokenAdminRegistry, and/or show info about token/pool'

/**
 * Yargs builder for the supported-tokens command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Source network: chainId or name (e.g., ethereum-mainnet)',
    })
    .option('address', {
      alias: 'a',
      type: 'string',
      demandOption: true,
      describe: 'Router/OnRamp/TokenAdminRegistry/TokenPool contract address',
    })
    .option('token', {
      alias: 't',
      type: 'string',
      describe: 'Token address to query (pre-selects from list if address is a registry)',
    })
    .option('fee-tokens', {
      type: 'boolean',
      describe:
        'List fee tokens instead of transferable tokens; default=true for Routers; Use `--no-fee-tokens` to disable',
    })
    .option('only-fee-tokens', {
      type: 'boolean',
      describe: 'Return after listing fee tokens',
    })
    .check(({ onlyFeeTokens, feeTokens }) => {
      if (onlyFeeTokens && feeTokens === false)
        throw new Error(
          'Invalid options: --only-fee-tokens requires --fee-tokens to be true or omitted',
        )

      return true
    })
    .example([
      [
        'ccip-cli get-supported-tokens -n ethereum-mainnet -a 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
        'List all supported tokens from router',
      ],
      [
        'ccip-cli get-supported-tokens -n ethereum-mainnet -a 0x80226fc... -t 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'Get details for specific token',
      ],
    ])

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
  const { output } = ctx
  const sourceNetwork = networkInfo(argv.network)
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const source = await getChain(sourceNetwork.name)
  let registry
  try {
    registry = await source.getTokenAdminRegistryFor(argv.address)
  } catch (_) {
    // ignore
  }

  // In JSON mode, accumulate all output into a single envelope so JSON.parse(stdout) works.
  let jsonFeeTokens: unknown

  // Handle --fee-tokens flag
  if (argv.feeTokens === true || argv.onlyFeeTokens || (argv.feeTokens == null && registry)) {
    const feeTokens: Record<string, TokenInfo & { price?: number }> = await source.getFeeTokens(
      argv.address,
    )
    await Promise.all(
      Object.entries(feeTokens).map(async ([token]) =>
        source.getTokenPrice({ router: argv.address, token }).then(
          ({ price }) => (feeTokens[token]!.price = Number(price.toPrecision(4))),
          () => {},
        ),
      ),
    )
    switch (argv.format) {
      case Format.pretty:
        output.write('Fee Tokens:')
        output.table(feeTokens)
        break
      case Format.json:
        jsonFeeTokens = feeTokens // deferred — combined with subsequent output
        break
      default:
        output.write('feeTokens:', feeTokens)
    }
    if (argv.onlyFeeTokens) {
      if (jsonFeeTokens !== undefined)
        output.write(JSON.stringify({ feeTokens: jsonFeeTokens }, bigIntReplacer, 2))
      return
    }
  }

  let info, tokenPool, poolConfig, registryConfig
  if (registry && !argv.token) {
    // router + interactive list
    info = await listTokens(ctx, source, registry, argv, jsonFeeTokens)
    if (!info) return // format != pretty
    registryConfig = await source.getRegistryTokenConfig(registry, info.token)
    tokenPool = registryConfig.tokenPool
    if (!tokenPool) throw new CCIPTokenNotConfiguredError(info.token, registry)
    poolConfig = await source.getTokenPoolConfig(tokenPool)
  } else {
    if (!argv.token) {
      // tokenPool
      tokenPool = argv.address
      poolConfig = await source.getTokenPoolConfig(tokenPool)
      registry ??= await source.getTokenAdminRegistryFor(poolConfig.router)
      ;[info, registryConfig] = await Promise.all([
        source.getTokenInfo(poolConfig.token),
        source.getRegistryTokenConfig(registry, poolConfig.token),
      ])
    } else {
      registry ??= await source.getTokenAdminRegistryFor(argv.address)
      // router|ramp|registry + token
      info = await source.getTokenInfo(argv.token)

      registryConfig = await source.getRegistryTokenConfig(registry, argv.token)
      tokenPool = registryConfig.tokenPool
      if (!tokenPool) throw new CCIPTokenNotConfiguredError(argv.token, registry)
      poolConfig = await source.getTokenPoolConfig(tokenPool)
    }

    if (argv.format === Format.json) {
      output.write(
        JSON.stringify(
          {
            ...(jsonFeeTokens !== undefined && { feeTokens: jsonFeeTokens }),
            ...info,
            tokenPool,
            ...poolConfig,
          },
          bigIntReplacer,
          2,
        ),
      )
      return
    } else if (argv.format === Format.log) {
      output.write('Token:', poolConfig.token, info)
      output.write('Token Pool:', tokenPool)
      output.write('Pool Configs:', poolConfig)
      return
    }
  }
  const remotes = await source.getTokenPoolRemotes(tokenPool)

  prettyTable.call(ctx, {
    network: `${source.network.name} [${source.network.chainSelector}]`,
    token: poolConfig.token,
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    tokenPool,
    typeAndVersion: poolConfig.typeAndVersion,
    router: poolConfig.router,
    tokenAdminRegistry: registry,
    administrator: registryConfig.administrator,
    ...(registryConfig.pendingAdministrator && {
      pendingAdministrator: registryConfig.pendingAdministrator,
    }),
    ...(poolConfig.finalityDepth != null && {
      finalityDepth: poolConfig.finalityDepth === 0 ? '0 (finalized)' : poolConfig.finalityDepth,
      finalitySafe: poolConfig.finalitySafe ? 'true (FCR)' : false,
    }),
  })
  const remotesLen = Object.keys(remotes).length
  if (remotesLen > 0) output.write('Remotes [', remotesLen, ']:')
  for (const [network, remote] of Object.entries(remotes))
    prettyTable.call(ctx, {
      remoteNetwork: `${network} [${networkInfo(network).chainSelector}]`,
      remoteToken: remote.remoteToken,
      remotePool: remote.remotePools,
      outbound: prettyRateLimiter(remote.outboundRateLimiterState, info),
      inbound: prettyRateLimiter(remote.inboundRateLimiterState, info),
      ...('fastOutboundRateLimiterState' in remote && {
        ['[fast]outbound']: prettyRateLimiter(remote.fastOutboundRateLimiterState, info),
        ['[fast]inbound']: prettyRateLimiter(remote.fastInboundRateLimiterState, info),
      }),
    })
}

async function listTokens(
  { output, logger }: Ctx,
  source: Chain,
  registry: string,
  argv: GlobalOpts,
  jsonFeeTokens?: unknown,
) {
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
                output.write(token, '=', info)
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
    infos.push(...infos_)
  }
  if (argv.format === Format.json) {
    // Emit a single JSON object with all tokens (and fee tokens if available)
    output.write(
      JSON.stringify(
        { ...(jsonFeeTokens !== undefined && { feeTokens: jsonFeeTokens }), tokens: infos },
        bigIntReplacer,
        2,
      ),
    )
    return
  }
  if (argv.format !== Format.pretty) return // Format.pretty interactive search and details

  return search({
    message: 'Select a supported token to know more:',
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
