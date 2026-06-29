import type { PublicKey } from '@solana/web3.js'
import type BN from 'bn.js'
import { type Addressable, type BytesLike, hexlify, isBytesLike, toBigInt } from 'ethers'
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
  CCIPTransactionNotFinalizedError,
} from './errors/index.ts'
import type { EVMChain } from './evm/index.ts'
import { decodeExtraArgs, decodeFinalityRequested } from './extra-args.ts'
import { ChainFamily, networkInfo } from './networks.ts'
import { supportedChains } from './supported-chains.ts'
import {
  type AnyMessage,
  type CCIPMessage,
  type CCIPRequest,
  type ChainLog,
  type ChainTransaction,
  type Lane,
  type LeanNumbers,
  type MessageInput,
  CCIPVersion,
} from './types.ts'
import {
  convertKeysToCamelCase,
  decodeAddress,
  getDataBytes,
  leToBigInt,
  parseJson,
  signalToPromise,
} from './utils.ts'

type Normalized<T> = T extends PublicKey | Addressable
  ? string
  : T extends BN
    ? bigint
    : T extends Array<infer U>
      ? Array<Normalized<U>>
      : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<Normalized<U>>
        : T extends Record<string, unknown>
          ? { [K in keyof T]: Normalized<T[K]> }
          : T extends Readonly<Record<string, unknown>>
            ? { readonly [K in keyof T]: Normalized<T[K]> }
            : T

/** Convert recursively a message or config record into normalized values */
export function normalizeDeep<T extends Record<string, unknown>>(
  data: T,
  opts: { sourceFamily?: ChainFamily; destFamily?: ChainFamily } = {},
): Normalized<T> {
  return convertKeysToCamelCase(data, (v, k) => {
    if (k === 'chainFamilySelector') return hexlify(getDataBytes(v as number[]))
    if ((v as { _bn?: unknown } | undefined)?._bn) return (v as PublicKey).toString()
    if (
      k?.match(/(selector|amount|nonce|number|limit|bitmap|juels|value)$/i) ||
      (v as { words?: unknown } | undefined)?.words
    )
      return toBigInt(
        Array.isArray(v) ? getDataBytes(v) : (v as string | number | bigint | BN).toString(),
      )
    if (k?.match(/(^dest.*address)|(receiver|offramp|accounts)/i))
      return (
        v && decodeAddress((typeof v === 'bigint' ? v.toString() : v) as BytesLike, opts.destFamily)
      )
    if (k?.match(/((source.*address)|sender|issuer|origin|onramp|(feetoken$)|(token.*address$))/i))
      return (
        v &&
        decodeAddress((typeof v === 'bigint' ? v.toString() : v) as BytesLike, opts.sourceFamily)
      )
    if (
      v instanceof Uint8Array ||
      (Array.isArray(v) && v.length >= 4 && v.every((e) => typeof e === 'number'))
    )
      return hexlify(getDataBytes(v))
    return v
  }) as Normalized<T>
}

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
  data_ = normalizeDeep(data_, { sourceFamily, destFamily })

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
    const { requestedFinalityConfig, ...rest } = data_.extraArgs as Record<string, unknown>
    Object.assign(data_, rest)
    if (requestedFinalityConfig != null) {
      data_.finality = decodeFinalityRequested(parseInt(requestedFinalityConfig as string))
    }
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
 * Resolve the lane for a decoded CCIP message.
 *
 * Shared helper used by {@link getMessagesInTx}, {@link getMessageById}, and
 * {@link getMessagesInRange} to build the {@link Lane} from a decoded message and log.
 *
 * @internal
 */
export async function resolveLane(
  source: Chain,
  message: CCIPMessage,
  log: ChainLog,
): Promise<Lane> {
  if ('destChainSelector' in message) {
    if (source.network.family === ChainFamily.Canton) {
      return {
        sourceChainSelector: message.sourceChainSelector,
        destChainSelector: message.destChainSelector,
        onRamp: log.address || '',
        version: CCIPVersion.V2_0,
      }
    }
    const [_, version] = await source.typeAndVersion(log.address)
    return {
      sourceChainSelector: message.sourceChainSelector,
      destChainSelector: message.destChainSelector,
      onRamp: log.address,
      version: version as CCIPVersion,
    }
  } else if (source.network.family !== ChainFamily.EVM) {
    throw new CCIPChainFamilyUnsupportedError(source.network.family)
  } else {
    return await (source as EVMChain).getLaneForOnRamp(log.address)
  }
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
  const requests: CCIPRequest[] = []
  for (const log of tx.logs) {
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (!message) continue
    const lane = await resolveLane(source, message, log)
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
    const lane = await resolveLane(source, message, log)
    const tx = log.tx ?? (await source.getTransaction(log.transactionHash))
    return { lane, message, log, tx }
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
    | `log.${'topics' | 'address' | 'blockNumber' | 'blockTimestamp'}`
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

  type LogAnchor = Pick<R['log'], 'blockNumber' | 'blockTimestamp'>
  type BatchEntry = { log: LogAnchor; message: R['message'] }

  const baseFilter = {
    page: opts.page ?? BLOCK_LOG_WINDOW_SIZE,
    topics: [request.log.topics[0]],
    address: request.log.address,
    ...opts,
  }

  const entries: BatchEntry[] = []

  const collectForward = async (filter: Parameters<C['getLogs']>[0]): Promise<boolean> => {
    // on first, collect up to batch end; on subsequent, collect up to before earliest seen
    const stopAtSeqNr = entries.length ? BigInt(entries[0]!.message.sequenceNumber) - 1n : maxSeqNr
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
      if (BigInt(message.sequenceNumber) <= minSeqNr) done = true // if we see anything before batch, we're sure there's nothing earlier
      if (BigInt(message.sequenceNumber) < minSeqNr) continue // if before batch, ignore
      if (BigInt(message.sequenceNumber) <= maxSeqNr) head.push({ log, message }) // inside batch, collect
      if (BigInt(message.sequenceNumber) >= stopAtSeqNr) break
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
      Number(request.log.blockNumber) -
        Math.ceil(
          (Number(BigInt(request.message.sequenceNumber) - minSeqNr) /
            Number(maxSeqNr - minSeqNr)) *
            Number(baseFilter.page),
        ),
    ),
    // iff our request is maxSeqNr, we know we don't need to go past it
    ...(BigInt(request.message.sequenceNumber) === maxSeqNr && {
      endBlock: request.log.blockNumber,
    }),
  })

  let retries = 0
  const batchSize = Number(maxSeqNr - minSeqNr) + 1
  while (!done && BigInt(entries[0]!.message.sequenceNumber) > minSeqNr) {
    const earliest = entries[0]!
    const earliestBefore = earliest.message.sequenceNumber

    done = await collectForward({
      ...baseFilter,
      startTime: Math.max(
        0,
        Number(earliest.log.blockTimestamp) - BATCH_LOG_LOOKBACK_SECONDS * 2 ** retries,
      ),
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
 * Discover and decode CCIP messages within a block/slot/checkpoint range.
 *
 * This is the range-scanning equivalent of {@link getMessagesInTx}. It composes
 * {@link Chain.getLogs} and {@link ChainStatic.decodeMessage} to yield CCIP requests
 * in discovery order without requiring transaction hashes upfront.
 *
 * Results are yielded in native log order: (blockNumber, logIndex) ascending for EVM,
 * slot order for Solana. Non-CCIP logs in the range are silently skipped.
 *
 * @param source - Source chain to scan logs from
 * @param opts - {@link LogFilter} options. Key fields:
 *   - `startBlock` / `endBlock` — block/slot range (endBlock supports `'finalized'` and `'latest'`)
 *   - `address` — onRamp/router address (optional on EVM, required on Solana)
 *   - `topics` — defaults to both CCIP message event names
 *   - `page` — batch size for log pagination
 * @returns Async iterator of {@link CCIPRequest} objects in native log order
 *
 * @throws {@link CCIPChainFamilyUnsupportedError} if a pre-v1.6 message is found on a non-EVM chain
 * @throws {@link CCIPLogsAddressRequiredError} on Solana if `address` is not provided
 *
 * @example EVM — scan a block range for all CCIP messages
 *
 * ```typescript
 * const chain = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * for await (const request of getMessagesInRange(chain, {
 *   startBlock: 1000000,
 *   endBlock: 1001000,
 *   address: '0xOnRampAddress...', // optional on EVM, but recommended for public RPCs
 * })) {
 *   console.log(`seqNr=${request.message.sequenceNumber} dest=${request.lane.destChainSelector}`)
 * }
 * ```
 *
 * @example Solana — scan a slot range (address required)
 *
 * ```typescript
 * const chain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
 * for await (const request of getMessagesInRange(chain, {
 *   startBlock: 450000000,
 *   endBlock: 450100000,
 *   address: 'Ccip842gzYHh...', // router program address (required on Solana)
 * })) {
 *   console.log(`seqNr=${request.message.sequenceNumber}`)
 * }
 * ```
 *
 * @see {@link getMessagesInTx} - Per-transaction message discovery
 * @see {@link getMessagesInBatch} - Batch discovery by sequence number range
 */
export async function* getMessagesInRange(
  source: Chain,
  opts: LeanNumbers<LogFilter>,
): AsyncIterableIterator<CCIPRequest> {
  for await (const log of source.getLogs({
    ...opts,
    topics: opts.topics ?? [
      ...(source.network.family === ChainFamily.EVM ? ['CCIPSendRequested'] : []),
      'CCIPMessageSent',
    ],
  })) {
    const message = (source.constructor as ChainStatic).decodeMessage(log)
    if (!message) continue
    const lane = await resolveLane(source, message, log)
    const tx = log.tx ?? (await source.getTransaction(log.transactionHash))
    yield { lane, message, log, tx }
  }
}

/**
 * Confirm a log tx is finalized or wait for it to be finalized.
 *
 * @param chain - Chain instance to check finality on
 * @param opts - Options containing the request, finality level, and optional cancel promise
 * @returns Some block info at or after tx finalization
 *
 * @throws {@link CCIPTransactionNotFinalizedError} if the transaction is not included (e.g., due to a reorg)
 *
 * @example Wait for message finality
 * ```typescript
 * const request = await source.getMessagesInTx(txHash)
 * try {
 *   await waitFinalized(chain, { request: request[0] })
 *   console.log('Transaction finalized')
 * } catch (err) {
 *   if (err instanceof CCIPTransactionNotFinalizedError) {
 *     console.log('Transaction not yet finalized')
 *   }
 * }
 * ```
 */
export async function waitFinalized<C extends Chain>(
  chain: C,
  {
    finality = 'finalized',
    abort,
    reorgSafetyBlocks = 10,
    pollInterval = 5_000,
    ...rest
  }: Parameters<Chain['waitFinalized']>[0],
): Promise<Awaited<ReturnType<Chain['getBlockInfo']>> | undefined> {
  const log = 'request' in rest ? rest.request.log : rest.log
  // Fast-path: if the log is old enough, check tx timestamp vs finalized timestamp
  if (!log.blockTimestamp || Date.now() / 1e3 - Number(log.blockTimestamp) > 60) {
    const [tx, finalized, latest] = await Promise.all([
      chain.getTransaction(log.transactionHash),
      chain.getBlockInfo(finality),
      chain.getBlockInfo('latest'),
    ])
    if (tx.timestamp <= finalized.timestamp) return latest
  }
  const watch = abort ? AbortSignal.any([chain.abort, abort]) : chain.abort

  // Block-height deadline: poll finalized block height and abort if tx is gone
  const deadlineAc = new AbortController()
  const deadline = deadlineAc.signal
  let txBlockNumber = Number(log.blockNumber)
  const blockHeightPoller = (async () => {
    let firstFinalized
    while (!watch.aborted && !deadline.aborted) {
      try {
        const info = await chain.getBlockInfo(finality)
        if (info.number >= txBlockNumber) {
          firstFinalized ??= info.number
          // OG txBlock finalized — but the tx may have been reorged to a later block.
          // Re-fetch the tx: if it's still present, update blockNumber and keep going.
          try {
            const tx = await chain.getTransaction(log.transactionHash)
            if (tx.blockNumber !== txBlockNumber) txBlockNumber = tx.blockNumber
            // tx still present — fall through to the delay and re-evaluate;
            // if it's genuinely finalized, the concurrent getLogs loop will match it
          } catch {
            if (info.number > Math.max(firstFinalized, txBlockNumber + reorgSafetyBlocks - 1)) {
              // some block after the original tx block has been finalized without the tx reappearing — very likely reorged out
              deadlineAc.abort(new CCIPTransactionNotFinalizedError(log.transactionHash))
              return
            }
            chain.logger.debug(`waitFinalized: tx not found`, {
              network: chain.network.name,
              txHash: log.transactionHash,
              finality,
              finalizedBlock: info,
              firstFinalized,
              txBlockNumber,
              reorgSafetyBlocks,
            })
          }
        }
      } catch {
        // transient RPC error — retry on next poll
      }
      // wait before re-checking; exit early on watch abort
      await signalToPromise(
        AbortSignal.any([watch, deadline, AbortSignal.timeout(pollInterval)]),
      ).catch(() => {})
    }
  })()

  // Race: getLogs watch vs block height deadline
  const combinedWatch = AbortSignal.any([watch, deadline])
  try {
    for await (const l of chain.getLogs({
      address: log.address,
      startBlock: Number(log.blockNumber) - 10,
      endBlock: finality,
      topics: [log.topics[0]!],
      watch: combinedWatch,
    })) {
      if (l.transactionHash === log.transactionHash) {
        return chain.getBlockInfo('latest')
      } else if (l.blockNumber > txBlockNumber) {
        break
      }
    }
  } catch (err) {
    // If the reorg deadline fired, its reason is already the right error
    if (deadline.aborted) throw deadline.reason
    // External cancellation (e.g. show.ts found an execution first on a FTF message):
    // not a finality failure — swallow it and let the caller ignore the result
    if (watch.aborted) return undefined
    throw err
  } finally {
    deadlineAc.abort() // stop the poller if getLogs resolved first
    await blockHeightPoller // clean up
  }
  // getLogs ended without matching the tx; if we were cancelled, don't report a reorg
  if (watch.aborted) return undefined
  throw new CCIPTransactionNotFinalizedError(log.transactionHash)
}
