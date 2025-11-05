import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { Format } from './types.ts'
import { prettyTable } from './utils.ts'
import { bigIntReplacer, supportedChains } from '../lib/index.ts'

export const command = ['parse <data>', 'parseBytes <data>', 'parseData <data>']
export const describe =
  'Try to parse and print errors, revert reasons or function call or event data'

export const builder = (yargs: Argv) =>
  yargs.positional('data', {
    type: 'string',
    demandOption: true,
    describe: 'router contract address on source',
  })

export function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  try {
    parseBytes(argv)
  } catch (err) {
    process.exitCode = 1
    console.error(err)
  }
}

export function parseBytes(argv: Parameters<typeof handler>[0]) {
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
      console.log(`parsed =`, parsed)
      break
    }
    case Format.pretty:
      prettyTable(parsed)
      break
    case Format.json:
      console.info(JSON.stringify(parsed, bigIntReplacer, 2))
      break
  }
}
