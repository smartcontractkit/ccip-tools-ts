#!/usr/bin/env node

// Redirect console.log/debug/info to stderr before any imports. Third-party libraries (notably
// ethers.js v6) use bare console.log for retry/diagnostic messages, which would pollute stdout
// and break JSON.parse(stdout) for agents. Our own code uses ctx.output (stdout) and ctx.logger (stderr).
// Using `new Console(process.stderr)` preserves Node's exact formatting (util.format, util.inspect,
// format specifiers like %s/%d, color support, etc.) — only the destination stream changes.

const stderrConsole = new console.Console(process.stderr)
console.log = stderrConsole.log.bind(stderrConsole)
console.debug = stderrConsole.debug.bind(stderrConsole)
console.info = stderrConsole.info.bind(stderrConsole)

import { realpathSync } from 'fs'
import { createRequire } from 'module'
import util from 'node:util'
import { pathToFileURL } from 'url'

import updateNotifier from 'update-notifier'
import yargs, { type ArgumentsCamelCase, type InferredOptionTypes } from 'yargs'
import { hideBin } from 'yargs/helpers'

import { Format } from './commands/index.ts'

util.inspect.defaultOptions.depth = 6 // print down to tokenAmounts in requests
// generate:nofail
// `const VERSION = '${require('./package.json').version}-${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}'`
const VERSION = '1.4.2-36cc294'
// generate:end

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { name: string; version: string }

const useColor = !process.env.NO_COLOR && process.stderr.isTTY
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s)
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[39m` : s)
const cyan = (s: string) => (useColor ? `\x1b[36m${s}\x1b[39m` : s)
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[39m` : s)

const FOUR_HOURS = 1000 * 60 * 60 * 4
const notifier = updateNotifier({
  pkg,
  updateCheckInterval: FOUR_HOURS,
  shouldNotifyInNpmScript: true,
})

// Show update notification after command output completes
process.on('exit', () => {
  try {
    notifier.notify({
      defer: false,
      isGlobal: true,
      message:
        `Update available: ${dim('{currentVersion}')} → ${green('{latestVersion}')}\n` +
        `Run ${cyan(`npm install -g ${pkg.name}`)} to update\n` +
        `${yellow('Changelog')}: https://github.com/smartcontractkit/ccip-tools-ts/releases`,
    })
  } catch {
    // never let update check crash the CLI
  }
})

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
  interactive: {
    type: 'boolean',
    default: true,
    describe:
      'Enable interactive prompts (use --no-interactive to disable for automation and AI agents)',
  },
} as const

/** Type for global CLI options. */
export type GlobalOpts = ArgumentsCamelCase<InferredOptionTypes<typeof globalOpts>>

function preprocessArgv(argv: string[]): string[] {
  const result = argv.flatMap((arg) => {
    if (arg === '--no-api') return '--api=false'
    if (arg === '--json') return ['--format', 'json']
    return arg
  })
  if (!process.stdin.isTTY && !result.includes('--no-interactive')) result.push('--no-interactive')
  return result
}

async function main() {
  await yargs(preprocessArgv(hideBin(process.argv)))
    .scriptName(process.env.CLI_NAME || 'ccip-cli')
    .env('CCIP')
    .options(globalOpts)
    .check((_argv) => {
      const raw = process.argv
      const hasJson = raw.includes('--json')
      const hasFormat = raw.some((a) => a === '--format' || a === '-f' || a.startsWith('--format='))
      if (hasJson && hasFormat) throw new Error('--json and --format are mutually exclusive')
      return true
    })
    .commandDir('commands', {
      extensions: [new URL(import.meta.url).pathname.split('.').pop()!],
      exclude: /\.test\.[tj]s$/,
    })
    .completion()
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
