/**
 * Token-admin create-token-alt subcommand (Solana only).
 * Creates an Address Lookup Table (ALT) with CCIP base addresses for a token's pool.
 */

import {
  type SolanaChain,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { SolanaTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/solana/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'create-token-alt'
export const describe = 'Create Address Lookup Table for a token pool (Solana only)'

/**
 * Yargs builder for the token-admin create-token-alt subcommand.
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
      describe: 'Wallet: ledger[:index] or private key',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'SPL token mint address (base58)',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Pool state PDA (base58). SDK derives pool program ID from its on-chain owner.',
    })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe: 'CCIP Router program ID (base58). SDK discovers feeQuoter from config.',
    })
    .option('authority', {
      type: 'string',
      describe:
        'ALT authority (base58). Defaults to wallet. Can differ for multisig setups (e.g., Squads vault).',
    })
    .option('additional-addresses', {
      type: 'array',
      string: true,
      describe:
        'Extra addresses for ALT (e.g., SPL Token Multisig address when using multisig mint authority for burn-mint pools)',
    })
    .example([
      [
        'ccip-cli token-admin create-token-alt -n solana-devnet --token-address J6fE... --pool-address 2pGY... --router-address Ccip...',
        'Create ALT with 10 base CCIP addresses',
      ],
      [
        'ccip-cli token-admin create-token-alt -n solana-devnet --token-address J6fE... --pool-address 2pGY... --router-address Ccip... --additional-addresses 6c5U...',
        'Create ALT with base addresses + SPL Token Multisig',
      ],
    ])

/**
 * Handler for the token-admin create-token-alt subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doCreateTokenAlt(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type CreateTokenAltArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

async function doCreateTokenAlt(ctx: Ctx, argv: CreateTokenAltArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  if (chain.network.family !== ChainFamily.Solana) {
    throw new CCIPChainFamilyUnsupportedError(chain.network.family, {
      context: { reason: 'create-token-alt is only supported on Solana' },
    })
  }

  const solanaChain = chain as SolanaChain
  const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
    logger: solanaChain.logger,
  })

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await admin.createTokenAlt(wallet, {
    tokenAddress: argv.tokenAddress,
    poolAddress: argv.poolAddress,
    routerAddress: argv.routerAddress,
    ...(argv.authority && { authority: argv.authority }),
    ...(argv.additionalAddresses && { additionalAddresses: argv.additionalAddresses }),
  })

  const output: Record<string, string> = {
    network: networkName,
    lookupTableAddress: result.lookupTableAddress,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('ALT created:', result.lookupTableAddress, 'tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
