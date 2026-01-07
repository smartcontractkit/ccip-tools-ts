import { CCIPAPIClient, CCIPApiClientNotAvailableError } from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError, prettyTable } from './utils.ts'

export const command = ['getMessageId <tx-hash>', 'get-message-id <tx-hash>']
export const describe = 'Get CCIP message ID(s) from a transaction hash'
export const aliases = ['msgid']

/**
 * Yargs builder for the get-message-id command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('tx-hash', {
      type: 'string',
      demandOption: true,
      describe: 'Transaction hash (0x-prefixed hex for EVM, Base58 for Solana)',
    })
    .option('api-url', {
      type: 'string',
      describe: 'Custom CCIP API URL (defaults to api.ccip.chain.link)',
    })

/**
 * Handler for the get-message-id command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return getMessageIdCmd(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

/** Exported for testing */
export async function getMessageIdCmd(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx

  // Respect --no-api flag - this command requires API access
  if (argv.noApi) {
    throw new CCIPApiClientNotAvailableError({
      context: {
        reason:
          'The get-message-id command requires API access. Remove --no-api flag to use this command.',
      },
    })
  }

  const apiClient = new CCIPAPIClient(argv.apiUrl, { logger })

  const messageIds = await apiClient.getMessageIdsFromTransaction(argv.txHash)

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(messageIds, null, 2))
      break
    case Format.log:
      logger.log('Message IDs:', messageIds)
      break
    default: {
      if (messageIds.length === 1) {
        prettyTable.call(ctx, {
          'Message ID': messageIds[0],
          Transaction: argv.txHash,
        })
      } else {
        prettyTable.call(ctx, {
          Transaction: argv.txHash,
          'Message Count': messageIds.length,
        })
        messageIds.forEach((id, i) => {
          prettyTable.call(ctx, {
            [`Message ${i + 1}`]: id,
          })
        })
      }
    }
  }
}
