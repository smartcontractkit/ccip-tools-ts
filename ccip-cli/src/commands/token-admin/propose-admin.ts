/**
 * Propose admin subcommand.
 * Proposes an administrator for a token in the TokenAdminRegistry.
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
import {
  type EVMRegistrationMethod,
  EVMTokenAdmin,
} from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import { SolanaTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/solana/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'propose-admin'
export const describe = 'Propose an administrator for a token in the TokenAdminRegistry'

/**
 * Yargs builder for the propose-admin subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be token owner)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address to propose admin for',
    })
    // Solana & Aptos only — on EVM the admin is always the caller
    .option('administrator', {
      type: 'string',
      describe: 'Address of the proposed administrator (Solana, Aptos only)',
    })
    // EVM-specific
    .option('registry-module-address', {
      type: 'string',
      describe: 'RegistryModuleOwnerCustom address (EVM only, from CCIP API registryModule field)',
    })
    .option('registration-method', {
      type: 'string',
      choices: ['owner', 'get-ccip-admin', 'access-control-default-admin'] as const,
      default: 'owner',
      describe: 'EVM registration method (EVM only)',
    })
    // Solana & Aptos
    .option('router-address', {
      type: 'string',
      describe: 'CCIP Router address (Solana, Aptos)',
    })
    .example([
      [
        'ccip-cli token-admin propose-admin -n ethereum-testnet-sepolia --token-address 0xa42B... --registry-module-address 0xa3c7...',
        'Propose admin on Sepolia (owner method, default)',
      ],
      [
        'ccip-cli token-admin propose-admin -n ethereum-testnet-sepolia --token-address 0xa42B... --registry-module-address 0xa3c7... --registration-method get-ccip-admin',
        'Propose admin via getCCIPAdmin method',
      ],
      [
        'ccip-cli token-admin propose-admin -n solana-devnet --wallet ~/.config/solana/id.json --token-address J6fE... --administrator 5YNm... --router-address Ccip...',
        'Propose admin on Solana devnet',
      ],
      [
        'ccip-cli token-admin propose-admin -n aptos-testnet --token-address 0x89fd... --administrator 0x0650... --router-address 0xc748...',
        'Propose admin on Aptos testnet',
      ],
    ])

/**
 * Handler for the propose-admin subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doProposeAdmin(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type ProposeArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Proposes an admin using the appropriate chain-family admin with typed params. */
function proposeAdminForChain(chain: Chain, wallet: unknown, argv: ProposeArgv) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      // Map CLI kebab-case to SDK type
      const cliToSdk: Record<string, EVMRegistrationMethod> = {
        owner: 'owner',
        'get-ccip-admin': 'getCCIPAdmin',
        'access-control-default-admin': 'accessControlDefaultAdmin',
      }
      return admin.proposeAdminRole(wallet, {
        tokenAddress: argv.tokenAddress,
        registryModuleAddress: argv.registryModuleAddress!,
        registrationMethod: cliToSdk[argv.registrationMethod],
      })
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.proposeAdminRole(wallet, {
        tokenAddress: argv.tokenAddress,
        administrator: argv.administrator!,
        routerAddress: argv.routerAddress!,
      })
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.proposeAdminRole(wallet, {
        tokenAddress: argv.tokenAddress,
        administrator: argv.administrator!,
        routerAddress: argv.routerAddress!,
      })
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doProposeAdmin(ctx: Ctx, argv: ProposeArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await proposeAdminForChain(chain, wallet, argv)

  const output: Record<string, string> = {
    network: networkName,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Admin proposed, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
