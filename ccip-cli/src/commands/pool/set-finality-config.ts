/**
 * Pool set-finality-config subcommand.
 * Sets the allowed-finality config on a CCIP token pool (EVM v2.0+ only).
 */

import {
  type Chain,
  type EVMChain,
  type SetAllowedFinalityConfigParams,
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

export const command = 'set-finality-config'
export const describe = 'Set the allowed-finality config on a CCIP token pool (EVM v2.0+ only)'

/**
 * Yargs builder for the pool set-finality-config subcommand.
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
    .option('finality', {
      type: 'string',
      demandOption: true,
      describe:
        'Allowed finality: "finalized" (full finality), "safe" (safe head), or a block depth NUMBER [0-65535] for Faster-Than-Finality',
    })
    .example([
      [
        'ccip-cli pool set-finality-config -n sepolia --pool-address 0x... --finality finalized',
        'Require full finality',
      ],
      [
        'ccip-cli pool set-finality-config -n sepolia --pool-address 0x... --finality 5',
        'Allow Faster-Than-Finality down to 5 block confirmations',
      ],
    ])

/**
 * Handler for the pool set-finality-config subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return doSetFinalityConfig(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

type SetFinalityConfigArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/** Parses the --finality flag into the SDK finality value. */
function parseFinality(input: string): SetAllowedFinalityConfigParams['finality'] {
  const normalized = input.trim().toLowerCase()
  if (normalized === 'finalized') return 'finalized'
  if (normalized === 'safe') return 'safe'
  const depth = Number(normalized)
  if (!Number.isInteger(depth) || depth < 0 || depth > 65535) {
    throw new CCIPArgumentInvalidError(
      'finality',
      'must be "finalized", "safe", or a block depth integer between 0 and 65535',
    )
  }
  return depth
}

/** Calls setAllowedFinalityConfig on the appropriate chain-family admin (EVM v2.0+ only). */
function setForChain(chain: Chain, wallet: unknown, params: SetAllowedFinalityConfigParams) {
  switch (chain.network.family) {
    case ChainFamily.EVM: {
      const evmChain = chain as EVMChain
      const admin = new EVMTokenAdmin(evmChain.provider, evmChain.network, {
        logger: evmChain.logger,
      })
      return admin.setAllowedFinalityConfig(wallet, params)
    }
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}

async function doSetFinalityConfig(ctx: Ctx, argv: SetFinalityConfigArgv) {
  const { logger } = ctx
  const networkName = networkInfo(argv.network).name
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const chain = await getChain(networkName)

  const params: SetAllowedFinalityConfigParams = {
    poolAddress: argv.poolAddress,
    finality: parseFinality(argv.finality),
  }

  logger.debug(
    `Setting allowed finality config: pool=${params.poolAddress}, finality=${argv.finality}`,
  )

  const [, wallet] = await loadChainWallet(chain, argv)
  const result = await setForChain(chain, wallet, params)

  const output: Record<string, string> = {
    network: networkName,
    poolAddress: params.poolAddress,
    finality: argv.finality,
    txHash: result.txHash,
  }

  switch (argv.format) {
    case Format.json:
      ctx.output.write(JSON.stringify(output, null, 2))
      return
    case Format.log:
      ctx.output.write('Allowed finality config updated, tx:', result.txHash)
      return
    case Format.pretty:
    default:
      prettyTable.call(ctx, output)
      return
  }
}
