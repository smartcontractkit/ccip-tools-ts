import { Address, Cell, beginCell, toNano } from '@ton/core'
import { TonClient4, internal } from '@ton/ton'
import { type BytesLike, getAddress as checksumAddress, isBytesLike } from 'ethers'
import { memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import { type LogDecoders, fetchLogs } from './logs.ts'
import { type ChainContext, type LogFilter, Chain } from '../chain.ts'
import {
  CCIPArgumentInvalidError,
  CCIPExtraArgsInvalidError,
  CCIPHttpError,
  CCIPNotImplementedError,
  CCIPSourceChainUnsupportedError,
  CCIPTransactionNotFoundError,
  CCIPWalletInvalidError,
} from '../errors/specialized.ts'
import { type EVMExtraArgsV2, type ExtraArgs, EVMExtraArgsV2Tag } from '../extra-args.ts'
import { fetchCCIPRequestsInTx } from '../requests.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ChainFamily,
} from '../types.ts'
import {
  bytesToBuffer,
  createRateLimitedFetch,
  decodeAddress,
  getDataBytes,
  networkInfo,
  parseTypeAndVersion,
} from '../utils.ts'
import { OffRamp } from './bindings/offramp.ts'
import { OnRamp } from './bindings/onramp.ts'
import { Router } from './bindings/router.ts'
import { generateUnsignedExecuteReport as generateUnsignedExecuteReportImpl } from './exec.ts'
import { getTONLeafHasher } from './hasher.ts'
import { type CCIPMessage_V1_6_TON, type UnsignedTONTx, isTONWallet } from './types.ts'
import { lookupTxByRawHash, parseJettonContent, waitForTransaction } from './utils.ts'
import type { LeafHasher } from '../hasher/common.ts'

/**
 * Type guard to check if an error is a TVM error with an exit code.
 * TON VM errors include an exitCode property indicating the error type.
 */
function isTvmError(error: unknown): error is Error & { exitCode: number } {
  return error instanceof Error && 'exitCode' in error && typeof error.exitCode === 'number'
}

/**
 * TON chain implementation supporting TON networks.
 *
 * TON uses two different ordering concepts:
 * - `seqno` (sequence number): The actual block number in the blockchain
 * - `lt` (logical time): A per-account transaction ordering timestamp
 *
 * This implementation uses `lt` for the `blockNumber` field in logs and transactions
 * because TON's transaction APIs are indexed by `lt`, not `seqno`. The `lt` is
 * monotonically increasing per account and suitable for pagination and ordering.
 */
export class TONChain extends Chain<typeof ChainFamily.TON> {
  static {
    supportedChains[ChainFamily.TON] = TONChain
  }
  static readonly family = ChainFamily.TON
  static readonly decimals = 9 // TON uses 9 decimals (nanotons)
  private readonly rateLimitedFetch: typeof fetch
  readonly provider: TonClient4
  /**
   * Cache mapping logical time (lt) to Unix timestamp.
   * Populated during getLogs iteration for later getBlockTimestamp lookups.
   */
  private readonly ltTimestampCache: Map<number, number> = new Map()

  /**
   * Creates a new TONChain instance.
   * @param client - TonClient instance.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   */
  constructor(client: TonClient4, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)
    this.provider = client

    // Rate-limited fetch for TonCenter API (public tier: ~1 req/sec)
    const rateLimitedFetch = createRateLimitedFetch(
      { maxRequests: 1, windowMs: 1500, maxRetries: 5 },
      ctx,
    )
    this.rateLimitedFetch = (input, init) => {
      this.logger.warn?.(
        'Public TONCenter API calls are rate-limited to ~1 req/sec, some commands may be slow',
      )
      return rateLimitedFetch(input, init)
    }

    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
    })
  }

  /**
   * Creates a TONChain instance from an RPC URL.
   * Verifies the connection and detects the network.
   *
   * @param url - RPC endpoint URL for TonClient4.
   * @param ctx - Context containing logger.
   * @returns A new TONChain instance.
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<TONChain> {
    const { logger = console } = ctx ?? {}

    // Parse URL for validation
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new CCIPArgumentInvalidError('url', `Invalid URL format: ${url}`)
    }

    const hostname = parsedUrl.hostname.toLowerCase()
    const client = new TonClient4({ endpoint: url })

    // Verify connection by getting the latest block
    try {
      await client.getLastBlock()
      logger.debug?.(`Connected to TON V4 endpoint: ${url}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CCIPHttpError(0, `Failed to connect to TON V4 endpoint ${url}: ${message}`)
    }

    // Detect network from hostname
    let networkId: string
    if (hostname.includes('testnet')) {
      networkId = 'ton-testnet'
    } else if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.includes('sandbox')
    ) {
      networkId = 'ton-localnet'
    } else {
      // Default to mainnet for production endpoints
      networkId = 'ton-mainnet'
    }

    return new TONChain(client, networkInfo(networkId), ctx)
  }

  /**
   * Fetch the timestamp for a given logical time (lt) or finalized block.
   *
   * Note: For TON, the `block` parameter represents logical time (lt), not block seqno.
   * This is because TON transaction APIs are indexed by lt. The lt must have been
   * previously cached via getLogs or getTransaction calls.
   *
   * @param block - Logical time (lt) as number, or 'finalized' for latest block timestamp
   * @returns Unix timestamp in seconds
   */
  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    if (block === 'finalized') {
      // Get the latest block timestamp from V4 API
      const lastBlock = await this.provider.getLastBlock()
      return lastBlock.now
    }

    // Check lt → timestamp cache
    const cached = this.ltTimestampCache.get(block)
    if (cached !== undefined) {
      return cached
    }

    // For TON, we cannot look up timestamp by lt alone without the account address.
    // The lt must have been cached during a previous getLogs or getTransaction call.
    throw new CCIPNotImplementedError(
      `getBlockTimestamp: lt ${block} not in cache. ` +
        `TON requires lt to be cached from getLogs or getTransaction calls first.`,
    )
  }

  /**
   * Fetches a transaction by its hash.
   *
   * Supports two formats:
   * 1. Composite format: "workchain:address:lt:hash" (e.g., "0:abc123...def:12345:abc123...def")
   * 2. Raw hash format: 64-character hex string resolved via TonCenter V3 API
   *
   * Note: TON's V4 API requires (address, lt, hash) for lookups. Raw hash lookups
   * use TonCenter's V3 index API to resolve the hash to a full identifier first.
   *
   * @param hash - Transaction identifier in either format
   * @returns ChainTransaction with transaction details
   *          Note: `blockNumber` contains logical time (lt), not block seqno
   */
  async getTransaction(hash: string): Promise<ChainTransaction> {
    const parts = hash.split(':')

    // If not composite format (4 parts), check if it's a raw 64-char hex hash
    if (parts.length !== 4) {
      const cleanHash = hash.startsWith('0x') || hash.startsWith('0X') ? hash.slice(2) : hash

      if (/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
        const isTestnet = this.network.name?.includes('testnet') ?? false
        const txInfo = await lookupTxByRawHash(
          cleanHash,
          isTestnet,
          this.rateLimitedFetch,
          this.logger,
        )

        const compositeHash = `${txInfo.account}:${txInfo.lt}:${cleanHash}`
        this.logger.debug?.(`Resolved raw hash to composite: ${compositeHash}`)

        return this.getTransaction(compositeHash)
      }

      throw new CCIPArgumentInvalidError(
        'hash',
        `Invalid TON transaction hash format: "${hash}". Expected "workchain:address:lt:hash" or 64-char hex hash`,
      )
    }

    // Parse composite format: workchain:address:lt:hash
    const address = Address.parseRaw(`${parts[0]}:${parts[1]}`)
    const lt = parts[2]
    const txHash = parts[3]

    // Get the latest block to use as reference
    const lastBlock = await this.provider.getLastBlock()

    // Get account transactions using V4 API
    const account = await this.provider.getAccountLite(lastBlock.last.seqno, address)
    if (!account.account.last) {
      throw new CCIPTransactionNotFoundError(hash)
    }

    // Fetch transactions and find the one we're looking for
    const txs = await this.provider.getAccountTransactions(
      address,
      BigInt(lt),
      Buffer.from(txHash, 'hex'),
    )

    if (!txs || txs.length === 0) {
      throw new CCIPTransactionNotFoundError(hash)
    }

    const tx = txs[0].tx
    const txLt = Number(tx.lt)

    // Cache lt → timestamp for later getBlockTimestamp lookups
    this.ltTimestampCache.set(txLt, tx.now)

    // Extract logs from outgoing external messages
    const logs: Log_[] = []
    const outMessages = tx.outMessages.values()
    let index = 0
    for (const msg of outMessages) {
      if (msg.info.type === 'external-out') {
        logs.push({
          address: address.toRawString(),
          topics: [],
          data: msg.body.toBoc().toString('base64'),
          blockNumber: txLt, // Note: This is lt (logical time), not block seqno
          transactionHash: hash,
          index: index,
        })
      }
      index++
    }

    return {
      hash,
      logs,
      blockNumber: txLt, // Note: This is lt (logical time), not block seqno
      timestamp: tx.now,
      from: address.toRawString(),
    }
  }

  /**
   * Async generator that yields logs from TON transactions.
   *
   * Note: For TON, `startBlock` and `endBlock` in opts represent logical time (lt),
   * not block sequence numbers. This is because TON transaction APIs are indexed by lt.
   *
   * @param opts - Log filter options (startBlock/endBlock are interpreted as lt values)
   */
  async *getLogs(opts: LogFilter & { versionAsHash?: boolean }): AsyncIterableIterator<Log_> {
    const decoders: LogDecoders = {
      tryDecodeAsMessage: (log) => TONChain.decodeMessage(log),
      tryDecodeAsCommit: (log) => TONChain.decodeCommits(log as Log_),
    }
    yield* fetchLogs(this.provider, opts, this.ltTimestampCache, decoders)
  }

  /** {@inheritDoc Chain.fetchRequestsInTx} */
  override async fetchRequestsInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return fetchCCIPRequestsInTx(this, typeof tx === 'string' ? await this.getTransaction(tx) : tx)
  }

  /** {@inheritDoc Chain.fetchAllMessagesInBatch} */
  override async fetchAllMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    _request: R,
    _commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    _opts?: { page?: number },
  ): Promise<R['message'][]> {
    return Promise.reject(new CCIPNotImplementedError('fetchAllMessagesInBatch'))
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(
    address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
    const tonAddress = Address.parse(address)

    // Get current block for state lookup
    const lastBlock = await this.provider.getLastBlock()

    // Call the typeAndVersion getter method on the contract
    const result = await this.provider.runMethod(lastBlock.last.seqno, tonAddress, 'typeAndVersion')

    // Parse the two string slices returned by the contract
    // TON contracts return strings as cells with snake format encoding
    const typeCell = result.reader.readCell()
    const versionCell = result.reader.readCell()

    // Load strings from cells using snake format
    const contractType = typeCell.beginParse().loadStringTail()
    const version = versionCell.beginParse().loadStringTail()

    // Extract just the last part of the type (e.g., "OffRamp" from "com.chainlink.ton.ccip.OffRamp")
    const typeParts = contractType.split('.')
    const shortType = typeParts[typeParts.length - 1]

    // Format as "Type Version" and use the common parser
    const typeAndVersionStr = `${shortType} ${version}`

    return parseTypeAndVersion(typeAndVersionStr) as
      | [type_: string, version: string, typeAndVersion: string]
      | [type_: string, version: string, typeAndVersion: string, suffix: string]
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  async getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string> {
    const rawAddress = TONChain.getAddress(onRamp)
    const onRampAddress = Address.parseRaw(rawAddress)

    const onRampContract = OnRamp.createFromAddress(onRampAddress)
    const openedContract = this.provider.open(onRampContract)
    const destConfig = await openedContract.getDestChainConfig(destChainSelector)

    return destConfig.router.toString()
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  async getRouterForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const offRampAddress = Address.parse(offRamp)
    const offRampContract = OffRamp.createFromAddress(offRampAddress)
    const openedContract = this.provider.open(offRampContract)

    const sourceConfig = await openedContract.getSourceChainConfig(sourceChainSelector)
    return sourceConfig.router.toString()
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('getNativeTokenForRouter'))
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
    const routerAddress = Address.parse(router)
    const routerContract = Router.createFromAddress(routerAddress)
    const openedContract = this.provider.open(routerContract)

    try {
      // Get the specific OffRamp for the source chain selector
      const offRamp = await openedContract.getOffRamp(sourceChainSelector)
      return [offRamp.toString()]
    } catch (error) {
      if (isTvmError(error) && error.exitCode === 261) {
        return [] // Return empty array if no OffRamp configured for this source chain
      }
      throw error
    }
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    const routerAddress = Address.parse(router)
    const routerContract = Router.createFromAddress(routerAddress)
    const openedContract = this.provider.open(routerContract)

    const onRamp = await openedContract.getOnRamp(destChainSelector)
    return onRamp.toString()
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const offRampAddress = Address.parse(offRamp)
    const offRampContract = OffRamp.createFromAddress(offRampAddress)
    const openedContract = this.provider.open(offRampContract)

    try {
      const sourceConfig = await openedContract.getSourceChainConfig(sourceChainSelector)
      // Convert CrossChainAddress (buffer) to checksummed EVM address
      return checksumAddress('0x' + sourceConfig.onRamp.toString('hex'))
    } catch (error) {
      if (isTvmError(error) && error.exitCode === 266) {
        throw new CCIPSourceChainUnsupportedError(sourceChainSelector, {
          context: { offRamp },
        })
      }
      throw error
    }
  }

  /** {@inheritDoc Chain.getCommitStoreForOffRamp} */
  async getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    // TODO: FIXME: check assumption
    return Promise.resolve(offRamp)
  }

  /** {@inheritDoc Chain.getTokenForTokenPool} */
  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('getTokenForTokenPool'))
  }

  /** {@inheritDoc Chain.getTokenInfo} */
  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    const tokenAddress = Address.parse(token)
    const lastBlock = await this.provider.getLastBlock()

    try {
      const result = await this.provider.runMethod(
        lastBlock.last.seqno,
        tokenAddress,
        'get_jetton_data',
      )

      // skips
      result.reader.readBigNumber() // total_supply
      result.reader.readBigNumber() // mintable
      result.reader.readAddress() // admin_address

      const contentCell = result.reader.readCell()
      return parseJettonContent(contentCell, this.rateLimitedFetch, this.logger)
    } catch (error) {
      this.logger.debug?.(`Failed to get jetton data for ${token}:`, error)
      return { symbol: '', decimals: 9 }
    }
  }

  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('getTokenAdminRegistryFor'))
  }

  /**
   * Decodes a CCIP message from a TON log event.
   * @param log - Log with data field.
   * @returns Decoded CCIPMessage or undefined if not valid.
   */
  static decodeMessage(log: Pick<Log_, 'data'>): CCIPMessage_V1_6_TON | undefined {
    if (!log.data || typeof log.data !== 'string') return undefined

    try {
      // Parse BOC from base64
      const boc = Buffer.from(log.data, 'base64')
      const cell = Cell.fromBoc(boc)[0]
      const slice = cell.beginParse()

      // Load header fields directly (no topic prefix)
      // Structure from TVM2AnyRampMessage:
      // header: RampMessageHeader + sender: address + body: Cell + feeValueJuels: uint96
      const header = {
        messageId: '0x' + slice.loadUintBig(256).toString(16).padStart(64, '0'),
        sourceChainSelector: slice.loadUintBig(64),
        destChainSelector: slice.loadUintBig(64),
        sequenceNumber: slice.loadUintBig(64),
        nonce: slice.loadUintBig(64),
      }

      // Load sender address
      const sender = slice.loadAddress()?.toString() ?? ''

      // Load body cell ref
      const bodyCell = slice.loadRef()

      // Load feeValueJuels (96 bits) at message level, after body ref
      const feeValueJuels = slice.loadUintBig(96)

      // Parse body cell: TVM2AnyRampMessageBody
      // Order: receiver (ref) + data (ref) + extraArgs (ref) + tokenAmounts (ref) + feeToken (inline) + feeTokenAmount (256 bits)
      const bodySlice = bodyCell.beginParse()

      // Load receiver from ref 0 (CrossChainAddress: length(8 bits) + bytes)
      const receiverSlice = bodySlice.loadRef().beginParse()
      const receiverLength = receiverSlice.loadUint(8)
      const receiverBytes = receiverSlice.loadBuffer(receiverLength)

      // Decode receiver address using destination chain's format
      let receiver: string
      try {
        const destFamily = networkInfo(header.destChainSelector).family
        receiver = decodeAddress(receiverBytes, destFamily)
      } catch {
        // Fallback to raw hex if chain not registered or decoding fails
        receiver = '0x' + receiverBytes.toString('hex')
      }

      // Load data from ref 1
      const dataSlice = bodySlice.loadRef().beginParse()
      const dataBytes = dataSlice.loadBuffer(dataSlice.remainingBits / 8)
      const data = '0x' + dataBytes.toString('hex')

      // Load extraArgs from ref 2
      const extraArgsCell = bodySlice.loadRef()
      const extraArgsSlice = extraArgsCell.beginParse()

      // Read tag (32 bits)
      const extraArgsTag = extraArgsSlice.loadUint(32)
      if (extraArgsTag !== Number(EVMExtraArgsV2Tag)) return undefined

      // Read gasLimit (maybe uint256): 1 bit flag + 256 bits if present
      const hasGasLimit = extraArgsSlice.loadBit()
      const gasLimit = hasGasLimit ? extraArgsSlice.loadUintBig(256) : 0n

      // Read allowOutOfOrderExecution (1 bit)
      const allowOutOfOrderExecution = extraArgsSlice.loadBit()

      // Build extraArgs as raw hex matching reference format
      const tagHex = extraArgsTag.toString(16).padStart(8, '0')
      const gasLimitHex = (hasGasLimit ? '8' : '0') + gasLimit.toString(16).padStart(63, '0')
      const oooByte = allowOutOfOrderExecution ? '40' : '00'
      const extraArgs = '0x' + tagHex + gasLimitHex + oooByte

      // Load tokenAmounts from ref 3
      const _tokenAmountsCell = bodySlice.loadRef()
      const tokenAmounts: CCIPMessage_V1_6_TON['tokenAmounts'] = [] // TODO: FIXME: parse when implemented

      // Load feeToken (inline address in body)
      const feeToken = bodySlice.loadMaybeAddress()?.toString() ?? ''

      // Load feeTokenAmount (256 bits)
      const feeTokenAmount = bodySlice.loadUintBig(256)

      return {
        ...header,
        sender,
        receiver,
        data,
        tokenAmounts,
        feeToken,
        feeTokenAmount,
        feeValueJuels,
        extraArgs,
        gasLimit,
        allowOutOfOrderExecution,
      }
    } catch {
      return undefined
    }
  }

  /**
   * Encodes extra args from TON messages into BOC serialization format.
   *
   * Currently only supports GenericExtraArgsV2 (EVMExtraArgsV2) encoding since TON
   * lanes are only connected to EVM chains. When new lanes are planned to be added,
   * this should be extended to support them (eg. Solana and SVMExtraArgsV1)
   *
   * @param args - Extra arguments containing gas limit and execution flags
   * @returns Hex string of BOC-encoded extra args (0x-prefixed)
   */
  static encodeExtraArgs(args: ExtraArgs): string {
    if (!args) return '0x'
    if ('gasLimit' in args && 'allowOutOfOrderExecution' in args) {
      const cell = beginCell()
        .storeUint(Number(EVMExtraArgsV2Tag), 32) // magic tag
        .storeUint(args.gasLimit, 256) // gasLimit
        .storeBit(args.allowOutOfOrderExecution) // bool
        .endCell()

      // Return full BOC including headers
      return '0x' + cell.toBoc().toString('hex')
    }
    return '0x'
  }

  /**
   * Decodes BOC-encoded extra arguments from TON messages.
   * Parses the BOC format and extracts extra args, validating the magic tag
   * to ensure correct type. Returns undefined if parsing fails or tag doesn't match.
   *
   * Currently only supports EVMExtraArgsV2 (GenericExtraArgsV2) encoding since TON
   * lanes are only connected to EVM chains. When new lanes are planned to be added,
   * this should be extended to support them (eg. Solana and SVMExtraArgsV1)
   *
   * @param extraArgs - BOC-encoded extra args as hex string or bytes
   * @returns Decoded EVMExtraArgsV2 (GenericExtraArgsV2) object or undefined if invalid
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ): (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' }) | undefined {
    const data = Buffer.from(getDataBytes(extraArgs))

    try {
      // Parse BOC format to extract cell data
      const cell = Cell.fromBoc(data)[0]
      const slice = cell.beginParse()

      // Load and verify magic tag to ensure correct extra args type
      const magicTag = slice.loadUint(32)
      if (magicTag !== Number(EVMExtraArgsV2Tag)) return undefined

      return {
        _tag: 'EVMExtraArgsV2',
        gasLimit: slice.loadUintBig(256),
        allowOutOfOrderExecution: slice.loadBit(),
      }
    } catch {
      // Return undefined for any parsing errors (invalid BOC, malformed data, etc.)
      return undefined
    }
  }

  /**
   * Decodes commit reports from a TON log event (CommitReportAccepted).
   *
   * @param log - Log with data field (base64-encoded BOC).
   * @param lane - Optional lane info for filtering.
   * @returns Array of CommitReport or undefined if not a valid commit event.
   */
  static decodeCommits(log: Log_, lane?: Lane): CommitReport[] | undefined {
    if (!log.data || typeof log.data !== 'string') return undefined

    try {
      const boc = Buffer.from(log.data, 'base64')
      const cell = Cell.fromBoc(boc)[0]
      const slice = cell.beginParse()

      // Cell body starts directly with hasMerkleRoot (topic is in message header)
      const hasMerkleRoot = slice.loadBit()

      if (!hasMerkleRoot) {
        // No merkle root: could be price-only update, skip for now
        return undefined
      }

      // Read MerkleRoot fields inline
      const sourceChainSelector = slice.loadUintBig(64)
      const onRampLen = slice.loadUint(8)

      if (onRampLen === 0 || onRampLen > 32) {
        // Invalid onRamp length
        return undefined
      }

      const onRampBytes = slice.loadBuffer(onRampLen)
      const minSeqNr = slice.loadUintBig(64)
      const maxSeqNr = slice.loadUintBig(64)
      const merkleRoot = '0x' + slice.loadUintBig(256).toString(16).padStart(64, '0')

      // Read hasPriceUpdates (1 bit): we don't need the data but should consume it
      if (slice.remainingBits >= 1) {
        const hasPriceUpdates = slice.loadBit()
        if (hasPriceUpdates && slice.remainingRefs > 0) {
          slice.loadRef() // Skip price updates ref
        }
      }

      const report: CommitReport = {
        sourceChainSelector,
        onRampAddress: '0x' + onRampBytes.toString('hex'),
        minSeqNr,
        maxSeqNr,
        merkleRoot,
      }

      // Filter by lane if provided
      if (lane) {
        if (report.sourceChainSelector !== lane.sourceChainSelector) return undefined
        if (report.onRampAddress?.toLowerCase() !== lane.onRamp?.toLowerCase()) return undefined
      }

      return [report]
    } catch {
      return undefined
    }
  }

  /**
   * Decodes an execution receipt from a TON log event.
   * @param _log - Log with data field.
   * @returns ExecutionReceipt or undefined if not valid.
   */
  static decodeReceipt(_log: Log_): ExecutionReceipt | undefined {
    throw new CCIPNotImplementedError('decodeReceipt')
  }

  /**
   * Converts bytes to a TON address.
   * Handles:
   * - 36-byte CCIP format: workchain(4 bytes, big-endian) + hash(32 bytes)
   * - 33-byte format: workchain(1 byte) + hash(32 bytes)
   * - 32-byte format: hash only (assumes workchain 0)
   * Also handles user-friendly format strings (e.g., "EQ...", "UQ...", "kQ...", "0Q...")
   * and raw format strings ("workchain:hash").
   * @param bytes - Bytes or string to convert.
   * @returns TON raw address string in format "workchain:hash".
   */
  static getAddress(bytes: BytesLike): string {
    // If it's already a string address, try to parse and return raw format
    if (typeof bytes === 'string') {
      // Handle raw format "workchain:hash"
      if (bytes.includes(':') && !bytes.startsWith('0x')) {
        return bytes
      }
      // Handle user-friendly format (EQ..., UQ..., etc.)
      if (
        bytes.startsWith('EQ') ||
        bytes.startsWith('UQ') ||
        bytes.startsWith('kQ') ||
        bytes.startsWith('0Q')
      ) {
        return Address.parse(bytes).toRawString()
      }
    }

    const data = bytesToBuffer(bytes)

    if (data.length === 36) {
      // CCIP cross-chain format: workchain(4 bytes, big-endian) + hash(32 bytes)
      const workchain = data.readInt32BE(0)
      const hash = data.subarray(4).toString('hex')
      return `${workchain}:${hash}`
    } else if (data.length === 33) {
      // workchain (1 byte) + hash (32 bytes)
      const workchain = data[0] === 0xff ? -1 : data[0]
      const hash = data.subarray(1).toString('hex')
      return `${workchain}:${hash}`
    } else if (data.length === 32) {
      // hash only, assume workchain 0
      return `0:${data.toString('hex')}`
    } else {
      throw new CCIPArgumentInvalidError(
        'bytes',
        `Invalid TON address bytes length: ${data.length}. Expected 32, 33, or 36 bytes.`,
      )
    }
  }

  /**
   * Formats a TON address for human-friendly display.
   * Converts raw format (workchain:hash) to user-friendly format (EQ..., UQ..., etc.)
   * @param address - Address in any recognized format
   * @returns User-friendly TON address string
   */
  static formatAddress(address: string): string {
    try {
      // Parse the address (handles both raw and friendly formats)
      const parsed = Address.parse(address)
      // Return user-friendly format (bounceable by default)
      return parsed.toString()
    } catch {
      // If parsing fails, return original
      return address
    }
  }

  /**
   * Formats a TON transaction hash for human-friendly display.
   * Extracts the raw 64-char hash from composite format for cleaner display.
   * @param hash - Transaction hash in composite or raw format
   * @returns The raw 64-char hex hash for display
   */
  static formatTxHash(hash: string): string {
    const parts = hash.split(':')
    if (parts.length === 4) {
      // Composite format: workchain:address:lt:hash - return just the hash part
      return parts[3]
    }
    // Already raw format or unknown - return as-is
    return hash
  }

  /**
   * Validates a transaction hash format for TON.
   * Supports:
   * - Raw 64-char hex hash (with or without 0x prefix)
   * - Composite format: "workchain:address:lt:hash"
   */
  static isTxHash(v: unknown): v is string {
    if (typeof v !== 'string') return false

    // Check for raw 64-char hex hash (with or without 0x prefix)
    const cleanHash = v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v
    if (/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
      return true
    }

    // Check for composite format: workchain:address:lt:hash
    const parts = v.split(':')
    if (parts.length === 4) {
      const [workchain, address, lt, hash] = parts
      // workchain should be a number (typically 0 or -1)
      if (!/^-?\d+$/.test(workchain)) return false
      // address should be 64-char hex
      if (!/^[a-fA-F0-9]{64}$/.test(address)) return false
      // lt should be a number
      if (!/^\d+$/.test(lt)) return false
      // hash should be 64-char hex
      if (!/^[a-fA-F0-9]{64}$/.test(hash)) return false
      return true
    }

    return false
  }
  /**
   * Gets the leaf hasher for TON destination chains.
   * @param lane - Lane configuration.
   * @param _ctx - Context containing logger.
   * @returns Leaf hasher function.
   */
  static getDestLeafHasher(lane: Lane, _ctx?: WithLogger): LeafHasher {
    return getTONLeafHasher(lane)
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    return Promise.reject(new CCIPNotImplementedError('getFee'))
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  generateUnsignedSendMessage(
    _sender: string,
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee?: bigint },
    _opts?: { approveMax?: boolean },
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('generateUnsignedSendMessage'))
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    return Promise.reject(new CCIPNotImplementedError('sendMessage'))
  }

  /** {@inheritDoc Chain.fetchOffchainTokenData} */
  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteReport} */
  generateUnsignedExecuteReport(
    _payer: string,
    offRamp: string,
    execReport: ExecutionReport,
    opts?: { gasLimit?: number },
  ): Promise<UnsignedTONTx> {
    if (!('allowOutOfOrderExecution' in execReport.message && 'gasLimit' in execReport.message)) {
      throw new CCIPExtraArgsInvalidError('TON')
    }

    const unsigned = generateUnsignedExecuteReportImpl(
      offRamp,
      execReport as ExecutionReport<CCIPMessage_V1_6_TON>,
      opts,
    )

    return Promise.resolve({
      family: ChainFamily.TON,
      to: unsigned.to,
      body: unsigned.body,
    })
  }

  /** {@inheritDoc Chain.executeReport} */
  async executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts: { wallet: unknown; gasLimit?: number },
  ): Promise<ChainTransaction> {
    const wallet = opts.wallet
    if (!isTONWallet(wallet)) {
      throw new CCIPWalletInvalidError(wallet)
    }

    const unsigned = await this.generateUnsignedExecuteReport(
      wallet.contract.address.toString(),
      offRamp,
      execReport as ExecutionReport<CCIPMessage_V1_6_TON>,
      opts,
    )

    // Open wallet and send transaction using the unsigned data
    const openedWallet = this.provider.open(wallet.contract)
    const seqno = await openedWallet.getSeqno()

    await openedWallet.sendTransfer({
      seqno,
      secretKey: wallet.keyPair.secretKey,
      messages: [
        internal({
          to: unsigned.to,
          value: toNano('0.2'), // TODO: FIXME: estimate proper value for execution costs instead of hardcoding.
          body: unsigned.body,
        }),
      ],
    })

    // Wait for transaction to be confirmed
    const offRampAddress = Address.parse(offRamp)
    const txInfo = await waitForTransaction(
      this.provider,
      wallet.contract.address,
      seqno,
      offRampAddress,
    )

    // Return composite hash in format "workchain:address:lt:hash"
    const hash = `${wallet.contract.address.toRawString()}:${txInfo.lt}:${txInfo.hash}`
    return this.getTransaction(hash)
  }

  /**
   * Parses raw TON data into typed structures.
   * @param data - Raw data to parse.
   * @returns Parsed data or undefined.
   */
  static parse(data: unknown) {
    if (isBytesLike(data)) {
      const parsedExtraArgs = this.decodeExtraArgs(data)
      if (parsedExtraArgs) return parsedExtraArgs
    }
  }

  /** {@inheritDoc Chain.getSupportedTokens} */
  async getSupportedTokens(_address: string): Promise<string[]> {
    return Promise.reject(new CCIPNotImplementedError('getSupportedTokens'))
  }

  /** {@inheritDoc Chain.getRegistryTokenConfig} */
  async getRegistryTokenConfig(_address: string, _tokenName: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getRegistryTokenConfig'))
  }

  /** {@inheritDoc Chain.getTokenPoolConfigs} */
  async getTokenPoolConfigs(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getTokenPoolConfigs'))
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getTokenPoolRemotes'))
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getFeeTokens'))
  }
}
