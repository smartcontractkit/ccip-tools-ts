/**
 * Token balance query command.
 * Queries native or token balance for an address.
 */

import { networkInfo } from '@chainlink/ccip-sdk/src/index.ts'
import { formatUnits } from 'ethers'
import type { Argv } from 'yargs'

import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError, prettyTable } from './utils.ts'
import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = ['token <network> <holder> [token]']
export const describe = 'Query token balance for an address'

/**
 * Yargs builder for the token command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('network', {
      type: 'string',
      demandOption: true,
      describe: 'Network name or chainId (e.g., ethereum-mainnet, solana-devnet)',
    })
    .positional('holder', {
      type: 'string',
      demandOption: true,
      describe: 'Wallet address to query balance for',
    })
    .positional('token', {
      type: 'string',
      demandOption: false,
      describe: 'Token address (omit for native token balance)',
    })

/**
 * Handler for the token command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return queryTokenBalance(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function queryTokenBalance(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const balance = await chain.getBalance({
    holder: argv.holder,
    token: argv.token,
  })

  // Get token info for formatting (only for tokens, not native)
  const tokenInfo = argv.token ? await chain.getTokenInfo(argv.token) : null
  const tokenLabel = tokenInfo?.symbol ?? 'native'
  const formatted = tokenInfo ? formatUnits(balance, tokenInfo.decimals) : null

  switch (argv.format) {
    case Format.json:
      logger.log(
        JSON.stringify(
          {
            network: networkName,
            holder: argv.holder,
            token: tokenLabel,
            balance: balance.toString(),
            ...(tokenInfo && {
              formatted,
              decimals: tokenInfo.decimals,
              name: tokenInfo.name,
            }),
          },
          null,
          2,
        ),
      )
      return
    case Format.log:
      logger.log(
        tokenInfo
          ? `Balance of ${tokenInfo.name} (${tokenLabel}): ${balance} = ${formatted} ${tokenLabel}`
          : `Balance of ${tokenLabel}: ${balance}`,
      )
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, {
        network: networkName,
        holder: argv.holder,
        token: tokenLabel,
        balance: balance.toString(),
        ...(tokenInfo && {
          formatted,
          decimals: tokenInfo.decimals,
          name: tokenInfo.name,
        }),
      })
      return
  }
}
