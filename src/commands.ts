/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  Contract,
  hexlify,
  isHexString,
  parseUnits,
  type Provider,
  toUtf8Bytes,
  ZeroAddress,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import util from 'util'

import Router from './abi/Router.js'
import {
  bigIntReplacer,
  calculateManualExecProof,
  type CCIPRequest,
  CCIPVersion_1_2,
  chainIdFromName,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  chainSelectorFromId,
  encodeExtraArgs,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchOffRamp,
  fetchRequestsForSender,
  getSomeBlockNumberBefore,
  lazyCached,
} from './lib/index.js'
import {
  getTxInAnyProvider,
  getWallet,
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  TokenABI,
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
    wallet?: string
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

  const wallet = (await getWallet(argv)).connect(dest)

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
    wallet?: string
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

  const wallet = (await getWallet(argv)).connect(dest)

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

type AnyMessage = Parameters<TypedContract<typeof Router>['ccipSend']>[1]

export async function sendMessage(
  providers: Record<number, Provider>,
  argv: {
    source: string
    dest: string
    router: string
    receiver?: string
    data?: string
    'gas-limit'?: number
    'allow-out-of-order-exec'?: boolean
    'fee-token'?: string
    'transfer-tokens'?: string[]
    format: Format
    wallet?: string
  },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = providers[sourceChainId]
  if (!source) throw new Error(`No provider for source chain: "${chainNameFromId(sourceChainId)}"`)
  const wallet = (await getWallet(argv)).connect(source)

  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const destSelector = chainSelectorFromId(destChainId)

  // parse `--transfer-tokens token1=amount1 token2=amount2 ...` into `{ token, amount }[]`
  const tokenAmounts = []
  if (argv['transfer-tokens']) {
    for (const tokenAmount of argv['transfer-tokens']) {
      const [token, amount_] = tokenAmount.split('=')
      const decimals = await lazyCached(`decimals ${token}`, () => {
        const contract = new Contract(token, TokenABI, source) as unknown as TypedContract<
          typeof TokenABI
        >
        return contract.decimals()
      })
      const amount = parseUnits(amount_, decimals)
      tokenAmounts.push({ token, amount })
    }
  }

  // `--allow-out-of-order-exec` forces EVMExtraArgsV2, which shouldn't work on v1.2 lanes;
  // otherwise, fallsback to EVMExtraArgsV1 (compatible with v1.2 & v1.5)
  const extraArgs = {
    ...(argv['allow-out-of-order-exec'] != null
      ? { allowOutOfOrderExecution: argv['allow-out-of-order-exec'] }
      : {}),
    ...(argv['gas-limit'] != null ? { gasLimit: BigInt(argv['gas-limit']) } : {}),
  }

  const receiver = argv.receiver ?? wallet.address
  const message: AnyMessage = {
    receiver: zeroPadValue(receiver, 32), // receiver must be 32B value-encoded
    data: !argv.data ? '0x' : isHexString(argv.data) ? argv.data : hexlify(toUtf8Bytes(argv.data)),
    extraArgs: encodeExtraArgs(extraArgs),
    feeToken: argv['fee-token'] ?? ZeroAddress, // feeToken=ZeroAddress means native
    tokenAmounts,
  }

  const router = new Contract(argv.router, Router, wallet) as unknown as TypedContract<
    typeof Router
  >

  // calculate fee
  const fee = await router.getFee(destSelector, message)

  // make sure to approve once per token, for the total amount (including fee, if needed)
  const amountsToApprove = tokenAmounts.reduce(
    (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
    <Record<string, bigint>>{},
  )
  if (argv['fee-token']) {
    amountsToApprove[argv['fee-token']] = (amountsToApprove[argv['fee-token']] ?? 0n) + fee
  }

  // approve all tokens (including fee token) in parallel
  let nonce = await source.getTransactionCount(wallet.address)
  await Promise.all(
    Object.entries(amountsToApprove).map(async ([token, amount]) => {
      const contract = new Contract(token, TokenABI, wallet) as unknown as TypedContract<
        typeof TokenABI
      >
      const allowance = await contract.allowance(wallet.address, argv.router)
      if (allowance < amount) {
        // optimization: hardcode nonce and gasLimit to send all approvals in parallel without estimating
        const tx = await contract.approve(argv.router, amount, { nonce: nonce++, gasLimit: 50_000 })
        console.log('Approving', amount, token, 'for', argv.router, '=', tx.hash)
        await tx.wait(1, 60_000)
      }
    }),
  )

  const tx = await router.ccipSend(destSelector, message, {
    nonce: nonce++,
    // if native fee, include it in value; otherwise, it's transferedFrom fee token
    ...(!argv['fee-token'] ? { value: fee } : {}),
  })
  console.log(
    'Sending message to',
    receiver,
    '@',
    chainNameFromId(destChainId),
    ', tx_hash =',
    tx.hash,
  )

  // print CCIPRequest from tx receipt
  const receipt = (await tx.wait(1, 60_000))!
  const request = (await withLanes(source, await fetchCCIPMessagesInTx(receipt)))[0]

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
}
