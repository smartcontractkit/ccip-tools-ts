import {
  type BytesLike,
  type Interface,
  type JsonRpcApiProvider,
  type Log,
  type Result,
  type Signer,
  type TransactionReceipt,
  type TransactionRequest,
  type TransactionResponse,
  Contract,
  JsonRpcProvider,
  WebSocketProvider,
  ZeroAddress,
  formatUnits,
  getAddress,
  hexlify,
  isBytesLike,
  isError,
  isHexString,
  keccak256,
  toBeHex,
  toBigInt,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import { memoize } from 'micro-memoize'
import type { PickDeep, SetRequired } from 'type-fest'

import {
  type ChainContext,
  type GetBalanceOpts,
  type LaneFeatures,
  type LogFilter,
  type RateLimiterState,
  type TokenPoolRemote,
  type TokenTransferFeeConfig,
  type TokenTransferFeeOpts,
  type TotalFeesEstimate,
  Chain,
  LaneFeature,
} from '../chain.ts'
import {
  CCIPAddressInvalidEvmError,
  CCIPBlockNotFoundError,
  CCIPContractNotRouterError,
  CCIPContractTypeInvalidError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPExecTxNotConfirmedError,
  CCIPExecTxRevertedError,
  CCIPHasherVersionUnsupportedError,
  CCIPLogDataInvalidError,
  CCIPSourceChainUnsupportedError,
  CCIPTokenDecimalsInsufficientError,
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTransactionNotFoundError,
  CCIPVersionFeatureUnavailableError,
  CCIPVersionRequiresLaneError,
  CCIPVersionUnsupportedError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { ExtraArgs, GenericExtraArgsV3 } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { getUsdcBurnFees } from '../offchain.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVerifications,
  type ChainLog,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionState,
  type Lane,
  type NetworkInfo,
  type WithLogger,
  CCIPVersion,
  ChainFamily,
  NetworkType,
} from '../types.ts'
import {
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  networkInfo,
  parseTypeAndVersion,
} from '../utils.ts'
import type Token_ABI from './abi/BurnMintERC677Token.ts'
import type FeeQuoter_ABI from './abi/FeeQuoter_1_6.ts'
import type TokenPool_1_5_ABI from './abi/LockReleaseTokenPool_1_5.ts'
import type TokenPool_ABI from './abi/LockReleaseTokenPool_1_6_1.ts'
import EVM2EVMOffRamp_1_2_ABI from './abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from './abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from './abi/OffRamp_1_6.ts'
import OffRamp_2_0_ABI from './abi/OffRamp_2_0.ts'
import EVM2EVMOnRamp_1_2_ABI from './abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import type OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import type OnRamp_2_0_ABI from './abi/OnRamp_2_0.ts'
import type Router_ABI from './abi/Router.ts'
import type TokenAdminRegistry_1_5_ABI from './abi/TokenAdminRegistry_1_5.ts'
import type TokenPool_2_0_ABI from './abi/TokenPool_2_0.ts'
import {
  CCV_INDEXER_URL,
  VersionedContractABI,
  commitsFragments,
  interfaces,
  receiptsFragments,
  requestsFragments,
} from './const.ts'
import { parseData } from './errors.ts'
import {
  decodeExtraArgs as decodeExtraArgs_,
  encodeExtraArgs as encodeExtraArgs_,
} from './extra-args.ts'
import { estimateExecGas } from './gas.ts'
import { getV12LeafHasher, getV16LeafHasher } from './hasher.ts'
import { getEvmLogs } from './logs.ts'
import type { CCIPMessage_V1_6_EVM, CCIPMessage_V2_0, CleanAddressable } from './messages.ts'
import { encodeEVMOffchainTokenData } from './offchain.ts'
import { buildMessageForDest, decodeMessage, getMessagesInBatch } from '../requests.ts'
import { type UnsignedEVMTx, resultToObject } from './types.ts'
import { decodeMessageV1 } from '../messages.ts'
export type { UnsignedEVMTx }

/** Raw on-chain TokenBucket struct returned by TokenPool rate limiter queries. */
type RateLimiterBucket = { tokens: bigint; isEnabled: boolean; capacity: bigint; rate: bigint }

/** Converts an on-chain bucket to the public RateLimiterState, stripping `isEnabled`. */
function toRateLimiterState(b: RateLimiterBucket): RateLimiterState {
  return b.isEnabled ? { tokens: b.tokens, capacity: b.capacity, rate: b.rate } : null
}

/** typeguard for ethers Signer interface (used for `wallet`s)  */
function isSigner(wallet: unknown): wallet is Signer {
  return (
    typeof wallet === 'object' &&
    wallet !== null &&
    'signTransaction' in wallet &&
    'getAddress' in wallet
  )
}

/**
 * Submit transaction using best available method.
 * Try sendTransaction() first (works with browser wallets),
 * fallback to signTransaction() + broadcastTransaction() if unsupported.
 */
async function submitTransaction(
  wallet: Signer,
  tx: TransactionRequest,
  provider: JsonRpcApiProvider,
): Promise<TransactionResponse> {
  try {
    return await wallet.sendTransaction(tx)
  } catch {
    const signed = await wallet.signTransaction(tx)
    return provider.broadcastTransaction(signed)
  }
}

/**
 * EVM chain implementation supporting Ethereum-compatible networks.
 *
 * Provides methods for sending CCIP cross-chain messages, querying message
 * status, fetching fee quotes, and manually executing pending messages on
 * Ethereum Virtual Machine compatible chains.
 *
 * @example Create from RPC URL
 * ```typescript
 * import { EVMChain } from '@chainlink/ccip-sdk'
 *
 * const chain = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * console.log(`Connected to: ${chain.network.name}`)
 * ```
 *
 * @example Query messages in a transaction
 * ```typescript
 * const requests = await chain.getMessagesInTx('0xabc123...')
 * for (const req of requests) {
 *   console.log(`Message ID: ${req.message.messageId}`)
 * }
 * ```
 */
export class EVMChain extends Chain<typeof ChainFamily.EVM> {
  static {
    supportedChains[ChainFamily.EVM] = EVMChain
  }
  static readonly family = ChainFamily.EVM
  static readonly decimals = 18

  provider: JsonRpcApiProvider
  readonly destroy$: Promise<void>
  private noncesPromises: Record<string, Promise<unknown>>
  /**
   * Cache of current nonces per wallet address.
   * Used internally by {@link sendMessage} and {@link execute} to manage transaction ordering.
   * Can be inspected for debugging or manually adjusted if needed.
   */
  nonces: Record<string, number>

  /**
   * Creates a new EVMChain instance.
   * @param provider - JSON-RPC provider for the EVM network.
   * @param network - Network information for this chain.
   */
  constructor(provider: JsonRpcApiProvider, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)

    this.noncesPromises = {}
    this.nonces = {}

    this.provider = provider
    this.destroy$ = new Promise<void>((resolve) => (this.destroy = resolve))
    void this.destroy$.finally(() => provider.destroy())

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this))

    this.provider.getBlock = memoize(provider.getBlock.bind(provider), {
      maxSize: 100,
      maxArgs: 1,
      async: true,
      forceUpdate: ([block]) => typeof block !== 'number' || block <= 0,
    })
    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
      transformKey: (args) =>
        typeof args[0] !== 'string'
          ? [(args[0] as unknown as TransactionReceipt).hash]
          : (args as unknown as string[]),
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this))
    this.getNativeTokenForRouter = memoize(this.getNativeTokenForRouter.bind(this), {
      maxArgs: 1,
      async: true,
    })
    this.getTokenInfo = memoize(this.getTokenInfo.bind(this))
    this.getTokenAdminRegistryFor = memoize(this.getTokenAdminRegistryFor.bind(this), {
      async: true,
      maxArgs: 1,
    })
    this.getFeeTokens = memoize(this.getFeeTokens.bind(this), { async: true, maxArgs: 1 })
  }

  /**
   * Expose ethers provider's `listAccounts`, if provider supports it
   */
  async listAccounts(): Promise<string[]> {
    return (await this.provider.listAccounts()).map(({ address }) => address)
  }

  /**
   * Get the next nonce for a wallet address and increment the internal counter.
   * Fetches from the network on first call, then uses cached value.
   * @param address - Wallet address to get nonce for
   * @returns The next available nonce
   */
  async nextNonce(address: string): Promise<number> {
    await (this.noncesPromises[address] ??= this.provider
      .getTransactionCount(address)
      .then((nonce) => {
        this.nonces[address] = nonce
        return nonce
      }))
    return this.nonces[address]!++
  }

  /**
   * Creates a JSON-RPC provider from a URL.
   * @param url - WebSocket (wss://) or HTTP (https://) endpoint URL.
   * @returns A ready JSON-RPC provider.
   */
  static async _getProvider(url: string): Promise<JsonRpcApiProvider> {
    let provider: JsonRpcApiProvider
    let providerReady: Promise<JsonRpcApiProvider>
    if (url.startsWith('ws')) {
      const provider_ = new WebSocketProvider(url)
      providerReady = new Promise((resolve, reject) => {
        provider_.websocket.onerror = reject
        provider_
          ._waitUntilReady()
          .then(() => resolve(provider_))
          .catch(reject)
      })
      provider = provider_
    } else if (url.startsWith('http')) {
      provider = new JsonRpcProvider(url)
      providerReady = Promise.resolve(provider)
    } else {
      throw new CCIPDataFormatUnsupportedError(url)
    }
    return providerReady
  }

  /**
   * Creates an EVMChain instance from an existing provider.
   * @param provider - JSON-RPC provider instance.
   * @param ctx - context containing logger.
   * @returns A new EVMChain instance.
   */
  static async fromProvider(provider: JsonRpcApiProvider, ctx?: ChainContext): Promise<EVMChain> {
    try {
      return new EVMChain(provider, networkInfo(Number((await provider.getNetwork()).chainId)), ctx)
    } catch (err) {
      provider.destroy()
      throw err
    }
  }

  /**
   * Creates an EVMChain instance from an RPC URL.
   *
   * @param url - WebSocket (wss://) or HTTP (https://) endpoint URL.
   * @param ctx - Optional context containing logger and API client configuration.
   * @returns A new EVMChain instance connected to the specified network.
   * @throws {@link CCIPChainNotFoundError} if chain cannot be identified from chainId
   *
   * @example
   * ```typescript
   * // HTTP connection
   * const chain = await EVMChain.fromUrl('https://rpc.sepolia.org')
   *
   * // With custom logger
   * const chain = await EVMChain.fromUrl(url, { logger: customLogger })
   * ```
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<EVMChain> {
    return this.fromProvider(await this._getProvider(url), ctx)
  }

  /** {@inheritDoc Chain.getBlockTimestamp} */
  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    const res = await this.provider.getBlock(block) // cached
    if (!res) throw new CCIPBlockNotFoundError(block)
    return res.timestamp
  }

  /** {@inheritDoc Chain.getTransaction} */
  async getTransaction(hash: string | TransactionReceipt): Promise<ChainTransaction> {
    const tx = typeof hash === 'string' ? await this.provider.getTransactionReceipt(hash) : hash
    if (!tx) throw new CCIPTransactionNotFoundError(hash as string)
    const timestamp = await this.getBlockTimestamp(tx.blockNumber)
    const chainTx = {
      ...tx,
      timestamp,
      logs: [] as ChainLog[],
    }
    const logs: ChainLog[] = tx.logs.map((l) => Object.assign(l, { tx: chainTx }))
    chainTx.logs = logs
    return chainTx
  }

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(filter: LogFilter & { onlyFallback?: boolean }): AsyncIterableIterator<Log> {
    if (filter.watch instanceof Promise)
      filter = { ...filter, watch: Promise.race([filter.watch, this.destroy$]) }
    yield* getEvmLogs(filter, this)
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  override getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    range: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: Pick<LogFilter, 'page'>,
  ): Promise<R['message'][]> {
    let opts_: Parameters<EVMChain['getLogs']>[0] | undefined
    if (request.lane.version >= CCIPVersion.V1_6) {
      // specialized getLogs filter for v1.6 CCIPMessageSent events, to filter by dest
      opts_ = {
        ...opts,
        topics: [[request.log.topics[0]!], [toBeHex(request.lane.destChainSelector, 32)]],
      }
    }
    return getMessagesInBatch(this, request, range, opts_)
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string) {
    const contract = new Contract(
      address,
      VersionedContractABI,
      this.provider,
    ) as unknown as TypedContract<typeof VersionedContractABI>
    const res = parseTypeAndVersion(await contract.typeAndVersion())
    if (res[1].startsWith('1.7.')) res[1] = CCIPVersion.V2_0
    return res
  }

  /**
   * Decodes a CCIP message from a log event.
   * @param log - Log event with topics and data.
   * @returns Decoded CCIPMessage or undefined if not a valid CCIP message.
   * @throws {@link CCIPLogDataInvalidError} if log data is not valid bytes
   * @throws {@link CCIPMessageDecodeError} if message cannot be decoded
   */
  static decodeMessage(log: {
    topics?: readonly string[]
    data: unknown
  }): CCIPMessage | undefined {
    if (!isBytesLike(log.data)) throw new CCIPLogDataInvalidError(log.data)
    let fragments
    if (log.topics?.[0]) {
      const f = requestsFragments[log.topics[0] as `0x${string}`]
      if (!f) return
      fragments = [f]
    } else {
      fragments = Object.values(requestsFragments)
    }
    let message
    for (const fragment of fragments) {
      try {
        // we don't actually use Interface instance here, `decodeEventLog` is mostly static when given a fragment
        const result = interfaces.OnRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
        message = resultToObject(result) as Record<string, unknown>
        if (message.message) message = message.message as Record<string, unknown> | undefined
        else if (message.encodedMessage) {
          Object.assign(message, decodeMessageV1(message.encodedMessage as BytesLike))
        }
        if (message) break
      } catch (_) {
        // try next fragment
      }
    }
    if (!message) return
    return decodeMessage(message)
  }

  /**
   * Decodes commit reports from a log event.
   * @param log - Log event with topics and data.
   * @param lane - Lane info (required for CCIP v1.5 and earlier).
   * @returns Array of CommitReport or undefined if not a valid commit event.
   * @throws {@link CCIPLogDataInvalidError} if log data is not valid bytes
   * @throws {@link CCIPVersionRequiresLaneError} if CCIP v1.5 event but no lane provided
   */
  static decodeCommits(
    log: { topics?: readonly string[]; data: unknown },
    lane?: Omit<Lane, 'destChainSelector'>,
  ): CommitReport[] | undefined {
    if (!isBytesLike(log.data)) throw new CCIPLogDataInvalidError(log.data)
    let fragments
    if (log.topics?.[0]) {
      const fragment = commitsFragments[log.topics[0] as `0x${string}`]
      if (!fragment) return
      const isCcipV15 = fragment.name === 'ReportAccepted'
      // CCIP<=1.5 doesn't have lane info in event, so we need lane to be provided (e.g. from CommitStore's configs)
      if (isCcipV15 && !lane) throw new CCIPVersionRequiresLaneError('v1.5')
      fragments = [fragment]
    } else fragments = Object.values(commitsFragments)
    for (const fragment of fragments) {
      let result
      try {
        result = interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
      } catch (_) {
        continue
      }
      if (result.length === 1) result = result[0] as Result
      const isCcipV15 = fragment.name === 'ReportAccepted'
      if (isCcipV15) {
        return [
          {
            merkleRoot: result.merkleRoot as string,
            minSeqNr: (result.interval as Result).min as bigint,
            maxSeqNr: (result.interval as Result).max as bigint,
            sourceChainSelector: lane!.sourceChainSelector,
            onRampAddress: lane!.onRamp,
          },
        ]
      } else {
        const reports: CommitReport[] = []
        for (const c of [...(result[0] as Result[]), ...(result[1] as Result[])]) {
          // if ccip>=v1.6 and lane is provided, use it to filter reports; otherwise, include all
          if (lane && c.sourceChainSelector !== lane.sourceChainSelector) continue
          const onRampAddress = decodeOnRampAddress(
            c.onRampAddress as string,
            networkInfo(c.sourceChainSelector as bigint).family,
          )
          if (lane && onRampAddress !== lane.onRamp) continue
          reports.push({ ...c.toObject(), onRampAddress } as CommitReport)
        }
        if (reports.length) return reports
      }
    }
  }

  /**
   * Decodes an execution receipt from a log event.
   * @param log - Log event with topics and data.
   * @returns ExecutionReceipt or undefined if not a valid execution event.
   * @throws {@link CCIPLogDataInvalidError} if log data is not valid bytes
   */
  static decodeReceipt(log: {
    topics?: readonly string[]
    data: unknown
  }): ExecutionReceipt | undefined {
    if (!isBytesLike(log.data)) throw new CCIPLogDataInvalidError(log.data)
    let fragments
    if (log.topics?.[0]) {
      const f = receiptsFragments[log.topics[0] as `0x${string}`]
      if (!f) return
      fragments = [f]
    } else fragments = Object.values(receiptsFragments)
    for (const fragment of fragments) {
      try {
        const result = interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
        return {
          ...result.toObject(),
          // ...(fragment.inputs.filter((p) => p.indexed).map((p, i) => [p.name, log.topics[i+1]] as const)).
          state: Number(result.state as bigint) as ExecutionState,
        } as ExecutionReceipt
      } catch (_) {
        // continue
      }
    }
  }

  /**
   * Decodes extra arguments from a CCIP message.
   * @param extraArgs - Encoded extra arguments bytes.
   * @returns Decoded extra arguments with tag, or undefined if unknown format.
   */
  static decodeExtraArgs(extraArgs: BytesLike) {
    return decodeExtraArgs_(extraArgs)
  }

  /**
   * Encodes extra arguments for a CCIP message.
   * @param args - Extra arguments to encode.
   * @returns Encoded extra arguments as hex string.
   */
  static encodeExtraArgs(args: ExtraArgs | undefined): string {
    return encodeExtraArgs_(args)
  }

  /**
   * Converts bytes to a checksummed EVM address.
   * @param bytes - Bytes to convert (must be 20 bytes or 32 bytes with leading zeros).
   * @returns Checksummed EVM address.
   * @throws {@link CCIPAddressInvalidEvmError} if bytes cannot be converted to a valid EVM address
   */
  static getAddress(bytes: BytesLike): string {
    if (isHexString(bytes, 20)) return getAddress(bytes)
    bytes = getAddressBytes(bytes)
    if (bytes.length < 20) throw new CCIPAddressInvalidEvmError(hexlify(bytes))
    else if (bytes.length > 20) {
      if (bytes.slice(0, bytes.length - 20).every((b) => b === 0)) {
        bytes = bytes.slice(-20)
      } else {
        throw new CCIPAddressInvalidEvmError(hexlify(bytes))
      }
    }
    return getAddress(hexlify(bytes))
  }

  /**
   * Validates a transaction hash format for EVM
   */
  static isTxHash(v: unknown): v is `0x${string}` {
    return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
  }

  /**
   * Gets lane configuration from an OnRamp contract.
   * @param onRamp - OnRamp contract address.
   * @returns Lane configuration.
   * @throws {@link CCIPContractTypeInvalidError} if contract doesn't have destChainSelector
   */
  async getLaneForOnRamp(onRamp: string): Promise<Lane> {
    const [, version] = await this.typeAndVersion(onRamp)
    const onRampABI = version === CCIPVersion.V1_2 ? EVM2EVMOnRamp_1_2_ABI : EVM2EVMOnRamp_1_5_ABI
    const contract = new Contract(onRamp, onRampABI, this.provider) as unknown as TypedContract<
      typeof onRampABI
    >
    // TODO: memo this call
    const staticConfig = await contract.getStaticConfig()
    if (!staticConfig.destChainSelector)
      throw new CCIPContractTypeInvalidError(onRamp, 'missing destChainSelector', ['OnRamp'])
    return {
      sourceChainSelector: this.network.chainSelector,
      destChainSelector: staticConfig.destChainSelector,
      version: version as CCIPVersion,
      onRamp,
    }
  }

  /**
   * {@inheritDoc Chain.getRouterForOnRamp}
   * @throws {@link CCIPVersionUnsupportedError} if OnRamp version is not supported
   */
  async getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string> {
    const [, version] = await this.typeAndVersion(onRamp)
    let onRampABI
    switch (version) {
      case CCIPVersion.V1_2:
        onRampABI = EVM2EVMOnRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        onRampABI ??= EVM2EVMOnRamp_1_5_ABI
        const contract = new Contract(onRamp, onRampABI, this.provider) as unknown as TypedContract<
          typeof onRampABI
        >
        const { router } = await contract.getDynamicConfig()
        return router as string
      }
      case CCIPVersion.V1_6: {
        const contract = new Contract(
          onRamp,
          interfaces.OnRamp_v1_6,
          this.provider,
        ) as unknown as TypedContract<typeof OnRamp_1_6_ABI>
        const [, , router] = await contract.getDestChainConfig(destChainSelector)
        return router as string
      }
      case CCIPVersion.V2_0: {
        const contract = new Contract(
          onRamp,
          interfaces.OnRamp_v2_0,
          this.provider,
        ) as unknown as TypedContract<typeof OnRamp_2_0_ABI>
        const { router } = await contract.getDestChainConfig(destChainSelector)
        return router as string
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }
  }

  /**
   * {@inheritDoc Chain.getLaneFeatures}
   */
  override async getLaneFeatures(opts: {
    router: string
    destChainSelector: bigint
    token?: string
  }): Promise<Partial<LaneFeatures>> {
    const onRamp = await this.getOnRampForRouter(opts.router, opts.destChainSelector)
    const [, version] = await this.typeAndVersion(onRamp)

    const result: Partial<LaneFeatures> = {}

    // default FTF value for V2_0+ lanes if no token/pool or pool doesn't specify
    if (version >= CCIPVersion.V2_0) result[LaneFeature.MIN_BLOCK_CONFIRMATIONS] = 1

    // MIN_BLOCK_CONFIRMATIONS — V2_0+ only
    if (opts.token) {
      const { tokenPool } = await this.getRegistryTokenConfig(
        await this.getTokenAdminRegistryFor(onRamp),
        opts.token,
      )
      if (tokenPool) {
        const { minBlockConfirmations } = await this.getTokenPoolConfig(tokenPool)
        if (minBlockConfirmations != null)
          result[LaneFeature.MIN_BLOCK_CONFIRMATIONS] = minBlockConfirmations

        const remote = await this.getTokenPoolRemote(tokenPool, opts.destChainSelector)
        result[LaneFeature.RATE_LIMITS] = remote.outboundRateLimiterState
        if (minBlockConfirmations && 'customBlockConfirmationsOutboundRateLimiterState' in remote) {
          result[LaneFeature.CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS] =
            remote.customBlockConfirmationsOutboundRateLimiterState
        }
      }
    }

    return result
  }

  /**
   * {@inheritDoc Chain.getRouterForOffRamp}
   * @throws {@link CCIPVersionUnsupportedError} if OffRamp version is not supported
   */
  async getRouterForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const [, version] = await this.typeAndVersion(offRamp)
    let offRampABI, router
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        ;({ router } = await contract.getDynamicConfig())
        break
      }
      case CCIPVersion.V1_6:
        offRampABI = OffRamp_1_6_ABI
      // falls through
      case CCIPVersion.V2_0: {
        offRampABI ??= OffRamp_2_0_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        ;({ router } = await contract.getSourceChainConfig(sourceChainSelector))
        break
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }
    return router as string
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  async getNativeTokenForRouter(router: string): Promise<string> {
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return contract.getWrappedNative() as Promise<string>
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    const offRamps = await contract.getOffRamps()
    return offRamps
      .filter((offRamp) => offRamp.sourceChainSelector === sourceChainSelector)
      .map(({ offRamp }) => offRamp) as string[]
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return contract.getOnRamp(destChainSelector) as Promise<string>
  }

  /**
   * {@inheritDoc Chain.getOnRampsForOffRamp}
   * @throws {@link CCIPVersionUnsupportedError} if OffRamp version is not supported
   */
  async getOnRampsForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string[]> {
    const [, version] = await this.typeAndVersion(offRamp)
    let offRampABI
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { onRamp } = await contract.getStaticConfig()
        return [onRamp as string]
      }
      case CCIPVersion.V1_6: {
        offRampABI = OffRamp_1_6_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { onRamp } = await contract.getSourceChainConfig(sourceChainSelector)
        if (!onRamp || onRamp.match(/^(0x)?0*$/i)) return []
        return [decodeOnRampAddress(onRamp, networkInfo(sourceChainSelector).family)]
      }
      case CCIPVersion.V2_0: {
        offRampABI = OffRamp_2_0_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { onRamps } = await contract.getSourceChainConfig(sourceChainSelector)
        const sourceFamily = networkInfo(sourceChainSelector).family
        return onRamps.map((onRamp) => decodeOnRampAddress(onRamp, sourceFamily))
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }
  }

  /**
   * Fetch the CommitStore set in OffRamp config (CCIP v1.5 and earlier).
   * For CCIP v1.6 and later, it should return the offRamp address.
   *
   * @param offRamp - OffRamp contract address
   * @returns Promise resolving to CommitStore address
   *
   * @example Get commit store
   * ```typescript
   * const commitStore = await dest.getCommitStoreForOffRamp(offRampAddress)
   * // For v1.6+, commitStore === offRampAddress
   * ```
   * @throws {@link CCIPVersionUnsupportedError} if OffRamp version is not supported
   * @internal
   */
  async getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    const [, version] = await this.typeAndVersion(offRamp)
    let offRampABI
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { commitStore } = await contract.getStaticConfig()
        return commitStore as string
      }
      default:
        return offRamp
    }
  }

  /** {@inheritDoc Chain.getTokenForTokenPool} */
  async getTokenForTokenPool(tokenPool: string): Promise<string> {
    const contract = new Contract(
      tokenPool,
      interfaces.TokenPool_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof TokenPool_ABI>
    return contract.getToken() as Promise<string>
  }

  /** {@inheritDoc Chain.getTokenInfo} */
  async getTokenInfo(token: string): Promise<{ decimals: number; symbol: string; name: string }> {
    const contract = new Contract(
      token,
      interfaces.Token,
      this.provider,
    ) as unknown as TypedContract<typeof Token_ABI>
    const [symbol, decimals, name] = await Promise.all([
      contract.symbol(),
      contract.decimals(),
      contract.name(),
    ])
    return { symbol, decimals: Number(decimals), name }
  }

  /** {@inheritDoc Chain.getBalance} */
  async getBalance(opts: GetBalanceOpts): Promise<bigint> {
    const { holder, token } = opts

    if (!token) {
      return this.provider.getBalance(holder)
    }

    const contract = new Contract(
      token,
      interfaces.Token,
      this.provider,
    ) as unknown as TypedContract<typeof Token_ABI>
    return contract.balanceOf(holder)
  }

  /**
   * Gets the leaf hasher for computing Merkle proofs on the destination chain.
   * @param lane - Lane configuration.
   * @param ctx - Context object containing logger.
   * @returns Leaf hasher function.
   * @throws {@link CCIPSourceChainUnsupportedError} if source chain is not EVM for v1.2/v1.5
   * @throws {@link CCIPHasherVersionUnsupportedError} if lane version is not supported
   */
  static getDestLeafHasher(
    { sourceChainSelector, destChainSelector, onRamp, version }: Lane,
    ctx?: WithLogger,
  ): LeafHasher {
    switch (version) {
      case CCIPVersion.V1_2:
      case CCIPVersion.V1_5:
        if (networkInfo(sourceChainSelector).family !== ChainFamily.EVM)
          throw new CCIPSourceChainUnsupportedError(sourceChainSelector)
        return getV12LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher
      case CCIPVersion.V1_6:
        return getV16LeafHasher(sourceChainSelector, destChainSelector, onRamp, ctx) as LeafHasher
      default:
        throw new CCIPHasherVersionUnsupportedError('EVM', version as string)
    }
  }

  /**
   * Gets any available OnRamp for the given router.
   * @param router - Router contract address.
   * @returns OnRamp contract address.
   */
  async _getSomeOnRampFor(router: string): Promise<string> {
    // when given a router, we take any onRamp we can find, as usually they all use same registry
    const someOtherNetwork =
      this.network.networkType === NetworkType.Testnet
        ? this.network.name === 'ethereum-testnet-sepolia'
          ? 'avalanche-testnet-fuji'
          : 'ethereum-testnet-sepolia'
        : this.network.name === 'ethereum-mainnet'
          ? 'avalanche-mainnet'
          : 'ethereum-mainnet'
    return this.getOnRampForRouter(router, networkInfo(someOtherNetwork).chainSelector)
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPContractNotRouterError} if address is not a Router, OnRamp, or OffRamp
   */
  async getTokenAdminRegistryFor(address: string): Promise<string> {
    let [type, version, typeAndVersion] = await this.typeAndVersion(address)
    if (type === 'TokenAdminRegistry') {
      return address
    } else if (type === 'Router') {
      address = await this._getSomeOnRampFor(address)
      ;[type, version, typeAndVersion] = await this.typeAndVersion(address)
    } else if (!type.includes('Ramp')) {
      throw new CCIPContractNotRouterError(address, typeAndVersion)
    }
    const contract = new Contract(
      address,
      version < CCIPVersion.V1_6
        ? type.includes('OnRamp')
          ? interfaces.EVM2EVMOnRamp_v1_5
          : interfaces.EVM2EVMOffRamp_v1_5
        : version < CCIPVersion.V2_0
          ? type.includes('OnRamp')
            ? interfaces.OnRamp_v1_6
            : interfaces.OffRamp_v1_6
          : type.includes('OnRamp')
            ? interfaces.OnRamp_v2_0
            : interfaces.OffRamp_v2_0,
      this.provider,
    ) as unknown as TypedContract<
      | typeof EVM2EVMOnRamp_1_5_ABI
      | typeof EVM2EVMOffRamp_1_5_ABI
      | typeof OnRamp_1_6_ABI
      | typeof OffRamp_1_6_ABI
      | typeof OnRamp_2_0_ABI
      | typeof OffRamp_2_0_ABI
    >
    const { tokenAdminRegistry } = await contract.getStaticConfig()
    return tokenAdminRegistry as string
  }

  /**
   * Gets the FeeQuoter contract address for a given Router or Ramp.
   * @internal
   * @param address - Router or Ramp contract address.
   * @returns FeeQuoter contract address.
   * @throws {@link CCIPContractNotRouterError} if address is not a Router, OnRamp, or OffRamp
   * @throws {@link CCIPVersionFeatureUnavailableError} if contract version is below v1.6
   */
  async getFeeQuoterFor(address: string): Promise<string> {
    let [type, version, typeAndVersion] = await this.typeAndVersion(address)
    if (type === 'FeeQuoter') {
      return address
    } else if (type === 'Router') {
      address = await this._getSomeOnRampFor(address)
      ;[type, version, typeAndVersion] = await this.typeAndVersion(address)
    } else if (!type.includes('Ramp')) {
      throw new CCIPContractNotRouterError(address, typeAndVersion)
    }
    if (version < CCIPVersion.V1_6)
      throw new CCIPVersionFeatureUnavailableError('feeQuoter', version, 'v1.6')

    const isOnRamp = type.includes('OnRamp')
    const contract = new Contract(
      address,
      version < CCIPVersion.V2_0
        ? isOnRamp
          ? interfaces.OnRamp_v1_6
          : interfaces.OffRamp_v1_6
        : isOnRamp
          ? interfaces.OnRamp_v2_0
          : interfaces.OffRamp_v2_0,
      this.provider,
    ) as unknown as TypedContract<
      | typeof OnRamp_1_6_ABI
      | typeof OffRamp_1_6_ABI
      | typeof OnRamp_2_0_ABI
      | typeof OffRamp_2_0_ABI
    >

    const { feeQuoter } = await contract.getDynamicConfig()
    return feeQuoter as string
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee({
    router,
    destChainSelector,
    message,
  }: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    const populatedMessage = buildMessageForDest(message, networkInfo(destChainSelector).family)
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return contract.getFee(destChainSelector, {
      receiver: zeroPadValue(getAddressBytes(populatedMessage.receiver), 32),
      data: hexlify(populatedMessage.data ?? '0x'),
      tokenAmounts: populatedMessage.tokenAmounts ?? [],
      feeToken: populatedMessage.feeToken ?? ZeroAddress,
      extraArgs: hexlify(
        (this.constructor as typeof EVMChain).encodeExtraArgs(populatedMessage.extraArgs),
      ),
    })
  }

  /**
   * Detect whether a token pool is a USDC/CCTP pool via typeAndVersion, then resolve
   * the CCTPVerifier address and fetch source/dest CCTP domain IDs.
   *
   * @param poolAddress - The token pool address to check.
   * @param destChainSelector - Destination chain selector for getDomain().
   * @param ccvs - Cross-chain verifier addresses from extraArgs (fallback for verifier discovery).
   * @returns Source and dest CCTP domain IDs, or undefined if not a USDC pool.
   */
  private async detectUsdcDomains(
    poolAddress: string,
    destChainSelector: bigint,
    ccvs: string[],
  ): Promise<{ sourceDomain: number; destDomain: number } | undefined> {
    // 1. Check if pool is USDCTokenPoolProxy
    let poolType: string
    try {
      ;[poolType] = await this.typeAndVersion(poolAddress)
    } catch {
      return undefined
    }
    if (poolType !== 'USDCTokenPoolProxy') return undefined

    // 2. Find CCTPVerifier address
    let verifierAddress: string | undefined

    // 2a. Try pool's getStaticConfig (returns resolver/verifier address)
    try {
      const proxy = new Contract(poolAddress, interfaces.USDCTokenPoolProxy_v2_0, this.provider)
      const config = (await proxy.getFunction('getStaticConfig')()) as {
        cctpVerifier: string
      }
      const candidate = config.cctpVerifier
      if (candidate && candidate !== ZeroAddress) {
        verifierAddress = await this.resolveVerifier(candidate, destChainSelector)
      }
    } catch {
      /* proxy may not be initialized */
    }

    // 2b. Fall back to scanning ccvs from extraArgs
    if (!verifierAddress) {
      for (const ccv of ccvs) {
        if (!ccv) continue
        try {
          const resolved = await this.resolveVerifier(ccv, destChainSelector)
          if (resolved) {
            verifierAddress = resolved
            break
          }
        } catch {
          /* not a valid contract */
        }
      }
    }

    if (!verifierAddress) return undefined

    // 3. Fetch source and dest CCTP domain IDs from verifier
    try {
      const verifier = new Contract(verifierAddress, interfaces.CCTPVerifier_v2_0, this.provider)
      const [verifierConfig, destDomainResult] = (await Promise.all([
        verifier.getFunction('getStaticConfig')(),
        verifier.getFunction('getDomain')(destChainSelector),
      ])) as [{ localDomainIdentifier: bigint }, { domainIdentifier: bigint }]
      return {
        sourceDomain: Number(verifierConfig.localDomainIdentifier),
        destDomain: Number(destDomainResult.domainIdentifier),
      }
    } catch (err) {
      if (isError(err, 'CALL_EXCEPTION')) return undefined
      throw CCIPError.from(err)
    }
  }

  /**
   * Given a candidate address, check if it's a CCTPVerifier or VersionedVerifierResolver
   * and return the actual verifier address (resolving through the resolver if needed).
   */
  private async resolveVerifier(
    candidate: string,
    destChainSelector: bigint,
  ): Promise<string | undefined> {
    try {
      const [candidateType] = await this.typeAndVersion(candidate)
      if (candidateType === 'VersionedVerifierResolver') {
        const resolver = new Contract(
          candidate,
          interfaces.VersionedVerifierResolver_v2_0,
          this.provider,
        )
        return (await resolver.getFunction('getOutboundImplementation')(
          destChainSelector,
          '0x',
        )) as string
      }
      if (candidateType === 'CCTPVerifier') return candidate
    } catch {
      /* not a valid versioned contract */
    }
    return undefined
  }

  /** {@inheritDoc Chain.getTotalFeesEstimate} */
  override async getTotalFeesEstimate(
    opts: Parameters<Chain['getTotalFeesEstimate']>[0],
  ): Promise<TotalFeesEstimate> {
    const tokenAmounts = opts.message.tokenAmounts
    const ccipFeeP = this.getFee(opts)

    if (!tokenAmounts?.length) {
      return { ccipFee: await ccipFeeP }
    }

    const { token, amount } = tokenAmounts[0]!

    // Determine blockConfirmations and tokenArgs from extraArgs
    const extraArgs = opts.message.extraArgs
    let blockConfirmations = 0
    let tokenArgs: string = '0x'
    if (extraArgs && 'blockConfirmations' in extraArgs) {
      const v3 = extraArgs as GenericExtraArgsV3
      blockConfirmations = v3.blockConfirmations
      tokenArgs = hexlify(v3.tokenArgs)
    }

    // Skip pool-level fee lookup for pre-v2.0 lanes
    const onRamp = await this.getOnRampForRouter(opts.router, opts.destChainSelector)
    const [, version] = await this.typeAndVersion(onRamp)
    if (version < CCIPVersion.V2_0) {
      return { ccipFee: await ccipFeeP }
    }

    const onRampContract = new Contract(onRamp, interfaces.OnRamp_v2_0, this.provider)

    const poolAddress = (await onRampContract.getFunction('getPoolBySourceToken')(
      opts.destChainSelector,
      token,
    )) as string

    const [ccipFee, { tokenTransferFeeConfig }, usdcDomains] = await Promise.all([
      ccipFeeP,
      this.getTokenPoolConfig(poolAddress, {
        destChainSelector: opts.destChainSelector,
        blockConfirmationsRequested: blockConfirmations,
        tokenArgs,
      }),
      this.detectUsdcDomains(
        poolAddress,
        opts.destChainSelector,
        extraArgs && 'ccvs' in extraArgs ? (extraArgs as GenericExtraArgsV3).ccvs : [],
      ),
    ])

    // USDC path: use Circle CCTP burn fees
    if (usdcDomains) {
      try {
        const burnFees = await getUsdcBurnFees(
          usdcDomains.sourceDomain,
          usdcDomains.destDomain,
          this.network.networkType,
        )
        const fast = blockConfirmations > 0
        const tier = burnFees.find((t) =>
          fast ? t.finalityThreshold <= 1000 : t.finalityThreshold > 1000,
        )
        if (tier && tier.minimumFee > 0) {
          return {
            ccipFee,
            tokenTransferFee: {
              feeDeducted: (BigInt(amount) * BigInt(tier.minimumFee)) / 10_000n,
              bps: tier.minimumFee,
            },
          }
        }
        return { ccipFee }
      } catch (err) {
        this.logger.warn('Failed to fetch USDC burn fees from Circle API:', err)
        return { ccipFee }
      }
    }

    // Non-USDC path: use on-chain tokenTransferFeeConfig
    if (!tokenTransferFeeConfig || !tokenTransferFeeConfig.isEnabled) {
      return { ccipFee }
    }

    const useCustom = blockConfirmations > 0
    const bps = useCustom
      ? tokenTransferFeeConfig.customBlockConfirmationsTransferFeeBps
      : tokenTransferFeeConfig.defaultBlockConfirmationsTransferFeeBps

    return {
      ccipFee,
      tokenTransferFee: {
        feeDeducted: (BigInt(amount) * BigInt(bps)) / 10_000n,
        bps,
      },
    }
  }

  /**
   * Generates unsigned EVM transactions for sending a CCIP message.
   *
   * @param opts - Send message options with sender address for populating transaction fields.
   * @returns Unsigned EVM transaction set containing 0 or more token approval txs
   *   (if needed at the time of generation), followed by a ccipSend TransactionRequest.
   *
   * @remarks
   * When a token in `tokenAmounts` has `ZeroAddress` as its address, the corresponding
   * amount is included as native `value` in the `ccipSend` transaction instead of
   * going through the ERC-20 approve flow.
   */
  async generateUnsignedSendMessage(
    opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<UnsignedEVMTx> {
    const { sender, router, destChainSelector } = opts
    const populatedMessage = buildMessageForDest(
      opts.message,
      networkInfo(destChainSelector).family,
    )
    const message = {
      ...populatedMessage,
      fee: opts.message.fee ?? (await this.getFee({ ...opts, message: populatedMessage })),
    }

    const feeToken = message.feeToken ?? ZeroAddress
    const receiver = zeroPadValue(getAddressBytes(message.receiver), 32)
    const data = hexlify(message.data ?? '0x')
    const extraArgs = hexlify(
      (this.constructor as typeof EVMChain).encodeExtraArgs(message.extraArgs),
    )

    // make sure to approve once per token, for the total amount (including fee, if needed)
    const amountsToApprove = (message.tokenAmounts ?? [])
      .filter(({ token }) => token && token !== ZeroAddress)
      .reduce(
        (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
        {} as { [token: string]: bigint },
      )
    if (feeToken !== ZeroAddress)
      amountsToApprove[feeToken] = (amountsToApprove[feeToken] ?? 0n) + message.fee

    const approveTxs = (
      await Promise.all(
        Object.entries(amountsToApprove).map(async ([token, amount]) => {
          const contract = new Contract(
            token,
            interfaces.Token,
            this.provider,
          ) as unknown as TypedContract<typeof Token_ABI>
          const allowance = await contract.allowance(sender, router)
          if (allowance >= amount) return
          const amnt = opts.approveMax ? BigInt(2) ** BigInt(256) - BigInt(1) : amount
          return contract.approve.populateTransaction(router, amnt, { from: sender })
        }),
      )
    ).filter((tx) => tx != null)

    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>

    // if `token` is ZeroAddress, send its `amount` as `value` to router/EtherSenderReceiver (plus possibly native fee)
    // if native fee, include it in value; otherwise, it's transferedFrom feeToken
    const value = (message.tokenAmounts ?? [])
      .filter(({ token }) => token === ZeroAddress)
      .reduce((acc, { amount }) => acc + amount, feeToken === ZeroAddress ? message.fee : 0n)

    const sendTx = await contract.ccipSend.populateTransaction(
      destChainSelector,
      {
        receiver,
        data,
        tokenAmounts: message.tokenAmounts ?? [],
        extraArgs,
        feeToken,
      },
      { from: sender, ...(value > 0n ? { value } : {}) },
    )
    const txRequests = [...approveTxs, sendTx] as SetRequired<typeof sendTx, 'from'>[]
    return {
      family: ChainFamily.EVM,
      transactions: txRequests,
    }
  }

  /**
   * {@inheritDoc Chain.sendMessage}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    const wallet = opts.wallet
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = await wallet.getAddress()
    const txs = await this.generateUnsignedSendMessage({ ...opts, sender })
    const approveTxs = txs.transactions.slice(0, txs.transactions.length - 1)
    let sendTx: TransactionRequest = txs.transactions[txs.transactions.length - 1]!

    // approve all tokens (including feeToken, if needed) in parallel
    const responses = await Promise.all(
      approveTxs.map(async (tx: TransactionRequest) => {
        tx.nonce = await this.nextNonce(sender)
        try {
          tx = await wallet.populateTransaction(tx)
          tx.from = undefined
          const response = await submitTransaction(wallet, tx, this.provider)
          this.logger.debug('approve =>', response.hash)
          return response
        } catch (err) {
          this.nonces[sender]!--
          throw err
        }
      }),
    )
    if (responses.length) await responses[responses.length - 1]!.wait(1, 60_000) // wait last tx nonce to be mined

    sendTx.nonce = await this.nextNonce(sender)
    let response
    try {
      // sendTx.gasLimit = await this.provider.estimateGas(sendTx)
      sendTx = await wallet.populateTransaction(sendTx)
      sendTx.from = undefined // some signers don't like receiving pre-populated `from`
      response = await submitTransaction(wallet, sendTx, this.provider)
    } catch (err) {
      this.nonces[sender]!--
      throw err
    }
    this.logger.debug('ccipSend =>', response.hash)
    const tx = (await response.wait(1, 60_000))!
    return (await this.getMessagesInTx(await this.getTransaction(tx)))[0]!
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecute}
   * @returns array containing one unsigned `manuallyExecute` TransactionRequest object
   * @throws {@link CCIPVersionUnsupportedError} if OffRamp version is not supported
   */
  async generateUnsignedExecute(
    opts: Parameters<Chain['generateUnsignedExecute']>[0],
  ): Promise<UnsignedEVMTx> {
    const { offRamp, input, gasLimit } = await this.resolveExecuteOpts(opts)
    if ('verifications' in input) {
      const contract = new Contract(
        offRamp,
        interfaces.OffRamp_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof OffRamp_2_0_ABI>

      const message = decodeMessageV1(input.encodedMessage)
      const messageId = keccak256(input.encodedMessage)
      // `execute` doesn't revert on failure, so we need to estimate using `executeSingleMessage`
      const txGasLimit = await contract.executeSingleMessage.estimateGas(
        {
          ...message,
          onRampAddress: zeroPadValue(getAddressBytes(message.onRampAddress), 32),
          sender: zeroPadValue(getAddressBytes(message.sender), 32),
          tokenTransfer: message.tokenTransfer.map((ta) => ({
            ...ta,
            sourcePoolAddress: zeroPadValue(getAddressBytes(ta.sourcePoolAddress), 32),
            sourceTokenAddress: zeroPadValue(getAddressBytes(ta.sourceTokenAddress), 32),
          })),
          executionGasLimit: BigInt(message.executionGasLimit),
          ccipReceiveGasLimit: BigInt(message.ccipReceiveGasLimit),
          finality: BigInt(message.finality),
        },
        messageId,
        input.verifications.map(({ destAddress }) => destAddress),
        input.verifications.map(({ ccvData }) => hexlify(ccvData)),
        BigInt(gasLimit ?? 0),
        { from: offRamp }, // internal method
      )
      const execTx = await contract.execute.populateTransaction(
        input.encodedMessage,
        input.verifications.map(({ destAddress }) => destAddress),
        input.verifications.map(({ ccvData }) => hexlify(ccvData)),
        BigInt(gasLimit ?? 0),
      )
      execTx.gasLimit = txGasLimit + 40000n // plus `execute`'s overhead
      return { family: ChainFamily.EVM, transactions: [execTx] }
    }

    let manualExecTx
    const [_, version] = await this.typeAndVersion(offRamp)
    const offchainTokenData = input.offchainTokenData.map(encodeEVMOffchainTokenData)

    switch (version) {
      case CCIPVersion.V1_2: {
        const contract = new Contract(
          offRamp,
          interfaces.EVM2EVMOffRamp_v1_2,
          this.provider,
        ) as unknown as TypedContract<typeof EVM2EVMOffRamp_1_2_ABI>
        const gasOverride = BigInt(gasLimit ?? 0)
        manualExecTx = await contract.manuallyExecute.populateTransaction(
          {
            ...input,
            proofs: input.proofs.map((d) => hexlify(d)),
            messages: [input.message as CCIPMessage<typeof CCIPVersion.V1_2>],
            offchainTokenData: [offchainTokenData],
          },
          [gasOverride],
        )
        break
      }
      case CCIPVersion.V1_5: {
        const contract = new Contract(
          offRamp,
          interfaces.EVM2EVMOffRamp_v1_5,
          this.provider,
        ) as unknown as TypedContract<typeof EVM2EVMOffRamp_1_5_ABI>
        manualExecTx = await contract.manuallyExecute.populateTransaction(
          {
            ...input,
            proofs: input.proofs.map((d) => hexlify(d)),
            messages: [input.message as CCIPMessage<typeof CCIPVersion.V1_5>],
            offchainTokenData: [offchainTokenData],
          },
          [
            {
              receiverExecutionGasLimit: BigInt(gasLimit ?? 0),
              tokenGasOverrides: input.message.tokenAmounts.map(() =>
                BigInt(opts.tokensGasLimit ?? gasLimit ?? 0),
              ),
            },
          ],
        )
        break
      }
      case CCIPVersion.V1_6: {
        // normalize message
        const senderBytes = getAddressBytes(input.message.sender)
        // Addresses ≤32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes;
        // Addresses >32 bytes (e.g., TON 36B) are used as raw bytes without padding
        const sender =
          senderBytes.length <= 32 ? zeroPadValue(senderBytes, 32) : hexlify(senderBytes)
        const tokenAmounts = (input.message as CCIPMessage_V1_6_EVM).tokenAmounts.map((ta) => ({
          ...ta,
          sourcePoolAddress: zeroPadValue(getAddressBytes(ta.sourcePoolAddress), 32),
          extraData: hexlify(getDataBytes(ta.extraData)),
        }))
        const message = {
          ...(input.message as CCIPMessage_V1_6_EVM),
          sender,
          tokenAmounts,
        }
        const contract = new Contract(
          offRamp,
          interfaces.OffRamp_v1_6,
          this.provider,
        ) as unknown as TypedContract<typeof OffRamp_1_6_ABI>
        manualExecTx = await contract.manuallyExecute.populateTransaction(
          [
            {
              ...input,
              proofs: input.proofs.map((p) => hexlify(p)),
              sourceChainSelector: input.message.sourceChainSelector,
              messages: [
                {
                  ...message,
                  header: {
                    messageId: message.messageId,
                    sourceChainSelector: message.sourceChainSelector,
                    destChainSelector: message.destChainSelector,
                    sequenceNumber: message.sequenceNumber,
                    nonce: message.nonce,
                  },
                },
              ],
              offchainTokenData: [offchainTokenData],
            },
          ],
          [
            [
              {
                receiverExecutionGasLimit: BigInt(gasLimit ?? 0),
                tokenGasOverrides: input.message.tokenAmounts.map(() =>
                  BigInt(opts.tokensGasLimit ?? gasLimit ?? 0),
                ),
              },
            ],
          ],
        )
        break
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }

    /* Executing a message for the first time has some hard try/catches on-chain
     * so we need to ensure some lower-bounds gasLimits */
    let txGasLimit = await this.provider.estimateGas(manualExecTx)
    if (
      'gasLimit' in input.message &&
      input.message.gasLimit &&
      txGasLimit < input.message.gasLimit + 100000n
    )
      // if message requested gasLimit, ensure execution more than 100k above requested, otherwise it's clearly a try/catch fail
      txGasLimit = BigInt(input.message.gasLimit) + 200000n
    else if ('gasLimit' in input.message && !input.message.gasLimit && txGasLimit < 240000n)
      // if message didn't request gasLimit, ensure execution gasLimit is above 240k (empiric)
      txGasLimit = 240000n
    manualExecTx.gasLimit = txGasLimit

    return { family: ChainFamily.EVM, transactions: [manualExecTx] }
  }

  /**
   * {@inheritDoc Chain.execute}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer.
   * @throws {@link CCIPExecTxNotConfirmedError} if execution transaction fails to confirm.
   * @throws {@link CCIPExecTxRevertedError} if execution transaction reverts.
   */
  async execute(opts: Parameters<Chain['execute']>[0]) {
    const wallet = opts.wallet
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsignedTxs = await this.generateUnsignedExecute({
      ...opts,
      payer: await wallet.getAddress(),
    })

    const unsignedTx: TransactionRequest = unsignedTxs.transactions[0]!
    unsignedTx.nonce = await this.nextNonce(await wallet.getAddress())
    const populatedTx = await wallet.populateTransaction(unsignedTx)
    populatedTx.from = undefined // some signers don't like receiving pre-populated `from`

    const response = await submitTransaction(wallet, populatedTx, this.provider)
    this.logger.debug('manuallyExecute =>', response.hash)

    let receipt = await response.wait(0)
    if (!receipt) receipt = await response.wait(1, 240_000)
    if (!receipt?.hash) throw new CCIPExecTxNotConfirmedError(response.hash)
    if (!receipt.status) throw new CCIPExecTxRevertedError(response.hash)
    const tx = await this.getTransaction(receipt)
    return this.getExecutionReceiptInTx(tx)
  }

  /**
   * Parses raw data into typed structures.
   * @param data - Raw data to parse.
   * @returns Parsed data.
   */
  static parse(data: unknown) {
    return parseData(data)
  }

  /**
   * Get the supported tokens for a given contract address.
   * @param registry - Router, OnRamp, OffRamp or TokenAdminRegistry contract address.
   * @param opts - Optional parameters.
   * @returns An array of supported token addresses.
   */
  async getSupportedTokens(registry: string, opts?: { page?: number }): Promise<string[]> {
    const contract = new Contract(
      registry,
      interfaces.TokenAdminRegistry,
      this.provider,
    ) as unknown as TypedContract<typeof TokenAdminRegistry_1_5_ABI>

    const limit = (opts?.page ?? 1000) || Number.MAX_SAFE_INTEGER
    const res = []
    let page
    do {
      page = await contract.getAllConfiguredTokens(BigInt(res.length), BigInt(limit))
      res.push(...page)
    } while (page.length === limit)
    return res as string[]
  }

  /**
   * {@inheritDoc Chain.getRegistryTokenConfig}
   * @throws {@link CCIPTokenNotConfiguredError} if token is not configured in registry
   */
  async getRegistryTokenConfig(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }> {
    const contract = new Contract(
      registry,
      interfaces.TokenAdminRegistry,
      this.provider,
    ) as unknown as TypedContract<typeof TokenAdminRegistry_1_5_ABI>

    const config = (await resultToObject(contract.getTokenConfig(token))) as CleanAddressable<
      Partial<Awaited<ReturnType<(typeof contract)['getTokenConfig']>>>
    >
    if (!config.administrator || config.administrator === ZeroAddress)
      throw new CCIPTokenNotConfiguredError(token, registry)
    if (!config.pendingAdministrator || config.pendingAdministrator === ZeroAddress)
      delete config.pendingAdministrator
    if (!config.tokenPool || config.tokenPool === ZeroAddress) delete config.tokenPool
    return {
      ...config,
      administrator: config.administrator,
    }
  }

  /**
   * Fetches the token pool configuration for an EVM token pool contract.
   *
   * @param tokenPool - Token pool contract address.
   * @param feeOpts - Optional parameters to also fetch token transfer fee config.
   * @returns Token pool config containing token, router, typeAndVersion, and optionally
   *          minBlockConfirmations and tokenTransferFeeConfig.
   *
   * @remarks
   * For pools with version \>= 2.0, also returns `minBlockConfirmations` for
   * Faster-Than-Finality (FTF) support. Pre-2.0 pools omit this field.
   * When `feeOpts` is provided and the pool is v2.0+, also fetches token transfer fee config.
   */
  async getTokenPoolConfig(
    tokenPool: string,
    feeOpts?: TokenTransferFeeOpts,
  ): Promise<{
    token: string
    router: string
    typeAndVersion: string
    minBlockConfirmations?: number
    tokenTransferFeeConfig?: TokenTransferFeeConfig
  }> {
    const [_, version, typeAndVersion] = await this.typeAndVersion(tokenPool)

    let token, router, minBlockConfirmations, tokenTransferFeeConfig
    if (version < CCIPVersion.V2_0) {
      const contract = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_6,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_ABI>
      token = contract.getToken()
      router = contract.getRouter()
    } else {
      const contract = new Contract(
        tokenPool,
        interfaces.TokenPool_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_2_0_ABI>
      token = contract.getToken()
      router = contract.getDynamicConfig().then(([router]) => router)
      minBlockConfirmations = contract.getMinBlockConfirmations().catch((err) => {
        if (isError(err, 'CALL_EXCEPTION')) return 0
        throw CCIPError.from(err)
      })
      if (feeOpts) {
        tokenTransferFeeConfig = token.then((tokenAddr) =>
          contract
            .getTokenTransferFeeConfig(
              tokenAddr as string,
              feeOpts.destChainSelector,
              BigInt(feeOpts.blockConfirmationsRequested),
              feeOpts.tokenArgs,
            )
            .then((result) => ({
              destGasOverhead: Number(result.destGasOverhead),
              destBytesOverhead: Number(result.destBytesOverhead),
              defaultBlockConfirmationsFeeUSDCents: Number(
                result.defaultBlockConfirmationsFeeUSDCents,
              ),
              customBlockConfirmationsFeeUSDCents: Number(
                result.customBlockConfirmationsFeeUSDCents,
              ),
              defaultBlockConfirmationsTransferFeeBps: Number(
                result.defaultBlockConfirmationsTransferFeeBps,
              ),
              customBlockConfirmationsTransferFeeBps: Number(
                result.customBlockConfirmationsTransferFeeBps,
              ),
              isEnabled: result.isEnabled,
            }))
            .catch((err) => {
              if (isError(err, 'CALL_EXCEPTION')) return undefined
              throw CCIPError.from(err, 'UNKNOWN')
            }),
        )
      }
    }

    return Promise.all([token, router, minBlockConfirmations, tokenTransferFeeConfig]).then(
      ([token, router, minBlockConfirmations, tokenTransferFeeConfig]) => {
        return {
          token: token as CleanAddressable<typeof token>,
          router: router as CleanAddressable<typeof router>,
          typeAndVersion,
          ...(minBlockConfirmations != null && {
            minBlockConfirmations: Number(minBlockConfirmations),
          }),
          ...(tokenTransferFeeConfig != null && { tokenTransferFeeConfig }),
        }
      },
    )
  }

  /**
   * Fetches remote chain configurations for an EVM token pool contract.
   *
   * @param tokenPool - Token pool address on the current chain.
   * @param remoteChainSelector - Optional chain selector to filter results to a single destination.
   * @returns Record mapping chain names to {@link TokenPoolRemote} configs.
   *
   * @remarks
   * Handles 3 pool version branches:
   * - v1.5: single remote pool via `getRemotePool`, standard rate limiters.
   * - v1.6: multiple remote pools via `getRemotePools`, standard rate limiters.
   * - v2.0+: multiple remote pools plus FTF (Faster-Than-Finality) rate limiters
   *   (`customBlockConfirmationsOutboundRateLimiterState` / `customBlockConfirmationsInboundRateLimiterState`).
   *
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if remote token is not configured for a chain.
   */
  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    const [_, version] = await this.typeAndVersion(tokenPool)

    let supportedChains: Promise<NetworkInfo[]> | undefined
    if (remoteChainSelector) supportedChains = Promise.resolve([networkInfo(remoteChainSelector)])

    let remotePools: Promise<string[][]>
    let remoteInfo
    if (version < '1.5.1') {
      const contract = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_5,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_1_5_ABI>
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract
              .getRemotePool(chain.chainSelector)
              .then((remotePool) => [decodeAddress(remotePool, chain.family)]),
          ),
        ),
      )
      remoteInfo = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            Promise.all([
              contract.getRemoteToken(chain.chainSelector),
              resultToObject(contract.getCurrentOutboundRateLimiterState(chain.chainSelector)),
              resultToObject(contract.getCurrentInboundRateLimiterState(chain.chainSelector)),
            ] as const),
          ),
        ),
      )
    } else if (version < CCIPVersion.V2_0) {
      const contract = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_6,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_ABI>
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract
              .getRemotePools(chain.chainSelector)
              .then((pools) => pools.map((remotePool) => decodeAddress(remotePool, chain.family))),
          ),
        ),
      )
      remoteInfo = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            Promise.all([
              contract.getRemoteToken(chain.chainSelector),
              resultToObject(contract.getCurrentOutboundRateLimiterState(chain.chainSelector)),
              resultToObject(contract.getCurrentInboundRateLimiterState(chain.chainSelector)),
            ] as const),
          ),
        ),
      )
    } else {
      const contract = new Contract(
        tokenPool,
        interfaces.TokenPool_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_2_0_ABI>
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract
              .getRemotePools(chain.chainSelector)
              .then((pools) => pools.map((remotePool) => decodeAddress(remotePool, chain.family))),
          ),
        ),
      )
      remoteInfo = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            Promise.all([
              contract.getRemoteToken(chain.chainSelector),
              contract.getCurrentRateLimiterState(chain.chainSelector, false),
              contract.getCurrentRateLimiterState(chain.chainSelector, true),
            ] as const).then(
              ([remoteToken, [outbound, inbound], [customOutbound, customInbound]]) => {
                return [remoteToken, outbound, inbound, customOutbound, customInbound] as const
              },
            ),
          ),
        ),
      )
    }
    return Promise.all([supportedChains, remotePools, remoteInfo]).then(
      ([supportedChains, remotePools, remoteInfo]) =>
        Object.fromEntries(
          supportedChains.map((chain, i) => {
            const remoteTokenRaw = remoteInfo[i]![0]
            if (!remoteTokenRaw || remoteTokenRaw.match(/^(0x)?0*$/))
              throw new CCIPTokenPoolChainConfigNotFoundError(tokenPool, tokenPool, chain.name)
            return [
              chain.name,
              {
                remoteToken: decodeAddress(remoteTokenRaw, chain.family),
                remotePools: remotePools[i]!.map((pool) => decodeAddress(pool, chain.family)),
                outboundRateLimiterState: toRateLimiterState(remoteInfo[i]![1]),
                inboundRateLimiterState: toRateLimiterState(remoteInfo[i]![2]),
                ...(remoteInfo[i]!.length === 5 && {
                  customBlockConfirmationsOutboundRateLimiterState: toRateLimiterState(
                    remoteInfo[i]![3],
                  ),
                  customBlockConfirmationsInboundRateLimiterState: toRateLimiterState(
                    remoteInfo[i]![4],
                  ),
                }),
              },
            ] as const
          }),
        ),
    )
  }

  /**
   * {@inheritDoc Chain.getFeeTokens}
   * @throws {@link CCIPVersionUnsupportedError} if OnRamp version is not supported
   */
  async getFeeTokens(router: string) {
    const onRamp = await this._getSomeOnRampFor(router)
    const [_, version] = await this.typeAndVersion(onRamp)
    let tokens
    let onRampIface: Interface | undefined
    switch (version) {
      case CCIPVersion.V1_2:
        onRampIface = interfaces.EVM2EVMOnRamp_v1_2
      // falls through
      case CCIPVersion.V1_5: {
        onRampIface ??= interfaces.EVM2EVMOnRamp_v1_5
        const fragment = onRampIface.getEvent('FeeConfigSet')!
        const tokens_ = new Set()
        for await (const log of this.getLogs({
          address: onRamp,
          topics: [fragment.topicHash],
          startBlock: 1,
          onlyFallback: true,
        })) {
          ;(
            onRampIface.decodeEventLog(fragment, log.data, log.topics) as unknown as {
              feeConfig: { token: string; enabled: boolean }[]
            }
          ).feeConfig.forEach(({ token, enabled }) =>
            enabled ? tokens_.add(token) : tokens_.delete(token),
          )
        }
        tokens = Array.from(tokens_)
        break
      }
      case CCIPVersion.V1_6:
      case CCIPVersion.V2_0: {
        const feeQuoter = await this.getFeeQuoterFor(onRamp)
        const contract = new Contract(
          feeQuoter,
          interfaces.FeeQuoter,
          this.provider,
        ) as unknown as TypedContract<typeof FeeQuoter_ABI>
        tokens = await contract.getFeeTokens()
        break
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }
    return Object.fromEntries(
      await Promise.all(
        tokens.map(
          async (token) => [token as string, await this.getTokenInfo(token as string)] as const,
        ),
      ),
    )
  }

  /** {@inheritDoc Chain.getVerifications} */
  override async getVerifications(
    opts: Parameters<Chain['getVerifications']>[0],
  ): Promise<CCIPVerifications> {
    const { offRamp, request } = opts
    if (request.lane.version >= CCIPVersion.V2_0) {
      const { encodedMessage } = request.message as CCIPMessage_V2_0
      const contract = new Contract(
        offRamp,
        interfaces.OffRamp_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof OffRamp_2_0_ABI>
      const ccvs = await contract.getCCVsForMessage(encodedMessage)
      const [requiredCCVs, optionalCCVs, optionalThreshold] = ccvs.map(
        resultToObject,
      ) as unknown as CleanAddressable<typeof ccvs>
      const verificationPolicy = {
        requiredCCVs,
        optionalCCVs,
        optionalThreshold: Number(optionalThreshold),
      }

      if (this.apiClient) {
        const apiRes = await this.apiClient.getMessageById(request.message.messageId)
        if ('verifiers' in apiRes.message) {
          const verifiers = apiRes.message.verifiers as {
            items?: {
              destAddress: string
              sourceAddress: string
              verification?: { data: string; timestamp: string }
            }[]
          }
          return {
            verificationPolicy,
            verifications: (verifiers.items ?? [])
              .filter((item) => item.verification?.data)
              .map((item) => ({
                destAddress: item.destAddress,
                sourceAddress: item.sourceAddress,
                ccvData: item.verification!.data,
                ...(!!item.verification?.timestamp && {
                  timestamp: new Date(item.verification.timestamp).getTime() / 1e3,
                }),
              })),
          }
        }
      }

      const url = `${CCV_INDEXER_URL}/v1/verifierresults/${request.message.messageId}`
      const res = await fetch(url)
      const json = await res.json()
      return json as CCIPVerifications
    } else if (request.lane.version < CCIPVersion.V1_6) {
      // v1.2..v1.5 EVM (only) have separate CommitStore
      opts.offRamp = await this.getCommitStoreForOffRamp(opts.offRamp)
    }
    // fallback <=v1.6
    return super.getVerifications(opts)
  }

  /** {@inheritDoc Chain.getExecutionReceipts} */
  override async *getExecutionReceipts(
    opts: Parameters<Chain['getExecutionReceipts']>[0],
  ): AsyncIterableIterator<CCIPExecution> {
    const { messageId, sourceChainSelector } = opts
    let opts_: Parameters<Chain['getExecutionReceipts']>[0] & Parameters<EVMChain['getLogs']>[0] =
      opts
    const [, version] = await this.typeAndVersion(opts.offRamp)
    if (version < CCIPVersion.V1_6) {
      opts_ = {
        ...opts,
        topics: [
          interfaces.EVM2EVMOffRamp_v1_5.getEvent('ExecutionStateChanged')!.topicHash,
          null,
          messageId ?? null,
        ],
        // onlyFallback: false,
      }
    } else /* >= V1.6 */ {
      const topicHash =
        version === CCIPVersion.V1_6
          ? interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!.topicHash
          : interfaces.OffRamp_v2_0.getEvent('ExecutionStateChanged')!.topicHash
      opts_ = {
        ...opts,
        topics: [
          topicHash,
          sourceChainSelector ? toBeHex(sourceChainSelector, 32) : null,
          null,
          messageId ?? null,
        ],
        // onlyFallback: false,
      }
    }
    yield* super.getExecutionReceipts(opts_)
  }

  /** {@inheritDoc Chain.estimateReceiveExecution} */
  override async estimateReceiveExecution(
    opts: Parameters<NonNullable<Chain['estimateReceiveExecution']>>[0],
  ): Promise<number> {
    const convertAmounts = (
      tokenAmounts?: readonly ((
        | { token: string }
        | { destTokenAddress: string; extraData?: string }
      ) & {
        amount: bigint
      })[],
    ) =>
      !tokenAmounts
        ? undefined
        : Promise.all(
            tokenAmounts.map(async (ta) => {
              if (!('destTokenAddress' in ta)) return ta
              let amount = ta.amount
              if (isHexString(ta.extraData, 32)) {
                // extraData is source token decimals in most pools derived from standard TP contracts;
                // we can identify for it being exactly 32B and being a small integer; otherwise, assume same decimals
                const sourceDecimals = toBigInt(ta.extraData)
                if (0 < sourceDecimals && sourceDecimals <= 36) {
                  const { decimals: destDecimals } = await this.getTokenInfo(ta.destTokenAddress)
                  amount =
                    (amount * BigInt(10) ** BigInt(destDecimals)) /
                    BigInt(10) ** BigInt(sourceDecimals)
                  if (amount === 0n)
                    throw new CCIPTokenDecimalsInsufficientError(
                      ta.destTokenAddress,
                      destDecimals,
                      this.network.name,
                      formatUnits(amount, sourceDecimals),
                    )
                }
              }
              return { token: ta.destTokenAddress, amount }
            }),
          )

    let opts_
    if (!('offRamp' in opts)) {
      const { lane, message, metadata } = await this.getMessageById(opts.messageId)

      const offRamp =
        ('offRampAddress' in message && message.offRampAddress) ||
        metadata?.offRamp ||
        (await this.apiClient!.getExecutionInput(opts.messageId)).offRamp

      opts_ = {
        offRamp,
        message: {
          sourceChainSelector: lane.sourceChainSelector,
          messageId: message.messageId,
          receiver: message.receiver,
          sender: message.sender,
          data: message.data,
          destTokenAmounts: await convertAmounts(message.tokenAmounts),
        },
      }
    } else {
      opts_ = {
        ...opts,
        message: {
          ...opts.message,
          destTokenAmounts: await convertAmounts(opts.message.destTokenAmounts),
        },
      }
    }

    const destRouter = await this.getRouterForOffRamp(
      opts_.offRamp,
      opts_.message.sourceChainSelector,
    )
    return estimateExecGas({ provider: this.provider, router: destRouter, ...opts_ })
  }
}
