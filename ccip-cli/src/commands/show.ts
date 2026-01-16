import {
  type CCIPRequest,
  type Chain,
  type ChainGetter,
  type ChainTransaction,
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
 * Show details of a request.
 */
export async function showRequests(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx
  let source: Chain | undefined
  let getChain: ChainGetter | undefined
  let tx!: ChainTransaction
  let request: CCIPRequest | undefined
  // messageId not yet implemented for Solana
  if (argv.idFromSource) {
    let idFromSource: string, onRamp: string | undefined
    if (argv.idFromSource.includes('@')) {
      ;[onRamp, idFromSource] = argv.idFromSource.split('@') as [string, string]
    } else idFromSource = argv.idFromSource
    const sourceNetwork = networkInfo(idFromSource)

    // Try API first if available (no RPC needed)
    let apiError: CCIPError | undefined
    if (!argv.noApi) {
      const apiClient = new CCIPAPIClient(undefined, { logger })
      try {
        request = await apiClient.getMessageById(argv.txHash)
        logger.debug('API getMessageById succeeded')
      } catch (err) {
        apiError = CCIPError.from(err)
        logger.debug('API getMessageById failed, falling back to RPC:', err)
      }
    }

    // Fall back to RPC if API failed or was disabled
    if (!request) {
      try {
        getChain = fetchChainsFromRpcs(ctx, argv)
        source = await getChain(sourceNetwork.chainId)
        if (!source.getMessageById)
          throw new CCIPNotImplementedError(`getMessageById for ${source.constructor.name}`)
        request = await source.getMessageById(argv.txHash, onRamp, argv)
      } catch (err) {
        const rpcError = CCIPError.from(err)
        // Both API and RPC failed - throw combined error
        throw new CCIPMessageRetrievalError(argv.txHash, apiError, rpcError)
      }
    }
  } else {
    const [getChain_, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHash)
    getChain = getChain_
    ;[source, tx] = await tx$
    request = await selectRequest(await source.getMessagesInTx(tx), 'to know more', argv)
  }

  // Request is guaranteed defined: idFromSource path throws CCIPMessageRetrievalError,
  // else path throws via selectRequest if no messages found
  const req = request

  // Lazy-load chains if needed (when we got request from API)
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
      // If we got request from API without RPC, fall back to JSON immediately
      // (TODO: Expand pritty printing to not rely on the RPC. Currently RPC
      // is required mainly for token formatting)
      if (!source && !getChain) {
        logger.debug('No RPC available, falling back to JSON for display')
        logger.info(JSON.stringify(req, bigIntReplacer, 2))
        break
      }
      // Try to get chain for rich display, fall back to JSON if unavailable
      try {
        const { source: src } = await ensureChains()
        await prettyRequest.call(ctx, src, req)
      } catch {
        logger.debug('Chain unavailable for pretty format, falling back to JSON')
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

  // Only continue to commit/receipt logic if --wait is explicitly requested
  if (!argv.wait) return

  // Ensure chains are loaded for wait/commit/receipt functionality
  const { source: src, getChain: gc } = await ensureChains()
  await waitForExecution(ctx, argv, req, src, gc)
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
