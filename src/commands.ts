/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  AbiCoder,
  type BytesLike,
  Contract,
  dataSlice,
  hexlify,
  isHexString,
  type Provider,
  toUtf8Bytes,
  ZeroAddress,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from './abi/BurnMintERC677Token.js'
import RouterABI from './abi/Router.js'
import {
  bigIntReplacer,
  calculateManualExecProof,
  type CCIPRequest,
  type CCIPRequestWithLane,
  CCIPVersion_1_2,
  chainIdFromName,
  chainIdFromSelector,
  chainNameFromId,
  chainSelectorFromId,
  encodeExtraArgs,
  estimateExecGasForRequest,
  fetchAllMessagesInBatch,
  fetchCCIPMessageById,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchOffRamp,
  fetchRequestsForSender,
  getFunctionBySelector,
  getSomeBlockNumberBefore,
  lazyCached,
  parseErrorData,
} from './lib/index.js'
import type { Providers } from './providers.js'
import {
  getWallet,
  parseTokenAmounts,
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
  withLanes,
} from './utils.js'

export enum Format {
  log = 'log',
  pretty = 'pretty',
  json = 'json',
}

export async function showRequests(
  providers: Providers,
  txHash: string,
  argv: { logIndex?: number; idFromSource?: string; format: Format },
) {
  let source: Provider, request: CCIPRequestWithLane
  if (argv.idFromSource) {
    const sourceChainId = isNaN(+argv.idFromSource)
      ? chainIdFromName(argv.idFromSource)
      : +argv.idFromSource
    source = await providers.forChainId(sourceChainId)
    const request_ = await fetchCCIPMessageById(source, txHash)
    request = (await withLanes(source, [request_]))[0]
  } else {
    const tx = await providers.getTxReceipt(txHash)
    source = tx.provider

    if (argv.logIndex != null) {
      const request_ = await fetchCCIPMessageInLog(tx, argv.logIndex)
      request = (await withLanes(source, [request_]))[0]
    } else {
      request = await selectRequest(
        await withLanes(source, await fetchCCIPMessagesInTx(tx)),
        'to know more',
      )
    }
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

  const commit = await fetchCommitReport(dest, request)
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

  let found = false
  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock: commit.log.blockNumber,
  })) {
    switch (argv.format) {
      case Format.log:
        console.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        if (!found) console.info('Receipts (dest):')
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
  providers: Providers,
  txHash: string,
  argv: {
    gasLimit: number
    tokensGasLimit: number
    logIndex?: number
    format: Format
    wallet?: string
  },
) {
  const tx = await providers.getTxReceipt(txHash)
  const source = tx.provider

  let request
  if (argv.logIndex != null) {
    const request_ = await fetchCCIPMessageInLog(tx, argv.logIndex)
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

  const dest = await providers.forChainId(chainIdFromSelector(request.lane.destChainSelector))

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
    const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit))
    const offRampContract = await fetchOffRamp(wallet, request.lane, request.version, {
      fromBlock: commit.log.blockNumber,
    })
    manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
  } else {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv.gasLimit),
      tokenGasOverrides: message.sourceTokenData.map(() => BigInt(argv.tokensGasLimit)),
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
  providers: Providers,
  txHash: string,
  argv: {
    gasLimit: number
    tokensGasLimit: number
    logIndex?: number
    execFailed?: boolean
    format: Format
    wallet?: string
  },
) {
  const tx = await providers.getTxReceipt(txHash)
  const source = tx.provider

  let firstRequest
  if (argv.logIndex != null) {
    const firstRequest_ = await fetchCCIPMessageInLog(tx, argv.logIndex)
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

  const dest = await providers.forChainId(chainIdFromSelector(firstRequest.lane.destChainSelector))

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
    argv.execFailed
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
      const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit))
      manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
    } else {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv.gasLimit),
        tokenGasOverrides: message.sourceTokenData.map(() => BigInt(argv.tokensGasLimit)),
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

type AnyMessage = Parameters<TypedContract<typeof RouterABI>['ccipSend']>[1]

export async function sendMessage(
  providers: Providers,
  argv: {
    source: string
    dest: string
    router: string
    receiver?: string
    data?: string
    gasLimit?: number
    estimateGasLimit?: number
    allowOutOfOrderExec?: boolean
    feeToken?: string
    transferTokens?: string[]
    format: Format
    wallet?: string
  },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = await providers.forChainId(sourceChainId)
  const wallet = (await getWallet(argv)).connect(source)

  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const destSelector = chainSelectorFromId(destChainId)

  let tokenAmounts: { token: string; amount: bigint }[] = []
  if (argv.transferTokens) {
    tokenAmounts = await parseTokenAmounts(source, argv.transferTokens)
  }

  const receiver = argv.receiver ?? wallet.address
  const data = !argv.data
    ? '0x'
    : isHexString(argv.data)
      ? argv.data
      : hexlify(toUtf8Bytes(argv.data))

  if (argv.estimateGasLimit != null) {
    const gasLimit = await estimateExecGasForRequest(
      source,
      await providers.forChainId(destChainId),
      argv.router,
      {
        sender: wallet.address,
        receiver,
        data,
        tokenAmounts,
      },
    )
    argv.gasLimit = Math.ceil(gasLimit * (1 + argv.estimateGasLimit / 100))
  }

  // `--allow-out-of-order-exec` forces EVMExtraArgsV2, which shouldn't work on v1.2 lanes;
  // otherwise, fallsback to EVMExtraArgsV1 (compatible with v1.2 & v1.5)
  const extraArgs = {
    ...(argv.allowOutOfOrderExec != null
      ? { allowOutOfOrderExecution: argv.allowOutOfOrderExec }
      : {}),
    ...(argv.gasLimit != null ? { gasLimit: BigInt(argv.gasLimit) } : {}),
  }

  const message: AnyMessage = {
    receiver: zeroPadValue(receiver, 32), // receiver must be 32B value-encoded
    data,
    extraArgs: encodeExtraArgs(extraArgs),
    feeToken: argv.feeToken ?? ZeroAddress, // feeToken=ZeroAddress means native
    tokenAmounts,
  }

  const router = new Contract(argv.router, RouterABI, wallet) as unknown as TypedContract<
    typeof RouterABI
  >

  // calculate fee
  const fee = await router.getFee(destSelector, message)

  // make sure to approve once per token, for the total amount (including fee, if needed)
  const amountsToApprove = tokenAmounts.reduce(
    (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
    <Record<string, bigint>>{},
  )
  if (argv.feeToken) {
    amountsToApprove[argv.feeToken] = (amountsToApprove[argv.feeToken] ?? 0n) + fee
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
    ...(!argv.feeToken ? { value: fee } : {}),
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

const defaultAbiCoder = AbiCoder.defaultAbiCoder()
export function parseData(data: BytesLike) {
  const func = getFunctionBySelector(dataSlice(data, 0, 4))
  if (func) {
    const [fragment, contract] = func
    const args = defaultAbiCoder.decode(fragment.inputs, dataSlice(data, 4))
    console.info('Function:', `${contract}.${fragment.format()}`)
    console.info('Args:', args.toObject(true))
    return
  }

  const error = parseErrorData(data)
  if (error) {
    const [parsed, contract] = error
    console.info('Error:', `${contract}.${parsed.signature}`)
    console.info('Args:', parsed.args.toObject(true))
    return
  }

  throw new Error('Unknown data')
}

export async function estimateGas(
  providers: Providers,
  argv: {
    source: string
    dest: string
    router: string
    receiver: string
    sender?: string
    data?: string
    offRamp?: string
    transferTokens?: string[]
  },
) {
  const source = await providers.forChainId(
    isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source,
  )
  const dest = await providers.forChainId(
    isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest,
  )

  const data = !argv.data
    ? '0x'
    : isHexString(argv.data)
      ? argv.data
      : hexlify(toUtf8Bytes(argv.data))
  let tokenAmounts: { token: string; amount: bigint }[] = []
  if (argv.transferTokens) {
    tokenAmounts = await parseTokenAmounts(source, argv.transferTokens)
  }

  const gas = await estimateExecGasForRequest(source, dest, argv.router, {
    sender: argv.sender ?? ZeroAddress,
    receiver: argv.receiver,
    data,
    tokenAmounts,
  })
  console.log('Estimated gas:', gas)
}
