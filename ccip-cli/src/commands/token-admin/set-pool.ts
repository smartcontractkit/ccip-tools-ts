/**
 * Set pool subcommand.
 * Registers a pool in the TokenAdminRegistry for a token.
 */

import { AptosTokenManager } from '@chainlink/ccip-sdk/src/cct/aptos/index.ts'
import { EVMTokenManager } from '@chainlink/ccip-sdk/src/cct/evm/index.ts'
import { SolanaTokenManager } from '@chainlink/ccip-sdk/src/cct/solana/index.ts'
import {
  type AptosChain,
  type Chain,
  type EVMChain,
  type SolanaChain,
  CCIPArgumentInvalidError,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'set-pool'
export const describe = 'Register a pool in the TokenAdminRegistry for a token'

/**
 * Yargs builder for the set-pool subcommand.
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
      describe: 'Wallet: ledger[:index] or private key (must be token administrator)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address to register pool for',
    })
    .option('pool-address', {
      type: 'string',
      demandOption: true,
      describe: 'Pool address to register',
    })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe:
        'CCIP Router address (EVM/Aptos: discovers registry; Solana: router is the registry)',
    })
    .option('pool-lookup-table', {
      type: 'string',
      describe: 'Address Lookup Table (Solana only, required)',
    })
    .example([
      [
        'ccip-cli token-admin set-pool -n ethereum-testnet-sepolia --token-address 0xa42B... --pool-address 0xd7BF... --router-address 0x0BF3...',
        'Set pool on Sepolia',
      ],
      [
        'ccip-cli token-admin set-pool -n solana-devnet --wallet ~/.config/solana/id.json --token-address J6fE... --pool-address 99Ux... --router-address Ccip... --pool-lookup-table C6jB...',
        'Set pool on Solana devnet',
      ],
      [
        'ccip-cli token-admin set-pool -n aptos-testnet --token-address 0x89fd... --pool-address 0xeb63... --router-address 0xc748...',
        'Set pool on Aptos testnet',
      ],
    ])

/**
 * Handler for the set-pool subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doSetPool(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type SetPoolArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Sets pool using the appropriate chain-family facade, normalizing to `{ hash }`. */
async function setPoolForChain(
  chain: Chain,
  wallet: unknown,
  argv: SetPoolArgv,
): Promise<{ hash: string }> {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const mgr = EVMTokenManager.fromChain(evmChain)
      // EVM resolves the TokenAdminRegistry from `address` (router/pool/registry).
      return mgr.setPool({
        tokenAddress: argv.tokenAddress,
        poolAddress: argv.poolAddress,
        address: argv.routerAddress,
        wallet,
      })
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      if (!argv.poolLookupTable) {
        throw new CCIPArgumentInvalidError('pool-lookup-table', 'required for Solana')
      }
      const mgr = SolanaTokenManager.fromChain(solanaChain)
      // Solana derives the pool from its lookup table; `address` is the router (the registry).
      return mgr.setPool({
        tokenAddress: argv.tokenAddress,
        address: argv.routerAddress,
        poolLookupTableAddress: argv.poolLookupTable,
        wallet,
      })
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      const mgr = AptosTokenManager.fromChain(aptosChain)
      const { hash } = await mgr.setPool({
        tokenAddress: argv.tokenAddress,
        poolAddress: argv.poolAddress,
        routerAddress: argv.routerAddress,
        wallet,
      })
      return { hash }
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doSetPool(ctx: Ctx, argv: SetPoolArgv) {
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await setPoolForChain(chain, wallet, argv)

  const output: Record<string, string> = {
    network: networkName,
    tokenAddress: argv.tokenAddress,
    poolAddress: argv.poolAddress,
    txHash: result.hash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Pool registered, tx:', result.hash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
