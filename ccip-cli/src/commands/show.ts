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
  type ChainStatic,
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
  prettyReceipt,
  prettyRequest,
  prettyTable,
  prettyVerifications,
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
  const { output, logger } = ctx

  // In JSON mode, accumulate all output into a single envelope so JSON.parse(stdout) works.
  // Fields are added as they become available; omitted if not applicable.
  const jsonEnvelope:
    | { request?: unknown; attestations?: unknown; verifications?: unknown; receipts?: unknown[] }
    | undefined = argv.format === Format.json ? {} : undefined
  const emitJsonEnvelope = () => {
    if (jsonEnvelope) output.write(JSON.stringify(jsonEnvelope, bigIntReplacer, 2))
  }

  const [getChain, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHashOrId)

  let source: Chain | undefined, offRamp
  let request$ = (async () => {
    const [source_, tx] = await tx$
    source = source_
    return selectRequest(await source_.getMessagesInTx(tx), 'to know more', argv)
  })()

  if (argv.api !== false && isHexString(argv.txHashOrId, 32)) {
    const apiClient = CCIPAPIClient.fromUrl(
      typeof argv.api === 'string' ? argv.api : undefined,
      ctx,
    )
    request$ = Promise.any([request$, apiClient.getMessageById(argv.txHashOrId)])
  }

  let request
  try {
    request = await request$
    if ('offRampAddress' in request.message) {
      offRamp = request.message.offRampAddress
    }
  } catch (err) {
    if (err instanceof AggregateError && err.errors.length === 2) {
      if (!(err.errors[0] instanceof CCIPTransactionNotFoundError)) throw err.errors[0] as Error
      else if (!(err.errors[1] instanceof CCIPMessageIdNotFoundError)) throw err.errors[1] as Error
    }
    throw err
  }
  if (!source) {
    // source isn't strictly needed when fetching messageId from API, but it may be useful to print
    // more information, e.g. request's token symbols
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
      output.write(`message ${request.log.index} =`, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest.call(ctx, request, source)
      break
    case Format.json:
      jsonEnvelope!.request = request
      break
  }
  if (request.tx.error)
    throw new CCIPExecTxRevertedError(request.log.transactionHash, {
      context: { error: request.tx.error },
    })

  if (!source) {
    emitJsonEnvelope()
    return
  }
  if (argv.wait === false) {
    emitJsonEnvelope()
    return // `false` used by call at end of `send` command without `--wait`
  }

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
          output.write('attestations =', offchainTokenData)
          break
        }
        case Format.pretty:
          output.write('Attestations:')
          for (const attestation of offchainTokenData) {
            const { _tag: type, ...rest } = attestation!
            prettyTable.call(ctx, { type, ...rest })
          }
          break
        case Format.json:
          jsonEnvelope!.attestations = offchainTokenData
          break
      }
    }

    if (argv.wait)
      logger.info(`[${MessageStatus.SourceFinalized}] Waiting for commit on destination chain...`)
    else if (!request.metadata?.receiptTransactionHash && argv.format !== Format.json)
      output.write('Commit (dest):')
  })()

  const dest = await getChain(request.lane.destChainSelector)

  let execs$, cancelWaitVerifications: (() => void) | undefined, verifications$
  if (request.metadata?.receiptTransactionHash) {
    // if we got last receipt metadata from api, just fetch it instead of scanning (faster)
    execs$ = await dest
      .getTransaction(request.metadata.receiptTransactionHash)
      .then(async ({ logs }) => {
        const res = []
        for (const log of logs) {
          const receipt = (dest.constructor as ChainStatic).decodeReceipt(log)
          if (!receipt) continue
          res.push({ receipt, log, timestamp: request.metadata!.receiptTimestamp! })
        }
        cancelWaitFinalized?.()
        await finalized$
        return res
      })
  } else {
    offRamp ??= await discoverOffRamp(source, dest, request.lane.onRamp, source)

    verifications$ = (async () => {
      const verifications = await dest.getVerifications({
        offRamp,
        request,
        ...argv,
        watch: argv.wait && new Promise<void>((resolve) => (cancelWaitVerifications = resolve)),
      })
      cancelWaitFinalized?.()
      await finalized$
      if (argv.wait)
        logger.info(`[${MessageStatus.Committed}] Commit report accepted on destination chain`)
      switch (argv.format) {
        case Format.log:
          output.write('commit =', verifications)
          break
        case Format.pretty:
          await prettyVerifications.call(ctx, dest, verifications, request)
          break
        case Format.json:
          jsonEnvelope!.verifications = verifications
          break
      }
      if (argv.wait)
        logger.info(`[${MessageStatus.Blessed}] Waiting for execution on destination chain...`)
      else if (argv.format !== Format.json) output.write('Receipts (dest):')
      return verifications
    })().catch((err) => {
      logger.debug('getVerifications error:', err)
      return undefined
    })
    execs$ = dest.getExecutionReceipts({
      ...argv,
      offRamp,
      messageId: request.message.messageId,
      sourceChainSelector: request.message.sourceChainSelector,
      startTime: request.tx.timestamp,
      verifications: !argv.wait ? await verifications$ : undefined,
      watch: argv.wait && ctx.destroy$,
    })
  }

  let found = false
  for await (const exec of execs$) {
    cancelWaitVerifications?.()
    await verifications$
    const status =
      exec.receipt.state === ExecutionState.Success ? MessageStatus.Success : MessageStatus.Failed
    const statusMessage =
      exec.receipt.state === ExecutionState.Success
        ? 'Message executed on destination chain'
        : 'Message execution failed on destination chain'
    logger.info(`[${status}] ${statusMessage}`)
    switch (argv.format) {
      case Format.log:
        output.write('receipt =', withDateTimestamp(exec))
        break
      case Format.pretty:
        prettyReceipt.call(
          ctx,
          exec,
          request,
          exec.log.tx?.from ??
            (await dest.getTransaction(exec.log.transactionHash).catch(() => null))?.from,
        )
        break
      case Format.json:
        jsonEnvelope!.receipts ??= []
        jsonEnvelope!.receipts.push(exec)
        break
    }
    found = true
    if (argv.wait) break
  }
  if (!found) logger.warn(`No execution receipt found for request`)
  emitJsonEnvelope()
}
