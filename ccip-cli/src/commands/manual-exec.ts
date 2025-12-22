import {
  type CCIPExecution,
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
  const request = await selectRequest(await source.fetchRequestsInTx(tx), 'to know more', argv)

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
  const commit = await dest.fetchCommitReport(commitStore, request, argv)

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

  const messagesInBatch = await source.fetchAllMessagesInBatch(request, commit.report, argv)
  const execReportProof = calculateManualExecProof(
    messagesInBatch,
    request.lane,
    request.message.messageId,
    commit.report.merkleRoot,
    dest,
  )

  const offchainTokenData = await source.fetchOffchainTokenData(request)
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
  const manualExecTx = await dest.executeReport(offRamp, execReport, { ...argv, wallet })

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
    // For async execution, we need to wait for the Offramp to process the message.
    // The execution receipt will appear in a separate transaction.
    const walletTxTimestamp = manualExecTx.timestamp

    // Keep polling until we find a Success receipt or exhaust attempts
    const maxAttempts = 60
    const delayMs = 5000
    const timeoutMins = Math.floor((maxAttempts * delayMs) / 1000 / 60)
    logger.info(`Waiting for execution receipt (timeout: ~${timeoutMins}m)...`)

    let latestReceipt: CCIPExecution | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      for await (const execution of dest.fetchExecutionReceipts(offRamp, request, commit, {
        page: argv.page,
      })) {
        // Only accept receipts that occurred AFTER our wallet transaction
        if (walletTxTimestamp && execution.timestamp < walletTxTimestamp) {
          continue // Skip old receipts from before our manual exec
        }

        // Track the latest receipt we've found
        if (!latestReceipt || execution.timestamp > latestReceipt.timestamp) {
          latestReceipt = execution
        }

        // If we found Success, we're done
        if (execution.receipt.state === 2) {
          // ExecutionState.Success
          found = true
          break
        }
      }

      // If we found a Success receipt, stop polling
      if (found) break
    }

    // Display the latest receipt we found (either Success after polling, or latest non-Success)
    if (latestReceipt) {
      switch (argv.format) {
        case Format.log:
          logger.log('receipt =', withDateTimestamp(latestReceipt))
          break
        case Format.pretty:
          logger.info('Receipts (dest):')
          prettyReceipt.call(
            ctx,
            latestReceipt,
            request,
            latestReceipt.log.tx?.from ??
              (await dest.getTransaction(latestReceipt.log.transactionHash).catch(() => null))
                ?.from,
          )
          break
        case Format.json:
          logger.info(JSON.stringify(latestReceipt.receipt, bigIntReplacer, 2))
          break
      }
      found = true
    }
  }
  if (!found) throw new CCIPReceiptNotFoundError(manualExecTx.hash)
}

/*
export async function manualExecSenderQueue(
  providers: Providers,
  txHash: string,
  argv: {
    gasLimit?: number
    tokensGasLimit?: number
    logIndex?: number
    execFailed?: boolean
    format: Format
    page: number
    wallet?: string
  },
) {
  const tx = await providers.getTxReceipt(txHash)
  const source = tx.provider

  let firstRequest
  if (argv.logIndex != null) {
    firstRequest = await fetchCCIPMessageInLog(tx, argv.logIndex)
  } else {
    firstRequest = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }
  switch (argv.format) {
    case Format.log:
      console.log(`message ${firstRequest.log.index} =`, withDateTimestamp(firstRequest))
      break
    case Format.pretty:
      await prettyRequest(source, firstRequest)
      break
    case Format.json:
      console.info(JSON.stringify(firstRequest, bigIntReplacer, 2))
      break
  }

  const dest = await providers.forChainId(chainIdFromSelector(firstRequest.lane.destChainSelector))

  const requests: Omit<CCIPRequest, 'timestamp' | 'tx'>[] = []
  for await (const request of fetchRequestsForSender(source, firstRequest)) {
    requests.push(request)
    if (requests.length >= MAX_QUEUE) break
  }
  console.info('Found', requests.length, `requests for "${firstRequest.message.sender}"`)
  if (!requests.length) return

  let startBlock = await getSomeBlockNumberBefore(dest, firstRequest.timestamp)
  const wallet = (await getWallet(argv)).connect(dest)
  const offRampContract = await discoverOffRamp(wallet, firstRequest.lane, {
    fromBlock: startBlock,
    page: argv.page,
  })
  const senderNonce = await offRampContract.getSenderNonce(firstRequest.message.sender)
  const origRequestsCnt = requests.length,
    last = requests[requests.length - 1]
  while (requests.length && requests[0].message.header.sequenceNumber <= senderNonce) {
    requests.shift()
  }
  console.info(
    'Found',
    requests.length,
    `requests for "${firstRequest.message.sender}", removed `,
    origRequestsCnt - requests.length,
    'already executed before senderNonce =',
    senderNonce,
    '. Last source txHash =',
    last.log.transactionHash,
  )
  if (!requests.length) return
  let nonce = await wallet.getNonce()

  let lastBatch:
    | readonly [CCIPCommit, Omit<CCIPRequest<CCIPVersion>, 'tx' | 'timestamp'>[]]
    | undefined
  const txsPending = []
  for (let i = 0; i < requests.length; ) {
    let commit, batch
    if (!lastBatch || requests[i].message.header.sequenceNumber > lastBatch[0].report.maxSeqNr) {
      commit = await fetchCommitReport(dest, requests[i], {
        startBlock,
        page: argv.page,
      })
      startBlock = commit.log.blockNumber + 1

      batch = await fetchAllMessagesInBatch(
        source,
        requests[i].lane.destChainSelector,
        requests[i].log,
        commit.report,
        { page: argv.page },
      )
      lastBatch = [commit, batch]
    } else {
      ;[commit, batch] = lastBatch
    }

    const msgIdsToExec = [] as string[]
    while (
      i < requests.length &&
      requests[i].message.header.sequenceNumber <= commit.report.maxSeqNr &&
      msgIdsToExec.length < MAX_EXECS_IN_BATCH
    ) {
      msgIdsToExec.push(requests[i++].message.header.messageId)
    }

    const manualExecReport = calculateManualExecProof(
      batch.map(({ message }) => message),
      firstRequest.lane,
      msgIdsToExec,
      commit.report.merkleRoot,
    )
    const requestsToExec = manualExecReport.messages.map(
      ({ header }) =>
        requests.find(({ message }) => message.header.messageId === header.messageId)!,
    )
    const offchainTokenData = await Promise.all(
      requestsToExec.map(async (request) => {
        const tx = await lazyCached(`tx ${request.log.transactionHash}`, () =>
          source.getTransactionReceipt(request.log.transactionHash).then((res) => {
            if (!res) throw new Error(`Tx not found: ${request.log.transactionHash}`)
            return res
          }),
        )
        return fetchOffchainTokenData({ ...request, tx })
      }),
    )
    const execReport = { ...manualExecReport, offchainTokenData }
    const getGasLimitOverride = (message: { gasLimit: bigint } | { extraArgs: string }): bigint => {
      if (argv.gasLimit != null) {
        const argvGasLimit = BigInt(argv.gasLimit)
        let msgGasLimit
        if ('gasLimit' in message) {
          msgGasLimit = message.gasLimit
        } else {
          const parsedArgs = parseExtraArgs(message.extraArgs, source.network.family)
          if (!parsedArgs || !('gasLimit' in parsedArgs) || !parsedArgs.gasLimit) {
            throw new Error(`Missing gasLimit argument`)
          }
          msgGasLimit = BigInt(parsedArgs.gasLimit)
        }
        if (argvGasLimit > msgGasLimit) {
          return argvGasLimit
        }
      }
      return 0n
    }

    let manualExecTx
    if (firstRequest.lane.version === CCIPVersion.V1_2) {
      const gasOverrides = manualExecReport.messages.map((message) =>
        getGasLimitOverride(message as CCIPMessage<typeof CCIPVersion.V1_2>),
      )
      manualExecTx = await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_2>
      ).manuallyExecute(
        execReport as {
          offchainTokenData: string[][]
          messages: CCIPMessage<typeof CCIPVersion.V1_2>[]
          proofs: string[]
          proofFlagBits: bigint
        },
        gasOverrides,
        { nonce: nonce++, gasLimit: argv.gasLimit ? argv.gasLimit : undefined },
      )
    } else if (firstRequest.lane.version === CCIPVersion.V1_5) {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: getGasLimitOverride(
          message as CCIPMessage<typeof CCIPVersion.V1_5>,
        ),
        tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
      }))
      manualExecTx = await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_5>
      ).manuallyExecute(
        execReport as {
          offchainTokenData: string[][]
          messages: CCIPMessage<typeof CCIPVersion.V1_5>[]
          proofs: string[]
          proofFlagBits: bigint
        },
        gasOverrides,
        { nonce: nonce++, gasLimit: argv.gasLimit ? argv.gasLimit : undefined },
      )
    } else {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: getGasLimitOverride(
          message as CCIPMessage<typeof CCIPVersion.V1_6>,
        ),
        tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
      }))
      manualExecTx = await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_6>
      ).manuallyExecute(
        [
          {
            sourceChainSelector: firstRequest.lane.sourceChainSelector,
            messages: execReport.messages as (CCIPMessage<typeof CCIPVersion.V1_6> & {
              gasLimit: bigint
            })[],
            proofs: execReport.proofs,
            proofFlagBits: execReport.proofFlagBits,
            offchainTokenData: execReport.offchainTokenData,
          },
        ],
        [gasOverrides],
        { nonce: nonce++, gasLimit: argv.gasLimit ? argv.gasLimit : undefined },
      )
    }

    const toExec = requests[i - 1] // log only request data for last msg in msgIdsToExec
    console.log(
      `🚀 [${i}/${requests.length}, ${batch.length} batch, ${msgIdsToExec.length} to exec]`,
      'source tx =',
      toExec.log.transactionHash,
      'msgId =',
      toExec.message.header.messageId,
      'nonce =',
      toExec.message.header.nonce,
      'manualExec tx =',
      manualExecTx.hash,
      'to =',
      manualExecTx.to,
      'gasLimit =',
      manualExecTx.gasLimit,
    )
    txsPending.push(manualExecTx)
    if (txsPending.length >= MAX_PENDING_TXS) {
      console.debug(
        'awaiting',
        txsPending.length,
        'txs:',
        txsPending.map((tx) => tx.hash),
      )
      await txsPending[txsPending.length - 1].wait()
      txsPending.length = 0
    }
  }
}
*/
