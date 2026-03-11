/**
 * Pool set-fee-admin subcommand.
 * Sets the fee admin on a CCIP token pool (EVM v2.0+ only).
 */

import {
  type Chain,
  type EVMChain,
  type SetFeeAdminParams,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'set-fee-admin'
export const describe = 'Set the fee admin on a CCIP token pool (EVM v2.0+ only)'

/**
 * Yargs builder for the pool set-fee-admin subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be pool owner)',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Local pool address',
    })
    .option('fee-admin', {
      type: 'string',
      demandOption: true,
      describe: 'Address of the new fee admin',
    })
    .example([
      [
        'ccip-cli pool set-fee-admin -n sepolia --pool-address 0x... --fee-admin 0x...',
        'Set the fee admin on a v2.0 pool',
      ],
    ])

/**
 * Handler for the pool set-fee-admin subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doSetFeeAdmin(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type SetFeeAdminArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Calls setFeeAdmin on the appropriate chain-family admin (EVM v2.0+ only). */
function setForChain(chain: Chain, wallet: unknown, params: SetFeeAdminParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.setFeeAdmin(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doSetFeeAdmin(ctx: Ctx, argv: SetFeeAdminArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: SetFeeAdminParams = {
    poolAddress: argv.poolAddress,
    feeAdmin: argv.feeAdmin,
  }

  logger.debug(`Setting fee admin: pool=${params.poolAddress}, admin=${params.feeAdmin}`)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await setForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: params.poolAddress,
    feeAdmin: params.feeAdmin,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Fee admin updated, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
