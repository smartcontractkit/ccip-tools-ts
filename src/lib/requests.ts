import {
  type Log,
  type Numeric,
  type Provider,
  type Result,
  type TransactionReceipt,
  Contract,
  Interface,
  ZeroAddress,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import {
  type CCIPMessage,
  type CCIPRequest,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
  defaultAbiCoder,
  parseExtraArgs,
  parseSourceTokenData,
} from './types.js'
import {
  blockRangeGenerator,
  chainNameFromSelector,
  decodeAddress,
  lazyCached,
  toObject,
  validateContractType,
} from './utils.js'

async function getOnRampInterface(
  source: Provider,
  onRamp: string,
): Promise<readonly [Interface, CCIPVersion]> {
  const [version] = await validateContractType(source, onRamp, CCIPContractType.OnRamp)
  return [
    lazyCached(
      `Interface ${CCIPContractType.OnRamp} ${version}`,
      () => new Interface(CCIP_ABIs[CCIPContractType.OnRamp][version]),
    ),
    version,
  ] as const
}

export async function getOnRampLane(source: Provider, address: string, destChainSelector?: bigint) {
  return lazyCached(`OnRamp ${address} lane`, async () => {
    const [iface, version] = await getOnRampInterface(source, address)
    const onRampContract = new Contract(address, iface, source) as unknown as TypedContract<
      (typeof CCIP_ABIs)[CCIPContractType.OnRamp][typeof version]
    >
    const staticConfig = toObject(await onRampContract.getStaticConfig())
    if (!('destChainSelector' in staticConfig)) {
      if (!destChainSelector) {
        throw new Error('destChainSelector is required for v1.6 OnRamp')
      }
      const [, , destRouter] = await onRampContract.getDestChainConfig(destChainSelector)
      if (destRouter === ZeroAddress) {
        throw new Error(
          `OnRamp ${address} is not configured for dest ${chainNameFromSelector(destChainSelector)}`,
        )
      }
    } else {
      destChainSelector = staticConfig.destChainSelector
    }
    return [
      {
        sourceChainSelector: staticConfig.chainSelector,
        destChainSelector,
        onRamp: address,
        version,
      },
      onRampContract,
    ] as {
      [V in CCIPVersion]: readonly [
        Lane<V>,
        TypedContract<(typeof CCIP_ABIs)[CCIPContractType.OnRamp][V]>,
      ]
    }[CCIPVersion]
  })
}

function resultsToMessage(result: Result): CCIPMessage {
  if (result.message) result = result.message as Result

  const tokenAmounts = (result.tokenAmounts as Result).map((tokenAmount, i) => {
    let obj = (tokenAmount as Result).toObject()
    if (result.sourceTokenData) {
      obj = { ...parseSourceTokenData((result.sourceTokenData as string[])[i]), ...obj }
    }
    if ('destExecData' in obj) {
      obj.destGasAmount = defaultAbiCoder.decode(
        ['uint32'],
        obj.destExecData as string,
      )[0] as bigint
    }
    obj.destTokenAddress = decodeAddress(obj.destTokenAddress as string)
    return obj
  })

  return {
    ...result.toObject(),
    receiver: decodeAddress(result.receiver as string),
    tokenAmounts,
    ...(result.sourceTokenData
      ? { sourceTokenData: (result.sourceTokenData as Result).toArray() }
      : {}),
    ...(result.header
      ? { header: (result.header as Result).toObject() }
      : {
          header: {
            messageId: result.messageId as string,
            sequenceNumber: result.sequenceNumber as bigint,
            nonce: result.nonce as bigint,
          },
        }),
    gasLimit: result.gasLimit
      ? (result.gasLimit as bigint)
      : parseExtraArgs(result.extraArgs as string)!.gasLimit!,
  } as unknown as CCIPMessage
}

const ccipRequestsTopicHashes = new Set(
  Object.entries(CCIP_ABIs[CCIPContractType.OnRamp]).map(
    ([version, abi]) =>
      lazyCached(
        `Interface ${CCIPContractType.OnRamp} ${version}`,
        () => new Interface(abi),
      ).getEvent(
        (version as CCIPVersion) < CCIPVersion.V1_6 ? 'CCIPSendRequested' : 'CCIPMessageSent',
      )!.topicHash,
  ),
)

/**
 * Fetch all CCIP messages in a transaction
 * @param tx - TransactionReceipt to search in
 * @returns CCIP messages in the transaction (at least one)
 **/
export async function fetchCCIPMessagesInTx(tx: TransactionReceipt): Promise<CCIPRequest[]> {
  const source = tx.provider
  const txHash = tx.hash
  const timestamp = (await tx.getBlock()).timestamp

  const requests: CCIPRequest[] = []
  for (const log of tx.logs) {
    if (!ccipRequestsTopicHashes.has(log.topics[0])) continue
    let onRampInterface: Interface
    try {
      ;[onRampInterface] = await getOnRampInterface(source, log.address)
    } catch (_) {
      continue
    }
    const decoded = onRampInterface.parseLog(log)
    if (!decoded || (decoded.name != 'CCIPSendRequested' && decoded.name != 'CCIPMessageSent'))
      continue
    const message = resultsToMessage(decoded.args)
    let lane
    if ('destChainSelector' in message.header) {
      lane = {
        sourceChainSelector: message.header.sourceChainSelector,
        destChainSelector: message.header.destChainSelector,
        onRamp: log.address,
        version: CCIPVersion.V1_6,
      }
    } else {
      ;[lane] = await getOnRampLane(source, log.address)
    }
    requests.push({ lane, message, log, tx, timestamp })
  }
  if (!requests.length) {
    throw new Error(`Could not find any CCIPSendRequested message in tx: ${txHash}`)
  }

  return requests
}

/**
 * Fetch a CCIP message by its log index in a transaction
 * @param tx - TransactionReceipt to search in
 * @param logIndex - log index to search for
 * @returns CCIPRequest in the transaction, with given logIndex
 **/
export async function fetchCCIPMessageInLog(
  tx: TransactionReceipt,
  logIndex: number,
): Promise<CCIPRequest> {
  const requests = await fetchCCIPMessagesInTx(tx)
  const request = requests.find(({ log }) => log.index === logIndex)
  if (!request)
    throw new Error(
      `Could not find a CCIPSendRequested message in tx ${tx.hash} with logIndex=${logIndex}`,
    )
  return request
}

/**
 * Fetch a CCIP message by its messageId
 * Can be slow due to having to paginate backwards through logs
 *
 * @param source - Provider to fetch logs from
 * @param messageId - messageId to search for
 * @param hints - Optional hints for pagination
 * @returns CCIPRequest with given messageId
 **/
export async function fetchCCIPMessageById(
  source: Provider,
  messageId: string,
  hints?: { page?: number },
): Promise<CCIPRequest> {
  for (const blockRange of blockRangeGenerator(
    { endBlock: await source.getBlockNumber() },
    hints?.page,
  )) {
    const logs = await source.getLogs({
      ...blockRange,
      topics: [Array.from(ccipRequestsTopicHashes)],
    })
    console.debug('fetchCCIPMessageById: found', logs.length, 'logs in', blockRange)
    for (const log of logs) {
      let onRampInterface: Interface
      try {
        ;[onRampInterface] = await getOnRampInterface(source, log.address)
      } catch (_) {
        continue
      }
      const decoded = onRampInterface.parseLog(log)
      if (!decoded || (decoded.name !== 'CCIPSendRequested' && decoded.name !== 'CCIPMessageSent'))
        continue
      const message = decoded.args.message as CCIPMessage
      if (('messageId' in message ? message.messageId : message.header.messageId) !== messageId)
        continue
      return fetchCCIPMessageInLog(
        (await source.getTransactionReceipt(log.transactionHash))!,
        log.index,
      )
    }
  }
  throw new Error('Could not find a CCIPSendRequested message with messageId: ' + messageId)
}

// Number of blocks to expand the search window for logs
const BLOCK_LOG_WINDOW_SIZE = 5000
const MAX_PAGES = 10

// Helper function to find the sequence number from CCIPSendRequested event logs
export async function fetchAllMessagesInBatch(
  source: Provider,
  destChainSelector: bigint,
  {
    address: onRamp,
    blockNumber: sendBlock,
    topics: [topic0],
  }: Pick<Log, 'address' | 'blockNumber' | 'topics'>,
  { minSeqNr, maxSeqNr }: { minSeqNr: Numeric; maxSeqNr: Numeric },
  {
    page: eventsBatchSize = BLOCK_LOG_WINDOW_SIZE,
    maxPageCount = MAX_PAGES,
  }: { page?: number; maxPageCount?: number } = {},
): Promise<Omit<CCIPRequest, 'tx' | 'timestamp'>[]> {
  const min = Number(minSeqNr)
  const max = Number(maxSeqNr)
  const latestBlock: number = await source.getBlockNumber()

  const [onRampInterface] = await getOnRampInterface(source, onRamp)
  const [lane] = await getOnRampLane(source, onRamp, destChainSelector)
  const getDecodedEvents = async (fromBlock: number, toBlock: number) => {
    const logs = await source.getLogs({
      address: onRamp,
      topics: [topic0],
      fromBlock,
      toBlock,
    })
    console.debug('fetchAllMessagesInBatch: found', logs.length, 'logs in', { fromBlock, toBlock })
    const result: Omit<CCIPRequest, 'tx' | 'timestamp'>[] = []
    for (const log of logs) {
      const decoded = onRampInterface.parseLog(log)
      if (!decoded) continue

      const message = resultsToMessage(decoded.args)
      if (min > message.header.sequenceNumber || message.header.sequenceNumber > max) {
        continue
      }
      result.push({ lane, message, log })
    }
    return result
  }

  const initFromBlock = Math.max(1, Math.trunc(sendBlock - eventsBatchSize / 2 + 1))
  const initToBlock = Math.min(latestBlock, initFromBlock + eventsBatchSize - 1)
  const events = await getDecodedEvents(initFromBlock, initToBlock)

  // page back if needed
  for (const { fromBlock, toBlock } of blockRangeGenerator(
    { endBlock: initFromBlock - 1 },
    eventsBatchSize,
  )) {
    if (
      events[0].message.header.sequenceNumber <= min ||
      (initToBlock - toBlock) / eventsBatchSize > maxPageCount
    )
      break
    const newEvents = await getDecodedEvents(fromBlock, toBlock)
    events.unshift(...newEvents)
  }

  // page forward if needed
  for (const { fromBlock, toBlock } of blockRangeGenerator(
    { startBlock: initToBlock + 1, endBlock: latestBlock },
    eventsBatchSize,
  )) {
    if (
      events[events.length - 1].message.header.sequenceNumber >= max ||
      (fromBlock - initToBlock) / eventsBatchSize > maxPageCount
    )
      break
    const newEvents = await getDecodedEvents(fromBlock, toBlock)
    events.push(...newEvents)
  }

  if (events.length != max - min + 1) {
    throw new Error('Could not find all expected CCIPSendRequested events')
  }
  return events
}

export async function* fetchRequestsForSender(
  source: Provider,
  firstRequest: Omit<CCIPRequest, 'tx' | 'timestamp' | 'log' | 'message'> & {
    log: Pick<CCIPRequest['log'], 'address' | 'topics' | 'blockNumber'>
    message: Pick<CCIPRequest['message'], 'sender'>
  },
): AsyncGenerator<Omit<CCIPRequest, 'tx' | 'timestamp'>, void, unknown> {
  const [onRampInterface] = await getOnRampInterface(source, firstRequest.log.address)

  for (const blockRange of blockRangeGenerator({
    endBlock: await source.getBlockNumber(),
    startBlock: firstRequest.log.blockNumber,
  })) {
    const logs = await source.getLogs({
      ...blockRange,
      topics: [firstRequest.log.topics[0]],
      address: firstRequest.log.address,
    })

    for (const log of logs) {
      const decoded = onRampInterface.parseLog(log)
      if (!decoded) continue

      const message = resultsToMessage(decoded.args)
      if (message.sender !== firstRequest.message.sender) continue

      yield { lane: firstRequest.lane, message, log }
    }
  }
}
