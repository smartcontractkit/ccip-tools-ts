#!/usr/bin/env -S npx tsx
import util from 'util'

import { ZeroAddress, isAddress, isHexString } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
  Format,
  estimateGas,
  manualExec,
  manualExecSenderQueue,
  parseData,
  sendMessage,
  showRequests,
} from './commands.js'
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
      verbose: {
        alias: 'v',
        type: 'boolean',
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
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
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
                'Encrypted wallet json file path; password will be prompted if not available in USER_KEY_PASSWORD envvar',
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
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
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
            },
            sender: {
              type: 'string',
              describe: 'Sender address of the message (passed to receiver)',
              default: ZeroAddress,
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
          .check(({ router }) => isAddress(router))
          .check(({ receiver }) => isAddress(receiver))
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
      'parseData <data>',
      'try to parse and print errors, revert reasons or function call data',
      (yargs) =>
        yargs
          .positional('data', {
            type: 'string',
            demandOption: true,
            describe: 'router contract address on source',
          })
          .check(({ data }) => isHexString(data)),
      (argv) => {
        try {
          parseData(argv.data)
        } catch (err) {
          process.exitCode = 1
          console.error(err)
        }
      },
    )
    .demandCommand()
    .strict()
    .help()
    .alias({ h: 'help', V: 'version' })
    .parse()
}

await main()
