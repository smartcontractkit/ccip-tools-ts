/**
 * CCIP CLI Manual Execution Command
 *
 * Manually executes pending or failed CCIP messages on the destination chain.
 * Use this when automatic execution fails or is delayed.
 *
 * @example
 * ```bash
 * # Execute a stuck message
 * ccip-cli manualExec 0xSourceTxHash... --wallet $PRIVATE_KEY
 *
 * # Execute with custom gas limit
 * ccip-cli manualExec 0xSourceTxHash... --gas-limit 500000
 *
 * # Execute all messages in sender queue
 * ccip-cli manualExec 0xSourceTxHash... --sender-queue
 * ```
 *
 * @packageDocumentation
 */

import {
  type ExecutionReport,
  bigIntReplacer,
  calculateManualExecProof,
  discoverOffRamp,
  estimateReceiveExecution,
  isSupportedTxHash,
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
import { fetchChainsFromRpcs, loadChainWallet } from '../providers/index.ts'

// const MAX_QUEUE = 1000
// const MAX_EXECS_IN_BATCH = 1
// const MAX_PENDING_TXS = 25

export const command = ['manualExec <tx-hash>', 'manual-exec <tx-hash>']
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
      logger.info('Commit (dest):')
      await prettyCommit.call(ctx, dest, commit, request)
      break
    case Format.json:
      logger.info(JSON.stringify(commit, bigIntReplacer, 2))
      break
  }

  const messagesInBatch = await source.getMessagesInBatch(request, commit.report, argv)
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

  if (argv.estimateGasLimit != null) {
    let estimated = await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: offRamp,
      message: request.message,
    })
    logger.info('Estimated gasLimit override:', estimated)
    estimated += Math.ceil((estimated * argv.estimateGasLimit) / 100)
    const origLimit = Number(
      'gasLimit' in request.message ? request.message.gasLimit : request.message.computeUnits,
    )
    if (origLimit >= estimated) {
      logger.warn(
        'Estimated +',
        argv.estimateGasLimit,
        '% =',
        estimated,
        '< original gasLimit =',
        origLimit,
        '. Leaving unchanged.',
      )
    } else {
      argv.gasLimit = estimated
    }
  }

  const [, wallet] = await loadChainWallet(dest, argv)
  const receipt = await dest.executeReport({ ...argv, offRamp, execReport, wallet })

  switch (argv.format) {
    case Format.log:
      logger.log('receipt =', withDateTimestamp(receipt))
      break
    case Format.pretty:
      logger.info('Receipt (dest):')
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
}

// TODO: re-implement executing `sender` queue
