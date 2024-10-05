import {
  Contract,
  Interface,
  type Log,
  type Numeric,
  type Provider,
  type Result,
  type TransactionReceipt,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import {
  CCIP_ABIs,
  CCIPContractTypeOnRamp,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type Lane,
} from './types.js'
import { blockRangeGenerator, getTypeAndVersion, lazyCached } from './utils.js'

async function getOnRampInterface(
  source: Provider,
  onRamp: string,
): Promise<readonly [Interface, CCIPVersion]> {
  const [type_, version] = await getTypeAndVersion(source, onRamp)
  if (type_ !== CCIPContractTypeOnRamp)
    throw new Error(`Not an OnRamp: ${onRamp} is "${type_} ${version}"`)
  return [
    lazyCached(
      `Interface ${CCIPContractTypeOnRamp} ${version}`,
      () => new Interface(CCIP_ABIs[CCIPContractTypeOnRamp][version]),
    ),
    version,
  ] as const
}

function resultsToMessage(result: Result): CCIPMessage {
  if (result.length === 1) result = result[0] as Result
  const message = {
    ...result.toObject(),
    tokenAmounts: (result.tokenAmounts as Result).map((tokenAmount) =>
      (tokenAmount as Result).toObject(),
    ),
    sourceTokenData: (result.sourceTokenData as Result).toArray(),
  } as unknown as CCIPMessage
  return message
}

export async function getOnRampLane(source: Provider, address: string): Promise<Lane> {
  return lazyCached(`OnRamp ${address} lane`, async () => {
    const [iface, version] = await getOnRampInterface(source, address)
    const onRampContract = new Contract(address, iface, source) as unknown as TypedContract<
      (typeof CCIP_ABIs)[CCIPContractTypeOnRamp][typeof version]
    >
    const staticConfig = await onRampContract.getStaticConfig()
    return {
      sourceChainSelector: staticConfig.chainSelector,
      destChainSelector: staticConfig.destChainSelector,
      onRamp: address,
      version,
    }
  })
}

const ccipRequestsTopicHashes = new Set(
  Object.entries(CCIP_ABIs[CCIPContractTypeOnRamp]).map(
    ([version, abi]) =>
      lazyCached(
        `Interface ${CCIPContractTypeOnRamp} ${version}`,
        () => new Interface(abi),
      ).getEvent('CCIPSendRequested')!.topicHash,
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
    if (!decoded || decoded.name != 'CCIPSendRequested') continue
    const message = resultsToMessage(decoded.args)
    const lane = await getOnRampLane(source, log.address)
    requests.push({ message, log, tx, timestamp, lane })
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
 * @returns CCIPRequest with given messageId
 **/
export async function fetchCCIPMessageById(
  source: Provider,
  messageId: string,
): Promise<CCIPRequest> {
  for (const blockRange of blockRangeGenerator({ endBlock: await source.getBlockNumber() })) {
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
      if (!decoded || decoded.name != 'CCIPSendRequested') continue
      if ((decoded.args.message as CCIPMessage).messageId !== messageId) continue
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
  { address: onRamp, blockNumber: sendBlock }: Pick<Log, 'address' | 'blockNumber'>,
  interval: { min: Numeric; max: Numeric },
  eventsBatchSize = BLOCK_LOG_WINDOW_SIZE,
  maxPageCount = MAX_PAGES,
): Promise<Omit<CCIPRequest, 'tx' | 'timestamp'>[]> {
  const min = Number(interval.min)
  const max = Number(interval.max)
  const latestBlock: number = await source.getBlockNumber()

  const [onRampInterface] = await getOnRampInterface(source, onRamp)
  const lane = await getOnRampLane(source, onRamp)
  const getDecodedEvents = async (fromBlock: number, toBlock: number) => {
    const logs = await source.getLogs({
      address: onRamp,
      topics: [onRampInterface.getEvent('CCIPSendRequested')!.topicHash],
      fromBlock,
      toBlock,
    })
    console.debug('fetchAllMessagesInBatch: found', logs.length, 'logs in', { fromBlock, toBlock })
    const result: Omit<CCIPRequest, 'tx' | 'timestamp'>[] = []
    for (const log of logs) {
      const decoded = onRampInterface.parseLog(log)
      if (!decoded) continue

      const message = resultsToMessage(decoded.args)
      const seqNum = message.sequenceNumber
      if (min > seqNum || seqNum > max) {
        continue
      }
      result.push({ message, log, lane })
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
      events[0].message.sequenceNumber <= min ||
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
      events[events.length - 1].message.sequenceNumber >= max ||
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

      yield { message, log, lane: firstRequest.lane }
    }
  }
}
