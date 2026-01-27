/**
 * Token balance query command.
 * Queries native or token balance for an address.
 */

import { type ChainStatic, networkInfo } from '@chainlink/ccip-sdk/src/index.ts'
import { formatUnits } from 'ethers'
import type { Argv } from 'yargs'

import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError, prettyTable } from './utils.ts'
import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = 'token'
export const describe = 'Query token balance for an address'

/**
 * Yargs builder for the token command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., ethereum-mainnet, solana-devnet)',
    })
    .option('holder', {
      alias: 'H',
      type: 'string',
      demandOption: true,
      describe: 'Wallet address to query balance for',
    })
    .option('token', {
      alias: 't',
      type: 'string',
      demandOption: false,
      describe: 'Token address (omit for native token balance)',
    })
    .example([
      ['ccip-cli token -n ethereum-mainnet -H 0x1234...abcd', 'Query native ETH balance'],
      [
        'ccip-cli token -n ethereum-mainnet -H 0x1234... -t 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'Query USDC token balance',
      ],
      [
        'ccip-cli token -n solana-devnet -H EPUjBP3Xf76K1VKsDSc6GupBWE8uykNksCLJgXZn87CB',
        'Query native SOL balance',
      ],
    ])

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
  let tokenInfo
  if (argv.token) {
    argv.token = (chain.constructor as ChainStatic).getAddress(argv.token)
    tokenInfo = await chain.getTokenInfo(argv.token)
  }

  const tokenLabel = tokenInfo?.symbol ?? 'native'
  const formatted = formatUnits(
    balance,
    tokenInfo ? tokenInfo.decimals : (chain.constructor as ChainStatic).decimals,
  )

  switch (argv.format) {
    case Format.json:
      logger.log(
        JSON.stringify(
          {
            network: networkName,
            holder: argv.holder,
            token: tokenLabel,
            balance: balance.toString(),
            formatted,
            ...tokenInfo,
          },
          null,
          2,
        ),
      )
      return
    case Format.log:
      logger.log(
        `Balance of`,
        tokenInfo ? argv.token : tokenLabel,
        ':',
        balance,
        `=`,
        tokenInfo ? `${formatted} ${tokenLabel}` : formatted,
      )
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, {
        network: networkName,
        holder: argv.holder,
        token: argv.token ?? tokenLabel,
        balance,
        formatted,
        ...tokenInfo,
      })
      return
  }
}
