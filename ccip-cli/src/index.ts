#!/usr/bin/env node
import util from 'node:util'

import yargs, { type InferredOptionTypes } from 'yargs'
import { hideBin } from 'yargs/helpers'

import { Format } from './commands/index.ts'

util.inspect.defaultOptions.depth = 6 // print down to tokenAmounts in requests
// generate:nofail
// `const VERSION = '${require('./package.json').version}-${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}'`
const VERSION = '0.90.0-278411e'
// generate:end

const globalOpts = {
  rpcs: {
    type: 'array',
    alias: 'r',
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
    default: 10_000,
  },
} as const

export type GlobalOpts = InferredOptionTypes<typeof globalOpts>

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName(process.env.CLI_NAME || 'ccip-cli')
    .env('CCIP')
    .options(globalOpts)
    .middleware((argv) => {
      if (!argv.verbose) {
        console.debug = () => {}
      }
    })
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

await main()
