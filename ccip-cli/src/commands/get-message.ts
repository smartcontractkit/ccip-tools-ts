import {
  CCIPAPIClient,
  CCIPApiClientNotAvailableError,
  bigIntReplacer,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { formatDuration, getCtx, logParsedError, prettyTable } from './utils.ts'

export const command = ['getMessage <message-id>', 'get-message <message-id>']
export const describe = 'Fetch CCIP message details by message ID from the API'
export const aliases = ['msg']

/**
 * Yargs builder for the getMessage command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('message-id', {
      type: 'string',
      demandOption: true,
      describe: 'Message ID (0x prefix + 64 hex characters)',
    })
    .option('api-url', {
      type: 'string',
      describe: 'Custom CCIP API URL (defaults to api.ccip.chain.link)',
    })

/**
 * Handler for the getMessage command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return getMessageByIdCmd(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

/** Exported for testing */
export async function getMessageByIdCmd(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx

  // Respect --no-api flag - this command requires API access
  if (argv.noApi) {
    throw new CCIPApiClientNotAvailableError({
      context: {
        reason:
          'The getMessage command requires API access. Remove --no-api flag to use this command.',
      },
    })
  }

  const apiClient = new CCIPAPIClient(argv.apiUrl, { logger })

  const result = await apiClient.getMessageById(argv.messageId)

  switch (argv.format) {
    case Format.json:
      logger.log(JSON.stringify(result, bigIntReplacer, 2))
      break
    case Format.log:
      logger.log('Message:', result)
      break
    default: {
      const sendTimestamp = result.tx.timestamp
      const receiptTimestamp = result.receiptTimestamp

      prettyTable.call(ctx, {
        Status: result.status,
        'Message ID': result.message.messageId,
        Source: `${result.sourceNetworkInfo.name} [${result.sourceNetworkInfo.chainSelector}]`,
        Destination: `${result.destNetworkInfo.name} [${result.destNetworkInfo.chainSelector}]`,
        Sender: result.message.sender,
        Receiver: result.message.receiver,
        'Send Tx': result.tx.hash,
        ...(sendTimestamp
          ? {
              'Send Time': `${formatTimestamp(sendTimestamp)} (${formatDuration(Date.now() / 1e3 - sendTimestamp)} ago)`,
            }
          : {}),
        ...(result.receiptTransactionHash ? { 'Receipt Tx': result.receiptTransactionHash } : {}),
        ...(receiptTimestamp && sendTimestamp
          ? {
              'Delivery Time': `${formatDuration(receiptTimestamp - sendTimestamp)}`,
            }
          : {}),
        Finality: result.finality,
        'Ready for Manual Exec': result.readyForManualExecution,
        Version: result.lane.version,
      })
    }
  }
}

/**
 * Format Unix timestamp to readable date string.
 * @param timestamp - Unix timestamp in seconds.
 * @returns Formatted date string.
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1e3).toISOString().substring(0, 19).replace('T', ' ')
}
