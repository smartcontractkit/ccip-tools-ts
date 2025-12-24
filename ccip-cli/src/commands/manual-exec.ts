import {
  type CCIPRequest,
  type CCIPVersion,
  type ChainStatic,
  type EVMChain,
  type ExecutionReport,
  CCIPChainFamilyUnsupportedError,
  CCIPReceiptNotFoundError,
  ChainFamily,
  bigIntReplacer,
  calculateManualExecProof,
  discoverOffRamp,
  estimateExecGasForRequest,
  isSupportedTxHash,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import {
  formatDisplayAddress,
  formatDisplayTxHash,
  getCtx,
  logParsedError,
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../providers/index.ts'

// const MAX_QUEUE = 1000
// const MAX_EXECS_IN_BATCH = 1
// const MAX_PENDING_TXS = 25

export const command = 'manualExec <tx-hash>'
export const describe = 'Execute manually pending or failed messages'

/**
 * Yargs builder for the manual-exec command.
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
        describe: 'Log index of message to execute (if more than one in request tx)',
      },
      'gas-limit': {
        alias: ['L', 'compute-units'],
        type: 'number',
        describe: 'Override gas limit or compute units for receivers callback (0 keeps original)',
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
        alias: 'w',
        type: 'string',
        describe:
          'Wallet to send transactions with; pass `ledger[:index_or_derivation]` to use Ledger USB hardware wallet, or private key in `USER_KEY` environment variable',
      },
      'force-buffer': {
        type: 'boolean',
        describe: 'Forces the usage of buffering for Solana execution.',
      },
      'force-lookup-table': {
        type: 'boolean',
        describe: 'Forces the creation & usage of an ad-hoc lookup table for Solana execution.',
      },
      'clear-leftover-accounts': {
        type: 'boolean',
        describe:
          'Clears buffers (if a previous attempt was aborted) or any ALT owned by this sender.',
      },
      'receiver-object-ids': {
        type: 'array',
        describe: 'Receiver object IDs for Sui execution (if executing on Sui destination)',
        string: true,
        example: '--receiver-object-ids 0xabc... 0xdef...',
      },
      'sender-queue': {
        type: 'boolean',
        describe: 'Execute all messages in sender queue, starting with the provided tx',
        default: false,
      },
      'exec-failed': {
        type: 'boolean',
        describe:
          'Whether to re-execute failed messages (instead of just non-executed) in sender queue',
        implies: 'sender-queue',
      },
    })

/**
 * Handler for the manual-exec command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  // argv.senderQueue
  //   ? manualExecSenderQueue(providers, argv.tx_hash, argv)
  //   : manualExec(argv, destroy$)
  return manualExec(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function manualExec(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { logger } = ctx
  // messageId not yet implemented for Solana
  const [getChain, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHash)
  const [source, tx] = await tx$
  const request = await selectRequest(await source.getMessagesInTx(tx), 'to know more', argv)

  switch (argv.format) {
    case Format.log: {
      const logPrefix = 'log' in request ? `message ${request.log.index} = ` : 'message = '
      logger.log(logPrefix, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest.call(ctx, source, request)
      break
    case Format.json:
      logger.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }

  const dest = await getChain(request.lane.destChainSelector)
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)
  const commit = await dest.getCommitReport({ ...argv, commitStore, request })

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

  const messagesInBatch = await source.getAllMessagesInBatch(request, commit.report, argv)
  const execReportProof = calculateManualExecProof(
    messagesInBatch,
    request.lane,
    request.message.messageId,
    commit.report.merkleRoot,
    dest,
  )

  const offchainTokenData = await source.getOffchainTokenData(request)
  const execReport: ExecutionReport = {
    ...execReportProof,
    message: request.message,
    offchainTokenData,
  }

  if (
    argv.estimateGasLimit != null &&
    'gasLimit' in request.message &&
    'extraArgs' in request.message
  ) {
    if (dest.network.family !== ChainFamily.EVM)
      throw new CCIPChainFamilyUnsupportedError(dest.network.family, {
        context: { feature: 'gas estimation' },
      })

    let estimated = await estimateExecGasForRequest(
      source,
      dest as unknown as EVMChain,
      request as CCIPRequest<typeof CCIPVersion.V1_5 | typeof CCIPVersion.V1_6>,
    )
    logger.info('Estimated gasLimit override:', estimated)
    estimated += Math.ceil((estimated * argv.estimateGasLimit) / 100)
    if (request.message.gasLimit >= estimated) {
      logger.warn(
        'Estimated +',
        argv.estimateGasLimit,
        '% margin =',
        estimated,
        '< original gasLimit =',
        request.message.gasLimit,
        '. Leaving unchanged.',
      )
    } else {
      argv.gasLimit = estimated
    }
  }

  const [, wallet] = await loadChainWallet(dest, argv)
  const manualExecTx = await dest.executeReport({ ...argv, offRamp, execReport, wallet })

  const destFamily = networkInfo(request.lane.destChainSelector).family
  logger.info(
    '🚀 manualExec tx =',
    formatDisplayTxHash(manualExecTx.hash, destFamily),
    'to offRamp =',
    formatDisplayAddress(offRamp, destFamily),
  )

  let found = false

  // For sync chains (eg. EVM) try to find receipt in the submitted transaction's logs
  for (const log of manualExecTx.logs) {
    const execReceipt = (dest.constructor as ChainStatic).decodeReceipt(log)
    if (!execReceipt) continue
    const timestamp = await dest.getBlockTimestamp(log.blockNumber)
    const receipt = { receipt: execReceipt, log, timestamp }
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
        logger.info(JSON.stringify(execReceipt, bigIntReplacer, 2))
        break
    }
    found = true
  }

  // For async chains (eg. TON), the receipt may be in a separate transaction
  if (!found) {
    // We need to wait for the Offramp to process the message.
    // Use watch mode to poll for the final execution state (Success or Failure).
    const timeoutMs = 10 * 60 * 1000 // ~10 minute timeout
    logger.info(`Waiting for execution receipt (timeout: ${timeoutMs / 60_000}m)...`)

    // Create a timeout promise that resolves after timeoutMs
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))

    // Use watch mode to poll for execution receipts
    for await (const execution of dest.getExecutionReceipts({
      offRamp,
      request,
      commit,
      page: argv.page,
      watch: timeoutPromise,
    })) {
      // Only accept receipts that occurred AFTER our wallet transaction
      if (manualExecTx.timestamp && execution.timestamp < manualExecTx.timestamp) {
        continue // Skip old receipts from before our manual exec
      }

      // Found a final state: display and exit
      switch (argv.format) {
        case Format.log:
          logger.log('receipt =', withDateTimestamp(execution))
          break
        case Format.pretty:
          logger.info('Receipts (dest):')
          prettyReceipt.call(
            ctx,
            execution,
            request,
            execution.log.tx?.from ??
              (await dest.getTransaction(execution.log.transactionHash).catch(() => null))?.from,
          )
          break
        case Format.json:
          logger.info(JSON.stringify(execution.receipt, bigIntReplacer, 2))
          break
      }
      found = true
    }
  }
  if (!found) throw new CCIPReceiptNotFoundError(manualExecTx.hash)
}

// TODO: re-implement executing `sender` queue
