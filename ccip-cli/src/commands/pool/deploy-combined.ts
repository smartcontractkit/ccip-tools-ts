/**
 * Pool deploy-combined subcommand (EVM only).
 * Deploys a CrossChainPoolToken — the canonical CCT v2.0 contract that is simultaneously
 * an ERC20 token and its own CCIP token pool (single deploy, no separate token/pool).
 */

import {
  type EVMChain,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
import { parseUnits } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'
import { runVerification } from '../verify-utils.ts'

export const command = 'deploy-combined'
export const describe = 'Deploy a CrossChainPoolToken (combined token + pool, EVM v2.0)'

/**
 * Yargs builder for the pool deploy-combined subcommand.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'EVM network: chainId or name (e.g., ethereum-testnet-sepolia)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key',
    })
    .option('name', { type: 'string', demandOption: true, describe: 'Token name' })
    .option('symbol', { type: 'string', demandOption: true, describe: 'Token symbol' })
    .option('decimals', { type: 'number', demandOption: true, describe: 'Token decimals' })
    .option('router-address', {
      type: 'string',
      demandOption: true,
      describe: 'CCIP Router address (used to derive rmnProxy)',
    })
    .option('max-supply', {
      type: 'string',
      describe: 'Max supply in whole units (omit for unlimited)',
    })
    .option('initial-supply', {
      type: 'string',
      default: '0',
      describe: 'Pre-mint amount in whole units',
    })
    .option('advanced-pool-hooks', {
      type: 'string',
      describe: 'AdvancedPoolHooks contract address (default: none)',
    })
    .option('ccip-admin', {
      type: 'string',
      describe: 'CCIP admin (getCCIPAdmin); defaults to signer',
    })
    .option('pre-mint-recipient', {
      type: 'string',
      describe: 'Recipient of the initial-supply pre-mint; defaults to ccip-admin',
    })
    .option('verify', {
      type: 'boolean',
      default: false,
      describe: 'Verify the deployed CrossChainPoolToken on the explorer',
    })
    .option('etherscan-api-key', {
      type: 'string',
      describe: 'Etherscan V2 API key for --verify (defaults to ETHERSCAN_API_KEY env)',
    })
    .example([
      [
        'ccip-cli pool deploy-combined -n ethereum-testnet-sepolia --name "My Token" --symbol MTK --decimals 18 --router-address 0x0BF3...',
        'Deploy a CrossChainPoolToken (token == pool) on Sepolia',
      ],
    ])

/**
 * Handler for the pool deploy-combined subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doDeployCombined(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function doDeployCombined(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  if (chain.network.family !== ChainFamily.EVM) {
    throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }

  const [, wallet] = await loadChainWallet(chain, argv)
  const evmChain = chain as EVMChain
  const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, { logger: evmChain.logger })

  const maxSupply = argv.maxSupply ? parseUnits(argv.maxSupply, argv.decimals) : undefined
  const initialSupply =
    argv.initialSupply !== '0' ? parseUnits(argv.initialSupply, argv.decimals) : undefined

  const result = await admin.deployCrossChainPoolToken(wallet, {
    name: argv.name,
    symbol: argv.symbol,
    decimals: argv.decimals,
    routerAddress: argv.routerAddress,
    maxSupply,
    initialSupply,
    ...(argv.advancedPoolHooks && { advancedPoolHooks: argv.advancedPoolHooks }),
    ...(argv.ccipAdmin && { ccipAdmin: argv.ccipAdmin }),
    ...(argv.preMintRecipient && { preMintRecipient: argv.preMintRecipient }),
  })

  const output: Record<string, string> = {
    network: networkName,
    address: result.address,
    tokenAddress: result.tokenAddress,
    poolAddress: result.poolAddress,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      break
    case Format.log:
      ctx.output.write('CrossChainPoolToken deployed (token == pool):', result.address)
      ctx.output.write('tx:', result.txHash)
      break
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      break
  }

  if (argv.verify && result.verification) {
    await runVerification(ctx, networkName, [{ ...result.verification, address: result.address }], {
      etherscanApiKey: argv.etherscanApiKey,
    })
  }
}
