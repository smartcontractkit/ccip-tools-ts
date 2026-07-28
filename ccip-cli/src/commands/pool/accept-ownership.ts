/**
 * Pool accept-ownership subcommand.
 * Accepts proposed pool ownership (2-step ownership transfer).
 */

import { AptosTokenManager } from '@chainlink/ccip-sdk/src/cct/aptos/index.ts'
import { EVMTokenManager } from '@chainlink/ccip-sdk/src/cct/evm/index.ts'
import { SolanaTokenManager } from '@chainlink/ccip-sdk/src/cct/solana/index.ts'
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

/** Calls acceptOwnership on the appropriate chain-family facade, normalizing to `{ hash }`. */
async function acceptForChain(
  chain: Chain,
  wallet: unknown,
  params: AcceptOwnershipParams,
): Promise<{ hash: string }> {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const mgr = EVMTokenManager.fromChain(chain as EVMChain)
      return mgr.acceptOwnership({ ...params, wallet })
    }
    case ChainFamily.Solana: {
      const mgr = SolanaTokenManager.fromChain(chain as SolanaChain)
      return mgr.acceptOwnership({ ...params, wallet })
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const mgr = AptosTokenManager.fromChain(aptosChain)
      const { hash } = await mgr.acceptOwnership({ ...params, wallet })
      return { hash }
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
    txHash: result.hash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Ownership accepted, tx:', result.hash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
