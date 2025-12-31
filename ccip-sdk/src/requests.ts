import { isBytesLike, toBigInt } from 'ethers'
import type { PickDeep } from 'type-fest'
import yaml from 'yaml'

import type { Chain, ChainStatic, LogFilter } from './chain.ts'
import {
  CCIPMessageBatchIncompleteError,
  CCIPMessageDecodeError,
  CCIPMessageIdNotFoundError,
  CCIPMessageInvalidError,
  CCIPMessageNotFoundInTxError,
  CCIPNetworkFamilyUnsupportedError,
  CCIPTokenNotInRegistryError,
} from './errors/index.ts'
import type { EVMChain } from './evm/index.ts'
import { decodeExtraArgs } from './extra-args.ts'
import { supportedChains } from './supported-chains.ts'
import {
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ChainTransaction,
  type Log_,
  ChainFamily,
} from './types.ts'
import { convertKeysToCamelCase, decodeAddress, leToBigInt, networkInfo } from './utils.ts'

function decodeJsonMessage(data: Record<string, unknown> | undefined) {
  if (!data || typeof data != 'object') throw new CCIPMessageInvalidError(data)
  if (data.message) data = data.message as Record<string, unknown>
  if (data.header) {
    Object.assign(data, data.header)
    delete data.header
  }
  let data_ = data as Record<string, unknown> & {
    dest_chain_selector?: string
    destChainSelector?: string
    source_chain_selector?: string
    sourceChainSelector?: string
    extraArgs?: string
    tokenAmounts: {
      destExecData: string
      destGasAmount?: bigint
    }[]
  }
  const sourceChainSelector = data_.source_chain_selector ?? data_.sourceChainSelector
  if (!sourceChainSelector) throw new CCIPMessageInvalidError(data)
  const sourceNetwork = networkInfo(sourceChainSelector)

  const destChainSelector = data_.dest_chain_selector ?? data_.destChainSelector
  if (destChainSelector) {
    const destFamily = networkInfo(destChainSelector).family
    data_ = convertKeysToCamelCase(data_, (v, k) =>
      typeof v === 'string' && v.match(/^\d+$/)
        ? BigInt(v)
        : k === 'receiver' || k === 'destTokenAddress' || k === 'tokenReceiver'
          ? decodeAddress(v as string, destFamily)
          : v,
    ) as typeof data_
  }

  for (const ta of data_.tokenAmounts) {
    if (ta.destGasAmount != null || !ta.destExecData) continue
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
    const extraArgs = decodeExtraArgs(data_.extraArgs ?? '', sourceNetwork.family)
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
    (typeof data === 'object' && !isBytesLike(data))
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
  throw new CCIPMessageDecodeError()
}

/**
 * Fetch all CCIP messages in a transaction
 * @param source - Chain
 * @param tx - ChainTransaction to search in
 * @returns CCIP requests (messages) in the transaction (at least one)
 **/
export async function getMessagesInTx(source: Chain, tx: ChainTransaction): Promise<CCIPRequest[]> {
  const txHash = tx.hash

  const requests: CCIPRequest[] = []
  for (const log of tx.logs) {
    let lane
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (!message) continue
    if ('destChainSelector' in message) {
      const [_, version] = await source.typeAndVersion(log.address)
      lane = {
        sourceChainSelector: message.sourceChainSelector,
        destChainSelector: message.destChainSelector,
        onRamp: log.address,
        version: version as CCIPVersion,
      }
    } else if (source.network.family !== ChainFamily.EVM) {
      throw new CCIPNetworkFamilyUnsupportedError(source.network.family)
    } else {
      lane = await (source as EVMChain).getLaneForOnRamp(log.address)
    }
    requests.push({ lane, message, log, tx })
  }
  if (!requests.length) {
    throw new CCIPMessageNotFoundInTxError(txHash)
  }

  return requests
}

/**
 * Fetch a CCIP message by its messageId.
 * Can be slow due to having to paginate backwards through logs.
 * @param source - Provider to fetch logs from.
 * @param messageId - MessageId to search for.
 * @param hints - Optional hints for pagination (e.g., `address` for onRamp, `page` for pagination size).
 * @returns CCIPRequest with given messageId.
 */
export async function getMessageById(
  source: Chain,
  messageId: string,
  hints?: { page?: number; address?: string },
): Promise<CCIPRequest> {
  for await (const log of source.getLogs({
    topics: ['CCIPSendRequested', 'CCIPMessageSent'],
    ...hints,
  })) {
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (message?.messageId !== messageId) continue
    let destChainSelector, version
    if ('destChainSelector' in message) {
      destChainSelector = message.destChainSelector
      ;[, version] = await source.typeAndVersion(log.address)
    } else {
      ;({ destChainSelector, version } = await (source as EVMChain).getLaneForOnRamp(log.address))
    }
    const tx = log.tx ?? (await source.getTransaction(log.transactionHash))
    return {
      lane: {
        sourceChainSelector: message.sourceChainSelector,
        destChainSelector,
        onRamp: log.address,
        version: version as CCIPVersion,
      },
      message,
      log,
      tx,
    }
  }
  throw new CCIPMessageIdNotFoundError(messageId)
}

// Number of blocks to expand the search window for logs
const BLOCK_LOG_WINDOW_SIZE = 5000

/**
 * Fetches all CCIP messages contained in a given commit batch.
 * @param source - The source chain.
 * @param request - The CCIP request containing lane and message info.
 * @param seqNrRange - Object containing minSeqNr and maxSeqNr for the batch range.
 * @param opts - Optional log filtering parameters.
 * @returns Array of messages in the batch.
 */
export async function getMessagesInBatch<
  C extends Chain,
  R extends PickDeep<
    CCIPRequest,
    'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
  >,
>(
  source: C,
  request: R,
  { minSeqNr, maxSeqNr }: { minSeqNr: bigint; maxSeqNr: bigint },
  opts: Parameters<C['getLogs']>[0] = { page: BLOCK_LOG_WINDOW_SIZE },
): Promise<R['message'][]> {
  if (minSeqNr === maxSeqNr) return [request.message]

  const filter = {
    page: BLOCK_LOG_WINDOW_SIZE,
    topics: [request.log.topics[0]],
    address: request.log.address,
    ...opts,
  }
  if (request.message.sequenceNumber === maxSeqNr) filter.endBlock = request.log.blockNumber
  else
    // start proportionally before send request block, including case when seqNum==min => startBlock
    filter.startBlock =
      request.log.blockNumber -
      Math.ceil(
        (Number(request.message.sequenceNumber - minSeqNr) / Number(maxSeqNr - minSeqNr)) *
          filter.page,
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
        ('destChainSelector' in message &&
          message.destChainSelector !== request.lane.destChainSelector)
      )
        continue
      if (message.sequenceNumber < minSeqNr) continue
      messages.push(message)
      if (message.sequenceNumber >= maxSeqNr) break
    }
    if (messages.length && messages[0]!.sequenceNumber > minSeqNr) {
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
        ('destChainSelector' in message &&
          message.destChainSelector !== request.lane.destChainSelector)
      )
        continue
      messages.unshift(message)
      if (message.sequenceNumber <= minSeqNr) break
    }
  }

  if (messages.length != Number(maxSeqNr - minSeqNr) + 1) {
    throw new CCIPMessageBatchIncompleteError(
      { min: minSeqNr, max: maxSeqNr },
      messages.map((e) => e.sequenceNumber),
    )
  }
  return messages
}

/**
 * Fetches CCIP requests originated by a specific sender.
 * @param source - Source chain instance.
 * @param sender - Sender address.
 * @param filter - Log filter options.
 * @returns Async generator of CCIP requests.
 */
export async function* getMessagesForSender(
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
    if ('destChainSelector' in message) {
      destChainSelector = message.destChainSelector
      ;[, version] = await source.typeAndVersion(log.address)
    } else if (source.network.family === ChainFamily.EVM) {
      ;({ destChainSelector, version } = await (source as EVMChain).getLaneForOnRamp(log.address))
    } else {
      throw new CCIPNetworkFamilyUnsupportedError(source.network.family)
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
 * Map source `token` to `sourcePoolAddress + destTokenAddress`.
 * @param source - Source chain.
 * @param destChainSelector - Destination network selector.
 * @param onRamp - Contract address.
 * @param sourceTokenAmounts - Array of token amounts, usually containing `token` and `amount` properties.
 * @returns Array of objects with `sourcePoolAddress`, `destTokenAddress`, and remaining properties.
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
      if (!sourcePoolAddress) throw new CCIPTokenNotInRegistryError(token, tokenAdminRegistry)
      const remotes = await source.getTokenPoolRemotes(sourcePoolAddress, destChainSelector)
      return {
        ...rest,
        sourcePoolAddress,
        destTokenAddress: remotes[networkInfo(destChainSelector).name]!.remoteToken,
      }
    }),
  )
}
