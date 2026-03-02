#!/usr/bin/env node
import { realpathSync } from 'fs'
import util from 'node:util'
import { pathToFileURL } from 'url'

import yargs, { type ArgumentsCamelCase, type InferredOptionTypes } from 'yargs'
import { hideBin } from 'yargs/helpers'

import { Format } from './commands/index.ts'

util.inspect.defaultOptions.depth = 6 // print down to tokenAmounts in requests
// generate:nofail
// `const VERSION = '${require('./package.json').version}-${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}'`
const VERSION = '1.0.0-793305b'
// generate:end

const globalOpts = {
  rpcs: {
    type: 'array',
    alias: 'rpc',
    describe: 'List of RPC endpoint URLs, ws[s] or http[s]',
    string: true,
  },
  'rpcs-file': {
    type: 'string',
    default: './.env',
    describe: 'File containing a list of RPCs endpoints to use',
    // demandOption: true,
  },
  format: {
    alias: 'f',
    describe: "Output to console format: pretty tables, node's console.log or JSON",
    choices: Object.values(Format),
    default: Format.pretty,
  },
  verbose: {
    alias: 'v',
    describe: 'enable debug logging',
    type: 'boolean',
  },
  page: {
    type: 'number',
    describe: 'getLogs page/range size',
  },
  api: {
    type: 'string',
    describe: 'CCIP API URL (use --no-api to disable, enabled by default)',
    defaultDescription: 'true',
    coerce: (arg: string | undefined): string | boolean => {
      if (arg === 'false' || arg === 'no') return false
      if (arg == null || arg === 'true' || arg === 'yes') return true
      return arg // it's a URL string
    },
  },
} as const

/** Type for global CLI options. */
export type GlobalOpts = ArgumentsCamelCase<InferredOptionTypes<typeof globalOpts>>

function preprocessArgv(argv: string[]): string[] {
  return argv.map((arg) => {
    if (arg === '--no-api') {
      return '--api=false'
    }
    return arg
  })
}

async function main() {
  await yargs(preprocessArgv(hideBin(process.argv)))
    .scriptName(process.env.CLI_NAME || 'ccip-cli')
    .env('CCIP')
    .options(globalOpts)
    .commandDir('commands', {
      extensions: [new URL(import.meta.url).pathname.split('.').pop()!],
      exclude: /\.test\.[tj]s$/,
    })
    .demandCommand()
    .strict()
    .help()
    .version(VERSION)
    .alias({ h: 'help', V: 'version' })
    .parse()
}

function wasCalledAsScript() {
  const realPath = realpathSync(process.argv[1]!)
  const realPathAsUrl = pathToFileURL(realPath).href
  return import.meta.url === realPathAsUrl
}

if (import.meta.main || wasCalledAsScript()) {
  const later = setTimeout(() => {}, 2 ** 31 - 1) // keep event-loop alive
  await main()
    .catch((err) => {
      console.error(err)
      throw err
    })
    .finally(() => {
      clearTimeout(later)
      setTimeout(() => {
        util.inspect.defaultOptions.depth = 2
        console.debug(
          'Pending handles after main completion:',
          (process as any)._getActiveHandles().length, // eslint-disable-line
        )
        process.exit()
      }, 5e3).unref()
    })
}
