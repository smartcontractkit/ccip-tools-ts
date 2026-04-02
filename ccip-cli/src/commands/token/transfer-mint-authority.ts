/**
 * Token transfer-mint-authority subcommand (Solana only).
 * Transfers SPL token mint authority to a new address (typically a multisig).
 */

import {
  type SolanaChain,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import {
  type TransferMintAuthorityParams,
  SolanaTokenAdmin,
} from '@chainlink/ccip-sdk/src/token-admin/solana/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'transfer-mint-authority'
export const describe = 'Transfer SPL token mint authority to a new address (Solana only)'

/**
 * Yargs builder for the token transfer-mint-authority subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., solana-devnet)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key (must be current mint authority)',
    })
    .option('mint', {
      type: 'string',
      demandOption: true,
      describe: 'SPL token mint address (base58)',
    })
    .option('new-mint-authority', {
      type: 'string',
      demandOption: true,
      describe: 'New mint authority address (base58) — typically a multisig',
    })
    .example([
      [
        'ccip-cli token transfer-mint-authority -n solana-devnet --mint J6fE... --new-mint-authority 2e8X...',
        'Transfer mint authority to a multisig',
      ],
    ])

/**
 * Handler for the token transfer-mint-authority subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doTransferMintAuthority(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type TransferMintAuthorityArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

async function doTransferMintAuthority(ctx: Ctx, argv: TransferMintAuthorityArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  if (chain.network.family !== ChainFamily.Solana) {
    throw new CCIPChainFamilyUnsupportedError(chain.network.family, {
      context: { reason: 'transfer-mint-authority is only supported on Solana' },
    })
  }

  const solanaChain = chain as SolanaChain
  const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
    logger: solanaChain.logger,
  })

  const params: TransferMintAuthorityParams = {
    mint: argv.mint,
    newMintAuthority: argv.newMintAuthority,
  }

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await admin.transferMintAuthority(wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    mint: params.mint,
    newMintAuthority: params.newMintAuthority,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Mint authority transferred, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
