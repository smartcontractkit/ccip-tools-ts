/**
 * Standalone contract-verification command for ALREADY-deployed CCIP v2 contracts
 * (CrossChainToken, BurnMintTokenPool, LockReleaseTokenPool, CrossChainPoolToken, ERC20LockBox).
 *
 * Zero-friction: given just `--contract` + `--address`, it derives the constructor args from the
 * contract's on-chain creation code (stripping the known SDK bytecode). `--constructor-args` and
 * `--creation-tx` are escape hatches. EVM only.
 */

import {
  type EVMChain,
  CCIPChainFamilyUnsupportedError,
  ChainFamily,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'
import { type Ctx } from './types.ts'
import { getCtx, logParsedError } from './utils.ts'
import { deriveEncodedConstructorArgs, runVerification } from './verify-utils.ts'

const DEPLOYABLE = [
  'CrossChainToken',
  'BurnMintTokenPool',
  'LockReleaseTokenPool',
  'CrossChainPoolToken',
  'ERC20LockBox',
  'AdvancedPoolHooks',
] as const

export const command = 'verify'
export const describe = 'Verify an already-deployed CCIP v2 contract on the source-chain explorer'

/**
 * Yargs builder for the verify command.
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
    .option('contract', {
      type: 'string',
      demandOption: true,
      choices: DEPLOYABLE,
      describe: 'Which bundled CCIP v2 contract this address is',
    })
    .option('address', {
      type: 'string',
      demandOption: true,
      describe: 'The deployed contract address',
    })
    .option('constructor-args', {
      type: 'string',
      describe: 'ABI-encoded constructor args (0x-hex). Omit to auto-derive from creation code',
    })
    .option('creation-tx', {
      type: 'string',
      describe:
        'Creation tx hash (used to auto-derive constructor args without an explorer lookup)',
    })
    .option('etherscan-api-key', {
      type: 'string',
      describe: 'Etherscan V2 API key (defaults to ETHERSCAN_API_KEY env)',
    })
    .example([
      [
        'ccip-cli verify -n ethereum-testnet-sepolia --contract CrossChainToken --address 0x302F...',
        'Verify a deployed CrossChainToken (constructor args auto-derived)',
      ],
      [
        'ccip-cli verify -n ethereum-testnet-sepolia --contract BurnMintTokenPool --address 0xb857... --constructor-args 0x...',
        'Verify a pool with explicit constructor args',
      ],
    ])

/**
 * Handler for the verify command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doVerify(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function doVerify(ctx: Ctx, argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const net = networkInfo(argv.network)
  if (net.family !== ChainFamily.EVM) {
    throw new CCIPChainFamilyUnsupportedError(net.family)
  }
  const apiKey = argv.etherscanApiKey ?? process.env.ETHERSCAN_API_KEY
  const chainId = Number(net.chainId)

  let encodedConstructorArgs = argv.constructorArgs
  if (!encodedConstructorArgs) {
    if (!apiKey) {
      ctx.logger.warn(
        'verify: assuming no constructor args (set --constructor-args or an API key to auto-derive)',
      )
    } else {
      const getChain = fetchChainsFromRpcs(ctx, argv)
      const chain = (await getChain(net.name)) as EVMChain
      ctx.logger.info('verify: deriving constructor args from on-chain creation code...')
      encodedConstructorArgs = await deriveEncodedConstructorArgs({
        contract: argv.contract,
        chainId,
        address: argv.address,
        apiKey,
        provider: chain.provider,
        creationTx: argv.creationTx,
      })
    }
  }

  await runVerification(
    ctx,
    net.name,
    [{ contract: argv.contract, address: argv.address, encodedConstructorArgs }],
    { etherscanApiKey: argv.etherscanApiKey },
  )
}
