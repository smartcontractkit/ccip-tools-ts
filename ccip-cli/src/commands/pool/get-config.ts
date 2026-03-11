/**
 * Pool get-config subcommand.
 * Reads pool configuration and remote chain settings from on-chain state.
 */

import {
  type RateLimiterState,
  CCIPArgumentInvalidError,
  bigIntReplacer,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { formatUnits } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { formatDuration, getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'get-config'
export const describe = 'Show pool configuration and remote chain settings'

/**
 * Yargs builder for the pool get-config subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      describe: 'Network: chainId, selector, or name (e.g., ethereum-testnet-sepolia)',
    })
    .option('pool-address', {
      type: 'string',
      describe: 'Pool address',
    })
    .option('remote-chain', {
      type: 'string',
      describe: 'Filter remotes by chain name, selector, or chainId (shows only this remote)',
    })
    .check((argv) => {
      if (!argv.network) throw new CCIPArgumentInvalidError('network', 'required argument missing')
      if (!argv.poolAddress)
        throw new CCIPArgumentInvalidError('pool-address', 'required argument missing')
      return true
    })
    .example([
      [
        'ccip-cli pool get-config -n sepolia --pool-address 0x...',
        'Show pool config and all remotes',
      ],
      [
        'ccip-cli pool get-config -n sepolia --pool-address 0x... --remote-chain solana-devnet',
        'Show config for a specific remote chain only',
      ],
      [
        'ccip-cli pool get-config -n solana-devnet --pool-address <base58> -f json',
        'Show pool config as JSON',
      ],
    ])

/**
 * Handler for the pool get-config subcommand.
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

function prettyRateLimiter(state: RateLimiterState, info: { decimals: number; symbol: string }) {
  if (!state) return null
  return {
    capacity: formatUnits(state.capacity, info.decimals) + ' ' + info.symbol,
    tokens: `${formatUnits(state.tokens, info.decimals)} (${Math.round((Number(state.tokens) / Number(state.capacity)) * 100)}%)`,
    rate: `${formatUnits(state.rate, info.decimals)}/s (0-to-full in ${formatDuration(Number(state.capacity / state.rate))})`,
    ...(state.tokens < state.capacity && {
      timeToFull: formatDuration(Number(state.capacity - state.tokens) / Number(state.rate)),
    }),
  }
}

async function doGetConfig(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network!).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const poolAddress = argv.poolAddress!

  // Resolve optional --remote-chain filter to a chain selector
  const remoteFilter = argv.remoteChain ? networkInfo(argv.remoteChain).chainSelector : undefined

  const [poolConfig, remotes, tokenInfo] = await Promise.all([
    chain.getTokenPoolConfig(poolAddress),
    chain.getTokenPoolRemotes(poolAddress, remoteFilter),
    chain.getTokenPoolConfig(poolAddress).then((c) => chain.getTokenInfo(c.token)),
  ])

  const remotesEntries = Object.entries(remotes)

  switch (argv.format) {
    case Format.json: {
      const output = {
        network: networkName,
        poolAddress,
        token: poolConfig.token,
        ...tokenInfo,
        owner: poolConfig.owner,
        ...('proposedOwner' in poolConfig && { proposedOwner: poolConfig.proposedOwner }),
        ...(poolConfig.rateLimitAdmin && { rateLimitAdmin: poolConfig.rateLimitAdmin }),
        ...(poolConfig.feeAdmin && { feeAdmin: poolConfig.feeAdmin }),
        router: poolConfig.router,
        typeAndVersion: poolConfig.typeAndVersion,
        remotes: Object.fromEntries(remotesEntries.map(([name, remote]) => [name, remote])),
      }
      logger.log(JSON.stringify(output, bigIntReplacer, 2))
      return
    }
    case Format.log:
      logger.log('Pool:', poolAddress)
      logger.log('Token:', poolConfig.token, tokenInfo)
      logger.log('Owner:', poolConfig.owner)
      if (poolConfig.proposedOwner) logger.log('Proposed Owner:', poolConfig.proposedOwner)
      if (poolConfig.rateLimitAdmin) logger.log('Rate Limit Admin:', poolConfig.rateLimitAdmin)
      if (poolConfig.feeAdmin) logger.log('Fee Admin:', poolConfig.feeAdmin)
      logger.log('Router:', poolConfig.router)
      logger.log('Type:', poolConfig.typeAndVersion)
      logger.log('Remotes:', remotesEntries.length)
      for (const [name, remote] of remotesEntries) {
        logger.log(`  ${name}:`, remote)
      }
      return
    case Format.pretty:
    default: {
      prettyTable.call(ctx, {
        network: `${networkName} [${networkInfo(networkName).chainSelector}]`,
        poolAddress,
        token: poolConfig.token,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        decimals: tokenInfo.decimals,
        owner: poolConfig.owner,
        ...(poolConfig.proposedOwner && { proposedOwner: poolConfig.proposedOwner }),
        ...(poolConfig.rateLimitAdmin && { rateLimitAdmin: poolConfig.rateLimitAdmin }),
        ...(poolConfig.feeAdmin && { feeAdmin: poolConfig.feeAdmin }),
        typeAndVersion: poolConfig.typeAndVersion,
        router: poolConfig.router,
      })

      if (remotesEntries.length > 0) logger.info('Remotes [', remotesEntries.length, ']:')
      for (const [name, remote] of remotesEntries) {
        prettyTable.call(ctx, {
          remoteNetwork: `${name} [${networkInfo(name).chainSelector}]`,
          remoteToken: remote.remoteToken,
          remotePool: remote.remotePools,
          outbound: prettyRateLimiter(remote.outboundRateLimiterState, tokenInfo),
          inbound: prettyRateLimiter(remote.inboundRateLimiterState, tokenInfo),
          // FTF = Faster-Than-Finality: separate rate limiters for messages confirmed
          // with fewer block confirmations (EVM v2.0+ pools only)
          ...('customBlockConfirmationsOutboundRateLimiterState' in remote && {
            ['[ftf: Faster-Than-Finality]outbound']: prettyRateLimiter(
              remote.customBlockConfirmationsOutboundRateLimiterState,
              tokenInfo,
            ),
            ['[ftf: Faster-Than-Finality]inbound']: prettyRateLimiter(
              remote.customBlockConfirmationsInboundRateLimiterState,
              tokenInfo,
            ),
          }),
        })
      }
      return
    }
  }
}
