/**
 * Pool deploy-via-factory subcommand.
 *
 * Deploys CCT v2 contracts through a `TokenPoolFactory 2.0.0` (CREATE2) on EVM, in either mode:
 *  - no `--token-address`  → deploy a NEW CrossChainToken **and** its pool (deployTokenAndTokenPool)
 *  - with `--token-address`→ deploy a pool for an EXISTING token (deployTokenPoolWithExistingToken)
 *
 * With `--verify`, every contract the factory created (token, pool, and the auto-deployed lockbox
 * for lock-release) is verified on the source-chain explorer using the exact constructor args
 * (the factory contracts are born in internal CREATE2 calls, so the args are carried through from
 * the deploy rather than recovered from a creation tx).
 */

import {
  type EVMChain,
  CCIPArgumentInvalidError,
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
import { runVerification } from '../verify-utils.ts'

export const command = 'deploy-via-factory'
export const describe = 'Deploy CCT v2 token/pool through a TokenPoolFactory 2.0.0 (EVM, CREATE2)'

/**
 * Yargs builder for the pool deploy-via-factory subcommand.
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
    .option('factory', {
      type: 'string',
      demandOption: true,
      describe: 'TokenPoolFactory 2.0.0 address on this chain',
    })
    .option('pool-type', {
      type: 'string',
      choices: ['burn-mint', 'lock-release'] as const,
      demandOption: true,
      describe: 'Local pool type to deploy',
    })
    .option('decimals', {
      type: 'number',
      default: 18,
      describe: 'Local token decimals',
    })
    .option('token-address', {
      type: 'string',
      describe: 'Existing token address (existing-token mode); omit to deploy a new token + pool',
    })
    // New-token mode (omit --token-address)
    .option('name', { type: 'string', describe: 'Token name (new-token mode)' })
    .option('symbol', { type: 'string', describe: 'Token symbol (new-token mode)' })
    .option('max-supply', {
      type: 'string',
      describe: 'Max supply in smallest units (new-token mode); defaults to uint256 max',
    })
    .option('pre-mint', {
      type: 'string',
      describe: 'Initial supply minted at deploy, smallest units (new-token mode)',
    })
    .option('pre-mint-recipient', {
      type: 'string',
      describe: 'Recipient of the pre-mint; defaults to the future owner',
    })
    // Shared
    .option('lock-box', {
      type: 'string',
      describe: 'Existing ERC20LockBox (lock-release); the factory auto-deploys one if omitted',
    })
    .option('salt', { type: 'string', describe: 'CREATE2 salt (random 32 bytes if omitted)' })
    .option('future-owner', {
      type: 'string',
      describe: 'Final owner of the deployed contracts; defaults to the signer',
    })
    .option('verify', {
      type: 'boolean',
      default: false,
      describe: 'Verify every deployed contract on the source-chain explorer',
    })
    .option('etherscan-api-key', {
      type: 'string',
      describe: 'Etherscan V2 API key for --verify (defaults to ETHERSCAN_API_KEY env)',
    })
    .check((argv) => {
      if (!argv.tokenAddress && (!argv.name || !argv.symbol)) {
        throw new Error('new-token mode requires --name and --symbol (or pass --token-address)')
      }
      return true
    })
    .example([
      [
        'ccip-cli pool deploy-via-factory -n ethereum-testnet-sepolia --factory 0x93c5... --pool-type burn-mint --name "My Token" --symbol MTK --verify',
        'Deploy a new token + burn-mint pool via the factory and verify both',
      ],
      [
        'ccip-cli pool deploy-via-factory -n ethereum-testnet-sepolia --factory 0x93c5... --pool-type lock-release --token-address 0xabc... --verify',
        'Deploy a lock-release pool (+ auto lockbox) for an existing token and verify',
      ],
    ])

type FactoryArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/**
 * Handler for the pool deploy-via-factory subcommand.
 * @param argv - Command line arguments.
 */
export async function handler(argv: FactoryArgv) {
  const [ctx, destroy] = getCtx(argv)
  return doDeploy(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function doDeploy(ctx: Ctx, argv: FactoryArgv) {
  const net = networkInfo(argv.network)
  if (net.family !== ChainFamily.EVM) {
    throw new CCIPChainFamilyUnsupportedError(net.family)
  }
  const networkName = net.name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = (await getChain(networkName)) as EVMChain
  const [, wallet] = await loadChainWallet(chain, argv)
  const admin = new EVMTokenAdmin(chain.provider, chain.network, { logger: chain.logger })

  const poolType = argv.poolType
  const shared = {
    factoryAddress: argv.factory,
    decimals: argv.decimals,
    poolType,
    ...(argv.lockBox && { lockBoxAddress: argv.lockBox }),
    ...(argv.salt && { salt: argv.salt }),
    ...(argv.futureOwner && { futureOwner: argv.futureOwner }),
  }

  const output: Record<string, string> = { network: networkName }
  let verifications

  if (argv.tokenAddress) {
    // Existing-token mode → pool only.
    const result = await admin.deployPoolViaFactory(wallet, {
      ...shared,
      tokenAddress: argv.tokenAddress,
    })
    output.poolAddress = result.poolAddress
    output.txHash = result.txHash
    if (result.lockBoxAddress) output.lockBoxAddress = result.lockBoxAddress
    verifications = result.verifications
  } else {
    // New-token mode → token + pool.
    if (!argv.name || !argv.symbol) {
      throw new CCIPArgumentInvalidError('name', 'new-token mode requires --name and --symbol')
    }
    const result = await admin.deployTokenAndPoolViaFactory(wallet, {
      ...shared,
      name: argv.name,
      symbol: argv.symbol,
      maxSupply: argv.maxSupply ? BigInt(argv.maxSupply) : (1n << 256n) - 1n,
      ...(argv.preMint && { preMint: BigInt(argv.preMint) }),
      ...(argv.preMintRecipient && { preMintRecipient: argv.preMintRecipient }),
    })
    output.tokenAddress = result.tokenAddress
    output.poolAddress = result.poolAddress
    output.txHash = result.txHash
    if (result.lockBoxAddress) output.lockBoxAddress = result.lockBoxAddress
    verifications = result.verifications
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      break
    case Format.log:
      if (output.tokenAddress) ctx.output.write('Token:', output.tokenAddress)
      ctx.output.write('Pool:', output.poolAddress, 'tx:', output.txHash)
      if (output.lockBoxAddress) ctx.output.write('LockBox:', output.lockBoxAddress)
      break
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      break
  }

  if (argv.verify) {
    await runVerification(ctx, networkName, verifications, {
      etherscanApiKey: argv.etherscanApiKey,
    })
  }
}
