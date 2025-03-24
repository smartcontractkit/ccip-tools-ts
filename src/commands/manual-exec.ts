import {
  type CCIPContract,
  type CCIPContractType,
  type CCIPMessage,
  type CCIPRequest,
  CCIPVersion,
  ExecutionState,
  bigIntReplacer,
  calculateManualExecProof,
  chainIdFromSelector,
  discoverOffRamp,
  estimateExecGasForRequest,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchRequestsForSender,
  getSomeBlockNumberBefore,
  lazyCached,
} from '../lib/index.ts'
import type { Providers } from '../providers.ts'
import { Format } from './types.ts'
import {
  getWallet,
  prettyCommit,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'

export async function manualExec(
  providers: Providers,
  txHash: string,
  argv: {
    gasLimit?: number
    estimateGasLimit?: number
    tokensGasLimit?: number
    logIndex?: number
    format: Format
    page: number
    wallet?: string
  },
) {
  const tx = await providers.getTxReceipt(txHash)
  const source = tx.provider

  let request
  if (argv.logIndex != null) {
    request = await fetchCCIPMessageInLog(tx, argv.logIndex)
  } else {
    request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }

  switch (argv.format) {
    case Format.log:
      console.log(`message ${request.log.index} =`, withDateTimestamp(request))
      break
    case Format.pretty:
      await prettyRequest(source, request)
      break
    case Format.json:
      console.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }

  const dest = await providers.forChainId(chainIdFromSelector(request.lane.destChainSelector))

  const commit = await fetchCommitReport(dest, request, { page: argv.page })
  switch (argv.format) {
    case Format.log:
      console.log(
        'commit =',
        withDateTimestamp({
          ...commit,
          timestamp: (await dest.getBlock(commit.log.blockNumber))!.timestamp,
        }),
      )
      break
    case Format.pretty:
      await prettyCommit(dest, commit, request)
      break
    case Format.json:
      console.info(JSON.stringify(commit, bigIntReplacer, 2))
      break
  }

  const requestsInBatch = await fetchAllMessagesInBatch(
    source,
    request.lane.destChainSelector,
    request.log,
    commit.report,
    { page: argv.page },
  )

  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    request.lane,
    [request.message.header.messageId],
    commit.report.merkleRoot,
  )

  const offchainTokenData = await fetchOffchainTokenData(request)
  const execReport = { ...manualExecReport, offchainTokenData: [offchainTokenData] }

  const wallet = (await getWallet(argv)).connect(dest)
  const offRampContract = await discoverOffRamp(wallet, request.lane, {
    fromBlock: commit.log.blockNumber,
    page: argv.page,
  })

  if (argv.estimateGasLimit != null) {
    let estimated = await estimateExecGasForRequest(dest, request, {
      offRamp: await offRampContract.getAddress(),
    })
    console.info('Estimated gasLimit override:', estimated)
    estimated += Math.ceil(estimated * (argv.estimateGasLimit / 100))
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

  console.debug('manualExecReport:', { ...manualExecReport, root: commit.report.merkleRoot })
  let manualExecTx
  if (request.lane.version === CCIPVersion.V1_2) {
    const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit ?? 0))
    manualExecTx = await (
      offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_2>
    ).manuallyExecute(
      execReport as {
        offchainTokenData: string[][]
        messages: CCIPMessage<CCIPVersion.V1_2>[]
        proofs: string[]
        proofFlagBits: bigint
      },
      gasOverrides,
    )
  } else if (request.lane.version === CCIPVersion.V1_5) {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
      tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
    }))
    manualExecTx = await (
      offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_5>
    ).manuallyExecute(
      execReport as {
        offchainTokenData: string[][]
        messages: CCIPMessage<CCIPVersion.V1_5>[]
        proofs: string[]
        proofFlagBits: bigint
      },
      gasOverrides,
    )
  } /* v1.6 */ else {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
      tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
    }))
    manualExecTx = await (
      offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_6>
    ).manuallyExecute(
      [
        {
          sourceChainSelector: request.lane.sourceChainSelector,
          messages: execReport.messages as CCIPMessage<CCIPVersion.V1_6>[],
          proofs: execReport.proofs,
          proofFlagBits: execReport.proofFlagBits,
          offchainTokenData: execReport.offchainTokenData,
        },
      ],
      [gasOverrides],
    )
  }

  console.log(
    '🚀 manualExec tx =',
    manualExecTx.hash,
    'to offRamp =',
    manualExecTx.to,
    'gasLimit =',
    Number(manualExecTx.gasLimit),
  )
}

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
  }
  console.info('Found', requests.length, `requests for "${firstRequest.message.sender}"`)

  const destFromBlock = await getSomeBlockNumberBefore(dest, firstRequest.timestamp)
  const lastExecState = new Map<string, ExecutionState>()
  const firstExecBlock = new Map<string, number>()
  let offRamp: string
  for await (const { receipt, log } of fetchExecutionReceipts(dest, requests, {
    fromBlock: destFromBlock,
    page: argv.page,
  })) {
    lastExecState.set(receipt.messageId, receipt.state)
    if (!firstExecBlock.has(receipt.messageId))
      firstExecBlock.set(receipt.messageId, log.blockNumber)
    offRamp ??= log.address
  }

  const requestsPending = requests.filter(({ message }) =>
    argv.execFailed
      ? lastExecState.get(message.header.messageId) !== ExecutionState.Success
      : !lastExecState.has(message.header.messageId),
  )
  console.info(requestsPending.length, `requests eligible for manualExec`)
  if (!requestsPending.length) return

  const batches = []
  let startBlock = destFromBlock
  let lastCommitMax = 0n
  for (const request of requestsPending) {
    if (request.message.header.sequenceNumber <= lastCommitMax) {
      batches[batches.length - 1][2].push(request.message.header.messageId)
      continue
    }
    const commit = await fetchCommitReport(dest, request, { startBlock, page: argv.page })
    lastCommitMax = commit.report.maxSeqNr
    startBlock = commit.log.blockNumber + 1

    const batch = await fetchAllMessagesInBatch(
      source,
      request.lane.destChainSelector,
      request.log,
      commit.report,
      { page: argv.page },
    )
    const msgIdsToExec = [request.message.header.messageId]
    batches.push([commit, batch, msgIdsToExec] as const)
  }
  console.info('Got', batches.length, 'batches to execute')

  const wallet = (await getWallet(argv)).connect(dest)

  const offRampContract = await discoverOffRamp(wallet, firstRequest.lane, {
    fromBlock: destFromBlock,
    page: argv.page,
  })

  for (const [i, [commit, batch, msgIdsToExec]] of batches.entries()) {
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

    let manualExecTx
    if (firstRequest.lane.version === CCIPVersion.V1_2) {
      const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit ?? 0))
      manualExecTx = await (
        offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_2>
      ).manuallyExecute(
        execReport as {
          offchainTokenData: string[][]
          messages: CCIPMessage<CCIPVersion.V1_2>[]
          proofs: string[]
          proofFlagBits: bigint
        },
        gasOverrides,
      )
    } else if (firstRequest.lane.version === CCIPVersion.V1_5) {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
        tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
      }))
      manualExecTx = await (
        offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_5>
      ).manuallyExecute(
        execReport as {
          offchainTokenData: string[][]
          messages: CCIPMessage<CCIPVersion.V1_5>[]
          proofs: string[]
          proofFlagBits: bigint
        },
        gasOverrides,
      )
    } /* v1.6 */ else {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
        tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
      }))
      manualExecTx = await (
        offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_6>
      ).manuallyExecute(
        [
          {
            sourceChainSelector: firstRequest.lane.sourceChainSelector,
            messages: execReport.messages as CCIPMessage<CCIPVersion.V1_6>[],
            proofs: execReport.proofs,
            proofFlagBits: execReport.proofFlagBits,
            offchainTokenData: execReport.offchainTokenData,
          },
        ],
        [gasOverrides],
      )
    }

    console.log(
      `[${i + 1} of ${batches.length}, ${batch.length} msgs]`,
      'manualExec tx =',
      manualExecTx.hash,
      'to =',
      manualExecTx.to,
      'gasLimit =',
      manualExecTx.gasLimit,
    )
  }
}
