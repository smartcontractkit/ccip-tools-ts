import {
  type CCIPRequest,
  type Chain,
  type ChainGetter,
  CCIPAPIClient,
  CCIPError,
  CCIPExecTxRevertedError,
  CCIPMessageRetrievalError,
  CCIPNotImplementedError,
  ExecutionState,
  MessageStatus,
  bigIntReplacer,
  discoverOffRamp,
  isSupportedTxHash,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
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

export const command = ['show <tx-hash>', '* <tx-hash>']
export const describe = 'Show details of a CCIP request'

/**
 * Yargs builder for the show command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('tx-hash', {
      type: 'string',
      demandOption: true,
      describe: 'transaction hash of the request (source) message',
    })
    .check(({ txHash }) => isSupportedTxHash(txHash))
    .options({
      'log-index': {
        type: 'number',
        describe:
          'Pre-select a message request by logIndex, if more than one in tx; by default, a selection menu is shown',
      },
      'id-from-source': {
        type: 'string',
        describe:
          'Search by messageId instead of txHash; requires `[onRamp@]sourceNetwork` (onRamp address may be required in some chains)',
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
 * Retrieve message data by message ID (idFromSource path).
 * @returns Array containing a single CCIPRequest
 */
async function retrieveMessageDataFromId(
  ctx: Ctx,
  argv: Parameters<typeof handler>[0],
): Promise<CCIPRequest[]> {
  const { logger } = ctx

  let idFromSource: string
  let onRamp: string | undefined
  if (argv.idFromSource!.includes('@')) {
    ;[onRamp, idFromSource] = argv.idFromSource!.split('@') as [string, string]
  } else {
    idFromSource = argv.idFromSource!
  }
  const sourceNetwork = networkInfo(idFromSource)

  // Try API first if available (no RPC needed)
  let apiError: CCIPError | undefined
  if (!argv.noapi) {
    const apiClient = new CCIPAPIClient(undefined, { logger })
    try {
      const request = await apiClient.getMessageById(idFromSource)
      logger.debug('API getMessageById succeeded')
      return [request]
    } catch (err) {
      apiError = CCIPError.from(err)
      logger.debug('API getMessageById failed, falling back to RPC:', err)
    }
  }

  // Fall back to RPC if API failed or was disabled
  try {
    const getChain = fetchChainsFromRpcs(ctx, argv)
    const source = await getChain(sourceNetwork.chainId)
    if (!source.getMessageById)
      throw new CCIPNotImplementedError(`getMessageById for ${source.constructor.name}`)
    const request = await source.getMessageById(argv.idFromSource!, onRamp, argv)
    return [request]
  } catch (err) {
    const rpcError = CCIPError.from(err)
    // Both API and RPC failed - throw combined error
    throw new CCIPMessageRetrievalError(idFromSource, apiError, rpcError)
  }
}

/**
 * Retrieve message data by transaction hash.
 * @returns Array of CCIPRequests (may contain multiple)
 */
async function retrieveMessageDataFromTxHash(
  ctx: Ctx,
  argv: Parameters<typeof handler>[0],
): Promise<CCIPRequest[]> {
  const { logger } = ctx

  // Try API first if available (no RPC needed)
  let apiError: CCIPError | undefined
  if (!argv.noapi) {
    const apiClient = new CCIPAPIClient(undefined, { logger })
    try {
      const messageIds = await apiClient.getMessageIdsInTx(argv.txHash)
      logger.debug('API getMessageIdsInTx succeeded, found', messageIds.length)
      const requests = await Promise.all(messageIds.map((id) => apiClient.getMessageById(id)))
      logger.debug('API request retrieval succeeded')
      return requests
    } catch (err) {
      apiError = CCIPError.from(err)
      logger.debug('API getMessageIdsInTx failed, falling back to RPC:', err)
    }
  }

  // Fall back to RPC if API failed or was disabled
  try {
    const [, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHash)
    const [source, tx] = await tx$
    return await source.getMessagesInTx(tx)
  } catch (err) {
    const rpcError = CCIPError.from(err)
    // Both API and RPC failed - throw combined error
    throw new CCIPMessageRetrievalError('Unknown ID', apiError, rpcError)
  }
}

/**
 * Show details of a request.
 */
export async function showRequests(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx

  const requests = argv.idFromSource
    ? await retrieveMessageDataFromId(ctx, argv)
    : await retrieveMessageDataFromTxHash(ctx, argv)

  const req = await selectRequest(requests, 'to know more', argv)

  // Lazy-load chains if needed (when we got request from API)
  let source: Chain | undefined
  let getChain: ChainGetter | undefined
  const ensureChains = async () => {
    if (!getChain) {
      getChain = fetchChainsFromRpcs(ctx, argv)
    }
    if (!source) {
      source = await getChain(req.lane.sourceChainSelector)
    }
    return { source, getChain }
  }

  switch (argv.format) {
    case Format.log: {
      logger.log(`message ${req.log.index} =`, withDateTimestamp(req))
      break
    }
    case Format.pretty: {
      // Try to get chain for rich display, fall back to JSON if unavailable
      try {
        const { source: src } = await ensureChains()
        await prettyRequest.call(ctx, src, req)
      } catch (err) {
        logger.debug('Pretty format failed, falling back to JSON:', err)
        logger.info(JSON.stringify(req, bigIntReplacer, 2))
      }
      break
    }
    case Format.json:
      logger.info(JSON.stringify(req, bigIntReplacer, 2))
      break
  }
  if (req.tx.error)
    throw new CCIPExecTxRevertedError(req.log.transactionHash, {
      context: { error: req.tx.error },
    })

  if (argv.wait) {
    // Ensure chains are loaded for wait/commit/receipt functionality
    const { source: src, getChain: gc } = await ensureChains()
    await waitForExecution(ctx, argv, req, src, gc)
  }
}

/**
 * Wait for finalization, commit, and execution receipt.
 * Called only when --wait flag is set.
 * Currently only supported through RPC.
 */
async function waitForExecution(
  ctx: Ctx,
  argv: Parameters<typeof handler>[0],
  req: CCIPRequest,
  source: Chain,
  getChain: ChainGetter,
) {
  const { logger } = ctx

  let cancelWaitFinalized: (() => void) | undefined
  const finalized$ = (async () => {
    logger.info(`[${MessageStatus.Sent}] Waiting for source chain finalization...`)
    await source.waitFinalized({
      request: req,
      cancel$: new Promise<void>((resolve) => (cancelWaitFinalized = resolve)),
    })
    logger.info(`[${MessageStatus.SourceFinalized}] Source chain finalized`)

    const offchainTokenData = await source.getOffchainTokenData(req)
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

    logger.info(`[${MessageStatus.SourceFinalized}] Waiting for commit on destination chain...`)
  })()

  const dest = await getChain(req.lane.destChainSelector)
  const offRamp = await discoverOffRamp(source, dest, req.lane.onRamp, source)
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)

  let cancelWaitCommit: (() => void) | undefined
  const commit$ = (async () => {
    const commit = await dest.getCommitReport({
      commitStore,
      request: req,
      ...argv,
      watch: new Promise<void>((resolve) => (cancelWaitCommit = resolve)),
    })
    cancelWaitFinalized?.()
    await finalized$
    logger.info(`[${MessageStatus.Committed}] Commit report accepted on destination chain`)
    switch (argv.format) {
      case Format.log:
        logger.log('commit =', commit)
        break
      case Format.pretty:
        await prettyCommit.call(ctx, dest, commit, req)
        break
      case Format.json:
        logger.info(JSON.stringify(commit, bigIntReplacer, 2))
        break
    }
    logger.info(`[${MessageStatus.Blessed}] Waiting for execution on destination chain...`)
    return commit
  })()

  let found = false
  for await (const receipt of dest.getExecutionReceipts({
    ...argv,
    offRamp,
    messageId: req.message.messageId,
    sourceChainSelector: req.message.sourceChainSelector,
    startTime: req.tx.timestamp,
    commit: undefined,
    watch: ctx.destroy$,
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
          req,
          receipt.log.tx?.from ??
            (await dest.getTransaction(receipt.log.transactionHash).catch(() => null))?.from,
        )
        break
      case Format.json:
        logger.info(JSON.stringify(receipt, bigIntReplacer, 2))
        break
    }
    found = true
    break
  }
  if (!found) logger.warn(`No execution receipt found for request`)
}
