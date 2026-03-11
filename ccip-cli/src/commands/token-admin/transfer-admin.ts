/**
 * Transfer admin subcommand.
 * Transfers the administrator role for a token in the TokenAdminRegistry to a new address.
 */

import {
  type AptosChain,
  type Chain,
  type EVMChain,
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

export const command = 'transfer-admin'
export const describe =
  'Transfer the administrator role for a token in the TokenAdminRegistry to a new address'

/**
 * Yargs builder for the transfer-admin subcommand.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
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
      describe: 'Wallet: ledger[:index] or private key (must be current administrator)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address to transfer admin role for',
    })
    .option('new-admin', {
      type: 'string',
      demandOption: true,
      describe: 'Address of the new administrator',
    })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe:
        'CCIP Router address (EVM/Aptos: discovers registry; Solana: router is the registry)',
    })
    .example([
      [
        'ccip-cli token-admin transfer-admin -n ethereum-testnet-sepolia --token-address 0xa42B... --new-admin 0x1234... --router-address 0x0BF3...',
        'Transfer admin on Sepolia',
      ],
      [
        'ccip-cli token-admin transfer-admin -n solana-devnet --wallet ~/.config/solana/id.json --token-address J6fE... --new-admin 5y76... --router-address Ccip...',
        'Transfer admin on Solana devnet',
      ],
      [
        'ccip-cli token-admin transfer-admin -n aptos-testnet --token-address 0x89fd... --new-admin 0xabe0... --router-address 0xc748...',
        'Transfer admin on Aptos testnet',
      ],
    ])

/**
 * Handler for the transfer-admin subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doTransferAdmin(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type TransferArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Transfers admin using the appropriate chain-family admin with typed params. */
function transferAdminForChain(chain: Chain, wallet: unknown, argv: TransferArgv) {
  const params = {
    tokenAddress: argv.tokenAddress,
    newAdmin: argv.newAdmin,
    routerAddress: argv.routerAddress,
  }

  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.transferAdminRole(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.transferAdminRole(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.transferAdminRole(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doTransferAdmin(ctx: Ctx, argv: TransferArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await transferAdminForChain(chain, wallet, argv)

  const output: Record<string, string> = {
    network: networkName,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Admin transferred, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
