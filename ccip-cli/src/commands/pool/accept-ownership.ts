/**
 * Pool accept-ownership subcommand.
 * Accepts proposed pool ownership (2-step ownership transfer).
 */

import {
  type AcceptOwnershipParams,
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

export const command = 'accept-ownership'
export const describe = 'Accept proposed pool ownership (2-step ownership transfer)'

/**
 * Yargs builder for the pool accept-ownership subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be pending/proposed owner)',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Pool address',
    })
    .example([
      [
        'ccip-cli pool accept-ownership -n sepolia --pool-address 0x...',
        'Accept proposed pool ownership',
      ],
    ])

/**
 * Handler for the pool accept-ownership subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doAcceptOwnership(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type AcceptOwnershipArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls acceptOwnership on the appropriate chain-family admin. */
function acceptForChain(chain: Chain, wallet: unknown, params: AcceptOwnershipParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.acceptOwnership(wallet, params)
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const admin = new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
      return admin.acceptOwnership(wallet, params)
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const admin = new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
      return admin.acceptOwnership(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doAcceptOwnership(ctx: Ctx, argv: AcceptOwnershipArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: AcceptOwnershipParams = {
    poolAddress: argv.poolAddress,
  }

  logger.debug(`Accepting ownership: pool=${params.poolAddress}`)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await acceptForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: params.poolAddress,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      logger.log('Ownership accepted, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
