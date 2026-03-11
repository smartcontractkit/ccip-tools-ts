/**
 * Pool create-multisig subcommand (Solana only).
 * Creates an SPL Token native multisig with the Pool Signer PDA auto-included.
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

export const command = 'create-multisig'
export const describe = 'Create SPL Token multisig with Pool Signer PDA (Solana only)'

/**
 * Yargs builder for the token create-multisig subcommand.
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
    .option('mint', {
      alias: 'token-address',
      type: 'string',
      demandOption: true,
      describe: 'SPL token mint address (base58)',
    })
    .option('pool-program-id', {
      type: 'string',
      demandOption: true,
      describe: 'Pool program ID for PDA derivation',
    })
    .option('additional-signers', {
      type: 'array',
      string: true,
      demandOption: true,
      describe: 'Additional signer pubkeys (Pool Signer PDA is auto-included)',
    })
    .option('threshold', {
      type: 'number',
      demandOption: true,
      describe: 'Required number of signers (m-of-n)',
    })
    .option('seed', {
      type: 'string',
      describe: 'Optional seed for deterministic multisig address derivation',
    })
    .example([
      [
        'ccip-cli token create-multisig -n solana-devnet --mint J6fE... --pool-program-id 41FG... --additional-signers 59eN... --threshold 1',
        'Create multisig with Pool Signer PDA + one additional signer, threshold 1',
      ],
    ])

/**
 * Handler for the token create-multisig subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doCreateMultisig(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type CreateMultisigArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

async function doCreateMultisig(ctx: Ctx, argv: CreateMultisigArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  if (chain.network.family !== ChainFamily.Solana) {
    throw new CCIPChainFamilyUnsupportedError(chain.network.family, {
      context: { reason: 'create-multisig is only supported on Solana' },
    })
  }

  const solanaChain = chain as SolanaChain
  const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
    logger: solanaChain.logger,
  })

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await admin.createPoolMintAuthorityMultisig(wallet, {
    mint: argv.mint,
    poolProgramId: argv.poolProgramId,
    additionalSigners: argv.additionalSigners,
    threshold: argv.threshold,
    ...(argv.seed && { seed: argv.seed }),
  })

  const output: Record<string, string | string[]> = {
    network: networkName,
    multisigAddress: result.multisigAddress,
    poolSignerPda: result.poolSignerPda,
    allSigners: result.allSigners,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Multisig created:', result.multisigAddress, 'tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, { ...output, allSigners: result.allSigners.join(', ') })
      return
  }
}
