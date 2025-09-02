#!/usr/bin/env -S npx tsx
import util from 'util'

import { ZeroAddress, getAddress } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
  Format,
  estimateGas,
  manualExec,
  manualExecSenderQueue,
  parseBytes,
  sendMessage,
  showLaneConfigs,
  showRequests,
  showSupportedTokens,
} from './commands/index.ts'
import { logParsedError, validateSupportedTxHash } from './commands/utils.ts'
import { Providers } from './providers.ts'

util.inspect.defaultOptions.depth = 6 // print down to tokenAmounts in requests
// generate:nofail
// `const VERSION = '${require('./package.json').version}-${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}'`
const VERSION = '0.2.9-3226323'
// generate:end

async function main() {
  await yargs(hideBin(process.argv))
    .env('CCIP')
    .options({
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
    })
    .middleware((argv) => {
      if (!argv.verbose) {
        console.debug = () => {}
      }
    })
    .command(
      ['show <tx_hash>', '*'],
      'show CCIP messages info',
      (yargs) =>
        yargs
          .positional('tx_hash', {
            type: 'string',
            demandOption: true,
            describe: 'transaction hash of the request (source) message',
          })
          .options({
            'log-index': {
              type: 'number',
              describe: 'Log index of message to select to know more, instead of prompting',
            },
            'id-from-source': {
              type: 'string',
              describe:
                'Search by messageId instead of tx_hash; requires specifying source network (by id or name)',
            },
          })
          .check(({ tx_hash }) => validateSupportedTxHash(tx_hash)),
      async (argv) => {
        const providers = new Providers(argv)
        return showRequests(providers, argv.tx_hash, argv)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .command(
      'manualExec <tx_hash>',
      'execute manually pending or failed messages',
      (yargs) =>
        yargs
          .positional('tx_hash', {
            type: 'string',
            demandOption: true,
            describe: 'transaction hash of the request (source) message',
          })
          .options({
            'log-index': {
              type: 'number',
              describe: 'Log index of message to execute (if more than one in request tx)',
            },
            'gas-limit': {
              type: 'number',
              describe: 'Override gas limit for receivers callback (0 keeps original)',
            },
            'tokens-gas-limit': {
              type: 'number',
              describe: 'Override gas limit for tokens releaseOrMint calls (0 keeps original)',
            },
            'estimate-gas-limit': {
              type: 'number',
              describe:
                'Estimate gas limit for receivers callback; argument is a % margin to add to the estimate',
              example: '10',
              conflicts: 'gas-limit',
            },
            wallet: {
              type: 'string',
              describe:
                'Encrypted wallet json file path; password will be prompted if not available in USER_KEY_PASSWORD envvar; also supports `ledger[:<derivationPath>]` hardwallet',
            },
            'solana-offramp': {
              type: 'string',
              describe:
                'Solana offramp. Must be provided for when Solana is destination, until automated discovery is implemented.',
            },
            'solana-router': {
              type: 'string',
              describe:
                'Solana router. Must be provided for when Solana is source, until automated discovery is implemented.',
            },
            'solana-keypair': {
              type: 'string',
              describe:
                'Location of the solana keypair to use for manual execution. Defaults to ~/.config/solana/id.json',
            },
            'solana-force-buffer': {
              type: 'boolean',
              describe: 'Forces the usage of buffering for Solana manual execution.',
              default: false,
            },
            'solana-force-lookup-table': {
              type: 'boolean',
              describe:
                'Forces the creation & usage of an ad-hoc lookup table for Solana manual execution.',
              default: false,
            },
            'solana-clear-buffer-first': {
              type: 'boolean',
              describe: 'Forces clearing the buffer (if a previous attempt was aborted).',
              default: false,
            },
            'solana-cu-limit': {
              type: 'number',
              describe:
                "Overrides Solana manual execution CU limit. Likely necessary for buffered transactions as they aren't estimated.",
            },
            'sender-queue': {
              type: 'boolean',
              describe: 'Execute all messages in sender queue, starting with the provided tx',
              default: false,
            },
            'exec-failed': {
              type: 'boolean',
              describe: 'Whether to re-execute failed messages (instead of just non-executed)',
              implies: 'sender-queue',
            },
          })
          .check(({ tx_hash }) => validateSupportedTxHash(tx_hash)),
      async (argv) => {
        const providers = new Providers(argv)
        return (
          argv.senderQueue
            ? manualExecSenderQueue(providers, argv.tx_hash, argv)
            : manualExec(providers, argv.tx_hash, argv)
        )
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .command(
      'send <source> <router> <dest>',
      'send a CCIP message from router on source to dest',
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
              describe: 'Receiver of the message; defaults to the sender wallet address',
              coerce: getAddress,
            },
            data: {
              type: 'string',
              describe: 'Data to send in the message (non-hex will be utf-8 encoded)',
              example: '0x1234',
            },
            'gas-limit': {
              type: 'number',
              describe:
                'Gas limit for receiver callback execution; defaults to default configured on ramps',
            },
            'estimate-gas-limit': {
              type: 'number',
              describe:
                'Estimate gas limit for receiver callback execution; argument is a % margin to add to the estimate',
              example: '10',
              conflicts: 'gas-limit',
            },
            'allow-out-of-order-exec': {
              type: 'boolean',
              describe:
                'Allow execution of messages out of order (i.e. sender nonce not enforced, only v1.5+ lanes)',
            },
            'fee-token': {
              type: 'string',
              describe:
                'Address of the fee token (e.g. LINK address on source); if not provided, will pay in native',
              coerce: getAddress,
            },
            'transfer-tokens': {
              type: 'array',
              string: true,
              describe: 'List of token amounts (on source) to transfer to the receiver',
              example: '0xtoken=0.1',
            },
            wallet: {
              type: 'string',
              describe:
                'Encrypted wallet json file path; password will be prompted if not provided in USER_KEY_PASSWORD envvar',
            },
          })
          .check(
            ({ 'transfer-tokens': transferTokens }) =>
              !transferTokens ||
              transferTokens.every((t) => /^0x[0-9a-fA-F]{40}=\d+(\.\d+)?$/.test(t)),
          ),
      async (argv) => {
        const providers = new Providers(argv)
        return sendMessage(providers, argv)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
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
      ['parseBytes <data>', 'parseData <data>', 'parse <data>'],
      'try to parse and print errors, revert reasons or function call data',
      (yargs) =>
        yargs
          .positional('data', {
            type: 'string',
            demandOption: true,
            describe: 'router contract address on source',
          })
          .options({
            selector: {
              type: 'string',
              describe: 'Event, Error, Function name or topicHash to parse data as',
            },
          })
          .alias({ event: 'selector' }),
      (argv) => {
        try {
          parseBytes(argv)
        } catch (err) {
          process.exitCode = 1
          console.error(err)
        }
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
