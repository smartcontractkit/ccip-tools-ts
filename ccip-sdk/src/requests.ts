import { type BytesLike, hexlify, isBytesLike, toBigInt } from 'ethers'
import { memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import type { Chain, ChainStatic, LogFilter } from './chain.ts'
import {
  CCIPChainFamilyUnsupportedError,
  CCIPLogsRequiresStartError,
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
  type ChainLog,
  type ChainTransaction,
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
        ? v == null && k === 'destAddress'
          ? v
          : decodeAddress((typeof v === 'bigint' ? v.toString() : v) as BytesLike, destFamily)
        : k?.match(/((source.*address)|sender|issuer|origin|onramp|(feetoken$)|(token.*address$))/i)
          ? decodeAddress((typeof v === 'bigint' ? v.toString() : v) as BytesLike, sourceFamily)
          : v instanceof Uint8Array ||
              (Array.isArray(v) && v.length >= 4 && v.every((e) => typeof e === 'number'))
            ? hexlify(getDataBytes(v))
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
      const decoded = chain.decodeMessage({ data })
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
  if (message.extraArgs && '_tag' in message.extraArgs) delete message.extraArgs._tag
  return supportedChains[dest]!.buildMessageForDest(message)
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
 *   startTime: 1710000000,
 * })
 * console.log(`Found: seqNr=${request.message.sequenceNumber}`)
 * ```
 *
 * @internal
 */
export async function getMessageById(
  source: Chain,
  messageId: string,
  opts?: Pick<LogFilter, 'page' | 'startBlock' | 'startTime'> & { onRamp?: string },
): Promise<CCIPRequest> {
  if (opts?.startBlock == null && opts?.startTime == null) throw new CCIPLogsRequiresStartError()
  const { onRamp, ...hints } = opts
  for await (const log of source.getLogs({
    topics: ['CCIPSendRequested', 'CCIPMessageSent'],
    address: onRamp,
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
const BATCH_LOG_LOOKBACK_SECONDS = 60 * 60

/**
 * Fetches all CCIP messages contained in a given commit batch.
 * @param source - The source chain.
 * @param request - The CCIP request containing lane and message info.
 * @param range - Object containing minSeqNr and maxSeqNr for the batch range.
 * @param opts - Optional log filtering parameters.
 * @returns Array of messages in the batch.
 * @throws {@link CCIPMessageBatchIncompleteError} if not all messages in the batch range could be found in source chain logs
 * @see {@link getVerifications} - Get commit report to determine batch range
 */
export async function getMessagesInBatch<
  C extends Chain,
  R extends PickDeep<
    CCIPRequest,
    | 'lane'
    | `log.${'topics' | 'address' | 'blockNumber' | 'tx.timestamp'}`
    | 'message.sequenceNumber'
  >,
>(
  source: C,
  request: R,
  { minSeqNr, maxSeqNr }: { minSeqNr: bigint; maxSeqNr: bigint },
  opts: Parameters<C['getLogs']>[0] = { page: BLOCK_LOG_WINDOW_SIZE },
): Promise<R['message'][]> {
  // short-circuit trivial batchSize=1
  if (minSeqNr === maxSeqNr) return [request.message]

  type LogAnchor = PickDeep<ChainLog, 'blockNumber' | 'tx.timestamp'>
  type BatchEntry = { log: LogAnchor; message: R['message'] }

  const baseFilter = {
    page: opts.page ?? BLOCK_LOG_WINDOW_SIZE,
    topics: [request.log.topics[0]],
    address: request.log.address,
    ...opts,
  }

  const entries: BatchEntry[] = []

  const getLogTimestamp = memoize(
    async (log: LogAnchor): Promise<number> => {
      if (log.tx?.timestamp != null) {
        getLogTimestamp.cache.set([log], Promise.resolve(log.tx.timestamp))
        return log.tx.timestamp
      }
      const timestamp = source.getBlockTimestamp(log.blockNumber)
      getLogTimestamp.cache.set([log], timestamp)
      return timestamp
    },
    { async: true, transformKey: ([log]) => [log.blockNumber] as const },
  )

  const collectForward = async (filter: Parameters<C['getLogs']>[0]): Promise<boolean> => {
    // on first, collect up to batch end; on subsequent, collect up to before earliest seen
    const stopAtSeqNr = entries.length ? entries[0]!.message.sequenceNumber - 1n : maxSeqNr
    let done = false
    const head: BatchEntry[] = []
    for await (const log of source.getLogs(filter)) {
      const message = (source.constructor as ChainStatic).decodeMessage(log)
      if (
        !message ||
        !('sequenceNumber' in message) ||
        ('destChainSelector' in message &&
          message.destChainSelector !== request.lane.destChainSelector)
      )
        continue
      if (message.sequenceNumber <= minSeqNr) done = true // if we see anything before batch, we're sure there's nothing earlier
      if (message.sequenceNumber < minSeqNr) continue // if before batch, ignore
      if (message.sequenceNumber <= maxSeqNr) head.push({ log, message }) // inside batch, collect
      if (message.sequenceNumber >= stopAtSeqNr) break
    }
    entries.unshift(...head)
    return done
  }

  // first, start proportionally before send request block; guaranteed to return at least 1 item (request's)
  let done = await collectForward({
    ...baseFilter,
    startBlock: Math.max(
      0,
      // edge cases: our req first => [req..]; our req last => [req-page..req]
      request.log.blockNumber -
        Math.ceil(
          (Number(request.message.sequenceNumber - minSeqNr) / Number(maxSeqNr - minSeqNr)) *
            baseFilter.page,
        ),
    ),
    // iff our request is maxSeqNr, we know we don't need to go past it
    ...(request.message.sequenceNumber === maxSeqNr && {
      endBlock: request.log.blockNumber,
    }),
  })

  let retries = 0
  const batchSize = Number(maxSeqNr - minSeqNr) + 1
  while (!done && entries[0]!.message.sequenceNumber > minSeqNr) {
    const earliest = entries[0]!
    const earliestBefore = earliest.message.sequenceNumber
    const earliestTimestamp = await getLogTimestamp(earliest.log)

    done = await collectForward({
      ...baseFilter,
      startTime: Math.max(0, earliestTimestamp - BATCH_LOG_LOOKBACK_SECONDS * 2 ** retries),
      endBlock: earliest.log.blockNumber,
    })

    const earliestAfter = entries[0]!.message.sequenceNumber
    if (earliestAfter < earliestBefore) {
      retries = 0
    } else {
      retries++
      if (retries >= 6) break
    }
  }

  if (entries.length < batchSize) {
    throw new CCIPMessageBatchIncompleteError(
      { min: minSeqNr, max: maxSeqNr },
      entries.map((e) => e.message.sequenceNumber),
    )
  }
  return entries.map((e) => e.message)
}

/**
 * Map source token to its pool address and destination token address.
 *
 * Resolves token routing by querying the TokenAdminRegistry and TokenPool
 * to find the corresponding destination chain token.
 *
 * @param opts - options to convert source to dest token addresses
 * @returns Extended token amount with `sourcePoolAddress`, `sourceTokenAddress`, and `destTokenAddress`
 *
 * @throws {@link CCIPTokenNotInRegistryError} if token is not registered in TokenAdminRegistry
 *
 * @example
 * ```typescript
 * import { sourceToDestTokenAddresses, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const tokenAmount = await sourceToDestTokenAddresses({
 *   source,
 *   onRamp: '0xOnRamp...',
 *   destChainSelector: 14767482510784806043n,
 *   sourceTokenAmount: { token: '0xLINK...', amount: 1000000000000000000n },
 * })
 * console.log(`Pool: ${tokenAmount.sourcePoolAddress}`)
 * console.log(`Dest token: ${tokenAmount.destTokenAddress}`)
 * ```
 */
export async function sourceToDestTokenAddresses<S extends { token: string }>({
  source,
  onRamp,
  destChainSelector,
  sourceTokenAmount,
}: {
  /** Source chain instance */
  source: Chain
  /** OnRamp contract address */
  onRamp: string
  /** Destination chain selector */
  destChainSelector: bigint
  /** Token amount object containing `token` and `amount` */
  sourceTokenAmount: S
}): Promise<
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
