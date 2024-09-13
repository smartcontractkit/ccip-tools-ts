/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import type { Provider } from 'ethers'
import util from 'util'

import {
  bigIntReplacer,
  calculateManualExecProof,
  type CCIPRequest,
  CCIPVersion_1_2,
  chainIdFromSelector,
  chainNameFromSelector,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchOffRamp,
  fetchRequestsForSender,
  getOnRampStaticConfig,
  getSomeBlockNumberBefore,
  lazyCached,
  networkInfo,
} from './lib/index.js'
import {
  getTxInAnyProvider,
  getWallet,
  prettyCommit,
  prettyLane,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
  withLanes,
} from './utils.js'

util.inspect.defaultOptions.depth = 4 // print down to tokenAmounts in requests

export enum Format {
  log = 'log',
  pretty = 'pretty',
  json = 'json',
}

export async function showRequests(
  providers: Record<number, Provider>,
  txHash: string,
  format: Format,
) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider

  const requests = await withLanes(source, await fetchCCIPMessagesInTx(tx))
  const request = await selectRequest(requests, 'to know more')

  switch (format) {
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

  const dest = providers[chainIdFromSelector(request.lane.destChainSelector)]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${chainNameFromSelector(request.lane.destChainSelector)}" [${chainIdFromSelector(request.lane.destChainSelector)}]`,
    )
  }

  const commit = await fetchCommitReport(dest, request)
  switch (format) {
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

  let found = false
  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock: commit.log.blockNumber,
  })) {
    switch (format) {
      case Format.log:
        console.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        if (!found) console.info('Receipts:')
        prettyReceipt(receipt, request)
        break
      case Format.json:
        console.info(JSON.stringify(receipt, bigIntReplacer, 2))
        break
    }
    found = true
  }
  if (!found) console.warn(`No execution receipt found for request`)
}

export async function manualExec(
  providers: Record<number, Provider>,
  txHash: string,
  argv: {
    'gas-limit': number
    'tokens-gas-limit': number
    'log-index'?: number
    format: Format
  },
) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider

  let request
  if (argv['log-index'] != null) {
    const request_ = await fetchCCIPMessageInLog(tx, argv['log-index'])
    request = (await withLanes(source, [request_]))[0]
  } else {
    request = await selectRequest(
      await withLanes(source, await fetchCCIPMessagesInTx(tx)),
      'to execute',
    )
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

  const dest = providers[chainIdFromSelector(request.lane.destChainSelector)]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${chainNameFromSelector(request.lane.destChainSelector)}" [${chainIdFromSelector(request.lane.destChainSelector)}]`,
    )
  }

  const commit = await fetchCommitReport(dest, request)
  const requestsInBatch = await fetchAllMessagesInBatch(source, request.log, commit.report.interval)

  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    request.lane,
    [request.message.messageId],
    commit.report.merkleRoot,
  )

  const offchainTokenData = await fetchOffchainTokenData(request)
  const execReport = { ...manualExecReport, offchainTokenData: [offchainTokenData] }

  const wallet = getWallet().connect(dest)

  let manualExecTx
  if (request.version === CCIPVersion_1_2) {
    const gasOverrides = manualExecReport.messages.map(() => BigInt(argv['gas-limit']))
    const offRampContract = await fetchOffRamp(wallet, request.lane, request.version, {
      fromBlock: commit.log.blockNumber,
    })
    manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
  } else {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv['gas-limit']),
      tokenGasOverrides: message.sourceTokenData.map(() => BigInt(argv['tokens-gas-limit'])),
    }))
    const offRampContract = await fetchOffRamp(wallet, request.lane, request.version, {
      fromBlock: commit.log.blockNumber,
    })
    manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
  }

  console.log(
    '🚀 manualExec tx =',
    manualExecTx.hash,
    ', to =',
    manualExecTx.to,
    ', gasLimit =',
    manualExecTx.gasLimit,
  )
}

export async function manualExecSenderQueue(
  providers: Record<number, Provider>,
  txHash: string,
  argv: {
    'gas-limit': number
    'tokens-gas-limit': number
    'log-index'?: number
    'exec-failed'?: boolean
    format: Format
  },
) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider

  let firstRequest
  if (argv['log-index'] != null) {
    const firstRequest_ = await fetchCCIPMessageInLog(tx, argv['log-index'])
    firstRequest = (await withLanes(source, [firstRequest_]))[0]
  } else {
    firstRequest = await selectRequest(
      await withLanes(source, await fetchCCIPMessagesInTx(tx)),
      'to execute',
    )
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

  const dest = providers[chainIdFromSelector(firstRequest.lane.destChainSelector)]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${chainNameFromSelector(firstRequest.lane.destChainSelector)}" [${chainIdFromSelector(firstRequest.lane.destChainSelector)}]`,
    )
  }

  const requests: Omit<CCIPRequest, 'timestamp' | 'tx'>[] = []
  for await (const request of fetchRequestsForSender(source, firstRequest)) {
    requests.push(request)
  }
  console.info('Found', requests.length, `requests for "${firstRequest.message.sender}"`)

  const destFromBlock = await getSomeBlockNumberBefore(dest, firstRequest.timestamp)
  const lastExecSuccess = new Map<string, boolean>()
  const firstExecBlock = new Map<string, number>()
  let offRamp: string
  for await (const { receipt, log } of fetchExecutionReceipts(dest, requests, {
    fromBlock: destFromBlock,
  })) {
    lastExecSuccess.set(receipt.messageId, receipt.state === 2n)
    if (!firstExecBlock.has(receipt.messageId))
      firstExecBlock.set(receipt.messageId, log.blockNumber)
    offRamp ??= log.address
  }

  const requestsPending = requests.filter(({ message }) =>
    argv['exec-failed']
      ? lastExecSuccess.get(message.messageId) !== true
      : !lastExecSuccess.has(message.messageId),
  )
  console.info(requestsPending.length, `requests eligible for manualExec`)
  if (!requestsPending.length) return

  const batches = []
  let startBlock = destFromBlock
  let lastCommitMax = 0n
  for (const request of requestsPending) {
    if (request.message.sequenceNumber <= lastCommitMax) {
      batches[batches.length - 1][2].push(request.message.messageId)
      continue
    }
    const commit = await fetchCommitReport(dest, request, { startBlock })
    lastCommitMax = commit.report.interval.max
    startBlock = commit.log.blockNumber + 1

    const batch = await fetchAllMessagesInBatch(source, request.log, commit.report.interval)
    const msgIdsToExec = [request.message.messageId]
    batches.push([commit, batch, msgIdsToExec] as const)
  }
  console.info('Got', batches.length, 'batches to execute')

  const wallet = getWallet().connect(dest)

  const offRampContract = await fetchOffRamp(wallet, firstRequest.lane, firstRequest.version, {
    fromBlock: destFromBlock,
  })

  for (const [i, [commit, batch, msgIdsToExec]] of batches.entries()) {
    const manualExecReport = calculateManualExecProof(
      batch.map(({ message }) => message),
      firstRequest.lane,
      msgIdsToExec,
      commit.report.merkleRoot,
    )
    const requestsToExec = manualExecReport.messages.map(
      ({ messageId }) => requests.find(({ message }) => message.messageId === messageId)!,
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
    if (firstRequest.version === CCIPVersion_1_2) {
      const gasOverrides = manualExecReport.messages.map(() => BigInt(argv['gas-limit']))
      manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
    } else {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv['gas-limit']),
        tokenGasOverrides: message.sourceTokenData.map(() => BigInt(argv['tokens-gas-limit'])),
      }))
      manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
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
