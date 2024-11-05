/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  type Provider,
  type Result,
  Contract,
  ZeroAddress,
  dataSlice,
  hexlify,
  isBytesLike,
  isHexString,
  toUtf8Bytes,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from './abi/BurnMintERC677Token.js'
import RouterABI from './abi/Router.js'
import {
  type CCIPRequest,
  CCIPContractTypeOffRamp,
  CCIPVersion_1_2,
  ExecutionState,
  bigIntReplacer,
  calculateManualExecProof,
  chainIdFromName,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  chainSelectorFromId,
  discoverOffRamp,
  encodeExtraArgs,
  estimateExecGasForRequest,
  fetchAllMessagesInBatch,
  fetchCCIPMessageById,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchRequestsForSender,
  getOnRampLane,
  getSomeBlockNumberBefore,
  getTypeAndVersion,
  lazyCached,
  parseWithFragment,
} from './lib/index.js'
import type { Providers } from './providers.js'
import {
  getWallet,
  parseTokenAmounts,
  prettyCommit,
  prettyLane,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.js'

export enum Format {
  log = 'log',
  pretty = 'pretty',
  json = 'json',
}

export async function showRequests(
  providers: Providers,
  txHash: string,
  argv: { logIndex?: number; idFromSource?: string; format: Format; page: number },
) {
  let source: Provider, request: CCIPRequest
  if (argv.idFromSource) {
    const sourceChainId = isNaN(+argv.idFromSource)
      ? chainIdFromName(argv.idFromSource)
      : +argv.idFromSource
    source = await providers.forChainId(sourceChainId)
    request = await fetchCCIPMessageById(source, txHash)
  } else {
    const tx = await providers.getTxReceipt(txHash)
    source = tx.provider

    if (argv.logIndex != null) {
      request = await fetchCCIPMessageInLog(tx, argv.logIndex)
    } else {
      request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to know more')
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

  let found = false
  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock: commit.log.blockNumber,
    page: argv.page,
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
  const requestsInBatch = await fetchAllMessagesInBatch(
    source,
    request.log,
    commit.report.interval,
    { page: argv.page },
  )

  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    request.lane,
    [request.message.messageId],
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
    const estimated = await estimateExecGasForRequest(
      source,
      dest,
      request.lane.onRamp,
      {
        sender: request.message.sender as string,
        receiver: request.message.receiver as string,
        data: request.message.data,
        tokenAmounts: request.message.tokenAmounts as { token: string; amount: bigint }[],
      },
      { offRamp: await offRampContract.getAddress() },
    )
    console.log('Estimated gasLimit override:', estimated)
    argv.gasLimit = Math.ceil(estimated * (1 + argv.estimateGasLimit / 100))
  }

  let manualExecTx
  if (request.lane.version === CCIPVersion_1_2) {
    const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit ?? 0))
    manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
  } else {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
      tokenGasOverrides: message.sourceTokenData.map(() => BigInt(argv.tokensGasLimit ?? 0)),
    }))
    manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
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
      ? lastExecState.get(message.messageId) !== ExecutionState.Success
      : !lastExecState.has(message.messageId),
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
    const commit = await fetchCommitReport(dest, request, { startBlock, page: argv.page })
    lastCommitMax = commit.report.interval.max
    startBlock = commit.log.blockNumber + 1

    const batch = await fetchAllMessagesInBatch(source, request.log, commit.report.interval, {
      page: argv.page,
    })
    const msgIdsToExec = [request.message.messageId]
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
    if (firstRequest.lane.version === CCIPVersion_1_2) {
      const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit ?? 0))
      manualExecTx = await offRampContract.manuallyExecute(execReport, gasOverrides)
    } else {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
        tokenGasOverrides: message.sourceTokenData.map(() => BigInt(argv.tokensGasLimit ?? 0)),
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

  const router = new Contract(argv.router, RouterABI, wallet) as unknown as TypedContract<
    typeof RouterABI
  >

  if (argv.estimateGasLimit != null) {
    const onRamp = (await router.getOnRamp(destSelector)) as string
    if (!onRamp || onRamp === ZeroAddress)
      throw new Error(
        `No "${chainNameFromId(sourceChainId)}" -> "${chainNameFromId(destChainId)}" lane on ${argv.router}`,
      )
    const estimated = await estimateExecGasForRequest(
      source,
      await providers.forChainId(destChainId),
      onRamp,
      {
        sender: wallet.address,
        receiver,
        data,
        tokenAmounts,
      },
    )
    console.log('Estimated gasLimit:', estimated)
    argv.gasLimit = Math.ceil(estimated * (1 + argv.estimateGasLimit / 100))
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
  const request = (await fetchCCIPMessagesInTx(receipt))[0]

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

export async function estimateGas(
  providers: Providers,
  argv: {
    source: string
    dest: string
    router: string
    receiver: string
    sender?: string
    data?: string
    transferTokens?: string[]
    page: number
  },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = await providers.forChainId(sourceChainId)
  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const dest = await providers.forChainId(destChainId)

  const data = !argv.data
    ? '0x'
    : isHexString(argv.data)
      ? argv.data
      : hexlify(toUtf8Bytes(argv.data))
  let tokenAmounts: { token: string; amount: bigint }[] = []
  if (argv.transferTokens) {
    tokenAmounts = await parseTokenAmounts(source, argv.transferTokens)
  }

  const router = new Contract(argv.router, RouterABI, source) as unknown as TypedContract<
    typeof RouterABI
  >
  const onRamp = (await router.getOnRamp(chainSelectorFromId(destChainId))) as string
  if (!onRamp || onRamp === ZeroAddress)
    throw new Error(
      `No "${chainNameFromId(sourceChainId)}" -> "${chainNameFromId(destChainId)}" lane on ${argv.router}`,
    )

  const gas = await estimateExecGasForRequest(
    source,
    dest,
    onRamp,
    {
      sender: argv.sender ?? ZeroAddress,
      receiver: argv.receiver,
      data,
      tokenAmounts,
    },
    { page: argv.page },
  )
  console.log('Estimated gas:', gas)
}

export function parseBytes({ data, selector }: { data: string; selector?: string }) {
  let parsed
  if (selector) {
    parsed = parseWithFragment(selector, data)
  } else {
    if (isBytesLike(data)) {
      parsed = parseWithFragment(dataSlice(data, 0, 4), dataSlice(data, 4))
    }
    if (!parsed) {
      parsed = parseWithFragment(data)
    }
  }
  if (!parsed) throw new Error('Unknown data')
  const [fragment, contract, args] = parsed
  const name = fragment.constructor.name.replace(/Fragment$/, '')
  console.info(`${name}: ${contract}.${fragment.format()}`)
  if (args) {
    let formatted
    try {
      formatted = args.toObject(true)
    } catch (_) {
      try {
        formatted = args.toObject()
      } catch (_) {
        formatted = args.toArray()
      }
    }
    console.info('Args:', formatted)
    if (args.length === 1) {
      if (args.returnData) {
        console.info('Inner returnData:')
        parseBytes({ data: args.returnData as string })
      } else if (args.error) {
        console.info('Inner error:')
        parseBytes({ data: args.error as string })
      }
    }
  }
}

export async function showLaneConfigs(
  providers: Providers,
  argv: { source: string; onramp_or_router: string; dest?: string; format: Format; page: number },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = await providers.forChainId(sourceChainId)
  let onramp
  if (argv.dest) {
    const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
    const router = new Contract(
      argv.onramp_or_router,
      RouterABI,
      source,
    ) as unknown as TypedContract<typeof RouterABI>
    onramp = (await router.getOnRamp(chainSelectorFromId(destChainId))) as string
  } else {
    onramp = argv.onramp_or_router
  }
  const [lane, onrampContract] = await getOnRampLane(source, onramp)
  switch (argv.format) {
    case Format.log:
      console.log('Lane:', lane)
      break
    case Format.pretty:
      prettyLane(lane)
      break
    case Format.json:
      console.info(JSON.stringify(lane, bigIntReplacer, 2))
      break
  }

  const [staticConfig, dynamicConfig] = await Promise.all([
    onrampContract.getStaticConfig(),
    onrampContract.getDynamicConfig(),
  ])
  if (dynamicConfig.router !== ZeroAddress) {
    const router = new Contract(
      dynamicConfig.router,
      RouterABI,
      source,
    ) as unknown as TypedContract<typeof RouterABI>
    const onRampInRouter = (await router.getOnRamp(lane.destChainSelector)) as string
    if (onRampInRouter !== onramp) {
      console.warn(
        `OnRamp=${onramp} is not registered in Router=${await router.getAddress()} for dest="${chainNameFromSelector(lane.destChainSelector)}"; instead, have=${onRampInRouter}`,
      )
    }
  }
  if (argv.dest && argv.onramp_or_router !== dynamicConfig.router) {
    console.warn(
      `OnRamp=${onramp} has Router=${dynamicConfig.router} set instead of ${argv.onramp_or_router}`,
    )
  }
  switch (argv.format) {
    case Format.log:
      console.log('OnRamp configs:', {
        staticConfig: (staticConfig as unknown as Result).toObject(),
        dynamicConfig: (dynamicConfig as unknown as Result).toObject(),
      })
      break
    case Format.pretty:
      console.info('OnRamp configs:')
      console.table({
        ...(staticConfig as unknown as Result).toObject(),
        ...(dynamicConfig as unknown as Result).toObject(),
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            onRamp: {
              staticConfig: (staticConfig as unknown as Result).toObject(),
              dynamicConfig: (dynamicConfig as unknown as Result).toObject(),
            },
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }

  const dest = await providers.forChainId(chainIdFromSelector(lane.destChainSelector))
  const offRampContract = await discoverOffRamp(dest, lane, { page: argv.page })
  const offRamp = await offRampContract.getAddress()
  const [offType, offVersion, offTnV] = await getTypeAndVersion(dest, offRamp)
  console.info('OffRamp:', offRamp, 'is', offTnV)
  if (offType !== CCIPContractTypeOffRamp || offVersion !== lane.version) {
    console.warn(`OffRamp=${offRamp} is not v${lane.version}`)
  }

  const [offStaticConfig, offDynamicConfig] = await Promise.all([
    offRampContract.getStaticConfig(),
    offRampContract.getDynamicConfig(),
  ])

  if (offDynamicConfig.router !== ZeroAddress) {
    const router = new Contract(
      offDynamicConfig.router,
      RouterABI,
      dest,
    ) as unknown as TypedContract<typeof RouterABI>
    const offRamps = await router.getOffRamps()
    if (
      !offRamps.some(
        ({ sourceChainSelector, offRamp: addr }) =>
          sourceChainSelector === lane.sourceChainSelector && addr === offRamp,
      )
    ) {
      console.warn(
        `OffRamp=${offRamp} is not registered in Router=${await router.getAddress()} for source="${chainNameFromSelector(lane.sourceChainSelector)}"; instead, have=${offRamps
          .filter(({ sourceChainSelector }) => sourceChainSelector === lane.sourceChainSelector)
          .map(({ offRamp }) => offRamp)
          .join(', ')}`,
      )
    }
  }

  switch (argv.format) {
    case Format.log:
      console.log('OffRamp configs:', {
        staticConfig: (offStaticConfig as unknown as Result).toObject(),
        dynamicConfig: (offDynamicConfig as unknown as Result).toObject(),
      })
      break
    case Format.pretty:
      console.info('OffRamp configs:')
      console.table({
        ...(offStaticConfig as unknown as Result).toObject(),
        ...(offDynamicConfig as unknown as Result).toObject(),
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            offRamp: {
              staticConfig: (offStaticConfig as unknown as Result).toObject(),
              dynamicConfig: (offDynamicConfig as unknown as Result).toObject(),
            },
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }
}
