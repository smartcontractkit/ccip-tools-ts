/**
 * Pool set-rate-limit-admin subcommand.
 * Sets the rate limit admin on a CCIP token pool.
 */

import {
  type AptosChain,
  type Chain,
  type EVMChain,
  type SetRateLimitAdminParams,
  type SolanaChain,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { AptosTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/aptos/index.ts'
import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import { SolanaTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/solana/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'set-rate-limit-admin'
export const describe = 'Set the rate limit admin on a CCIP token pool'

/**
 * Yargs builder for the pool set-rate-limit-admin subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be pool owner)',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Local pool address',
    })
    .option('rate-limit-admin', {
      type: 'string',
      demandOption: true,
      describe: 'Address of the new rate limit admin',
    })
    .example([
      [
        'ccip-cli pool set-rate-limit-admin -n sepolia --pool-address 0x... --rate-limit-admin 0x...',
        'Set the rate limit admin on a pool',
      ],
    ])

/**
 * Handler for the pool set-rate-limit-admin subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doSetRateLimitAdmin(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type SetRateLimitAdminArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls setRateLimitAdmin on the appropriate chain-family admin. */
function setForChain(chain: Chain, wallet: unknown, params: SetRateLimitAdminParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.setRateLimitAdmin(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.setRateLimitAdmin(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.setRateLimitAdmin(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doSetRateLimitAdmin(ctx: Ctx, argv: SetRateLimitAdminArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: SetRateLimitAdminParams = {
    poolAddress: argv.poolAddress,
    rateLimitAdmin: argv.rateLimitAdmin,
  }

  logger.debug(
    `Setting rate limit admin: pool=${params.poolAddress}, admin=${params.rateLimitAdmin}`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await setForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: params.poolAddress,
    rateLimitAdmin: params.rateLimitAdmin,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Rate limit admin updated, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
