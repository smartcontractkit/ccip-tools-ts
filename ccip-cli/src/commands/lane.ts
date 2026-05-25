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

  // In JSON mode, accumulate into a single envelope so JSON.parse(stdout) works.
  const jsonEnvelope: Record<string, unknown> | undefined =
    argv.format === Format.json ? {} : undefined
  const emitJsonEnvelope = () => {
    if (jsonEnvelope) output.write(JSON.stringify(jsonEnvelope, bigIntReplacer, 2))
  }

  const source = await getChain(sourceNetwork.name)

  // Resolve router-or-onramp: if typeAndVersion identifies it as a Router, fetch the OnRamp.
  // typeAndVersion may throw for chains where the address format requires a module suffix
  // (e.g., bare Aptos package address) — in that case we treat the address as an OnRamp directly.
  let onRamp = argv.router
  try {
    const [type] = await source.typeAndVersion(argv.router)
    if (type === 'Router') {
      onRamp = await source.getOnRampForRouter(argv.router, destNetwork.chainSelector)
      logger.debug('Resolved OnRamp from Router:', onRamp)
    }
  } catch (_) {
    // treat as OnRamp
  }

  const onRampConfig = await source.getOnRampConfig(onRamp, destNetwork.chainSelector)

  switch (argv.format) {
    case Format.log:
      output.write('onRamp:', onRamp)
      output.write('onRampConfig =', onRampConfig)
      break
    case Format.pretty:
      output.write(`OnRamp (${sourceNetwork.name}) [${sourceNetwork.family}]:`)
      prettyTable.call(ctx, { onRamp, ...onRampConfig })
      break
    default:
      if (jsonEnvelope) {
        jsonEnvelope.source = sourceNetwork.name
        jsonEnvelope.dest = destNetwork.name
        jsonEnvelope.onRamp = onRamp
        jsonEnvelope.onRampConfig = onRampConfig
      }
  }

  let dest
  try {
    dest = await getChain(destNetwork.name)
  } catch (err) {
    logger.debug('No dest RPC available for', destNetwork.name, '—', err)
    emitJsonEnvelope()
    throw err
  }

  let offRamp: string
  try {
    offRamp = await discoverOffRamp(source, dest, onRamp, ctx)
  } catch (err) {
    logger.debug('No offRamp found for', onRamp, '—', err)
    emitJsonEnvelope()
    throw err
  }

  let offRampConfig
  try {
    offRampConfig = await dest.getOffRampConfig(offRamp, source.network.chainSelector)
  } catch (err) {
    logger.debug('Failed to fetch offRamp config for', offRamp, '—', err)
    emitJsonEnvelope()
    throw err
  }

  switch (argv.format) {
    case Format.log:
      output.write('offRamp:', offRamp)
      output.write('offRampConfig =', offRampConfig)
      break
    case Format.pretty:
      output.write(`OffRamp (${destNetwork.name}) [${destNetwork.family}]:`)
      prettyTable.call(ctx, { offRamp, ...offRampConfig })
      break
    default:
      if (jsonEnvelope) {
        jsonEnvelope.offRamp = offRamp
        jsonEnvelope.offRampConfig = offRampConfig
      }
  }

  emitJsonEnvelope()
}
