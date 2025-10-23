import util from 'util'

import yaml from 'yaml'

import {
  type Chain,
  type ChainStatic,
  type ChainTransaction,
  type LogFilter,
  ChainFamily,
} from './chain.ts'
import type { EVMChain } from './evm/index.ts'
import { parseExtraArgs } from './extra-args.ts'
import { supportedChains } from './supported-chains.ts'
import type { CCIPMessage, CCIPRequest, CCIPVersion, Log_ } from './types.ts'
import { convertKeysToCamelCase, decodeAddress, networkInfo } from './utils.ts'

/**
 * Decodes hex strings, bytearrays, JSON strings and raw objects as CCIPMessages
 * Does minimal validation, but converts objects in the format expected by ccip-tools-ts
 **/
export function decodeMessage(data: string | Uint8Array | Record<string, unknown>): CCIPMessage {
  if (typeof data === 'string' && data.startsWith('{')) {
    data = yaml.parse(data, { intAsBigInt: true }) as Record<string, unknown>
    if (!data || typeof data != 'object') throw new Error(`invalid msg: ${util.inspect(data)}`)
    if (data.message) data = data.message as Record<string, unknown>
    let data_ = data as Record<string, unknown> & {
      header: {
        dest_chain_selector?: string
        destChainSelector?: string
        sourceChainSelector?: string
      }
      sourceChainSelector?: string
      extraArgs?: string
    }

    const destChainSelector = data_.header.dest_chain_selector ?? data_.header.destChainSelector
    if (destChainSelector) {
      const dest = networkInfo(destChainSelector)
      data_ = convertKeysToCamelCase(data_, (v, k) =>
        typeof v === 'string' && v.match(/^\d+$/)
          ? BigInt(v)
          : k === 'receiver' || k === 'destTokenAddress'
            ? decodeAddress(v as string, dest.family)
            : v,
      ) as typeof data_
    }
    if (data_.extraArgs) {
      const extraArgs = parseExtraArgs(
        data_.extraArgs ?? '',
        networkInfo((data_.header.sourceChainSelector ?? data_.sourceChainSelector)!).family,
      )
      if (extraArgs) {
        const { _tag, ...rest } = extraArgs
        Object.assign(data_, rest)
      }
    }
    return data_ as unknown as CCIPMessage
  }
  for (const chain of Object.values(supportedChains)) {
    try {
      const decoded = chain.decodeMessage({ data } as unknown as Log_)
      if (decoded) return decoded
    } catch (_) {
      // continue
    }
  }
  throw new Error('Failed to decode message')
}

/**
 * Fetch all CCIP messages in a transaction
 * @param tx - TransactionReceipt to search in
 * @returns CCIP messages in the transaction (at least one)
 **/
export async function fetchCCIPMessagesInTx(tx: ChainTransaction): Promise<CCIPRequest[]> {
  const source = tx.chain
  const txHash = tx.hash
  const timestamp = tx.timestamp

  const requests: CCIPRequest[] = []
  for (const log of tx.logs) {
    let lane
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (!message) continue
    if ('destChainSelector' in message.header) {
      const [_, version] = await source.typeAndVersion(log.address)
      lane = {
        sourceChainSelector: message.header.sourceChainSelector,
        destChainSelector: message.header.destChainSelector,
        onRamp: log.address,
        version: version as CCIPVersion,
      }
    } else if (source.network.family !== ChainFamily.EVM) {
      throw new Error(`Unsupported network family: ${source.network.family}`)
    } else {
      lane = await (source as EVMChain).getLaneForOnRamp(log.address)
    }
    requests.push({ lane, message, log, tx, timestamp })
  }
  if (!requests.length) {
    throw new Error(`Could not find any CCIPSendRequested message in tx: ${txHash}`)
  }

  return requests
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
  source: Chain,
  messageId: string,
  hints?: { page?: number; onRamp?: string },
): Promise<CCIPRequest> {
  for await (const log of source.getLogs({
    ...hints,
    ...(hints?.onRamp ? { address: hints.onRamp } : {}),
    topics: ['CCIPSendRequested', 'CCIPMessageSent'],
  })) {
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (message?.header.messageId !== messageId) continue
    let destChainSelector, version
    if ('destChainSelector' in message.header) {
      destChainSelector = message.header.destChainSelector
      ;[, version] = await source.typeAndVersion(log.address)
    } else if (source.network.family !== ChainFamily.EVM) {
      throw new Error(`Unsupported network family: ${source.network.family}`)
    } else {
      ;({ destChainSelector, version } = await (source as EVMChain).getLaneForOnRamp(log.address))
    }
    const tx = await source.getTransaction(log.transactionHash)
    return {
      lane: {
        sourceChainSelector: source.network.chainSelector,
        destChainSelector,
        onRamp: log.address,
        version: version as CCIPVersion,
      },
      message,
      log,
      tx,
      timestamp: tx.timestamp,
    }
  }
  throw new Error('Could not find a CCIPSendRequested message with messageId: ' + messageId)
}

// Number of blocks to expand the search window for logs
const BLOCK_LOG_WINDOW_SIZE = 5000

// Helper function to find the sequence number from CCIPSendRequested event logs
export async function fetchAllMessagesInBatch(
  source: Chain,
  request: Omit<CCIPRequest, 'tx' | 'timestamp'>,
  { minSeqNr: min, maxSeqNr: max }: { minSeqNr: bigint; maxSeqNr: bigint },
  { page: eventsBatchSize = BLOCK_LOG_WINDOW_SIZE }: { page?: number } = {},
): Promise<Omit<CCIPRequest, 'tx' | 'timestamp'>[]> {
  if (min === max) return [request]

  const filter: LogFilter = {
    page: eventsBatchSize,
    topics: [request.log.topics[0]],
    address: request.log.address,
  }
  if (request.message.header.sequenceNumber === max) filter.endBlock = request.log.blockNumber
  else
    // start proportionally before send request block, including case when seqNum==min => startBlock
    filter.startBlock =
      request.log.blockNumber -
      Math.ceil(
        (Number(request.message.header.sequenceNumber - min) / Number(max - min)) * eventsBatchSize,
      )

  const events: Omit<CCIPRequest, 'tx' | 'timestamp'>[] = []
  if (filter.startBlock) {
    // forward
    let backwardsBefore, backwardsEndBlock
    for await (const log of source.getLogs(filter)) {
      backwardsBefore ??= log.transactionHash
      backwardsEndBlock ??= log.blockNumber - 1
      const message = (source.constructor as ChainStatic).decodeMessage(log)
      if (
        !message ||
        ('destChainSelector' in message.header &&
          message.header.destChainSelector !== request.lane.destChainSelector)
      )
        continue
      if (message.header.sequenceNumber < min) continue
      events.push({ lane: request.lane, message, log })
      if (message.header.sequenceNumber >= max) break
    }
    if (events.length && events[0].message.header.sequenceNumber > min) {
      // still work to be done backwards
      delete filter['startBlock']
      filter['endBlock'] = backwardsEndBlock
      filter['endBefore'] = backwardsBefore
    }
  }
  if (filter.endBlock) {
    // backwards
    for await (const log of source.getLogs(filter)) {
      const message = (source.constructor as ChainStatic).decodeMessage(log)
      if (
        !message ||
        ('destChainSelector' in message.header &&
          message.header.destChainSelector !== request.lane.destChainSelector)
      )
        continue
      events.unshift({ lane: request.lane, message, log })
      if (message.header.sequenceNumber <= min) break
    }
  }

  if (events.length != Number(max - min) + 1) {
    throw new Error(
      `Could not find all expected request events: from=${request.log.blockNumber}, wanted=[${Number(min)}..${Number(max)}:${Number(max - min) + 1}], got=[${events.map((e) => Number(e.message.header.sequenceNumber)).join(',')}]`,
    )
  }
  return events
}

export async function* fetchRequestsForSender(
  source: Chain,
  sender: string,
  filter: Pick<LogFilter, 'address' | 'startBlock' | 'startTime' | 'endBlock'>,
): AsyncGenerator<Omit<CCIPRequest, 'tx' | 'timestamp'>, void, unknown> {
  for await (const log of source.getLogs({
    ...filter,
    topics: ['CCIPSendRequested', 'CCIPMessageSent'],
  })) {
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (message?.sender !== sender) continue
    let destChainSelector, version
    if ('destChainSelector' in message.header) {
      destChainSelector = message.header.destChainSelector
      ;[, version] = await source.typeAndVersion(log.address)
    } else if (source.network.family !== ChainFamily.EVM) {
      throw new Error(`Unsupported network family: ${source.network.family}`)
    } else {
      ;({ destChainSelector, version } = await (source as EVMChain).getLaneForOnRamp(log.address))
    }
    yield {
      lane: {
        sourceChainSelector: source.network.chainSelector,
        destChainSelector,
        onRamp: log.address,
        version: version as CCIPVersion,
      },
      message,
      log,
    }
  }
}
