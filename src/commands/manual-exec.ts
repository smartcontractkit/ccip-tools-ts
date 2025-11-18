import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { Format } from './types.ts'
import {
  logParsedError,
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'
import type { EVMChain } from '../lib/evm/index.ts'
import { discoverOffRamp } from '../lib/execution.ts'
import {
  type ChainStatic,
  ChainFamily,
  bigIntReplacer,
  calculateManualExecProof,
  estimateExecGasForRequest,
  fetchAllMessagesInBatch,
  fetchCCIPMessagesInTx,
} from '../lib/index.ts'
import type { CCIPRequest, CCIPVersion, ExecutionReport } from '../lib/types.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

// const MAX_QUEUE = 1000
// const MAX_EXECS_IN_BATCH = 1
// const MAX_PENDING_TXS = 25

export const command = 'manualExec <tx-hash>'
export const describe = 'Execute manually pending or failed messages'

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
      'clear-buffer-first': {
        type: 'boolean',
        describe: 'Forces clearing the buffer (if a previous attempt was aborted).',
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

export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  if (!argv.wallet) argv.wallet = process.env['USER_KEY'] || process.env['OWNER_KEY']
  let destroy
  const destroy$ = new Promise((resolve) => {
    destroy = resolve
  })
  // argv.senderQueue
  //   ? manualExecSenderQueue(providers, argv.tx_hash, argv)
  //   : manualExec(argv, destroy$)
  return manualExec(argv, destroy$)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError(err)) console.error(err)
    })
    .finally(destroy)
}

async function manualExec(
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
  destroy: Promise<unknown>,
) {
  // messageId not yet implemented for Solana
  const [getChain, tx$] = fetchChainsFromRpcs(argv, argv.txHash, destroy)
  const tx = await tx$
  const source = tx.chain
  const request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to know more', argv)

  switch (argv.format) {
    case Format.log: {
      const logPrefix = 'log' in request ? `message ${request.log.index} = ` : 'message = '
      console.log(logPrefix, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest(source, request)
      break
    case Format.json:
      console.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }

  const dest = await getChain(request.lane.destChainSelector)
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp)
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)
  const commit = await dest.fetchCommitReport(commitStore, request, argv)

  switch (argv.format) {
    case Format.log:
      console.log('commit =', commit)
      break
    case Format.pretty:
      await prettyCommit(dest, commit, request)
      break
    case Format.json:
      console.info(JSON.stringify(commit, bigIntReplacer, 2))
      break
  }

  const messagesInBatch = await fetchAllMessagesInBatch(source, request, commit.report, argv)
  const execReportProof = calculateManualExecProof(
    messagesInBatch,
    request.lane,
    request.message.header.messageId,
    commit.report.merkleRoot,
  )

  const offchainTokenData = await source.fetchOffchainTokenData(request)
  const execReport: ExecutionReport = {
    ...execReportProof,
    message: request.message,
    offchainTokenData: offchainTokenData,
  }

  if (
    argv.estimateGasLimit != null &&
    'gasLimit' in request.message &&
    'extraArgs' in request.message
  ) {
    if (dest.network.family !== ChainFamily.EVM)
      throw new Error('Gas estimation is only supported for EVM networks for now')

    let estimated = await estimateExecGasForRequest(
      source,
      dest as unknown as EVMChain,
      request as CCIPRequest<typeof CCIPVersion.V1_5 | typeof CCIPVersion.V1_6>,
    )
    console.info('Estimated gasLimit override:', estimated)
    estimated += Math.ceil((estimated * argv.estimateGasLimit) / 100)
    if (request.message.gasLimit >= estimated) {
      console.warn(
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

  const manualExecTx = await dest.executeReport(offRamp, execReport, argv)

  console.log('🚀 manualExec tx =', manualExecTx.hash, 'to offRamp =', offRamp)

  let found = false
  for (const log of manualExecTx.logs) {
    const execReceipt = (dest.constructor as ChainStatic).decodeReceipt(log)
    if (!execReceipt) continue
    const timestamp = await dest.getBlockTimestamp(log.blockNumber)
    const receipt = { receipt: execReceipt, log, timestamp }
    switch (argv.format) {
      case Format.log:
        console.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        if (!found) console.info('Receipts (dest):')
        prettyReceipt(
          receipt,
          request,
          receipt.log.tx?.from ??
            (await dest.getTransaction(receipt.log.transactionHash).catch(() => null))?.from,
        )
        break
      case Format.json:
        console.info(JSON.stringify(execReceipt, bigIntReplacer, 2))
        break
    }
    found = true
  }
  if (!found) throw new Error(`Could not find receipt in tx logs`)
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
