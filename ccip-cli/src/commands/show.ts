/**
 * CCIP CLI Show Command
 *
 * Displays detailed information about a CCIP message, including its status,
 * commit report, and execution receipts across source and destination chains.
 *
 * @example
 * ```bash
 * # Show message details
 * ccip-cli show 0xSourceTxHash...
 *
 * # Wait for execution
 * ccip-cli show 0xSourceTxHash... --wait
 *
 * # Output as JSON
 * ccip-cli show 0xSourceTxHash... --format json
 * ```
 *
 * @packageDocumentation
 */

import {
  type Chain,
  CCIPAPIClient,
  CCIPExecTxRevertedError,
  CCIPMessageIdNotFoundError,
  CCIPTransactionNotFoundError,
  ExecutionState,
  MessageStatus,
  bigIntReplacer,
  discoverOffRamp,
  isSupportedTxHash,
} from '@chainlink/ccip-sdk/src/index.ts'
import { isHexString } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import {
  getCtx,
  logParsedError,
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  prettyTable,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = ['show <tx-hash-or-id>', '* <tx-hash-or-id>']
export const describe = 'Show details of a CCIP request'

/**
 * Yargs builder for the show command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('tx-hash-or-id', {
      type: 'string',
      demandOption: true,
      describe: 'transaction hash or message ID (32-byte hex) of the CCIP request',
    })
    .check(({ txHashOrId }) => isSupportedTxHash(txHashOrId))
    .options({
      'log-index': {
        type: 'number',
        describe:
          'Pre-select a message request by logIndex, if more than one in tx; by default, a selection menu is shown',
      },
      wait: {
        type: 'boolean',
        describe: 'Wait for (first) execution',
      },
    })

/**
 * Handler for the show command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return showRequests(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

/**
 * Show details of a request.
 */
export async function showRequests(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx
  const [getChain, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHashOrId)

  let source: Chain | undefined
  let request$ = (async () => {
    const [source_, tx] = await tx$
    source = source_
    return selectRequest(await source_.getMessagesInTx(tx), 'to know more', argv)
  })()

  if (argv.noApi !== true) {
    const apiClient = CCIPAPIClient.fromUrl(undefined, ctx)
    if (isHexString(argv.txHashOrId, 32)) {
      request$ = Promise.any([request$, apiClient.getMessageById(argv.txHashOrId)])
    }
  }
  let request
  try {
    request = await request$
  } catch (err) {
    if (err instanceof AggregateError && err.errors.length === 2) {
      if (!(err.errors[0] instanceof CCIPTransactionNotFoundError)) throw err.errors[0] as Error
      else if (!(err.errors[1] instanceof CCIPMessageIdNotFoundError)) throw err.errors[1] as Error
    }
    throw err
  }
  if (!source) {
    try {
      source = await getChain(request.lane.sourceChainSelector)
    } catch (err) {
      logger.debug(
        'Fetched messageId from API, but failed find a source',
        request.lane.sourceChainSelector,
        'RPC endpoint:',
        err,
      )
    }
  }

  switch (argv.format) {
    case Format.log: {
      logger.log(`message ${request.log.index} =`, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest.call(ctx, request, source)
      break
    case Format.json:
      logger.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }
  if (request.tx.error)
    throw new CCIPExecTxRevertedError(request.log.transactionHash, {
      context: { error: request.tx.error },
    })

  if (!source) return
  if (argv.wait === false) return // `false` used by call at end of `send` command without `--wait`

  let cancelWaitFinalized: (() => void) | undefined
  const finalized$ = (async () => {
    if (argv.wait) {
      logger.info(`[${MessageStatus.Sent}] Waiting for source chain finalization...`)
      await source.waitFinalized({
        request,
        cancel$: new Promise<void>((resolve) => (cancelWaitFinalized = resolve)),
      })
      logger.info(`[${MessageStatus.SourceFinalized}] Source chain finalized`)
    }

    const offchainTokenData = await source.getOffchainTokenData(request)
    if (offchainTokenData.length && offchainTokenData.some((d) => !!d)) {
      switch (argv.format) {
        case Format.log: {
          logger.log('attestations =', offchainTokenData)
          break
        }
        case Format.pretty:
          logger.info('Attestations:')
          for (const attestation of offchainTokenData) {
            const { _tag: type, ...rest } = attestation!
            prettyTable.call(ctx, { type, ...rest })
          }
          break
        case Format.json:
          logger.info(JSON.stringify({ attestations: offchainTokenData }, bigIntReplacer, 2))
          break
      }
    }

    if (argv.wait)
      logger.info(`[${MessageStatus.SourceFinalized}] Waiting for commit on destination chain...`)
    else logger.info('Commit (dest):')
  })()

  const dest = await getChain(request.lane.destChainSelector)
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)

  let cancelWaitCommit: (() => void) | undefined
  const commit$ = (async () => {
    const commit = await dest.getCommitReport({
      commitStore,
      request,
      ...argv,
      watch: argv.wait && new Promise<void>((resolve) => (cancelWaitCommit = resolve)),
    })
    cancelWaitFinalized?.()
    await finalized$
    if (argv.wait)
      logger.info(`[${MessageStatus.Committed}] Commit report accepted on destination chain`)
    switch (argv.format) {
      case Format.log:
        logger.log('commit =', commit)
        break
      case Format.pretty:
        await prettyCommit.call(ctx, dest, commit, request)
        break
      case Format.json:
        logger.info(JSON.stringify(commit, bigIntReplacer, 2))
        break
    }
    if (argv.wait)
      logger.info(`[${MessageStatus.Blessed}] Waiting for execution on destination chain...`)
    else logger.info('Receipts (dest):')
    return commit
  })()

  let found = false
  for await (const receipt of dest.getExecutionReceipts({
    ...argv,
    offRamp,
    messageId: request.message.messageId,
    sourceChainSelector: request.message.sourceChainSelector,
    startTime: request.tx.timestamp,
    commit: !argv.wait ? await commit$ : undefined,
    watch: argv.wait && ctx.destroy$,
  })) {
    cancelWaitCommit?.()
    await commit$
    const status =
      receipt.receipt.state === ExecutionState.Success
        ? MessageStatus.Success
        : MessageStatus.Failed
    const statusMessage =
      receipt.receipt.state === ExecutionState.Success
        ? 'Message executed on destination chain'
        : 'Message execution failed on destination chain'
    logger.info(`[${status}] ${statusMessage}`)
    switch (argv.format) {
      case Format.log:
        logger.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        prettyReceipt.call(
          ctx,
          receipt,
          request,
          receipt.log.tx?.from ??
            (await dest.getTransaction(receipt.log.transactionHash).catch(() => null))?.from,
        )
        break
      case Format.json:
        logger.info(JSON.stringify(receipt, bigIntReplacer, 2))
        break
    }
    found = true
    if (argv.wait) break
  }
  if (!found) logger.warn(`No execution receipt found for request`)
}
