/**
 * Token get-mint-burn-info subcommand.
 * Read-only command that shows mint/burn role holders on a token.
 */

import {
  type AptosChain,
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
import { fetchChainsFromRpcs } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'

export const command = 'get-mint-burn-info'
export const describe = 'Show mint/burn role holders on a token (read-only)'

/**
 * Yargs builder for the token get-mint-burn-info subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia, solana-devnet)',
    })
    .option('token-address', {
      type: 'string',
      demandOption: true,
      describe: 'Token address (EVM contract, Solana mint, Aptos FA metadata)',
    })
    .example([
      [
        'ccip-cli token get-mint-burn-info -n sepolia --token-address 0x...',
        'Show minters and burners on an EVM BurnMintERC20',
      ],
      [
        'ccip-cli token get-mint-burn-info -n solana-devnet --token-address J6fE...',
        'Show Solana mint authority and multisig members',
      ],
      [
        'ccip-cli token get-mint-burn-info -n aptos-testnet --token-address 0x...',
        'Show Aptos managed/regulated token roles',
      ],
    ])

/**
 * Handler for the token get-mint-burn-info subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doGetMintBurnInfo(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type GetMintBurnInfoArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

async function doGetMintBurnInfo(ctx: Ctx, argv: GetMintBurnInfoArgv) {
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const tokenAddress = argv.tokenAddress

  switch (chain.network.family) {
    case ChainFamily.EVM:
      return handleEVM(ctx, chain as EVMChain, networkName, tokenAddress, argv)
    case ChainFamily.Solana:
      return handleSolana(ctx, chain as SolanaChain, networkName, tokenAddress, argv)
    case ChainFamily.Aptos:
      return handleAptos(ctx, chain as AptosChain, networkName, tokenAddress, argv)
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function handleEVM(
  ctx: Ctx,
  chain: EVMChain,
  networkName: string,
  tokenAddress: string,
  argv: GetMintBurnInfoArgv,
) {
  const admin = new EVMTokenAdmin(chain.provider, chain.network, { logger: chain.logger })
  const result = await admin.getMintBurnRoles(tokenAddress)

  const output = {
    network: networkName,
    tokenAddress,
    minters: result.minters,
    burners: result.burners,
  }

  switch (argv.format) {
    case Format.json:
      ctx.logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.logger.log('Token:', tokenAddress)
      ctx.logger.log('Minters:', result.minters.length ? result.minters.join(', ') : '(none)')
      ctx.logger.log('Burners:', result.burners.length ? result.burners.join(', ') : '(none)')
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, {
        network: networkName,
        tokenAddress,
        ['minters (' + result.minters.length + ')']: result.minters.length
          ? result.minters.join('\n')
          : '(none)',
        ['burners (' + result.burners.length + ')']: result.burners.length
          ? result.burners.join('\n')
          : '(none)',
      })
      return
  }
}

async function handleSolana(
  ctx: Ctx,
  chain: SolanaChain,
  networkName: string,
  tokenAddress: string,
  argv: GetMintBurnInfoArgv,
) {
  const admin = new SolanaTokenAdmin(chain.connection, chain.network, { logger: chain.logger })
  const result = await admin.getMintBurnRoles({ tokenAddress })

  const output: Record<string, unknown> = {
    network: networkName,
    tokenAddress,
    mintAuthority: result.mintAuthority ?? '(disabled)',
    isMultisig: result.isMultisig,
  }

  if (result.isMultisig) {
    output.multisigThreshold = `${result.multisigThreshold}-of-${result.multisigMembers!.length}`
    output.multisigMembers = result.multisigMembers
  }

  switch (argv.format) {
    case Format.json:
      ctx.logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.logger.log('Token:', tokenAddress)
      ctx.logger.log('Mint Authority:', result.mintAuthority ?? '(disabled)')
      if (result.isMultisig) {
        ctx.logger.log(
          'Multisig:',
          `${result.multisigThreshold}-of-${result.multisigMembers!.length}`,
        )
        for (const member of result.multisigMembers!) {
          ctx.logger.log('  -', member.address)
        }
      }
      return
    case Format.pretty:
    default: {
      const table: Record<string, unknown> = {
        network: networkName,
        tokenAddress,
        mintAuthority: result.mintAuthority ?? '(disabled)',
      }
      if (result.isMultisig) {
        table.multisigThreshold = `${result.multisigThreshold}-of-${result.multisigMembers!.length}`
        for (let i = 0; i < result.multisigMembers!.length; i++) {
          table[`member[${i}]`] = result.multisigMembers![i]!.address
        }
      }
      prettyTable.call(ctx, table)
      return
    }
  }
}

async function handleAptos(
  ctx: Ctx,
  chain: AptosChain,
  networkName: string,
  tokenAddress: string,
  argv: GetMintBurnInfoArgv,
) {
  const admin = new AptosTokenAdmin(chain.provider, chain.network, { logger: chain.logger })
  const result = await admin.getMintBurnRoles(tokenAddress)

  const output: Record<string, unknown> = {
    network: networkName,
    tokenAddress,
    tokenModule: result.tokenModule,
  }

  if (result.owner) output.owner = result.owner
  if (result.allowedMinters) output.allowedMinters = result.allowedMinters
  if (result.allowedBurners) output.allowedBurners = result.allowedBurners
  if (result.bridgeMintersOrBurners) output.bridgeMintersOrBurners = result.bridgeMintersOrBurners

  switch (argv.format) {
    case Format.json:
      ctx.logger.log(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.logger.log('Token:', tokenAddress)
      ctx.logger.log('Module:', result.tokenModule)
      if (result.owner) ctx.logger.log('Owner:', result.owner)
      if (result.allowedMinters) {
        ctx.logger.log(
          'Minters:',
          result.allowedMinters.length ? result.allowedMinters.join(', ') : '(none)',
        )
      }
      if (result.allowedBurners) {
        ctx.logger.log(
          'Burners:',
          result.allowedBurners.length ? result.allowedBurners.join(', ') : '(none)',
        )
      }
      if (result.bridgeMintersOrBurners) {
        ctx.logger.log(
          'Bridge Minters/Burners:',
          result.bridgeMintersOrBurners.length
            ? result.bridgeMintersOrBurners.join(', ')
            : '(none)',
        )
      }
      return
    case Format.pretty:
    default: {
      const table: Record<string, unknown> = {
        network: networkName,
        tokenAddress,
        tokenModule: result.tokenModule,
      }
      if (result.owner) table.owner = result.owner
      if (result.allowedMinters) {
        table['minters (' + result.allowedMinters.length + ')'] = result.allowedMinters.length
          ? result.allowedMinters.join('\n')
          : '(none)'
      }
      if (result.allowedBurners) {
        table['burners (' + result.allowedBurners.length + ')'] = result.allowedBurners.length
          ? result.allowedBurners.join('\n')
          : '(none)'
      }
      if (result.bridgeMintersOrBurners) {
        table['bridge minters/burners (' + result.bridgeMintersOrBurners.length + ')'] = result
          .bridgeMintersOrBurners.length
          ? result.bridgeMintersOrBurners.join('\n')
          : '(none)'
      }
      prettyTable.call(ctx, table)
      return
    }
  }
}
