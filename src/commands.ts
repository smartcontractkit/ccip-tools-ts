/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  type Addressable,
  type Provider,
  Contract,
  ZeroAddress,
  dataLength,
  hexlify,
  isBytesLike,
  isHexString,
  toUtf8Bytes,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from './abi/BurnMintERC677Token.js'
import FeeQuoterABI from './abi/FeeQuoter_1_6.js'
import TokenPoolABI from './abi/LockReleaseTokenPool_1_5_1.js'
import RouterABI from './abi/Router.js'
import TokenAdminRegistry_1_5 from './abi/TokenAdminRegistry_1_5.js'
import {
  type CCIPContract,
  type CCIPMessage,
  type CCIPRequest,
  CCIPContractType,
  CCIPVersion,
  ExecutionState,
  bigIntReplacer,
  calculateManualExecProof,
  chainIdFromName,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  chainSelectorFromId,
  decodeAddress,
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
  getProviderNetwork,
  getSomeBlockNumberBefore,
  getTypeAndVersion,
  lazyCached,
  parseExtraArgs,
  parseWithFragment,
  recursiveParseError,
  toObject,
  validateContractType,
} from './lib/index.js'
import type { Providers } from './providers.js'
import {
  formatDuration,
  formatResult,
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
  const requestsInBatch = await fetchAllMessagesInBatch(source, request.log, commit.report, {
    page: argv.page,
  })

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
    let estimated = await estimateExecGasForRequest(
      source,
      dest,
      request.lane.onRamp,
      {
        sender: request.message.sender,
        receiver: request.message.receiver,
        data: request.message.data,
        tokenAmounts: request.message.tokenAmounts,
      },
      { offRamp: await offRampContract.getAddress() },
    )
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

    const batch = await fetchAllMessagesInBatch(source, request.log, commit.report, {
      page: argv.page,
    })
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

  const router = new Contract(argv.router, RouterABI, wallet) as unknown as TypedContract<
    typeof RouterABI
  >

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
    const [destTokenAmounts, onRampAddress] = await sourceToDestTokenAmounts(tokenAmounts, {
      router: argv.router,
      source,
      dest: await providers.forChainId(destChainId),
    })

    const estimated = await estimateExecGasForRequest(
      source,
      await providers.forChainId(destChainId),
      onRampAddress,
      {
        sender: wallet.address,
        receiver,
        data,
        tokenAmounts: destTokenAmounts,
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
    feeToken: argv.feeToken || ZeroAddress, // feeToken==ZeroAddress means native
    tokenAmounts,
  }

  // calculate fee
  const fee = await router.getFee(destSelector, message)

  // make sure to approve once per token, for the total amount (including fee, if needed)
  const amountsToApprove = tokenAmounts.reduce(
    (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
    <Record<string, bigint>>{},
  )
  if (message.feeToken !== ZeroAddress) {
    amountsToApprove[message.feeToken as string] =
      (amountsToApprove[message.feeToken as string] ?? 0n) + fee
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
    // if native fee, include it in value; otherwise, it's transferedFrom feeToken
    ...(message.feeToken === ZeroAddress ? { value: fee } : {}),
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

async function sourceToDestTokenAmounts<S extends { token: string }>(
  sourceTokenAmounts: readonly S[],
  { router: routerAddress, source, dest }: { router: string; source: Provider; dest: Provider },
): Promise<[(Omit<S, 'token'> & { destTokenAddress: string })[], string]> {
  const { name: sourceName } = await getProviderNetwork(source)
  const { chainSelector: destSelector, name: destName } = await getProviderNetwork(dest)

  const router = new Contract(routerAddress, RouterABI, source) as unknown as TypedContract<
    typeof RouterABI
  >
  const onRampAddress = (await router.getOnRamp(destSelector)) as string
  if (!onRampAddress || onRampAddress === ZeroAddress)
    throw new Error(`No "${sourceName}" -> "${destName}" lane on ${routerAddress}`)
  const [lane, onRamp] = await getOnRampLane(source, onRampAddress, destSelector)

  let tokenAdminRegistryAddress
  if (lane.version < CCIPVersion.V1_5) {
    throw new Error('Deprecated lane version: ' + lane.version)
  } else {
    ;({ tokenAdminRegistry: tokenAdminRegistryAddress } = await (
      onRamp as CCIPContract<CCIPContractType.OnRamp, CCIPVersion.V1_5 | CCIPVersion.V1_6>
    ).getStaticConfig())
  }
  const tokenAdminRegistry = new Contract(
    tokenAdminRegistryAddress,
    TokenAdminRegistry_1_5,
    source,
  ) as unknown as TypedContract<typeof TokenAdminRegistry_1_5>

  let pools: readonly (string | Addressable)[] = []
  if (sourceTokenAmounts.length)
    pools = await tokenAdminRegistry.getPools(sourceTokenAmounts.map(({ token }) => token))

  return [
    await Promise.all(
      sourceTokenAmounts.map(async ({ token: _, ...ta }, i) => {
        const pool = new Contract(pools[i], TokenPoolABI, source) as unknown as TypedContract<
          typeof TokenPoolABI
        >
        const destToken = decodeAddress(await pool.getRemoteToken(destSelector))
        return { ...ta, destTokenAddress: destToken }
      }),
    ),
    onRampAddress,
  ]
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
  let sourceTokenAmounts: { token: string; amount: bigint }[] = []
  if (argv.transferTokens) {
    sourceTokenAmounts = await parseTokenAmounts(source, argv.transferTokens)
  }
  const [tokenAmounts, onRamp] = await sourceToDestTokenAmounts(sourceTokenAmounts, {
    router: argv.router,
    source,
    dest,
  })

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
      const extraArgs = parseExtraArgs(data)
      if (extraArgs) {
        const { _tag, ...rest } = extraArgs
        console.info(`${_tag}:`, rest)
        return
      }
    }
    parsed = parseWithFragment(data)
  }
  if (!parsed) throw new Error('Unknown data')
  const [fragment, contract, args] = parsed
  const name = fragment.constructor.name.replace(/Fragment$/, '')
  console.info(`${name}: ${contract.replace(/_\d\.\d.*$/, '')} ${fragment.format('full')}`)
  if (args) {
    const formatted = formatResult(args, (val, key) => {
      if (key === 'extraArgs' && isHexString(val)) {
        const extraArgs = parseExtraArgs(val)
        if (extraArgs) {
          const { _tag, ...rest } = extraArgs
          return `${_tag}(${Object.entries(rest)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')})`
        }
      }
      return val
    })
    const ps: unknown[] = []
    if (fragment.name === 'ReceiverError' && args.err === '0x') {
      ps.push('[possibly out-of-gas or abi.decode error]')
    }
    console.info('Args:', formatted ?? args, ...ps)
    if (dataLength(((args.err || args.error || args.returnData) as string) ?? '0x') > 0) {
      for (const [key, data] of Object.entries(args.toObject())) {
        if (isHexString(data)) {
          for (const [k, err] of recursiveParseError(key, data)) {
            console.info(`${k}:`, err)
          }
        } else {
          console.info(`${key}:`, data)
        }
      }
    }
  }
}

export async function showLaneConfigs(
  providers: Providers,
  argv: { source: string; onramp_or_router: string; dest: string; format: Format; page: number },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const source = await providers.forChainId(sourceChainId)
  const [onrampOrRouterType, , onrampOrRouterTnV] = await getTypeAndVersion(
    source,
    argv.onramp_or_router,
  )
  let onramp
  if (onrampOrRouterType === 'Router') {
    const router = new Contract(
      argv.onramp_or_router,
      RouterABI,
      source,
    ) as unknown as TypedContract<typeof RouterABI>
    onramp = (await router.getOnRamp(chainSelectorFromId(destChainId))) as string
  } else if (onrampOrRouterType.endsWith(CCIPContractType.OnRamp)) {
    onramp = argv.onramp_or_router
  } else {
    throw new Error(`Unknown contract type for onramp_or_router: ${onrampOrRouterTnV}`)
  }
  const [lane, onRampContract] = await getOnRampLane(
    source,
    onramp,
    chainSelectorFromId(destChainId),
  )
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

  const staticConfig = toObject(await onRampContract.getStaticConfig())
  const dynamicConfig = toObject(await onRampContract.getDynamicConfig())
  let onRampRouter, destChainConfig
  if ('router' in dynamicConfig) {
    onRampRouter = dynamicConfig.router as string
  } else {
    const [sequenceNumber, allowlistEnabled, onRampRouter_] = await (
      onRampContract as CCIPContract<CCIPContractType.OnRamp, CCIPVersion.V1_6>
    ).getDestChainConfig(lane.destChainSelector)
    onRampRouter = onRampRouter_ as string
    destChainConfig = { sequenceNumber, allowlistEnabled, router: onRampRouter }
  }
  if (onRampRouter !== ZeroAddress) {
    const router = new Contract(onRampRouter, RouterABI, source) as unknown as TypedContract<
      typeof RouterABI
    >
    const onRampInRouter = (await router.getOnRamp(lane.destChainSelector)) as string
    if (onRampInRouter !== onramp) {
      console.warn(
        `OnRamp=${onramp} is not registered in Router=${await router.getAddress()} for dest="${chainNameFromSelector(lane.destChainSelector)}"; instead, have=${onRampInRouter}`,
      )
    }
  }
  if (onrampOrRouterType === 'Router' && argv.onramp_or_router !== onRampRouter) {
    console.warn(
      `OnRamp=${onramp} has Router=${onRampRouter} set instead of ${argv.onramp_or_router}`,
    )
  }

  let feeQuoterConfig
  if ('feeQuoter' in dynamicConfig) {
    const feeQuoter = new Contract(
      dynamicConfig.feeQuoter,
      FeeQuoterABI,
      source,
    ) as unknown as TypedContract<typeof FeeQuoterABI>
    feeQuoterConfig = toObject(await feeQuoter.getDestChainConfig(lane.destChainSelector))
  }

  switch (argv.format) {
    case Format.log:
      console.log('OnRamp configs:', {
        staticConfig: staticConfig,
        dynamicConfig: dynamicConfig,
        ...(destChainConfig ? { destChainConfig } : {}),
        ...(feeQuoterConfig ? { feeQuoterConfig } : {}),
      })
      break
    case Format.pretty:
      console.table({
        typeAndVersion: (await getTypeAndVersion(onRampContract))[2],
        ...staticConfig,
        ...dynamicConfig,
        ...(destChainConfig ?? {}),
        ...(feeQuoterConfig
          ? Object.fromEntries(
              Object.entries(feeQuoterConfig).map(([k, v]) => [`feeQuoter.${k}`, v]),
            )
          : {}),
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            onRamp: {
              staticConfig: staticConfig,
              dynamicConfig: dynamicConfig,
              ...(destChainConfig ? { destChainConfig } : {}),
              ...(feeQuoterConfig ? { feeQuoterConfig } : {}),
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
  const [offVersion, offTnV] = await validateContractType(dest, offRamp, CCIPContractType.OffRamp)
  console.info('OffRamp:', offRamp, 'is', offTnV)
  if (offVersion !== lane.version) {
    console.warn(`OffRamp=${offRamp} is not v${lane.version}`)
  }

  const offStaticConfig = toObject(await offRampContract.getStaticConfig())
  const offDynamicConfig = toObject(await offRampContract.getDynamicConfig())
  let offRampRouter, sourceChainConfig
  if ('router' in offDynamicConfig) {
    offRampRouter = offDynamicConfig.router as string
  } else {
    sourceChainConfig = toObject(
      await (
        offRampContract as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_6>
      ).getSourceChainConfig(lane.sourceChainSelector),
    )
    offRampRouter = sourceChainConfig.router as string
  }
  if (offRampRouter !== ZeroAddress) {
    const router = new Contract(offRampRouter, RouterABI, dest) as unknown as TypedContract<
      typeof RouterABI
    >
    const offRamps = await router.getOffRamps()
    if (
      !offRamps.some(
        ({ sourceChainSelector, offRamp: addr }) =>
          sourceChainSelector === lane.sourceChainSelector && addr === offRamp,
      )
    ) {
      console.warn(
        `OffRamp=${offRamp} is not registered in Router=${offRampRouter} for source="${chainNameFromSelector(lane.sourceChainSelector)}"; instead, have=${offRamps
          .filter(({ sourceChainSelector }) => sourceChainSelector === lane.sourceChainSelector)
          .map(({ offRamp }) => offRamp)
          .join(', ')}`,
      )
    }
  }

  switch (argv.format) {
    case Format.log:
      console.log('OffRamp configs:', {
        staticConfig: offStaticConfig,
        dynamicConfig: offDynamicConfig,
        ...(sourceChainConfig ? { sourceChainConfig } : {}),
      })
      break
    case Format.pretty:
      console.table({
        typeAndVersion: (await getTypeAndVersion(offRampContract))[2],
        ...offStaticConfig,
        ...{
          ...offDynamicConfig,
          permissionLessExecutionThresholdSeconds: formatDuration(
            Number(offDynamicConfig.permissionLessExecutionThresholdSeconds),
          ),
        },
        ...(sourceChainConfig
          ? {
              ...sourceChainConfig,
              onRamp: decodeAddress(sourceChainConfig.onRamp),
            }
          : {}),
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            offRamp: {
              staticConfig: offStaticConfig,
              dynamicConfig: offDynamicConfig,
              ...(sourceChainConfig ? { sourceChainConfig } : {}),
            },
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }
}
