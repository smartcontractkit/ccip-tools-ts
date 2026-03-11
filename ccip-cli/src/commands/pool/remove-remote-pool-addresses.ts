/**
 * Pool remove-remote-pool-addresses subcommand.
 * Removes specific remote pool addresses from a CCIP token pool for a given remote chain.
 */

import {
  type AptosChain,
  type Chain,
  type EVMChain,
  type RemoveRemotePoolAddressesParams,
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

export const command = 'remove-remote-pool-addresses'
export const describe =
  'Remove specific remote pool addresses from a CCIP token pool for a given remote chain'

/**
 * Yargs builder for the pool remove-remote-pool-addresses subcommand.
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
    .option('remote-pool-addresses', {
      type: 'string',
      describe: 'Comma-separated list of remote pool addresses to remove',
    })
    .check((argv) => {
      if (!argv.network) throw new CCIPArgumentInvalidError('network', 'required argument missing')
      if (!argv.poolAddress)
        throw new CCIPArgumentInvalidError('pool-address', 'required argument missing')
      if (!argv.remoteChain)
        throw new CCIPArgumentInvalidError('remote-chain', 'required argument missing')
      if (!argv.remotePoolAddresses)
        throw new CCIPArgumentInvalidError('remote-pool-addresses', 'required argument missing')
      return true
    })
    .example([
      [
        'ccip-cli pool remove-remote-pool-addresses -n sepolia --pool-address 0x... --remote-chain avalanche-fuji --remote-pool-addresses 0xaaa,0xbbb',
        'Remove remote pool addresses for a remote chain',
      ],
    ])

/**
 * Handler for the pool remove-remote-pool-addresses subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doRemoveRemotePoolAddresses(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type RemoveArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls removeRemotePoolAddresses on the appropriate chain-family admin. */
function removeForChain(chain: Chain, wallet: unknown, params: RemoveRemotePoolAddressesParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.removeRemotePoolAddresses(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.removeRemotePoolAddresses(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.removeRemotePoolAddresses(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doRemoveRemotePoolAddresses(ctx: Ctx, argv: RemoveArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network!).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const remoteChainSelector = networkInfo(argv.remoteChain!).chainSelector.toString()
  const remotePoolAddresses = argv.remotePoolAddresses!.split(',').map((a) => a.trim())

  const params: RemoveRemotePoolAddressesParams = {
    poolAddress: argv.poolAddress!,
    remoteChainSelector,
    remotePoolAddresses,
  }

  logger.debug(
    `Removing ${remotePoolAddresses.length} remote pool address(es) for remote chain ${remoteChainSelector}`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await removeForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: argv.poolAddress!,
    remoteChainSelector,
    addressesRemoved: remotePoolAddresses.join(', '),
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Remote pool addresses removed, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
