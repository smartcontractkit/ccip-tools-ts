import { type BytesLike, hexlify, isBytesLike, toBigInt } from 'ethers'
import type { PickDeep } from 'type-fest'

import { type ChainStatic, type LogFilter, Chain } from './chain.ts'
import {
  CCIPChainFamilyUnsupportedError,
  CCIPMessageBatchIncompleteError,
  CCIPMessageDecodeError,
  CCIPMessageIdNotFoundError,
  CCIPMessageInvalidError,
  CCIPMessageNotFoundInTxError,
  CCIPTokenNotInRegistryError,
} from './errors/index.ts'
import type { EVMChain } from './evm/index.ts'
import { decodeExtraArgs } from './extra-args.ts'
import { supportedChains } from './supported-chains.ts'
import {
  type AnyMessage,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ChainTransaction,
  type Log_,
  type MessageInput,
  ChainFamily,
} from './types.ts'
import {
  convertKeysToCamelCase,
  decodeAddress,
  getDataBytes,
  leToBigInt,
  networkInfo,
  parseJson,
} from './utils.ts'

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
    extraArgs?: string | Record<string, unknown>
    sequenceNumber?: bigint
    messageNumber?: bigint
    tokenTransfer?: {
      destExecData: string
      destGasAmount?: bigint
      token?: string
      sourceTokenAddress?: string
    }[]
    tokenAmounts: {
      destExecData: string
      destGasAmount?: bigint
      token?: string
      sourceTokenAddress?: string
    }[]
    feeToken?: string
    feeTokenAmount?: bigint
    fees?: {
      fixedFeesDetails: {
        tokenAddress: string
        totalAmount: bigint
      }
    }
    receipts?: { feeTokenAmount: bigint }[]
    sourceNetworkInfo?: { chainSelector: string }
    destNetworkInfo?: { chainSelector: string }
  }
  const sourceChainSelector =
    data_.source_chain_selector ??
    data_.sourceChainSelector ??
    data_.sourceNetworkInfo?.chainSelector
  if (!sourceChainSelector) throw new CCIPMessageInvalidError(data)
  data_.sourceChainSelector ??= sourceChainSelector
  data_.nonce ??= 0n
  const sourceFamily = networkInfo(sourceChainSelector).family

  const destChainSelector =
    data_.dest_chain_selector ?? data_.destChainSelector ?? data_.destNetworkInfo?.chainSelector
  if (destChainSelector) data_.destChainSelector ??= destChainSelector
  const destFamily = destChainSelector ? networkInfo(destChainSelector).family : ChainFamily.EVM
  // transform type, normalize keys case, source/dest addresses, and ensure known bigints
  data_ = convertKeysToCamelCase(data_, (v, k) =>
    k?.match(/(selector|amount|nonce|number|limit|bitmap|juels)$/i)
      ? BigInt(v as string | number | bigint)
      : k?.match(/(^dest.*address)|(receiver|offramp|accounts)/i)
        ? decodeAddress(v as BytesLike, destFamily)
        : k?.match(/((source.*address)|sender|issuer|origin|onramp|(feetoken$)|(token.*address$))/i)
          ? decodeAddress(v as BytesLike, sourceFamily)
          : v instanceof Uint8Array ||
              (Array.isArray(v) && v.length >= 4 && v.every((e) => typeof e === 'number'))
            ? hexlify(getDataBytes(v as readonly number[]))
            : v,
  ) as typeof data_

  if (data_.tokenTransfer) {
    data_.tokenAmounts = data_.tokenTransfer
    delete data_.tokenTransfer
  }
  for (const ta of data_.tokenAmounts) {
    if (ta.token && !ta.sourceTokenAddress) ta.sourceTokenAddress = ta.token
    if (!ta.token && ta.sourceTokenAddress) ta.token = ta.sourceTokenAddress
    if (ta.destGasAmount != null || !ta.destExecData) continue
    switch (sourceFamily) {
      // EVM & Solana encode destExecData as big-endian
      case ChainFamily.EVM:
      case ChainFamily.Solana:
        ta.destGasAmount = toBigInt(getDataBytes(ta.destExecData))
        break
      // Aptos & Sui, as little-endian
      default:
        ta.destGasAmount = leToBigInt(getDataBytes(ta.destExecData))
    }
  }

  if (data_.extraArgs && typeof data_.extraArgs === 'string') {
    const extraArgs = decodeExtraArgs(data_.extraArgs, sourceFamily)
    if (extraArgs) {
      const { _tag, ...rest } = extraArgs
      Object.assign(data_, rest)
    }
  } else if (data_.extraArgs) {
    Object.assign(data_, data_.extraArgs)
    delete data_.extraArgs
  }

  if (data_.fees && !data_.feeToken) {
    data_.feeToken = data_.fees.fixedFeesDetails.tokenAddress
    data_.feeTokenAmount = data_.fees.fixedFeesDetails.totalAmount
  }
  if (data_.sequenceNumber == null && data_.messageNumber != null) {
    data_.sequenceNumber = data_.messageNumber
  }
  if (!data_.feeTokenAmount && data_.receipts) {
    data_.feeTokenAmount = data_.receipts.reduce(
      (acc, receipt) => acc + receipt.feeTokenAmount,
      BigInt(0),
    )
  }

  return data_ as unknown as CCIPMessage
}

/**
 * Decodes hex strings, bytearrays, JSON strings and raw objects as CCIPMessages.
 * Does minimal validation, but converts objects in the format expected by ccip-tools-ts.
 *
 * @param data - Data to decode (hex string, Uint8Array, JSON string, or object)
 * @returns Decoded CCIPMessage
 * @throws {@link CCIPMessageDecodeError} if data cannot be decoded as a valid message
 * @throws {@link CCIPMessageInvalidError} if message structure is invalid or missing required fields
 *
 * @example
 * ```typescript
 * import { decodeMessage } from '@chainlink/ccip-sdk'
 *
 * // Decode from JSON string
 * const message = decodeMessage('{"header":{"sourceChainSelector":"123",...}')
 *
 * // Decode from hex-encoded bytes
 * const message = decodeMessage('0x...')
 *
 * console.log('Message ID:', message.messageId)
 * ```
 */
export function decodeMessage(data: string | Uint8Array | Record<string, unknown>): CCIPMessage {
  if (
    (typeof data === 'string' && data.startsWith('{')) ||
    (typeof data === 'object' && !isBytesLike(data))
  ) {
    if (typeof data === 'string') data = parseJson<Record<string, unknown>>(data)
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
 * Populates missing required fields (e.g. `extraArgs`) from AnyMessage.
 * @param message - Partial AnyMessage with at least receiver
 * @param dest - Destination chain family to build message for
 * @returns Original message or shallow copy with defaults for required fields
 */
export function buildMessageForDest(message: MessageInput, dest: ChainFamily): AnyMessage {
  const chain = supportedChains[dest] ?? Chain
  return chain.buildMessageForDest(message)
}

/**
 * Fetch all CCIP messages in a transaction.
 * @param source - Source chain instance
 * @param tx - ChainTransaction to search in
 * @returns CCIP requests (messages) in the transaction (at least one)
 * @throws {@link CCIPChainFamilyUnsupportedError} if chain family not supported for legacy messages
 * @throws {@link CCIPMessageNotFoundInTxError} if no CCIP messages found in transaction
 *
 * @see {@link getMessageById} - Search by messageId when tx hash unknown
 */
export async function getMessagesInTx(source: Chain, tx: ChainTransaction): Promise<CCIPRequest[]> {
  // RPC fallback
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
      throw new CCIPChainFamilyUnsupportedError(source.network.family)
    } else {
      lane = await (source as EVMChain).getLaneForOnRamp(log.address)
    }
    requests.push({ lane, message, log, tx })
  }
  if (!requests.length)
    throw new CCIPMessageNotFoundInTxError(tx.hash, { context: { network: source.network.name } })
  return requests
}

/**
 * Fetch a CCIP message by messageId from RPC logs (slow scan).
 *
 * This is the fallback implementation called by {@link Chain.getMessageById}
 * when the API client is unavailable or fails.
 *
 * @param source - Source chain to scan logs from
 * @param messageId - Message ID to search for
 * @param opts - Optional hints (onRamp address narrows search, page controls batch size)
 * @returns CCIPRequest matching the messageId
 *
 * @throws {@link CCIPMessageIdNotFoundError} if message not found after scanning all logs
 *
 * @example
 *
 * ```typescript
 * import { getMessageById, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const request = await getMessageById(source, '0xabc123...', {
 *   onRamp: '0xOnRampAddress...',
 * })
 * console.log(`Found: seqNr=${request.message.sequenceNumber}`)
 * ```
 *
 * @internal
 */
export async function getMessageById(
  source: Chain,
  messageId: string,
  opts?: { page?: number; onRamp?: string },
): Promise<CCIPRequest> {
  for await (const log of source.getLogs({
    topics: ['CCIPSendRequested', 'CCIPMessageSent'],
    address: opts?.onRamp,
    ...opts,
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
 * @param range - Object containing minSeqNr and maxSeqNr for the batch range.
 * @param opts - Optional log filtering parameters.
 * @returns Array of messages in the batch.
 * @see {@link getCommitReport} - Get commit report to determine batch range
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
        !('sequenceNumber' in message) ||
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
        !('sequenceNumber' in message) ||
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
 * @throws {@link CCIPChainFamilyUnsupportedError} if chain family not supported for legacy messages
 *
 * @example
 * ```typescript
 * import { getMessagesForSender, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const chain = await EVMChain.fromUrl('https://rpc.sepolia.org')
 *
 * for await (const request of getMessagesForSender(chain, '0xSenderAddress', {})) {
 *   console.log('Message ID:', request.message.messageId)
 *   console.log('Destination:', request.lane.destChainSelector)
 * }
 * ```
 *
 * @see {@link getMessagesInTx} - Fetch from specific transaction
 * @see {@link getMessageById} - Search by messageId
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
      throw new CCIPChainFamilyUnsupportedError(source.network.family)
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
 * Map source token to its pool address and destination token address.
 *
 * Resolves token routing by querying the TokenAdminRegistry and TokenPool
 * to find the corresponding destination chain token.
 *
 * @param source - Source chain instance
 * @param destChainSelector - Destination chain selector
 * @param onRamp - OnRamp contract address
 * @param sourceTokenAmount - Token amount object containing `token` and `amount`
 * @returns Extended token amount with `sourcePoolAddress`, `sourceTokenAddress`, and `destTokenAddress`
 *
 * @throws {@link CCIPTokenNotInRegistryError} if token is not registered in TokenAdminRegistry
 *
 * @example
 * ```typescript
 * import { sourceToDestTokenAddresses, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const tokenAmount = await sourceToDestTokenAddresses(
 *   source,
 *   destChainSelector,
 *   '0xOnRamp...',
 *   { token: '0xLINK...', amount: 1000000000000000000n }
 * )
 * console.log(`Pool: ${tokenAmount.sourcePoolAddress}`)
 * console.log(`Dest token: ${tokenAmount.destTokenAddress}`)
 * ```
 */
export async function sourceToDestTokenAddresses<S extends { token: string }>(
  source: Chain,
  destChainSelector: bigint,
  onRamp: string,
  sourceTokenAmount: S,
): Promise<
  S & {
    sourcePoolAddress: string
    sourceTokenAddress: string
    destTokenAddress: string
  }
> {
  const tokenAdminRegistry = await source.getTokenAdminRegistryFor(onRamp)
  const sourceTokenAddress = sourceTokenAmount.token
  const { tokenPool: sourcePoolAddress } = await source.getRegistryTokenConfig(
    tokenAdminRegistry,
    sourceTokenAddress,
  )
  if (!sourcePoolAddress)
    throw new CCIPTokenNotInRegistryError(sourceTokenAddress, tokenAdminRegistry)
  const remotes = await source.getTokenPoolRemotes(sourcePoolAddress, destChainSelector)
  return {
    ...sourceTokenAmount,
    sourcePoolAddress,
    sourceTokenAddress,
    destTokenAddress: remotes[networkInfo(destChainSelector).name]!.remoteToken,
  }
}
