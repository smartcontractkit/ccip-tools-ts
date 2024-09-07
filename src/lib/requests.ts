import type { Addressable, TransactionReceipt } from 'ethers'
import {
  AbiCoder,
  Contract,
  EventFragment,
  Interface,
  keccak256,
  type Log,
  type Numeric,
  type Provider,
  type Result,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import {
  CCIP_ABIs,
  CCIPContractTypeOnRamp,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
} from './types.js'
import { blockRangeGenerator, getTypeAndVersion, lazyCached, networkInfo } from './utils.js'

async function getOnRampInterface(
  source: Provider,
  onRamp: string,
): Promise<readonly [Interface, CCIPVersion]> {
  const [type_, version] = await getTypeAndVersion(source, onRamp)
  if (type_ !== CCIPContractTypeOnRamp) throw new Error(`Not an OnRamp: ${onRamp}`)
  return lazyCached(
    `OnRampInterface ${version}`,
    () => [new Interface(CCIP_ABIs[CCIPContractTypeOnRamp][version]), version] as const,
  )
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

export async function getOnRampStaticConfig(source: Provider, address: string) {
  return lazyCached(`OnRamp ${address}.staticConfig`, async () => {
    const [type_, version] = await getTypeAndVersion(source, address)
    if (type_ != CCIPContractTypeOnRamp)
      throw new Error(`Not an OnRamp: ${address} is "${type_} ${version}"`)
    const onRampABI = CCIP_ABIs[CCIPContractTypeOnRamp][version]
    const onRampContract = new Contract(address, onRampABI, source) as unknown as TypedContract<
      typeof onRampABI
    >
    const staticConfig = await onRampContract.getStaticConfig()
    return [staticConfig, onRampContract] as const
  })
}

export async function fetchCCIPMessagesInTx(tx: TransactionReceipt): Promise<CCIPRequest[]> {
  const source = tx.provider
  const txHash = tx.hash
  const timestamp = (await tx.getBlock()).timestamp

  const requests: CCIPRequest[] = []
  for (const log of tx.logs) {
    let onRampInterface: Interface, version: CCIPVersion
    try {
      ;[onRampInterface, version] = await getOnRampInterface(source, log.address)
    } catch (_) {
      continue
    }
    const decoded = onRampInterface.parseLog(log)
    if (!decoded || decoded.name != 'CCIPSendRequested') continue
    const message = resultsToMessage(decoded.args)
    requests.push({ message, log, tx, timestamp, version })
  }
  if (!requests.length) {
    throw new Error(`Could not find any CCIPSendRequested message in tx: ${txHash}`)
  }

  return requests
}

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

  const [onRampInterface, version] = await getOnRampInterface(source, onRamp)
  const getDecodedEvents = async (fromBlock: number, toBlock: number) => {
    const logs = await source.getLogs({
      address: onRamp,
      topics: [onRampInterface.getEvent('CCIPSendRequested')!.topicHash],
      fromBlock,
      toBlock,
    })
    const result: Omit<CCIPRequest, 'tx' | 'timestamp'>[] = []
    for (const log of logs) {
      const decoded = onRampInterface.parseLog(log)
      if (!decoded) continue

      const message = resultsToMessage(decoded.args)
      const seqNum = message.sequenceNumber
      if (min > seqNum || seqNum > max) {
        continue
      }
      result.push({ message, log, version })
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

const USDC_EVENT = EventFragment.from('MessageSent(bytes message)')
const TRANSFER_EVENT = EventFragment.from('Transfer(address from, address to, uint256 value)')

const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com/v1',
  testnet: 'https://iris-api-sandbox.circle.com/v1',
}

type AttestationResponse =
  | { error: 'string' }
  | { status: 'pending_confirmations' }
  | { status: 'complete'; attestation: string }

const defaultAbiCoder = AbiCoder.defaultAbiCoder()

/**
 * Returns the USDC attestation for a given MessageSent Log
 * https://developers.circle.com/stablecoins/reference/getattestation
 *
 * @param message - payload of USDC MessageSent(bytes message) event
 * @param isTestnet - true if this was from a testnet
 * @returns USDC/CCTP attestation bytes
 */
async function getUsdcAttestation(message: string, isTestnet: boolean): Promise<string> {
  const msgHash = keccak256(message)

  const circleApiBaseUrl = isTestnet ? CIRCLE_API_URL.testnet : CIRCLE_API_URL.mainnet
  const res = await fetch(`${circleApiBaseUrl}/attestations/${msgHash}`)
  const json = (await res.json()) as AttestationResponse
  if (!('status' in json) || json.status !== 'complete' || !json.attestation) {
    throw new Error('Could not fetch USDC attestation. Response: ' + JSON.stringify(json, null, 2))
  }
  return json.attestation
}

/**
 * Try to fetch USDC attestations for transfers, return undefined in position if can't
 *
 * @param tokenAmounts - all tokenAmounts to try
 * @param allLogsInRequest - all other logs in same tx as CCIPSendRequested
 * @param isTestnet - use testnet CCTP API endpoint
 * @returns array where each position is either the attestation for that transfer or undefined
 **/
async function getUsdcTokenData(
  tokenAmounts: CCIPMessage['tokenAmounts'],
  allLogsInRequest: Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
): Promise<(string | undefined)[]> {
  const attestations: (string | undefined)[] = []

  const messageSentPerToken = allLogsInRequest.reduce((acc, log, i, arr) => {
    // for our MessageSent of interest (USDC-like), the token is the contract
    // which emitted a (burn) Transfer immediately before this event
    const logBefore = arr[i - 1]
    if (
      log.topics[0] !== USDC_EVENT.topicHash ||
      logBefore?.topics?.[0] !== TRANSFER_EVENT.topicHash
    )
      return acc
    const token = logBefore.address
    return acc.set(token, [...(acc.get(token) ?? []), log])
  }, new Map<string | Addressable, (typeof allLogsInRequest)[number][]>())

  for (const [i, { token }] of tokenAmounts.entries()) {
    // what if there are more USDC transfers of this same token after this one?
    const tokenTransfersCountAfter = tokenAmounts.filter(
      ({ token: t }, j) => t === token && j > i,
    ).length
    let messageSentLog: (typeof allLogsInRequest)[number] | undefined
    const messageSents = messageSentPerToken.get(token)
    if (messageSents) {
      // look from the end (near our request), but skip MessageSents for further transfers
      messageSentLog = messageSents[messageSents.length - 1 - tokenTransfersCountAfter]
    }
    let tokenData: string | undefined
    if (messageSentLog) {
      try {
        const message = defaultAbiCoder.decode(USDC_EVENT.inputs, messageSentLog.data)[0] as string
        const attestation = await getUsdcAttestation(message, isTestnet)
        tokenData = defaultAbiCoder.encode(
          ['tuple(bytes message, bytes attestation)'],
          [{ message, attestation }],
        )
      } catch (_) {
        // maybe not a USDC transfer
      }
    }
    attestations.push(tokenData)
  }

  return attestations
}

/**
 * Fetch offchain token data for all transfers in request
 *
 * @param request - Request (or subset of) to fetch offchainTokenData for
 * @returns Array of byte arrays, one per transfer in request
 */
export async function fetchOffchainTokenData(
  request: Pick<CCIPRequest, 'tx'> & {
    message: Pick<CCIPRequest['message'], 'tokenAmounts' | 'sourceChainSelector'>
    log: Pick<CCIPRequest['log'], 'topics' | 'index'>
  },
): Promise<string[]> {
  const { isTestnet } = networkInfo(request.message.sourceChainSelector)
  // there's a chance there are other CCIPSendRequested in same tx,
  // and they may contain USDC transfers as well, so we select
  // any USDC logs after that and before our CCIPSendRequested
  const prevCcipRequestIdx =
    request.tx.logs.find(
      ({ topics, index }) => topics[0] === request.log.topics[0] && index < request.log.index,
    )?.index ?? -1
  const requestLogs = request.tx.logs.filter(
    ({ index }) => prevCcipRequestIdx < index && index < request.log.index,
  )

  const offchainTokenData: string[] = request.message.tokenAmounts.map(
    () => '0x', // default tokenData
  )

  for (const [i, att] of (
    await getUsdcTokenData(request.message.tokenAmounts, requestLogs, isTestnet)
  ).entries()) {
    if (att) {
      offchainTokenData[i] = att
    }
  }

  return offchainTokenData
}

export async function* fetchRequestsForSender(
  source: Provider,
  firstRequest: Pick<CCIPRequest, 'version'> & {
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

      yield { message, log, version: firstRequest.version }
    }
  }
}
