/**
 * Accept admin subcommand.
 * Accepts an administrator role for a token in the TokenAdminRegistry.
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

export const command = 'accept-admin'
export const describe = 'Accept an administrator role for a token in the TokenAdminRegistry'

/**
 * Yargs builder for the accept-admin subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be pending administrator)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address to accept admin role for',
    })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe:
        'CCIP Router address (EVM/Aptos: discovers registry; Solana: router is the registry)',
    })
    .example([
      [
        'ccip-cli token-admin accept-admin -n ethereum-testnet-sepolia --token-address 0xa42B... --router-address 0x0BF3...',
        'Accept admin on Sepolia',
      ],
      [
        'ccip-cli token-admin accept-admin -n solana-devnet --wallet ~/.config/solana/id.json --token-address J6fE... --router-address Ccip...',
        'Accept admin on Solana devnet',
      ],
      [
        'ccip-cli token-admin accept-admin -n aptos-testnet --token-address 0x89fd... --router-address 0xc748...',
        'Accept admin on Aptos testnet',
      ],
    ])

/**
 * Handler for the accept-admin subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doAcceptAdmin(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type AcceptArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Accepts admin using the appropriate chain-family admin with typed params. */
function acceptAdminForChain(chain: Chain, wallet: unknown, argv: AcceptArgv) {
  const params = {
    tokenAddress: argv.tokenAddress,
    routerAddress: argv.routerAddress,
  }

  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.acceptAdminRole(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.acceptAdminRole(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.acceptAdminRole(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doAcceptAdmin(ctx: Ctx, argv: AcceptArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await acceptAdminForChain(chain, wallet, argv)

  const output: Record<string, string> = {
    network: networkName,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Admin accepted, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
