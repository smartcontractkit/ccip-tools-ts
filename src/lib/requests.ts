import util from 'util'

import { isBytesLike, toBigInt } from 'ethers'
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
import { convertKeysToCamelCase, decodeAddress, leToBigInt, networkInfo } from './utils.ts'

function decodeJsonMessage(data: Record<string, unknown>) {
  if (!data || typeof data != 'object') throw new Error(`invalid msg: ${util.inspect(data)}`)
  if (data.message) data = data.message as Record<string, unknown>
  let data_ = data as Record<string, unknown> & {
    header: {
      dest_chain_selector?: string
      destChainSelector?: string
      sourceChainSelector?: string
      source_chain_selector?: string
    }
    sourceChainSelector?: string
    extraArgs?: string
    tokenAmounts: {
      destExecData: string
      destGasAmount?: bigint
    }[]
  }
  const sourceChainSelector =
    data_.header.sourceChainSelector ??
    data_.header.source_chain_selector ??
    data_.sourceChainSelector
  if (!sourceChainSelector) throw new Error(`invalid msg: ${util.inspect(data)}`)
  const sourceNetwork = networkInfo(sourceChainSelector)
  if (!data_.header) {
    const header = {
      sourceChainSelector: data_.sourceChainSelector,
      messageId: data_.messageId,
      nonce: data_.nonce,
      sequenceNumber: data_.sequenceNumber,
    }
    data_.header = header
  }

  const destChainSelector = data_.header.dest_chain_selector ?? data_.header.destChainSelector
  if (destChainSelector) {
    const destFamily = networkInfo(destChainSelector).family
    data_ = convertKeysToCamelCase(data_, (v, k) =>
      typeof v === 'string' && v.match(/^\d+$/)
        ? BigInt(v)
        : k === 'receiver' || k === 'destTokenAddress'
          ? decodeAddress(v as string, destFamily)
          : v,
    ) as typeof data_
  }

  for (const ta of data_.tokenAmounts) {
    if (ta.destGasAmount != null || ta.destExecData == null) continue
    switch (sourceNetwork.family) {
      // EVM & Solana encode destExecData as big-endian
      case ChainFamily.EVM:
      case ChainFamily.Solana:
        ta.destGasAmount = toBigInt(ta.destExecData)
        break
      // Aptos & Sui, as little-endian
      default:
        ta.destGasAmount = leToBigInt(ta.destExecData)
    }
  }

  if (data_.extraArgs) {
    const extraArgs = parseExtraArgs(data_.extraArgs ?? '', sourceNetwork.family)
    if (extraArgs) {
      const { _tag, ...rest } = extraArgs
      Object.assign(data_, rest)
    }
  }
  return data_ as unknown as CCIPMessage
}

/**
 * Decodes hex strings, bytearrays, JSON strings and raw objects as CCIPMessages
 * Does minimal validation, but converts objects in the format expected by ccip-tools-ts
 **/
export function decodeMessage(data: string | Uint8Array | Record<string, unknown>): CCIPMessage {
  if (
    (typeof data === 'string' && data.startsWith('{')) ||
    (typeof data === 'object' && data !== null && !isBytesLike(data))
  ) {
    if (typeof data === 'string')
      data = yaml.parse(data, { intAsBigInt: true }) as Record<string, unknown>
    return decodeJsonMessage(data)
  }

  // try bytearray decoding on each supported chain
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
export async function fetchAllMessagesInBatch<R extends Omit<CCIPRequest, 'tx' | 'timestamp'>>(
  source: Chain,
  request: R,
  { minSeqNr, maxSeqNr }: { minSeqNr: bigint; maxSeqNr: bigint },
  { page: eventsBatchSize = BLOCK_LOG_WINDOW_SIZE }: { page?: number } = {},
): Promise<R['message'][]> {
  if (minSeqNr === maxSeqNr) return [request.message]

  const filter: LogFilter = {
    page: eventsBatchSize,
    topics: [request.log.topics[0]],
    address: request.log.address,
  }
  if (request.message.header.sequenceNumber === maxSeqNr) filter.endBlock = request.log.blockNumber
  else
    // start proportionally before send request block, including case when seqNum==min => startBlock
    filter.startBlock =
      request.log.blockNumber -
      Math.ceil(
        (Number(request.message.header.sequenceNumber - minSeqNr) / Number(maxSeqNr - minSeqNr)) *
          eventsBatchSize,
      )

  const messages: R['message'][] = []
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
      if (message.header.sequenceNumber < minSeqNr) continue
      messages.push(message)
      if (message.header.sequenceNumber >= maxSeqNr) break
    }
    if (messages.length && messages[0].header.sequenceNumber > minSeqNr) {
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
      messages.unshift(message)
      if (message.header.sequenceNumber <= minSeqNr) break
    }
  }

  if (messages.length != Number(maxSeqNr - minSeqNr) + 1) {
    throw new Error(
      `Could not find all expected request events: from=${request.log.blockNumber}, wanted=[${Number(minSeqNr)}..${Number(maxSeqNr)}:${Number(maxSeqNr - minSeqNr) + 1}], got=[${messages.map((e) => Number(e.header.sequenceNumber)).join(',')}]`,
    )
  }
  return messages
}

export async function* fetchRequestsForSender(
  source: Chain,
  sender: string,
  filter: Pick<LogFilter, 'address' | 'startBlock' | 'startTime' | 'endBlock'>,
): AsyncGenerator<Omit<CCIPRequest, 'tx' | 'timestamp'>, void, unknown> {
  const filterWithSender = {
    ...filter,
    sender, // some chain families may use this to look for account lookup/narrow down the search
    topics: ['CCIPSendRequested', 'CCIPMessageSent'],
  }
  for await (const log of source.getLogs(filterWithSender)) {
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (message?.sender !== sender) continue
    let destChainSelector, version
    if ('destChainSelector' in message.header) {
      destChainSelector = message.header.destChainSelector
      ;[, version] = await source.typeAndVersion(log.address)
    } else if (source.network.family === ChainFamily.EVM) {
      ;({ destChainSelector, version } = await (source as EVMChain).getLaneForOnRamp(log.address))
    } else {
      throw new Error(`Unsupported network family: ${source.network.family}`)
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

/**
 * Map source `token` to `sourcePoolAddress + destTokenAddress`
 * @param source - source chain
 * @param destChainSelector - dest network
 * @param onRamp - contract address
 * @param sourceTokenAmounts - usually `{ token, amount }`
 * @returns - { sourcePoolAddress, destTokenAddress, ...rest } objects
 */
export async function sourceToDestTokenAmounts<S extends { token: string }>(
  source: Chain,
  destChainSelector: bigint,
  onRamp: string,
  sourceTokenAmounts: readonly S[],
): Promise<(Omit<S, 'token'> & { sourcePoolAddress: string; destTokenAddress: string })[]> {
  const tokenAdminRegistry = await source.getTokenAdminRegistryFor(onRamp)
  return Promise.all(
    sourceTokenAmounts.map(async ({ token, ...rest }) => {
      const { tokenPool: sourcePoolAddress } = await source.getRegistryTokenConfig(
        tokenAdminRegistry,
        token,
      )
      if (!sourcePoolAddress)
        throw new Error(`Token=${token} not found in registry=${tokenAdminRegistry}`)
      const remotes = await source.getTokenPoolRemotes(sourcePoolAddress, destChainSelector)
      return {
        ...rest,
        sourcePoolAddress,
        destTokenAddress: remotes[networkInfo(destChainSelector).name].remoteToken,
      }
    }),
  )
}
