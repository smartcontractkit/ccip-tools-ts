/**
 * Pool provide-liquidity subcommand.
 * Funds a lock-release CCIP token pool with liquidity (EVM only).
 */

import {
  type Chain,
  type EVMChain,
  type ProvideLiquidityParams,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import { Contract, parseUnits } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'provide-liquidity'
export const describe = 'Provide liquidity to a lock-release CCIP token pool (EVM only)'

/**
 * Yargs builder for the pool provide-liquidity subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Lock-release pool address',
    })
    .option('amount', {
      type: 'string',
      demandOption: true,
      describe: 'Amount of liquidity to provide, in whole token units (e.g., 1000)',
    })
    .example([
      [
        'ccip-cli pool provide-liquidity -n sepolia --pool-address 0x... --amount 1000',
        'Provide 1000 whole tokens of liquidity to a lock-release pool',
      ],
    ])

/**
 * Handler for the pool provide-liquidity subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doProvideLiquidity(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type ProvideLiquidityArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Minimal pool/token ABI for resolving the pool's token and its decimals. */
const POOL_TOKEN_ABI = [
  'function getToken() view returns (address)',
  'function decimals() view returns (uint8)',
] as const

async function doProvideLiquidity(ctx: Ctx, argv: ProvideLiquidityArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain: Chain = await getChain(networkName)

  // provide-liquidity is EVM-only (lock-release liquidity is an EVM pool concept here).
  if (chain.network.family !== ChainFamily.EVM) {
    throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
  const evmChain = chain as EVMChain

  // Resolve the pool's token decimals so a whole-unit `--amount` can be scaled.
  const pool = new Contract(argv.poolAddress, POOL_TOKEN_ABI, evmChain.provider)
  const tokenAddress = (await pool.getFunction('getToken')()) as string
  const token = new Contract(tokenAddress, POOL_TOKEN_ABI, evmChain.provider)
  const decimals = Number((await token.getFunction('decimals')()) as bigint)
  const amount = parseUnits(argv.amount, decimals)

  const params: ProvideLiquidityParams = {
    poolAddress: argv.poolAddress,
    amount,
  }

  logger.debug(
    `Providing liquidity: pool=${params.poolAddress}, token=${tokenAddress}, amount=${amount} (${argv.amount} @ ${decimals} decimals)`,
  )

  const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, { logger: evmChain.logger })

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await admin.provideLiquidity(wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: params.poolAddress,
    token: tokenAddress,
    amount: amount.toString(),
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Liquidity provided, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
