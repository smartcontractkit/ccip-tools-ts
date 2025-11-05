#!/usr/bin/env -S npx tsx
import util from 'util'

import { ZeroAddress, getAddress } from 'ethers'
import yargs, { type InferredOptionTypes } from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
  Format,
  estimateGas,
  parseBytes,
  showLaneConfigs,
  showSupportedTokens,
} from './commands/index.ts'
import { logParsedError } from './commands/utils.ts'

util.inspect.defaultOptions.depth = 6 // print down to tokenAmounts in requests
// generate:nofail
// `const VERSION = '${require('./package.json').version}-${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}'`
const VERSION = '0.2.11-869a810'
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
    .env('CCIP')
    .options(globalOpts)
    .middleware((argv) => {
      if (!argv.verbose) {
        console.debug = () => {}
      }
    })
    .commandDir('commands', {
      extensions: ['ts'],
      include: /\b(show|send|manual-exec|parse)\.ts$/,
    })
    .command(
      'estimateGas <source> <router> <dest>',
      'estimate gasLimit for a CCIP message to be executed on receiver on dest',
      (yargs) =>
        yargs
          .positional('source', {
            type: 'string',
            demandOption: true,
            describe: 'source network, chainId or name',
            example: 'ethereum-testnet-sepolia',
          })
          .positional('router', {
            type: 'string',
            demandOption: true,
            describe: 'router contract address on source',
            coerce: getAddress,
          })
          .positional('dest', {
            type: 'string',
            demandOption: true,
            describe: 'destination network, chainId or name',
            example: 'ethereum-testnet-sepolia-arbitrum-1',
          })
          .options({
            receiver: {
              type: 'string',
              demandOption: true,
              describe: 'Receiver contract address (on dest, implementing ccipReceive)',
              coerce: getAddress,
            },
            sender: {
              type: 'string',
              describe: 'Sender address of the message (passed to receiver)',
              default: ZeroAddress,
              coerce: getAddress,
            },
            data: {
              type: 'string',
              describe: 'Data to send in the message',
              example: '0x1234',
            },
            'transfer-tokens': {
              type: 'array',
              string: true,
              describe: 'List of token amounts (on source) to transfer to the receiver',
              example: '0xtoken=0.1',
            },
          })
          .check(
            ({ 'transfer-tokens': transferTokens }) =>
              !transferTokens ||
              transferTokens.every((t) => /^0x[0-9a-fA-F]{40}=\d+(\.\d+)?$/.test(t)),
          ),
      async (argv) => {
        const providers = new Providers(argv)
        return estimateGas(providers, argv)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .command(
      'lane <source> <onramp_or_router> <dest>',
      'show CCIP ramps info and configs',
      (yargs) =>
        yargs
          .positional('source', {
            type: 'string',
            demandOption: true,
            describe: 'Source chain name or id',
          })
          .positional('onramp_or_router', {
            type: 'string',
            demandOption: true,
            describe: 'onramp (if dest is not provided) or source router',
            coerce: getAddress,
          })
          .positional('dest', {
            type: 'string',
            demandOption: true,
            describe: 'Dest chain name or id (implies previous arg is router)',
          }),
      async (argv) => {
        const providers = new Providers(argv)
        return showLaneConfigs(providers, argv)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .command(
      'getSupportedTokens <source> <router> <dest>',
      'show supported tokens for cross-chain transfers',
      (yargs) =>
        yargs
          .positional('source', {
            type: 'string',
            demandOption: true,
            describe: 'Source chain name or id',
            example: 'ethereum-testnet-sepolia',
          })
          .positional('router', {
            type: 'string',
            demandOption: true,
            describe: 'router contract address on source',
            coerce: getAddress,
          })
          .positional('dest', {
            type: 'string',
            demandOption: true,
            describe: 'Destination chain name or id',
            example: 'ethereum-testnet-sepolia-optimism-1',
          }),
      async (argv) => {
        const providers = new Providers(argv)
        return showSupportedTokens(providers, argv)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .demandCommand()
    .strict()
    .help()
    .version(VERSION)
    .alias({ h: 'help', V: 'version' })
    .parse()
}

await main()
