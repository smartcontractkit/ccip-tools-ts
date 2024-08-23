import type { Provider } from 'ethers'
import util from 'util'

import {
  calculateManualExecProof,
  type CCIPRequest,
  type CCIPRequestWithLane,
  chainIdFromSelector,
  chainNameFromId,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchOffRamp,
  getOnRampStaticConfig,
  getProviderNetwork,
} from './lib/index.js'
import { getTxInAnyProvider, getWallet, selectRequest, withDateTimestamp } from './utils.js'

util.inspect.defaultOptions.depth = 4 // print down to tokenAmounts in requests

export async function showRequests(providers: Record<number, Provider>, txHash: string) {
  const tx = await getTxInAnyProvider(providers, txHash)
  const source = tx.provider
  const sourceNetworkInfo = await getProviderNetwork(source)
  console.log('source =', sourceNetworkInfo)

  const requests = await fetchCCIPMessagesInTx(tx)

  const requestsWithLane: CCIPRequestWithLane[] = []
  for (const request of requests) {
    const onRamp = request.log.address
    const [, , lane] = await getOnRampStaticConfig(source, onRamp)

    const requestWithLane: CCIPRequestWithLane = {
      ...request,
      lane,
    }
    requestsWithLane.push(requestWithLane)
    console.log(`message ${request.log.index} =`, withDateTimestamp(requestWithLane))
  }

  const request = await selectRequest(requestsWithLane, 'to know more')
  const dest = providers[request.lane.dest.chainId]
  if (!dest) {
    throw new Error(
      `Could not find an RPC for dest network: "${request.lane.dest.name}" [${request.lane.dest.chainId}]`,
    )
  }

  const commit = await fetchCommitReport(dest, request)
  console.log('commit =', withDateTimestamp(commit))

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
  console.log('source =', sourceNetworkInfo)

  let request: CCIPRequest
  if (argv['log-index'] != null) {
    request = await fetchCCIPMessageInLog(tx, argv['log-index'])
  } else {
    request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }

  const onRamp = request.log.address
  const sourceChainSelector = request.message.sourceChainSelector
  const [{ destChainSelector }] = await getOnRampStaticConfig(source, onRamp)

  const dest = providers[Number(chainIdFromSelector(destChainSelector))]
  if (!dest) {
    const destChainId = chainIdFromSelector(destChainSelector)
    throw new Error(
      `Could not find an RPC for dest network: "${chainNameFromId(destChainId)}" [${destChainId}]`,
    )
  }
  console.log('dest =', await getProviderNetwork(dest))

  const commit = await fetchCommitReport(dest, request)

  const requestsInBatch = await fetchAllMessagesInBatch(source, request.log, commit.report.interval)

  const leafHasherArgs = { sourceChainSelector, destChainSelector, onRamp: request.log.address }
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
