import {
  type CCIPRequest,
  type Chain,
  type ChainTransaction,
  CCIPExecTxRevertedError,
  CCIPNotImplementedError,
  bigIntReplacer,
  CCIPMessageIdNotFoundError,
  discoverOffRamp,
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
        describe: 'Wait for execution',
      },
    })

/**
 * Handler for the show command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [controller, ctx] = getCtx(argv)
  return showRequests(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(() => controller.abort('Exited'))
}

/**
 * Show details of a request.
 */
export async function showRequests(ctx: Ctx, argv: Parameters<typeof handler>[0]) {
  const { logger } = ctx
  let source, getChain, tx: ChainTransaction, request: CCIPRequest
  // messageId not yet implemented for Solana
  if (argv.idFromSource) {
    getChain = fetchChainsFromRpcs(ctx, argv)
    let idFromSource, onRamp
    if (argv.idFromSource.includes('@')) {
      ;[onRamp, idFromSource] = argv.idFromSource.split('@')
    } else idFromSource = argv.idFromSource
    const sourceNetwork = networkInfo(idFromSource)
    source = await getChain(sourceNetwork.chainId)
    if (!source.fetchRequestById)
      throw new CCIPNotImplementedError(`fetchRequestById for ${source.constructor.name}`)
    request = await source.fetchRequestById(argv.txHash, onRamp, argv)
  } else {
    const [getChain_, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHash)
    getChain = getChain_
    ;[source, tx] = await tx$
    request = await selectRequest(await source.fetchRequestsInTx(tx), 'to know more', argv)
  }

  const offchainTokenData = await source.fetchOffchainTokenData(request)

  switch (argv.format) {
    case Format.log: {
      logger.log(
        `message ${request.log.index} =`,
        withDateTimestamp(request),
        '\nattestations =',
        offchainTokenData,
      )
      break
    }
    case Format.pretty:
      await prettyRequest.call(ctx, source, request, offchainTokenData)
      break
    case Format.json:
      logger.info(JSON.stringify({ ...request, offchainTokenData }, bigIntReplacer, 2))
      break
  }
  if (request.tx.error)
    throw new CCIPExecTxRevertedError(request.log.transactionHash, {
      context: { error: request.tx.error },
    })
  if (argv.wait === false) return // `false` used by call at end of `send` command

  await waitForRequestFinalized(source, request)

  const dest = await getChain(request.lane.destChainSelector)
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)

  const commit = await dest.fetchCommitReport(commitStore, request, { ...argv, watch: argv.wait })
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

  let found = false
  for await (const receipt of dest.fetchExecutionReceipts(offRamp, request, commit, {
    ...argv,
    watch: argv.wait,
  })) {
    switch (argv.format) {
      case Format.log:
        logger.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        if (!found) logger.info('Receipts (dest):')
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
    break
  }
  if (!found) logger.warn(`No execution receipt found for request`)
}

async function waitForRequestFinalized(source: Chain, request: CCIPRequest) {
  for await (const log of source.getLogs({
    address: request.lane.onRamp,
    startBlock: request.tx.blockNumber,
    endBlock: 'finalized',
    topics: [request.log.topics[0]],
    watch: true,
  })) {
    if (log.transactionHash === request.tx.hash) {
      source.logger.info(`Request ${request.message.header.messageId} finalized ✅`)
      break
    } else if (log.blockNumber > request.log.blockNumber) {
      throw new CCIPMessageIdNotFoundError(request.message.header.messageId)
    }
  }
}
