/**
 * Pool delete-chain-config subcommand.
 * Removes a remote chain configuration from a CCIP token pool.
 */

import {
  type AptosChain,
  type Chain,
  type DeleteChainConfigParams,
  type EVMChain,
  type SolanaChain,
  CCIPArgumentInvalidError,
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

export const command = 'delete-chain-config'
export const describe = 'Remove a remote chain configuration from a CCIP token pool'

/**
 * Yargs builder for the pool delete-chain-config subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key (must be pool owner)',
    })
    .option('pool-address', {
      type: 'string',
      describe: 'Local pool address',
    })
    .option('remote-chain', {
      type: 'string',
      describe: 'Remote chain: chainId, name, or selector',
    })
    .check((argv) => {
      if (!argv.network) throw new CCIPArgumentInvalidError('network', 'required argument missing')
      if (!argv.poolAddress)
        throw new CCIPArgumentInvalidError('pool-address', 'required argument missing')
      if (!argv.remoteChain)
        throw new CCIPArgumentInvalidError('remote-chain', 'required argument missing')
      return true
    })
    .example([
      [
        'ccip-cli pool delete-chain-config -n sepolia --pool-address 0x... --remote-chain avalanche-fuji',
        'Remove a remote chain config from a pool',
      ],
    ])

/**
 * Handler for the pool delete-chain-config subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doDeleteChainConfig(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type DeleteArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls deleteChainConfig on the appropriate chain-family admin. */
function deleteForChain(chain: Chain, wallet: unknown, params: DeleteChainConfigParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.deleteChainConfig(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.deleteChainConfig(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.deleteChainConfig(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doDeleteChainConfig(ctx: Ctx, argv: DeleteArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network!).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const remoteChainSelector = networkInfo(argv.remoteChain!).chainSelector.toString()

  const params: DeleteChainConfigParams = {
    poolAddress: argv.poolAddress!,
    remoteChainSelector,
  }

  logger.debug(`Deleting chain config for remote chain ${remoteChainSelector}`)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await deleteForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: argv.poolAddress!,
    remoteChainSelector,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Chain config deleted, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
