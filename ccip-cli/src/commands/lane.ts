import { bigIntReplacer, discoverOffRamp, networkInfo } from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError, prettyTable } from './utils.ts'
import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = ['lane', 'get-lane']
export const describe = 'Show OnRamp and OffRamp configs for a CCIP lane between two chains'

/**
 * Yargs builder for the lane command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('source', {
      alias: 's',
      type: 'string',
      demandOption: true,
      describe: 'Source network: chainId or name (e.g., ethereum-mainnet)',
    })
    .option('dest', {
      alias: 'd',
      type: 'string',
      demandOption: true,
      describe: 'Destination network: chainId or name',
    })
    .option('router', {
      alias: ['r', 'a', 'address'],
      type: 'string',
      demandOption: true,
      describe: 'Router or OnRamp contract address on source chain',
    })
    .example([
      [
        'ccip-cli lane -s ethereum-mainnet -d avalanche-mainnet -r 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
        'Show lane config via router address',
      ],
      [
        'ccip-cli lane -s ethereum-testnet-sepolia -d avalanche-testnet-fuji -r 0x12492154714fBD28F28219f6fc4315d19de1025B',
        'Show lane config via OnRamp address',
      ],
    ])

/**
 * Handler for the lane command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return getLane(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function getLane(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { output, logger } = ctx
  const sourceNetwork = networkInfo(argv.source)
  const destNetwork = networkInfo(argv.dest)

  const getChain = fetchChainsFromRpcs(ctx, argv)
  const [source, dest] = await Promise.all([
    getChain(sourceNetwork.name),
    getChain(destNetwork.name),
  ])

  // Resolve router-or-onramp: if typeAndVersion identifies it as a Router, fetch the OnRamp.
  // typeAndVersion may throw for chains where the address format requires a module suffix
  // (e.g., bare Aptos package address) — in that case we treat the address as an OnRamp directly.
  let onRamp = argv.router
  try {
    const [type] = await source.typeAndVersion(argv.router)
    if (type === 'Router') {
      onRamp = await source.getOnRampForRouter(argv.router, dest.network.chainSelector)
      logger.debug('Resolved OnRamp from Router:', onRamp)
    }
  } catch (_) {
    // treat as OnRamp
  }

  const [onRampConfig, offRamp] = await Promise.all([
    source.getOnRampConfig(onRamp, dest.network.chainSelector),
    discoverOffRamp(source, dest, onRamp, ctx),
  ])

  const offRampConfig = await dest.getOffRampConfig(offRamp, source.network.chainSelector)

  switch (argv.format) {
    case Format.json:
      output.write(
        JSON.stringify(
          {
            source: sourceNetwork.name,
            dest: destNetwork.name,
            onRamp,
            onRampConfig,
            offRamp,
            offRampConfig,
          },
          bigIntReplacer,
          2,
        ),
      )
      break
    case Format.log:
      output.write('onRamp:', onRamp)
      output.write('onRampConfig =', onRampConfig)
      output.write('offRamp:', offRamp)
      output.write('offRampConfig =', offRampConfig)
      break
    default: // pretty
      output.write(`OnRamp (${sourceNetwork.name}):`)
      prettyTable.call(ctx, { onRamp, ...onRampConfig })
      output.write(`OffRamp (${destNetwork.name}):`)
      prettyTable.call(ctx, { offRamp, ...offRampConfig })
  }
}
