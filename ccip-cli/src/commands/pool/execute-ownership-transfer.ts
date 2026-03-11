/**
 * Pool execute-ownership-transfer subcommand.
 * Aptos-only: finalizes pool ownership transfer (3rd step of Aptos 3-step process).
 *
 * Aptos ownership transfer flow:
 * 1. `transfer-ownership` — current owner proposes new owner
 * 2. `accept-ownership` — proposed owner signals acceptance
 * 3. `execute-ownership-transfer` — current owner finalizes the AptosFramework object transfer
 */

import {
  type AptosChain,
  type ExecuteOwnershipTransferParams,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { AptosTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/aptos/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'execute-ownership-transfer'
export const describe =
  'Aptos-only: finalize pool ownership transfer (3rd step after transfer + accept)'

/**
 * Yargs builder for the pool execute-ownership-transfer subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (must be an Aptos network)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key (must be current pool owner)',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Pool address',
    })
    .option('new-owner', {
      type: 'string',
      demandOption: true,
      describe: 'Address of the new owner (must match the address that called accept-ownership)',
    })
    .example([
      [
        'ccip-cli pool execute-ownership-transfer -n aptos-testnet --pool-address 0x... --new-owner 0x...',
        'Finalize Aptos pool ownership transfer',
      ],
    ])

/**
 * Handler for the pool execute-ownership-transfer subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doExecuteOwnershipTransfer(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type ExecuteOwnershipTransferArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

async function doExecuteOwnershipTransfer(ctx: Ctx, argv: ExecuteOwnershipTransferArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const aptosChain = chain as AptosChain
  const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
    logger: aptosChain.logger,
  })

  const params: ExecuteOwnershipTransferParams = {
    poolAddress: argv.poolAddress,
    newOwner: argv.newOwner,
  }

  logger.debug(
    `Executing ownership transfer: pool=${params.poolAddress}, newOwner=${params.newOwner}`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await admin.executeOwnershipTransfer(wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: params.poolAddress,
    newOwner: params.newOwner,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Ownership transfer executed, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
