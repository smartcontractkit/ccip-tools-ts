/**
 * Accept admin subcommand.
 * Accepts an administrator role for a token in the TokenAdminRegistry.
 */

import { AptosTokenManager } from '@chainlink/ccip-sdk/src/cct/aptos/index.ts'
import { EVMTokenManager } from '@chainlink/ccip-sdk/src/cct/evm/index.ts'
import { SolanaTokenManager } from '@chainlink/ccip-sdk/src/cct/solana/index.ts'
import {
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

export const command = 'accept-admin'
export const describe = 'Accept an administrator role for a token in the TokenAdminRegistry'

/**
 * Yargs builder for the accept-admin subcommand.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
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
      describe: 'Wallet: ledger[:index] or private key (must be pending administrator)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address to accept admin role for',
    })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe:
        'CCIP Router address (EVM/Aptos: discovers registry; Solana: router is the registry)',
    })
    .example([
      [
        'ccip-cli token-admin accept-admin -n ethereum-testnet-sepolia --token-address 0xa42B... --router-address 0x0BF3...',
        'Accept admin on Sepolia',
      ],
      [
        'ccip-cli token-admin accept-admin -n solana-devnet --wallet ~/.config/solana/id.json --token-address J6fE... --router-address Ccip...',
        'Accept admin on Solana devnet',
      ],
      [
        'ccip-cli token-admin accept-admin -n aptos-testnet --token-address 0x89fd... --router-address 0xc748...',
        'Accept admin on Aptos testnet',
      ],
    ])

/**
 * Handler for the accept-admin subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doAcceptAdmin(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type AcceptArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Accepts admin using the appropriate chain-family facade, normalizing to `{ hash }`. */
async function acceptAdminForChain(
  chain: Chain,
  wallet: unknown,
  argv: AcceptArgv,
): Promise<{ hash: string }> {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const mgr = EVMTokenManager.fromChain(evmChain)
      // EVM resolves the TokenAdminRegistry from `address` (router/pool/registry).
      return mgr.acceptAdminRole({
        tokenAddress: argv.tokenAddress,
        address: argv.routerAddress,
        wallet,
      })
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      const mgr = SolanaTokenManager.fromChain(solanaChain)
      return mgr.acceptAdminRole({
        tokenAddress: argv.tokenAddress,
        routerAddress: argv.routerAddress,
        wallet,
      })
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const mgr = AptosTokenManager.fromChain(aptosChain)
      const { hash } = await mgr.acceptAdminRole({
        tokenAddress: argv.tokenAddress,
        routerAddress: argv.routerAddress,
        wallet,
      })
      return { hash }
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doAcceptAdmin(ctx: Ctx, argv: AcceptArgv) {
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await acceptAdminForChain(chain, wallet, argv)

  const output: Record<string, string> = {
    network: networkName,
    txHash: result.hash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Admin accepted, tx:', result.hash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
