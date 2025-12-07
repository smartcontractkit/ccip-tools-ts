import { bigIntReplacer, supportedChains } from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { getCtx, prettyTable } from './utils.ts'

export const command = ['parse <data>', 'parseBytes <data>', 'parseData <data>']
export const describe =
  'Try to parse and print errors, revert reasons or function call or event data'

/**
 * Yargs builder for the parse command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs.positional('data', {
    type: 'string',
    demandOption: true,
    describe: 'router contract address on source',
  })

/**
 * Handler for the parse command.
 * @param argv - Command line arguments.
 */
export function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [, ctx] = getCtx(argv)
  try {
    parseBytes(ctx, argv)
  } catch (err) {
    process.exitCode = 1
    ctx.logger.error(err)
  }
}

function parseBytes(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx
  let parsed
  for (const chain of Object.values(supportedChains)) {
    try {
      parsed = chain.parse?.(argv.data)
      if (parsed) break
    } catch (_) {
      // pass
    }
  }
  if (!parsed) throw new Error('Unknown data')

  switch (argv.format) {
    case Format.log: {
      logger.log(`parsed =`, parsed)
      break
    }
    case Format.pretty:
      prettyTable.call(ctx, parsed)
      break
    case Format.json:
      logger.info(JSON.stringify(parsed, bigIntReplacer, 2))
      break
  }
}
