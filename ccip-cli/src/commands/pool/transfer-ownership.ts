/**
 * Pool transfer-ownership subcommand.
 * Proposes a new owner for a CCIP token pool (2-step ownership transfer).
 */

import {
  type AptosChain,
  type Chain,
  type EVMChain,
  type SolanaChain,
  type TransferOwnershipParams,
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

export const command = 'transfer-ownership'
export const describe = 'Propose a new owner for a CCIP token pool (2-step ownership transfer)'

/**
 * Yargs builder for the pool transfer-ownership subcommand.
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
      describe: 'Address of the proposed new owner',
    })
    .example([
      [
        'ccip-cli pool transfer-ownership -n sepolia --pool-address 0x... --new-owner 0x...',
        'Propose a new pool owner',
      ],
    ])

/**
 * Handler for the pool transfer-ownership subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doTransferOwnership(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type TransferOwnershipArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls transferOwnership on the appropriate chain-family admin. */
function transferForChain(chain: Chain, wallet: unknown, params: TransferOwnershipParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.transferOwnership(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.transferOwnership(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.transferOwnership(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doTransferOwnership(ctx: Ctx, argv: TransferOwnershipArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: TransferOwnershipParams = {
    poolAddress: argv.poolAddress,
    newOwner: argv.newOwner,
  }

  logger.debug(`Transferring ownership: pool=${params.poolAddress}, newOwner=${params.newOwner}`)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await transferForChain(chain, wallet, params)

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
      logger.log('Ownership transfer proposed, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
