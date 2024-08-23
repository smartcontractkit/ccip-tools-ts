import { isHexString } from 'ethers'
import util from 'util'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { manualExec, manualExecSenderQueue, showRequests } from './commands.js'
import { loadRpcProviders } from './utils.js'

util.inspect.defaultOptions.depth = 4 // print down to tokenAmounts in requests

async function main() {
  await yargs(hideBin(process.argv))
    .env('CCIP')
    .options({
      rpcs: {
        type: 'array',
        alias: 'r',
        describe: 'List of RPC endpoint URLs, ws[s] or http[s]',
        // default: 'wss://ethereum-sepolia-rpc.publicnode.com',
      },
      'rpcs-file': {
        type: 'string',
        default: './.env',
        describe: 'File containing a list of RPCs endpoints to use',
        // demandOption: true,
        // default: 'wss://rpc.chiadochain.net/wss',
      },
    })
    .coerce('rpcs', (rpcs: (string | number)[] | undefined) =>
      rpcs ? rpcs.map((r) => r.toString()) : <string[]>[],
    )
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
        const providers = await loadRpcProviders(argv)
        return showRequests(providers, argv.tx_hash)
          .catch((err) => console.error(err))
          .finally(() => Object.values(providers).forEach((provider) => provider.destroy()))
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
          })
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => {
        const providers = await loadRpcProviders(argv)
        return manualExec(providers, argv.tx_hash, argv)
          .catch((err) => console.error(err))
          .finally(() => Object.values(providers).forEach((provider) => provider.destroy()))
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
            'exec-failed': {
              type: 'boolean',
              describe: 'Whether to re-execute failed messages (instead of just non-executed)',
            },
          })
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => {
        const providers = await loadRpcProviders(argv)
        return manualExecSenderQueue(providers, argv.tx_hash, argv)
          .catch((err) => console.error(err))
          .finally(() => Object.values(providers).forEach((provider) => provider.destroy()))
      },
    )
    .demandCommand()
    .help()
    .alias({ h: 'help', V: 'version' })
    .parse()
}

void main()
