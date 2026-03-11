/**
 * Token grant-mint-burn-access subcommand.
 * Grants mint and burn permissions on a token to a pool or address.
 */

import {
  type AptosChain,
  type Chain,
  type EVMChain,
  type GrantMintBurnAccessParams,
  type MintBurnRole,
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

export const command = 'grant-mint-burn-access'
export const describe = 'Grant mint and burn permissions on a token to a pool or address'

/**
 * Yargs builder for the token grant-mint-burn-access subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia, solana-devnet)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key (must be token owner/authority)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address (EVM contract, Solana mint, Aptos FA metadata)',
    })
    .option('authority', {
      type: 'string',
      demandOption: true,
      describe: 'Address to grant mint/burn access to (pool, multisig, etc.)',
    })
    .option('role', {
      type: 'string',
      choices: ['mint', 'burn', 'mintAndBurn'] as const,
      default: 'mintAndBurn' as const,
      describe: 'Which role(s) to grant (default: mintAndBurn)',
    })
    .option('token-type', {
      type: 'string',
      choices: ['burnMintERC20', 'factoryBurnMintERC20'] as const,
      default: 'burnMintERC20',
      describe: 'EVM token type — controls grant ABI (EVM only)',
    })
    .example([
      [
        'ccip-cli token grant-mint-burn-access -n sepolia --token-address 0x... --authority 0x...',
        'Grant pool mint/burn roles on EVM',
      ],
      [
        'ccip-cli token grant-mint-burn-access -n solana-devnet --token-address J6fE... --authority 2e8X...',
        'Transfer Solana mint authority to multisig',
      ],
    ])

/**
 * Handler for the token grant-mint-burn-access subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doGrantMintBurnAccess(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type GrantMintBurnAccessArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls grantMintBurnAccess on the appropriate chain-family admin. */
function grantForChain(chain: Chain, wallet: unknown, params: GrantMintBurnAccessParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.grantMintBurnAccess(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.grantMintBurnAccess(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.grantMintBurnAccess(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doGrantMintBurnAccess(ctx: Ctx, argv: GrantMintBurnAccessArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: GrantMintBurnAccessParams = {
    tokenAddress: argv.tokenAddress,
    authority: argv.authority,
    role: argv.role as MintBurnRole,
    ...(argv.tokenType && {
      tokenType: argv.tokenType as 'burnMintERC20' | 'factoryBurnMintERC20',
    }),
  }

  logger.debug(
    `Granting mint/burn access: token=${params.tokenAddress}, authority=${params.authority}, role=${params.role}`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await grantForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    tokenAddress: params.tokenAddress,
    authority: params.authority,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Mint/burn access granted, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
