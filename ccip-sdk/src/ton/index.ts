import { Buffer } from 'buffer'

import { type Transaction, Address, Cell, beginCell, toNano } from '@ton/core'
import { TonClient } from '@ton/ton'
import { type AxiosAdapter, getAdapter } from 'axios'
import { type BytesLike, hexlify, isBytesLike, isHexString, toBeArray, toBeHex } from 'ethers'
import { type Memoized, memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import { streamTransactionsForAddress } from './logs.ts'
import { type ChainContext, type GetBalanceOpts, type LogFilter, Chain } from '../chain.ts'
import {
  CCIPArgumentInvalidError,
  CCIPExtraArgsInvalidError,
  CCIPHttpError,
  CCIPNotImplementedError,
  CCIPReceiptNotFoundError,
  CCIPSourceChainUnsupportedError,
  CCIPTopicsInvalidError,
  CCIPTransactionNotFoundError,
  CCIPWalletInvalidError,
} from '../errors/specialized.ts'
import { type EVMExtraArgsV2, type ExtraArgs, EVMExtraArgsV2Tag } from '../extra-args.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type CCIPExecution,
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
  ExecutionState,
} from '../types.ts'
import {
  bytesToBuffer,
  createRateLimitedFetch,
  decodeAddress,
  networkInfo,
  parseTypeAndVersion,
  sleep,
} from '../utils.ts'
import { generateUnsignedExecuteReport as generateUnsignedExecuteReportImpl } from './exec.ts'
import { getTONLeafHasher } from './hasher.ts'
import { type CCIPMessage_V1_6_TON, type UnsignedTONTx, isTONWallet } from './types.ts'
import { crc32, lookupTxByRawHash, parseJettonContent } from './utils.ts'
import type { LeafHasher } from '../hasher/common.ts'
export type { TONWallet, UnsignedTONTx } from './types.ts'

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
  readonly rateLimitedFetch: typeof fetch
  readonly provider: TonClient

  /**
   * Creates a new TONChain instance.
   * @param client - TonClient instance.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   */
  constructor(
    client: TonClient,
    network: NetworkInfo,
    ctx?: ChainContext & { fetchFn?: typeof fetch },
  ) {
    super(network, ctx)
    this.provider = client

    const txCache = new Map<string, Transaction[]>()
    const txDepleted: Record<string, boolean> = {}
    const origGetTransactions = this.provider.getTransactions.bind(this.provider)
    // cached getTransactions, used for getLogs
    this.provider.getTransactions = async (
      address: Address,
      opts: Parameters<typeof this.provider.getTransactions>[1],
    ): Promise<Transaction[]> => {
      const key = address.toString()
      let allTxs
      if (txCache.has(key)) {
        allTxs = txCache.get(key)!
      } else {
        allTxs = [] as Transaction[]
        txCache.set(key, allTxs)
      }
      let txs
      if (!opts.hash) {
        // if no cursor, always fetch most recent transactions
        txs = await origGetTransactions(address, opts)
      } else {
        const hash = opts.hash
        // otherwise, look to see if we have it already cached
        let idx = allTxs.findIndex((tx) => tx.hash().toString('base64') === hash)
        if (idx >= 0 && !opts.inclusive) idx++ // skip first if not inclusive
        // if found, and we have more than requested limit in cache, or we'd previously reached bottom of address
        if (idx >= 0 && (allTxs.length - idx >= opts.limit || txDepleted[key])) {
          return allTxs.slice(idx, idx + opts.limit) // return cached
        }
        // otherwise, fetch after end
        txs = await origGetTransactions(address, opts)
      }
      // add/merge unique/new/unseen txs to allTxs
      const allTxsHashes = new Set(allTxs.map((tx) => tx.hash().toString('base64')))
      allTxs.push(...txs.filter((tx) => !allTxsHashes.has(tx.hash().toString('base64'))))
      allTxs.sort((a, b) => Number(b.lt - a.lt)) // merge sorted inverse order
      if (txs.length < opts.limit) txDepleted[key] = true // bottom reached
      return txs
    }

    // Rate-limited fetch for TonCenter API (public tier: ~1 req/sec)
    this.rateLimitedFetch =
      ctx?.fetchFn ?? createRateLimitedFetch({ maxRequests: 1, windowMs: 1500, maxRetries: 5 }, ctx)

    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
    })

    this.getBlockTimestamp = memoize(this.getBlockTimestamp.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      forceUpdate: ([k]) => typeof k !== 'number' || k <= 0,
    })

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      maxArgs: 1,
      async: true,
    })
  }

  /**
   * Detect client network and instantiate a TONChain instance.
   */
  static async fromClient(
    client: TonClient,
    ctx?: ChainContext & { fetchFn?: typeof fetch },
  ): Promise<TONChain> {
    // Verify connection by getting the latest block
    const isTestnet =
      (
        await client.getContractState(
          Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'), // mainnet USDT
        )
      ).state !== 'active'
    return new TONChain(client, networkInfo(isTestnet ? 'ton-testnet' : 'ton-mainnet'), ctx)
  }

  /**
   * Creates a TONChain instance from an RPC URL.
   * Verifies the connection and detects the network.
   *
   * @param url - RPC endpoint URL for TonClient (v2).
   * @param ctx - Context containing logger.
   * @returns A new TONChain instance.
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<TONChain> {
    const { logger = console } = ctx ?? {}
    if (!url.endsWith('/jsonRPC')) url += '/jsonRPC'

    let fetchFn
    let httpAdapter
    if (['toncenter.com', 'tonapi.io'].some((d) => url.includes(d))) {
      logger.warn(
        'Public TONCenter API calls are rate-limited to ~1 req/sec, some commands may be slow',
      )
      fetchFn = createRateLimitedFetch({ maxRequests: 1, windowMs: 1500, maxRetries: 5 }, ctx)
      httpAdapter = (getAdapter as (name: string, config: object) => AxiosAdapter)('fetch', {
        env: { fetch: fetchFn },
      })
    }

    const client = new TonClient({ endpoint: url, httpAdapter })
    try {
      const chain = await this.fromClient(client, {
        ...ctx,
        fetchFn,
      })
      logger.debug(`Connected to TON V2 endpoint: ${url}`)
      return chain
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CCIPHttpError(0, `Failed to connect to TONv2 endpoint ${url}: ${message}`)
    }
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
    if (typeof block != 'number') {
      return Promise.resolve(Math.floor(Date.now() / 1000))
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
   * Note: TonClient requires (address, lt, hash) for lookups. Raw hash lookups
   * use TonCenter's V3 index API to resolve the hash to a full identifier first.
   *
   * @param tx - Transaction identifier in either format
   * @returns ChainTransaction with transaction details
   *          Note: `blockNumber` contains logical time (lt), not block seqno
   */
  async getTransaction(tx: string | Transaction): Promise<ChainTransaction> {
    let address
    if (typeof tx === 'string') {
      let parts = tx.split(':')

      // If not composite format (4 parts), check if it's a raw 64-char hex hash
      if (parts.length !== 4) {
        const cleanHash = tx.startsWith('0x') || tx.startsWith('0X') ? tx.slice(2) : tx

        if (!/^[a-fA-F0-9]{64}$/.test(cleanHash))
          throw new CCIPArgumentInvalidError(
            'hash',
            `Invalid TON transaction hash format: "${tx}". Expected "workchain:address:lt:hash" or 64-char hex hash`,
          )
        const txInfo = await lookupTxByRawHash(
          cleanHash,
          this.network.isTestnet,
          this.rateLimitedFetch,
          this,
        )

        tx = `${txInfo.account}:${txInfo.lt}:${cleanHash}`
        this.logger.debug(`Resolved raw hash to composite: ${tx}`)
        parts = tx.split(':')
      }

      // Parse composite format: workchain:address:lt:hash
      address = Address.parseRaw(`${parts[0]}:${parts[1]}`)
      const [, , lt, txHash] = parts as [string, string, string, string]

      // Fetch transactions and find the one we're looking for
      const tx_ = await this.provider.getTransaction(
        address,
        lt,
        Buffer.from(txHash, 'hex').toString('base64'),
      )
      if (!tx_) throw new CCIPTransactionNotFoundError(tx)
      tx = tx_
    } else {
      address = new Address(0, Buffer.from(toBeArray(tx.address, 32)))
    }

    // Cache lt → timestamp for later getBlockTimestamp lookups
    ;(this.getBlockTimestamp as Memoized<typeof this.getBlockTimestamp, { async: true }>).cache.set(
      [Number(tx.lt)],
      Promise.resolve(tx.now),
    )

    // Extract logs from outgoing external messages
    // Build composite hash format: workchain:address:lt:hash
    const compositeHash = `${address.toRawString()}:${tx.lt}:${tx.hash().toString('hex')}`
    const res = {
      hash: compositeHash,
      logs: [] as Log_[],
      blockNumber: Number(tx.lt), // Note: This is lt (logical time), not block seqno
      timestamp: tx.now,
      from: address.toRawString(),
      tx,
    }
    const logs: Log_[] = []
    for (const [index, msg] of tx.outMessages) {
      if (msg.info.type !== 'external-out') continue
      const topics = []
      // logs are external messages where dest "address" is the uint32 topic (e.g. crc32("ExecutionStateChanged"))
      if (msg.info.dest && msg.info.dest.value > 0n && msg.info.dest.value < 2n ** 32n)
        topics.push(toBeHex(msg.info.dest.value, 4))
      let data = ''
      try {
        data = msg.body.toBoc().toString('base64')
      } catch (_) {
        // ignore
      }
      logs.push({
        address: msg.info.src.toRawString(),
        topics,
        data,
        blockNumber: res.blockNumber, // Note: This is lt (logical time), not block seqno
        transactionHash: res.hash,
        index,
        tx: res,
      })
    }
    res.logs = logs
    return res
  }

  /**
   * Async generator that yields logs from TON transactions.
   *
   * Note: For TON, `startBlock` and `endBlock` in opts represent logical time (lt),
   * not block sequence numbers. This is because TON transaction APIs are indexed by lt.
   *
   * @param opts - Log filter options (startBlock/endBlock are interpreted as lt values)
   */
  async *getLogs(opts: LogFilter): AsyncIterableIterator<Log_> {
    let topics
    if (opts.topics?.length) {
      if (!opts.topics.every((topic) => typeof topic === 'string'))
        throw new CCIPTopicsInvalidError(opts.topics)
      // append events discriminants (if not 0x-8B already), but keep OG topics
      topics = new Set([
        ...opts.topics,
        ...opts.topics.filter((t) => !isHexString(t, 8)).map((t) => crc32(t)),
      ])
    }
    for await (const tx of streamTransactionsForAddress(opts, this)) {
      const logs =
        opts.startBlock == null && opts.startTime == null ? tx.logs.toReversed() : tx.logs
      for (const log of logs) {
        if (topics && !topics.has(log.topics[0]!)) continue
        yield log
      }
    }
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  override async getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    _request: R,
    _commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    _opts?: { page?: number },
  ): Promise<R['message'][]> {
    return Promise.reject(new CCIPNotImplementedError('getMessagesInBatch'))
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string) {
    const tonAddress = Address.parse(address)

    // Call the typeAndVersion getter method on the contract
    const result = await this.provider.runMethod(tonAddress, 'typeAndVersion')

    // Parse the two string slices returned by the contract
    // TON contracts return strings as cells with snake format encoding
    const typeCell = result.stack.readCell()
    const versionCell = result.stack.readCell()

    // Load strings from cells using snake format
    const contractType = typeCell.beginParse().loadStringTail()
    const version = versionCell.beginParse().loadStringTail()

    // Extract just the last part of the type (e.g., "OffRamp" from "com.chainlink.ton.ccip.OffRamp")
    const typeParts = contractType.split('.')
    const shortType = typeParts[typeParts.length - 1]

    // Format as "Type Version" and use the common parser
    const typeAndVersionStr = `${shortType} ${version}`

    return parseTypeAndVersion(typeAndVersionStr)
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  async getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string> {
    const { stack: destConfig } = await this.provider.runMethod(
      Address.parse(onRamp),
      'destChainConfig',
      [{ type: 'int', value: destChainSelector }],
    )
    return destConfig.readAddress().toRawString()
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  async getRouterForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const { stack } = await this.provider.runMethod(Address.parse(offRamp), 'sourceChainConfig', [
      { type: 'int', value: sourceChainSelector },
    ])
    return stack.readAddress().toRawString()
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('getNativeTokenForRouter'))
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
    const routerContract = this.provider.provider(Address.parse(router))
    // Get the specific OffRamp for the source chain selector
    const { stack } = await routerContract.get('offRamp', [
      { type: 'int', value: sourceChainSelector },
    ])
    return [stack.readAddress().toRawString()]
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    const routerContract = this.provider.provider(Address.parse(router))
    // Get the specific OnRamp for the source chain selector
    const { stack } = await routerContract.get('onRamp', [
      { type: 'int', value: destChainSelector },
    ])
    return stack.readAddress().toRawString()
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    try {
      const offRampContract = this.provider.provider(Address.parse(offRamp))

      const { stack } = await offRampContract.get('sourceChainConfig', [
        { type: 'int', value: sourceChainSelector },
      ])
      stack.readAddress() // router
      stack.readBoolean() // isEnabled
      stack.readBigNumber() // minSeqNr
      stack.readBoolean() // isRMNVerificationDisabled

      // onRamp is stored as CrossChainAddress cell
      const onRampCell = stack.readCell()
      const onRampSlice = onRampCell.beginParse()

      // Check if length-prefixed or raw format based on cell bit length
      const cellBits = onRampCell.bits.length
      let onRamp: Buffer

      if (cellBits === 160) {
        // Raw 20-byte EVM address (no length prefix)
        onRamp = onRampSlice.loadBuffer(20)
      } else {
        // Length-prefixed format: 8-bit length + data
        const onRampLength = onRampSlice.loadUint(8)
        onRamp = onRampSlice.loadBuffer(onRampLength)
      }
      return decodeAddress(onRamp, networkInfo(sourceChainSelector).family)
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
    if (tokenAddress.toRawString().match(/^[0:]+1$/)) {
      return { symbol: 'TON', decimals: (this.constructor as typeof TONChain).decimals }
    }

    try {
      const { stack } = await this.provider.runMethod(tokenAddress, 'get_jetton_data')

      // skips
      stack.readBigNumber() // total_supply
      stack.readBigNumber() // mintable
      stack.readAddress() // admin_address

      const contentCell = stack.readCell()
      return parseJettonContent(contentCell, this.rateLimitedFetch, this.logger)
    } catch (error) {
      this.logger.debug(`Failed to get jetton data for ${token}:`, error)
      return { symbol: '', decimals: (this.constructor as typeof TONChain).decimals }
    }
  }

  /** {@inheritDoc Chain.getBalance} */
  async getBalance(_opts: GetBalanceOpts): Promise<bigint> {
    return Promise.reject(new CCIPNotImplementedError('TONChain.getBalance'))
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
  static decodeMessage({
    data,
    topics,
  }: {
    data: unknown
    topics?: readonly string[]
  }): CCIPMessage_V1_6_TON | undefined {
    if (!data || typeof data !== 'string') return
    if (topics?.length && topics[0] !== crc32('CCIPMessageSent')) return

    try {
      // Parse BOC from base64
      const boc = bytesToBuffer(data)
      const cell = Cell.fromBoc(boc)[0]!
      const slice = cell.beginParse()

      // Load header fields directly (no topic prefix)
      // Structure from TVM2AnyRampMessage:
      // header: RampMessageHeader + sender: address + body: Cell + feeValueJuels: uint96
      const header = {
        messageId: toBeHex(slice.loadUintBig(256), 32),
        sourceChainSelector: slice.loadUintBig(64),
        destChainSelector: slice.loadUintBig(64),
        sequenceNumber: slice.loadUintBig(64),
        nonce: slice.loadUintBig(64),
      }

      // Load sender address
      const sender = slice.loadAddress().toString()

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
        data: hexlify(dataBytes),
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
    const data = bytesToBuffer(extraArgs)

    try {
      // Parse BOC format to extract cell data
      const cell = Cell.fromBoc(data)[0]!
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
  static decodeCommits(
    { data, topics }: { data: unknown; topics?: readonly string[] },
    lane?: Lane,
  ): CommitReport[] | undefined {
    if (!data || typeof data !== 'string') return
    if (topics?.length && topics[0] !== crc32('CommitReportAccepted')) return
    try {
      const boc = bytesToBuffer(data)
      const cell = Cell.fromBoc(boc)[0]!
      const slice = cell.beginParse()

      // Cell body starts directly with hasMerkleRoot (topic is in message header)
      const hasMerkleRoot = slice.loadBit()

      // No merkle root: could be price-only update, skip for now
      if (!hasMerkleRoot) return

      // Read MerkleRoot fields inline
      const sourceChainSelector = slice.loadUintBig(64)
      const onRampLen = slice.loadUint(8)

      // Invalid onRamp length
      if (onRampLen === 0 || onRampLen > 32) return

      const onRampAddress = decodeAddress(
        slice.loadBuffer(onRampLen),
        networkInfo(sourceChainSelector).family,
      )
      const minSeqNr = slice.loadUintBig(64)
      const maxSeqNr = slice.loadUintBig(64)
      const merkleRoot = hexlify(slice.loadBuffer(32))

      // Read hasPriceUpdates (1 bit): we don't need the data but should consume it
      if (slice.remainingBits >= 1) {
        const hasPriceUpdates = slice.loadBit()
        if (hasPriceUpdates && slice.remainingRefs > 0) {
          slice.loadRef() // Skip price updates ref
        }
      }

      const report: CommitReport = {
        sourceChainSelector,
        onRampAddress,
        minSeqNr,
        maxSeqNr,
        merkleRoot,
      }

      // Filter by lane if provided
      if (lane) {
        if (report.sourceChainSelector !== lane.sourceChainSelector) return
        if (report.onRampAddress !== lane.onRamp) return
      }

      return [report]
    } catch {
      return
    }
  }

  /**
   * Decodes an execution receipt from a TON log event.
   *
   * The ExecutionStateChanged event structure (topic is in message header, not body):
   * - sourceChainSelector: uint64 (8 bytes)
   * - sequenceNumber: uint64 (8 bytes)
   * - messageId: uint256 (32 bytes)
   * - state: uint8 (1 byte) - Untouched=0, InProgress=1, Success=2, Failure=3
   *
   * @param log - Log with data field (base64-encoded BOC).
   * @returns ExecutionReceipt or undefined if not valid.
   */
  static decodeReceipt({
    data,
    topics,
  }: {
    data: unknown
    topics?: readonly string[]
  }): ExecutionReceipt | undefined {
    if (!data || typeof data !== 'string') return
    if (topics?.length && topics[0] !== crc32('ExecutionStateChanged')) return

    try {
      const boc = bytesToBuffer(data)
      const cell = Cell.fromBoc(boc)[0]!
      const slice = cell.beginParse()

      // ExecutionStateChanged has no refs
      if (cell.refs.length > 0) return

      // Cell body contains only the struct fields
      // ExecutionStateChanged: sourceChainSelector(64) + sequenceNumber(64) + messageId(256) + state(8)
      const sourceChainSelector = slice.loadUintBig(64)
      const sequenceNumber = slice.loadUintBig(64)
      const messageId = toBeHex(slice.loadUintBig(256), 32)
      const state = slice.loadUint(8)

      // Validate state is a valid ExecutionState (2-3)
      // TON has intermediary txs with state 1 (InProgress), but we filter them here
      if (state !== ExecutionState.Success && state !== ExecutionState.Failed) return

      return {
        messageId,
        sequenceNumber,
        sourceChainSelector,
        state: state as ExecutionState,
      }
    } catch {
      // ignore
    }
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
      return parts[3]!
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
      const [workchain, address, lt, hash] = parts as [string, string, string, string]
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
  async getFee(_opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    return Promise.reject(new CCIPNotImplementedError('getFee'))
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  generateUnsignedSendMessage(
    _opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('generateUnsignedSendMessage'))
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(_opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    return Promise.reject(new CCIPNotImplementedError('sendMessage'))
  }

  /** {@inheritDoc Chain.getOffchainTokenData} */
  getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteReport} */
  generateUnsignedExecuteReport({
    offRamp,
    execReport,
    ...opts
  }: Parameters<Chain['generateUnsignedExecuteReport']>[0]): Promise<UnsignedTONTx> {
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
      ...unsigned,
    })
  }

  /** {@inheritDoc Chain.executeReport} */
  async executeReport(opts: Parameters<Chain['executeReport']>[0]): Promise<CCIPExecution> {
    const { offRamp, wallet } = opts
    if (!isTONWallet(wallet)) {
      throw new CCIPWalletInvalidError(wallet)
    }
    const payer = await wallet.getAddress()

    const { family: _, ...unsigned } = await this.generateUnsignedExecuteReport({
      ...opts,
      payer,
    })

    const startTime = Math.floor(Date.now() / 1000)
    // Open wallet and send transaction using the unsigned data
    const seqno = await wallet.sendTransaction({
      value: toNano('0.3'),
      ...unsigned,
    })

    const message = opts.execReport.message as CCIPMessage_V1_6_TON
    for await (const exec of this.getExecutionReceipts({
      offRamp,
      messageId: message.messageId,
      sourceChainSelector: message.sourceChainSelector,
      startTime,
      watch: sleep(10 * 60e3 /* 10m */),
    })) {
      return exec // break and return on first yield
    }
    throw new CCIPReceiptNotFoundError(seqno.toString())
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
