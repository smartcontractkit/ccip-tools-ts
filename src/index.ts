#!/usr/bin/env -S npx tsx

import { isAddress, isHexString } from 'ethers'
import util from 'util'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { Format, manualExec, manualExecSenderQueue, sendMessage, showRequests } from './commands.js'
import { Providers } from './providers.js'
import { logParsedError } from './utils.js'

util.inspect.defaultOptions.depth = 6 // print down to tokenAmounts in requests

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
        choices: Object.values(Format),
        default: Format.pretty,
      },
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
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => {
        const providers = new Providers(argv)
        return showRequests(providers, argv.tx_hash, argv.format)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .command(
      'manualExec <tx_hash>',
      'execute manually a single message',
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
              default: 0,
            },
            'tokens-gas-limit': {
              type: 'number',
              describe: 'Override gas limit for tokens releaseOrMint calls (0 keeps original)',
              default: 0,
            },
            wallet: {
              type: 'string',
              describe:
                'Encrypted wallet json file path; password will be prompted if not available in USER_KEY_PASSWORD envvar',
            },
          })
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => {
        const providers = new Providers(argv)
        return manualExec(providers, argv.tx_hash, argv)
          .catch((err) => {
            process.exitCode = 1
            if (!logParsedError(err)) console.error(err)
          })
          .finally(() => providers.destroy())
      },
    )
    .command(
      'manualExecSenderQueue <tx_hash>',
      'execute manually all messages since the provided request transaction',
      (yargs) =>
        yargs
          .positional('tx_hash', {
            type: 'string',
            demandOption: true,
            describe: 'transaction hash of the first request to start queue',
          })
          .options({
            'log-index': {
              type: 'number',
              describe: 'Log index of entry message message (if more than one in request tx)',
            },
            'gas-limit': {
              type: 'number',
              describe: "Override gas limit for receivers callback (0 keeps request's)",
              default: 0,
            },
            'tokens-gas-limit': {
              type: 'number',
              describe: 'Override gas limit for tokens releaseOrMint calls (0 keeps original)',
              default: 0,
            },
            'exec-failed': {
              type: 'boolean',
              describe: 'Whether to re-execute failed messages (instead of just non-executed)',
            },
            wallet: {
              type: 'string',
              describe:
                'Encrypted wallet json file path; password will be prompted if not available in USER_KEY_PASSWORD envvar',
            },
          })
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => {
        const providers = new Providers(argv)
        return manualExecSenderQueue(providers, argv.tx_hash, argv)
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
            },
            data: {
              type: 'string',
              describe: 'Data to send in the message',
              example: '0x1234',
            },
            'gas-limit': {
              type: 'number',
              describe:
                'Gas limit for receiver callback execution; defaults to default configured on ramps',
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
            },
            'transfer-tokens': {
              type: 'array',
              string: true,
              describe: 'List of token amounts to transfer to the receiver',
              example: '0xtoken=0.1',
            },
            wallet: {
              type: 'string',
              describe:
                'Encrypted wallet json file path; password will be prompted if not available in USER_KEY_PASSWORD envvar',
            },
          })
          .check(
            ({ router, receiver, 'fee-token': feeToken, 'transfer-tokens': transferTokens }) =>
              isAddress(router) &&
              (!receiver || isAddress(receiver)) &&
              (!feeToken || isAddress(feeToken)) &&
              (!transferTokens ||
                transferTokens.every((t) => /^0x[0-9a-fA-F]{40}=\d+(\.\d+)?$/.test(t))),
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
    .demandCommand()
    .help()
    .alias({ h: 'help', V: 'version' })
    .parse()
}

await main()
