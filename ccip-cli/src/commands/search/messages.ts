/**
 * CCIP CLI Search Messages Subcommand
 *
 * Searches CCIP messages via the API with filters for sender, receiver,
 * source/destination chains, and manual execution eligibility.
 *
 * @example
 * ```bash
 * # Search by sender address
 * ccip-cli search messages --sender 0x9d087fC03ae39b088326b67fA3C788236645b717
 *
 * # Search by lane
 * ccip-cli search messages --source ethereum-mainnet --dest arbitrum-mainnet
 *
 * # Filter by source token address
 * ccip-cli search messages --source-token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 *
 * # Find stuck messages ready for manual execution
 * ccip-cli search messages --manual-exec-only --limit 10
 *
 * # Positional sender shorthand
 * ccip-cli search messages 0x9d087fC03ae39b088326b67fA3C788236645b717
 * ```
 *
 * @packageDocumentation
 */

import {
  type MessageSearchResult,
  CCIPAPIClient,
  CCIPApiClientNotAvailableError,
  bigIntReplacer,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { select } from '@inquirer/prompts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../../index.ts'
import { type Ctx, Format } from '../types.ts'
import { getCtx, logParsedError, prettyRequest, prettyTable, withDateTimestamp } from '../utils.ts'

export const command = ['messages [sender]', 'msgs [sender]']
export const describe = 'Search CCIP messages'

const MENU_QUIT = -1 as const
const LARGE_RESULT_THRESHOLD = 1_000

/**
 * Yargs builder for the search messages subcommand.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('sender', {
      type: 'string',
      describe: 'Filter by sender address',
    })
    .options({
      receiver: {
        type: 'string',
        describe: 'Filter by receiver address',
      },
      source: {
        alias: 's',
        type: 'string',
        describe: 'Source chain (name, chainId, or selector)',
      },
      dest: {
        alias: 'd',
        type: 'string',
        describe: 'Destination chain (name, chainId, or selector)',
      },
      'source-token': {
        type: 'string',
        describe: 'Filter by source token address',
      },
      'manual-exec-only': {
        type: 'boolean',
        default: false,
        describe: 'Only messages ready for manual execution',
      },
      limit: {
        type: 'number',
        default: 20,
        describe: 'Max results to return (0 = unlimited)',
      },
    })

/**
 * Handler for the search messages subcommand.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return searchMessages(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

/** Exported for testing */
export async function searchMessages(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { output, logger } = ctx

  if (argv.api === false) {
    throw new CCIPApiClientNotAvailableError({
      context: {
        reason: 'The search command requires API access. Remove --no-api flag to use this command.',
      },
    })
  }

  const apiClient = CCIPAPIClient.fromUrl(argv.api === true ? undefined : argv.api, ctx)

  // Build filters from args
  const filters: Parameters<typeof apiClient.searchMessages>[0] = {}
  if (argv.sender) filters.sender = argv.sender
  if (argv.receiver) filters.receiver = argv.receiver
  if (argv.source) filters.sourceChainSelector = networkInfo(argv.source).chainSelector
  if (argv.dest) filters.destChainSelector = networkInfo(argv.dest).chainSelector
  if (argv.sourceToken) filters.sourceTokenAddress = argv.sourceToken
  if (argv.manualExecOnly) filters.readyForManualExecOnly = true

  // Collect results up to limit (0 means unlimited)
  let requestedLimit = argv.limit
  if (requestedLimit < 0) {
    logger.warn(`Invalid --limit ${requestedLimit}, using default (20).`)
    requestedLimit = 20
  }
  const limit = requestedLimit === 0 ? Infinity : requestedLimit

  // Wire abort signal from destroy$ for cancellation
  const ac = new AbortController()
  ctx.destroy$.then(() => ac.abort()).catch(() => {})

  let warned = false
  const results: MessageSearchResult[] = []
  for await (const msg of apiClient.searchAllMessages(filters, { signal: ac.signal })) {
    results.push(msg)
    if (!warned && results.length === LARGE_RESULT_THRESHOLD && limit > LARGE_RESULT_THRESHOLD) {
      logger.warn(`${results.length} results fetched so far, still paginating...`)
      warned = true
    }
    if (results.length >= limit) break
  }

  if (!results.length) {
    logger.warn('No messages found matching filters.')
    return
  }

  // Output results
  switch (argv.format) {
    case Format.json:
      output.write(JSON.stringify(results, bigIntReplacer, 2))
      return // no interactive follow-up for JSON
    case Format.log:
      for (const msg of results) output.write(msg)
      break
    default:
      for (const msg of results) {
        prettyTable.call(ctx, formatResult(msg))
      }
      output.write(`\n${results.length} message(s) found.`)
      break
  }

  // Interactive follow-up (TTY only, pretty/log formats)
  if (!process.stdout.isTTY) return
  await interactiveMenu(ctx, apiClient, results, argv.format)
}

function formatResult(msg: MessageSearchResult) {
  return {
    messageId: msg.messageId,
    status: msg.status,
    source: `${msg.sourceNetworkInfo.name} [${msg.sourceNetworkInfo.chainId}]`,
    dest: `${msg.destNetworkInfo.name} [${msg.destNetworkInfo.chainId}]`,
    sender: msg.sender,
    receiver: msg.receiver,
    txHash: msg.sendTransactionHash,
    timestamp: msg.sendTimestamp,
  }
}

function formatChoiceLabel(msg: MessageSearchResult): string {
  return `${msg.messageId.slice(0, 18)}\u2026  ${msg.status.padEnd(10)}  ${msg.sourceNetworkInfo.name} \u2192 ${msg.destNetworkInfo.name}`
}

async function fetchAndShowDetails(
  ctx: Ctx,
  apiClient: CCIPAPIClient,
  messageId: string,
  format?: string,
): Promise<void> {
  try {
    const full = await apiClient.getMessageById(messageId)
    switch (format) {
      case Format.json:
        ctx.output.write(JSON.stringify(full, bigIntReplacer, 2))
        break
      case Format.log:
        ctx.output.write('message =', withDateTimestamp(full))
        break
      default:
        await prettyRequest.call(ctx, full)
        break
    }
  } catch (err) {
    ctx.logger.error('Failed to fetch message details:', err)
  }
}

async function interactiveMenu(
  ctx: Ctx,
  apiClient: CCIPAPIClient,
  results: MessageSearchResult[],
  format?: string,
) {
  const choices = [
    ...results.map((msg, i) => ({
      value: i,
      name: formatChoiceLabel(msg),
      description: `sender: ${msg.sender}\nreceiver: ${msg.receiver}\ntx: ${msg.sendTransactionHash}\ntime: ${msg.sendTimestamp}`,
    })),
    { value: MENU_QUIT, name: 'Quit' },
  ]

  for (;;) {
    let answer: number
    try {
      answer = await select({
        message: 'Select a message to inspect, or quit:',
        choices,
        loop: false,
      })
    } catch (err) {
      // User pressed Ctrl+C or prompt closed — exit cleanly
      ctx.logger.debug('Interactive menu exited:', err)
      return
    }

    if (answer === MENU_QUIT) return

    const selected = results[answer]
    if (!selected) continue
    await fetchAndShowDetails(ctx, apiClient, selected.messageId, format)
  }
}
