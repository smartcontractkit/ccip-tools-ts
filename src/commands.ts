/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import type { Provider } from 'ethers'
import util from 'util'

import type { CCIPRequest } from './lib/index.js'
import {
  calculateManualExecProof,
  chainIdFromSelector,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchOffRamp,
  fetchRequestsForSender,
  getOnRampStaticConfig,
  getProviderNetwork,
  getSomeBlockNumberBefore,
  lazyCached,
} from './lib/index.js'
import {
  getTxInAnyProvider,
  getWallet,
  selectRequest,
  withDateTimestamp,
  withLanes,
} from './utils.js'

util.inspect.defaultOptions.depth = 4 // print down to tokenAmounts in requests

export async function showRequests(providers: Record<number, Provider>, txHash: string) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider
  const sourceNetworkInfo = await getProviderNetwork(source)
  console.table({ network: 'source', ...sourceNetworkInfo })

  const requests = await withLanes(source, await fetchCCIPMessagesInTx(tx))
  for (const request of requests) {
    console.log(`message ${request.log.index} =`, withDateTimestamp(request))
  }

  const request = await selectRequest(requests, 'to know more')
  const dest = providers[request.lane.dest.chainId]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${request.lane.dest.name}" [${request.lane.dest.chainId}]`,
    )
  }

  const commit = await fetchCommitReport(dest, request)
  console.log(
    'commit =',
    withDateTimestamp({
      ...commit,
      timestamp: (await dest.getBlock(commit.log.blockNumber))!.timestamp,
    }),
  )

  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock: commit.log.blockNumber,
  })) {
    console.log('receipt =', withDateTimestamp(receipt))
  }
}

export async function manualExec(
  providers: Record<number, Provider>,
  txHash: string,
  argv: {
    'gas-limit': number
    'log-index'?: number
  },
) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider
  const sourceNetworkInfo = await getProviderNetwork(source)
  console.table({ network: 'source', ...sourceNetworkInfo })

  let request
  if (argv['log-index'] != null) {
    request = await fetchCCIPMessageInLog(tx, argv['log-index'])
  } else {
    request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }

  const [, , lane] = await getOnRampStaticConfig(source, request.log.address)

  const dest = providers[chainIdFromSelector(lane.dest.chainSelector)]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${lane.dest.name}" [${lane.dest.chainId}]`,
    )
  }
  console.table({ network: 'dest', ...lane.dest })

  const commit = await fetchCommitReport(dest, request)

  const requestsInBatch = await fetchAllMessagesInBatch(source, request.log, commit.report.interval)

  const leafHasherArgs = {
    sourceChainSelector: lane.source.chainSelector,
    destChainSelector: lane.dest.chainSelector,
    onRamp: request.log.address,
  }
  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    leafHasherArgs,
    [request.message.messageId],
    commit.report.merkleRoot,
  )

  const offchainTokenData = await fetchOffchainTokenData(request, sourceNetworkInfo.isTestnet)
  const execReport = { ...manualExecReport, offchainTokenData: [offchainTokenData] }
  const gasOverrides = Array.from({ length: manualExecReport.messages.length }, () =>
    BigInt(argv['gas-limit']),
  )
  console.log('proof =', execReport, gasOverrides)

  let offRampContract = await fetchOffRamp(dest, leafHasherArgs, request.version, {
    fromBlock: commit.log.blockNumber,
  })
  console.log('offRamp =', await offRampContract.getAddress())

  const wallet = getWallet().connect(dest)
  offRampContract = offRampContract.connect(wallet) as typeof offRampContract

  const manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
  console.log('manualExec tx =', manualExecTx)
}

export async function manualExecSenderQueue(
  providers: Record<number, Provider>,
  txHash: string,
  argv: {
    'gas-limit': number
    'log-index'?: number
    'exec-failed'?: boolean
  },
) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider
  const sourceNetworkInfo = await getProviderNetwork(source)
  console.table({ network: 'source', ...sourceNetworkInfo })

  let firstRequest
  if (argv['log-index'] != null) {
    firstRequest = await fetchCCIPMessageInLog(tx, argv['log-index'])
  } else {
    firstRequest = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }
  const [, , lane] = await getOnRampStaticConfig(source, firstRequest.log.address)

  const dest = providers[lane.dest.chainId]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${lane.dest.name}" [${lane.dest.chainId}]`,
    )
  }
  console.table({ network: 'dest', ...lane.dest })

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
  console.log('Got', batches.length, 'batches to execute')

  const leafHasherArgs = {
    sourceChainSelector: lane.source.chainSelector,
    destChainSelector: lane.dest.chainSelector,
    onRamp: lane.onRamp,
  }

  let offRampContract = await fetchOffRamp(dest, leafHasherArgs, firstRequest.version, {
    fromBlock: destFromBlock,
  })
  const wallet = getWallet().connect(dest)
  offRampContract = offRampContract.connect(wallet) as typeof offRampContract

  for (const [commit, batch, msgIdsToExec] of batches) {
    const manualExecReport = calculateManualExecProof(
      batch.map(({ message }) => message),
      leafHasherArgs,
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
        return fetchOffchainTokenData({ ...request, tx }, sourceNetworkInfo.isTestnet)
      }),
    )
    const execReport = { ...manualExecReport, offchainTokenData }
    const gasOverrides = Array.from({ length: manualExecReport.messages.length }, () =>
      BigInt(argv['gas-limit']),
    )

    console.info('proof =', execReport, gasOverrides)
    const manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
    console.log('manualExec tx =', manualExecTx)
  }
}
