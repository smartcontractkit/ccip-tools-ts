/**
 * Pool deploy subcommand.
 * Deploys a new CCIP token pool (BurnMintTokenPool / LockReleaseTokenPool / Aptos pool).
 */

import {
  type AptosChain,
  type Chain,
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

export const command = 'deploy'
export const describe = 'Deploy a new CCIP token pool'

/**
 * Yargs builder for the pool deploy subcommand.
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
      describe: 'Wallet: ledger[:index] or private key',
    })
    .option('pool-type', {
      type: 'string',
      choices: ['burn-mint', 'lock-release'] as const,
      demandOption: true,
      describe:
        'Pool type: burn-mint (burns on source, mints on dest) or lock-release (locks on source, releases on dest)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address (ERC20, SPL mint, or Aptos FA metadata)',
    })
    .option('local-token-decimals', {
      type: 'number',
      demandOption: true,
      describe: 'Token decimals on this chain',
    })
    // EVM-specific
    .option('router-address', {
      type: 'string',
      describe: 'CCIP Router address (required for EVM and Aptos)',
    })
    .option('allowlist', {
      type: 'array',
      string: true,
      describe: 'Allowlisted sender addresses (EVM only)',
    })
    // Solana-specific
    .option('pool-program-id', {
      type: 'string',
      describe: 'Pre-deployed pool program ID (required for Solana)',
    })
    // Aptos-specific
    .option('token-module', {
      type: 'string',
      choices: ['managed', 'generic', 'regulated'] as const,
      describe: "Aptos token module variant (default: 'managed')",
    })
    .option('mcms-address', {
      type: 'string',
      describe: 'Deployed mcms package address (required for Aptos)',
    })
    .option('admin-address', {
      type: 'string',
      describe: 'Admin address for regulated token access control (Aptos regulated only)',
    })
    .check((argv) => {
      const { family } = networkInfo(argv.network)
      if (family === ChainFamily.EVM) {
        if (!argv.routerAddress)
          throw new CCIPArgumentInvalidError(
            'router-address',
            '--router-address is required for EVM and Aptos networks',
          )
      } else if (family === ChainFamily.Aptos) {
        if (!argv.routerAddress)
          throw new CCIPArgumentInvalidError(
            'router-address',
            '--router-address is required for EVM and Aptos networks',
          )
        if (!argv.mcmsAddress)
          throw new CCIPArgumentInvalidError(
            'mcms-address',
            '--mcms-address is required for Aptos networks',
          )
      } else if (family === ChainFamily.Solana) {
        if (!argv.poolProgramId)
          throw new CCIPArgumentInvalidError(
            'pool-program-id',
            '--pool-program-id is required for Solana networks',
          )
      }
      return true
    })
    .example([
      [
        'ccip-cli pool deploy -n ethereum-testnet-sepolia --pool-type burn-mint --token-address 0xa42B... --local-token-decimals 18 --router-address 0x0BF3...',
        'Deploy BurnMintTokenPool on Sepolia',
      ],
      [
        'ccip-cli pool deploy -n solana-devnet --pool-type burn-mint --token-address J6fE... --local-token-decimals 9 --pool-program-id <program-id>',
        'Deploy pool on Solana devnet',
      ],
      [
        'ccip-cli pool deploy -n aptos-testnet --pool-type burn-mint --token-address 0x89fd... --local-token-decimals 8 --router-address 0xabc... --mcms-address 0x123...',
        'Deploy managed_token_pool on Aptos testnet',
      ],
    ])

/**
 * Handler for the pool deploy subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doDeployPool(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type DeployArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Deploys a pool using the appropriate chain-family admin with typed params. */
function deployPoolForChain(chain: Chain, wallet: unknown, argv: DeployArgv) {
  const poolType = argv.poolType

  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.deployPool(wallet, {
        poolType,
        tokenAddress: argv.tokenAddress,
        localTokenDecimals: argv.localTokenDecimals,
        routerAddress: argv.routerAddress!,
        allowlist: argv.allowlist,
      })
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.deployPool(wallet, {
        poolType,
        tokenAddress: argv.tokenAddress,
        localTokenDecimals: argv.localTokenDecimals,
        poolProgramId: argv.poolProgramId!,
      })
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.deployPool(wallet, {
        poolType,
        tokenAddress: argv.tokenAddress,
        localTokenDecimals: argv.localTokenDecimals,
        routerAddress: argv.routerAddress!,
        mcmsAddress: argv.mcmsAddress!,
        ...(argv.tokenModule && { tokenModule: argv.tokenModule }),
        ...(argv.adminAddress && { adminAddress: argv.adminAddress }),
      })
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doDeployPool(ctx: Ctx, argv: DeployArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await deployPoolForChain(chain, wallet, argv)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: result.poolAddress,
    txHash: result.txHash,
  }

  if (result.initialized === false) {
    const poolModule =
      argv.poolType === 'burn-mint' ? 'burn_mint_token_pool' : 'lock_release_token_pool'
    const warning =
      `WARNING: Generic pool deployed but NOT initialized. ` +
      `The token creator module must call ${poolModule}::initialize() ` +
      `with stored capability refs (BurnRef/MintRef/TransferRef) ` +
      `before this pool can be used for CCIP operations.`
    output.initialized = 'false'
    output.warning = warning
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Pool deployed:', result.poolAddress, 'tx:', result.txHash)
      if (result.initialized === false) {
        logger.warn(output.warning)
      }
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
