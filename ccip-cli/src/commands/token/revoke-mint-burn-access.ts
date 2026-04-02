/**
 * Token revoke-mint-burn-access subcommand.
 * Revokes mint or burn permissions on a token from a pool or address.
 */

import {
  type AptosChain,
  type Chain,
  type EVMChain,
  type RevokeMintBurnAccessParams,
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

export const command = 'revoke-mint-burn-access'
export const describe = 'Revoke mint or burn permissions on a token from a pool or address'

/**
 * Yargs builder for the token revoke-mint-burn-access subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be token owner/authority)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address (EVM contract, Aptos FA metadata)',
    })
    .option('authority', {
      type: 'string',
      demandOption: true,
      describe: 'Address to revoke mint/burn access from (pool, multisig, etc.)',
    })
    .option('role', {
      type: 'string',
      choices: ['mint', 'burn'] as const,
      demandOption: true,
      describe: 'Which role to revoke: mint or burn',
    })
    .option('token-type', {
      type: 'string',
      choices: ['burnMintERC20', 'factoryBurnMintERC20'] as const,
      default: 'burnMintERC20',
      describe: 'EVM token type — controls revoke ABI (EVM only)',
    })
    .example([
      [
        'ccip-cli token revoke-mint-burn-access -n sepolia --token-address 0x... --authority 0x... --role mint',
        'Revoke mint role on EVM',
      ],
    ])

/**
 * Handler for the token revoke-mint-burn-access subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doRevokeMintBurnAccess(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type RevokeMintBurnAccessArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls revokeMintBurnAccess on the appropriate chain-family admin. */
function revokeForChain(chain: Chain, wallet: unknown, params: RevokeMintBurnAccessParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.revokeMintBurnAccess(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.revokeMintBurnAccess(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.revokeMintBurnAccess(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doRevokeMintBurnAccess(ctx: Ctx, argv: RevokeMintBurnAccessArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: RevokeMintBurnAccessParams = {
    tokenAddress: argv.tokenAddress,
    authority: argv.authority,
    role: argv.role,
    ...(argv.tokenType && {
      tokenType: argv.tokenType as 'burnMintERC20' | 'factoryBurnMintERC20',
    }),
  }

  logger.debug(
    `Revoking ${params.role} access: token=${params.tokenAddress}, authority=${params.authority}`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await revokeForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    tokenAddress: params.tokenAddress,
    authority: params.authority,
    role: params.role,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log(`${params.role} access revoked, tx:`, result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
