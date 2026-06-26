/**
 * Token deploy subcommand.
 * Deploys a new CCIP-compatible token (CrossChainToken / SPL mint / managed_token).
 */

import {
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
import { parseUnits } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../../providers/index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyTable } from '../utils.ts'
import { runVerification } from '../verify-utils.ts'

export const command = 'deploy'
export const describe = 'Deploy a new CCIP-compatible token'

/**
 * Yargs builder for the token deploy subcommand.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('network', {
      alias: 'n',
      type: 'string',
      demandOption: true,
      describe: 'Network: chainId or name (e.g., ethereum-testnet-sepolia, solana-devnet)',
    })
    .option('wallet', {
      alias: 'w',
      type: 'string',
      describe: 'Wallet: ledger[:index] or private key',
    })
    .option('name', {
      type: 'string',
      demandOption: true,
      describe: 'Token name',
    })
    .option('symbol', {
      type: 'string',
      demandOption: true,
      describe: 'Token symbol',
    })
    .option('decimals', {
      type: 'number',
      demandOption: true,
      describe: 'Token decimals',
    })
    .option('max-supply', {
      type: 'string',
      describe: 'Max supply in whole units (omit for unlimited; Solana: must fit in u64)',
    })
    .option('initial-supply', {
      type: 'string',
      default: '0',
      describe: 'Initial supply in whole units (Solana: must fit in u64)',
    })
    // EVM-specific (CrossChainToken v2.0)
    .option('owner', {
      type: 'string',
      describe: 'Owner address (2-step admin); defaults to signer. EVM only',
    })
    .option('ccip-admin', {
      type: 'string',
      describe: 'CCIP admin (getCCIPAdmin); defaults to owner/signer. EVM only',
    })
    .option('burn-mint-role-admin', {
      type: 'string',
      describe: 'Admin allowed to grant/revoke MINTER/BURNER roles; defaults to owner. EVM only',
    })
    .option('pre-mint-recipient', {
      type: 'string',
      describe: 'Recipient of the initial-supply pre-mint; defaults to owner. EVM only',
    })
    // Solana-specific
    .option('token-program', {
      type: 'string',
      choices: ['spl-token', 'token-2022'] as const,
      default: 'spl-token',
      describe: 'Solana token program (Solana only)',
    })
    .option('metadata-uri', {
      type: 'string',
      describe: 'Metaplex metadata JSON URI (Solana only)',
    })
    // Aptos-specific
    .option('icon', {
      type: 'string',
      describe: 'Token icon URI (Aptos only)',
    })
    .option('project', {
      type: 'string',
      describe: 'Project URL (Aptos only)',
    })
    // Verification (EVM only)
    .option('verify', {
      type: 'boolean',
      default: false,
      describe: 'Verify the deployed contract on the source-chain explorer (EVM only)',
    })
    .option('etherscan-api-key', {
      type: 'string',
      describe: 'Etherscan V2 API key for --verify (defaults to ETHERSCAN_API_KEY env)',
    })
    .example([
      [
        'ccip-cli token deploy -n ethereum-testnet-sepolia --name "My Token" --symbol MTK --decimals 18',
        'Deploy ERC20 on Sepolia',
      ],
      [
        'ccip-cli token deploy -n solana-devnet --name "My Token" --symbol MTK --decimals 9',
        'Deploy SPL token on Solana devnet',
      ],
      [
        'ccip-cli token deploy -n aptos-testnet --name "My Token" --symbol MTK --decimals 8',
        'Deploy managed_token on Aptos testnet',
      ],
    ])

/**
 * Handler for the token deploy subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doDeployToken(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

function getTokenAdmin(chain: Chain) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      return new EVMTokenAdmin(evmChain.provider, evmChain.network, { logger: evmChain.logger })
    }
    case ChainFamily.Solana: {
      const solanaChain = chain as SolanaChain
      return new SolanaTokenAdmin(solanaChain.connection, solanaChain.network, {
        logger: solanaChain.logger,
      })
    }
    case ChainFamily.Aptos: {
      const aptosChain = chain as AptosChain
      return new AptosTokenAdmin(aptosChain.provider, aptosChain.network, {
        logger: aptosChain.logger,
      })
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doDeployToken(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const [, wallet] = await loadChainWallet(chain, argv)
  const admin = getTokenAdmin(chain)

  const maxSupply = argv.maxSupply ? parseUnits(argv.maxSupply, argv.decimals) : undefined
  const initialSupply =
    argv.initialSupply !== '0' ? parseUnits(argv.initialSupply, argv.decimals) : undefined

  const result = await admin.deployToken(wallet, {
    name: argv.name,
    symbol: argv.symbol,
    decimals: argv.decimals,
    maxSupply,
    initialSupply,
    // EVM-specific (CrossChainToken v2.0)
    ...(argv.owner && { ownerAddress: argv.owner }),
    ...(argv.ccipAdmin && { ccipAdmin: argv.ccipAdmin }),
    ...(argv.burnMintRoleAdmin && { burnMintRoleAdmin: argv.burnMintRoleAdmin }),
    ...(argv.preMintRecipient && { preMintRecipient: argv.preMintRecipient }),
    // Solana-specific
    ...(argv.tokenProgram && {
      tokenProgram: argv.tokenProgram as 'spl-token' | 'token-2022',
    }),
    ...(argv.metadataUri && { metadataUri: argv.metadataUri }),
    // Aptos-specific
    ...(argv.icon && { icon: argv.icon }),
    ...(argv.project && { project: argv.project }),
  })

  // Build output object, including chain-specific optional fields when present
  const output: Record<string, string> = {
    network: networkName,
    tokenAddress: result.tokenAddress,
    txHash: result.txHash,
  }
  if (result.codeObjectAddress) output.codeObjectAddress = result.codeObjectAddress
  if (result.metadataAddress) output.metadataAddress = result.metadataAddress

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      break
    case Format.log:
      ctx.output.write('Token deployed:', result.tokenAddress, 'tx:', result.txHash)
      if (result.codeObjectAddress) ctx.output.write('Code object:', result.codeObjectAddress)
      if (result.metadataAddress) ctx.output.write('Metadata:', result.metadataAddress)
      break
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      break
  }

  if (argv.verify && result.verification) {
    await runVerification(
      ctx,
      networkName,
      [{ ...result.verification, address: result.tokenAddress }],
      { etherscanApiKey: argv.etherscanApiKey },
    )
  }
}
