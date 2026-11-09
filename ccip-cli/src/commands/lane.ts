import {
  type CCIPVersion,
  discoverOffRamp,
  jsonStringify,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'
import { type Ctx, Format } from './types.ts'
import { formatDisplayAddress, getCtx, logParsedError, prettyFormat, prettyTable } from './utils.ts'

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
    .option('lane-version', {
      type: 'string',
      choices: ['1.2', '1.5', '1.6', '2.0'],
      describe:
        'CCIP version of the lane, for an OnRamp that serves more than one (e.g. a Solana 2.0 Router also serves 1.6 lanes). Default: the OnRamp version',
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
      [
        'ccip-cli lane -s solana-devnet -d ethereum-testnet-sepolia -r Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C --lane-version 1.6',
        'Show the 1.6 lane of a Solana 2.0 Router',
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
    if (jsonEnvelope) output.write(jsonStringify(jsonEnvelope, 2))
  }

  const source = await getChain(sourceNetwork.name)

  // Resolve router-or-onramp: if typeAndVersion identifies it as a Router (or
  // a family-specific router handle like Sui's `StateObjectRouter`), fetch the
  // OnRamp. If typeAndVersion doesn't answer, treat the address as an OnRamp.
  let onRamp = argv.router
  try {
    const [type] = await source.typeAndVersion(argv.router)
    if (type.includes('Router')) {
      onRamp = await source.getOnRampForRouter(argv.router, destNetwork.chainSelector)
      logger.debug('Resolved OnRamp from Router:', onRamp)
    }
  } catch (_) {
    // typeAndVersion unavailable for this address form: treat it as an OnRamp.
  }

  // an OnRamp can serve more than one lane version (e.g. a Solana 2.0 Router also serves 1.6)
  const laneVersion = argv.laneVersion ? (`${argv.laneVersion}.0` as CCIPVersion) : undefined
  const onRampConfig = await source.getOnRampConfig(
    onRamp,
    destNetwork.chainSelector,
    laneVersion ? { version: laneVersion } : undefined,
  )
  // the lane version: both lanes of a Solana 2.0 Router report the same contract typeAndVersion
  const version = laneVersion || ((await source.typeAndVersion(onRamp))[1] as CCIPVersion)

  switch (argv.format) {
    case Format.log:
      output.write('onRamp:', onRamp)
      output.write('version:', version)
      output.write('onRampConfig =', onRampConfig)
      break
    case Format.pretty: {
      output.write(`OnRamp (${sourceNetwork.name}) [${sourceNetwork.family}]:`)
      // offRamp/offramp (v2 configs) are dest-chain addresses
      const { version: _accountVersion, ...configRows } = prettyFormat(
        onRampConfig,
        sourceNetwork.family,
        { offRamp: destNetwork.family, offramp: destNetwork.family },
      ) as Record<string, unknown>
      // the lane version replaces the config's own `version` row (e.g. a Solana account layout
      // version), which identifies neither the lane nor the contract
      prettyTable.call(ctx, {
        onRamp: formatDisplayAddress(onRamp, sourceNetwork.family),
        version,
        ...configRows,
      })
      break
    }
    default:
      if (jsonEnvelope) {
        jsonEnvelope.source = sourceNetwork.name
        jsonEnvelope.dest = destNetwork.name
        jsonEnvelope.onRamp = onRamp
        jsonEnvelope.version = version
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
    offRamp = await discoverOffRamp(source, dest, { onRamp, version }, ctx)
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
      prettyTable.call(ctx, {
        offRamp: formatDisplayAddress(offRamp, destNetwork.family),
        // onRamps accepted by the offRamp are source-chain addresses
        ...(prettyFormat(offRampConfig, destNetwork.family, {
          onRamps: sourceNetwork.family,
        }) as Record<string, unknown>),
      })
      break
    default:
      if (jsonEnvelope) {
        jsonEnvelope.offRamp = offRamp
        jsonEnvelope.offRampConfig = offRampConfig
      }
  }

  emitJsonEnvelope()
}
