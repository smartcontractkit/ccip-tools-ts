import {
  type BytesLike,
  type Interface,
  type JsonRpcApiProvider,
  type Log,
  type Signer,
  type TransactionReceipt,
  type TransactionRequest,
  type TransactionResponse,
  Contract,
  JsonRpcProvider,
  Result,
  WebSocketProvider,
  ZeroAddress,
  getAddress,
  hexlify,
  isBytesLike,
  isHexString,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import { memoize } from 'micro-memoize'
import type { PickDeep, SetRequired } from 'type-fest'

import {
  type ChainContext,
  type GetBalanceOpts,
  type LogFilter,
  type TokenPoolRemote,
  Chain,
} from '../chain.ts'
import {
  CCIPAddressInvalidEvmError,
  CCIPBlockNotFoundError,
  CCIPContractNotRouterError,
  CCIPContractTypeInvalidError,
  CCIPDataFormatUnsupportedError,
  CCIPExecTxNotConfirmedError,
  CCIPExecTxRevertedError,
  CCIPHasherVersionUnsupportedError,
  CCIPLogDataInvalidError,
  CCIPSourceChainUnsupportedError,
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTransactionNotFoundError,
  CCIPVersionFeatureUnavailableError,
  CCIPVersionRequiresLaneError,
  CCIPVersionUnsupportedError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { ExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVerifications,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionState,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
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
import {
  type CCIPMessage_V1_6_EVM,
  type CCIPMessage_V2_0,
  type CleanAddressable,
  type MessageV1,
  type TokenTransferV1,
  decodeMessageV1,
} from './messages.ts'
export { decodeMessageV1 }
export type { MessageV1, TokenTransferV1 }
import { encodeEVMOffchainTokenData, fetchEVMOffchainTokenData } from './offchain.ts'
import { buildMessageForDest, decodeMessage, getMessagesInBatch } from '../requests.ts'
import type { UnsignedEVMTx } from './types.ts'
export type { UnsignedEVMTx }

function resultToObject<T>(o: T): T {
  if (o instanceof Promise) return o.then(resultToObject) as T
  if (!(o instanceof Result)) return o
  if (o.length === 0) return o.toArray() as T
  try {
    const obj = o.toObject()
    if (!Object.keys(obj).every((k) => /^_+\d*$/.test(k)))
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resultToObject(v)])) as T
  } catch (_) {
    // fallthrough
  }
  return o.toArray().map(resultToObject) as T
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

/** Overhead gas buffer for the OffRamp's outer execution logic and state updates. */
const V2_EXECUTION_GAS_OVERHEAD = 200_000n

/**
 * Estimates the EVM transaction gas limit needed for a v2.0 OffRamp execute call.
 *
 * The OffRamp's `_callWithGasBuffer` catches internal OOGs without reverting,
 * so `eth_estimateGas` finds the minimum for a non-reverting tx (the failure
 * path, ~72K) rather than the gas actually needed for successful inner execution.
 *
 * Parses executionGasLimit (uint32 at bytes 25-28) and ccipReceiveGasLimit
 * (uint32 at bytes 29-32) from the MessageV1Codec wire format and adds overhead.
 */
function estimateV2ExecuteGasLimit(encodedMessage: string): bigint {
  const executionGasLimit = BigInt('0x' + encodedMessage.slice(52, 60))
  const ccipReceiveGasLimit = BigInt('0x' + encodedMessage.slice(60, 68))
  return executionGasLimit + ccipReceiveGasLimit + V2_EXECUTION_GAS_OVERHEAD
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
   * Used internally by {@link sendMessage} and {@link executeReport} to manage transaction ordering.
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
      logs: [] as Log_[],
    }
    const logs: Log_[] = tx.logs.map((l) => Object.assign(l, { tx: chainTx }))
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
  getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: { page?: number },
  ): Promise<R['message'][]> {
    let opts_: Parameters<EVMChain['getLogs']>[0] | undefined
    if (request.lane.version >= CCIPVersion.V1_6) {
      // specialized getLogs filter for v1.6 CCIPMessageSent events, to filter by dest
      opts_ = {
        ...opts,
        topics: [[request.log.topics[0]!], [toBeHex(request.lane.destChainSelector, 32)]],
      }
    }
    return getMessagesInBatch(this, request, commit, opts_)
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
        offRampABI = OffRamp_2_0_ABI
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
   * {@inheritDoc Chain.getCommitStoreForOffRamp}
   * @throws {@link CCIPVersionUnsupportedError} if OffRamp version is not supported
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
        : type.includes('OnRamp')
          ? interfaces.OnRamp_v1_6
          : interfaces.OffRamp_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof OnRamp_1_6_ABI | typeof OffRamp_1_6_ABI>
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

    const contract = new Contract(
      address,
      type.includes('OnRamp') ? interfaces.OnRamp_v1_6 : interfaces.OffRamp_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof OnRamp_1_6_ABI | typeof OffRamp_1_6_ABI>
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
   * {@inheritDoc Chain.generateUnsignedSendMessage}
   * @returns Array containing 0 or more unsigned token approvals txs (if needed at the time of
   *   generation), followed by a ccipSend TransactionRequest
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
    const amountsToApprove = (message.tokenAmounts ?? []).reduce(
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
          const amnt = opts.approveMax ? 2n ** 256n - 1n : amount
          return contract.approve.populateTransaction(router, amnt, { from: sender })
        }),
      )
    ).filter((tx) => tx != null)

    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    const sendTx = await contract.ccipSend.populateTransaction(
      destChainSelector,
      {
        receiver,
        data,
        tokenAmounts: message.tokenAmounts ?? [],
        extraArgs,
        feeToken,
      },
      {
        from: sender,
        // if native fee, include it in value; otherwise, it's transferedFrom feeToken
        ...(feeToken === ZeroAddress && { value: message.fee }),
      },
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

  /** {@inheritDoc Chain.getOffchainTokenData} */
  getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return fetchEVMOffchainTokenData(request, this)
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecuteReport}
   * @returns array containing one unsigned `manuallyExecute` TransactionRequest object
   * @throws {@link CCIPVersionUnsupportedError} if OffRamp version is not supported
   */
  async generateUnsignedExecuteReport({
    offRamp,
    execReport,
    ...opts
  }: Parameters<Chain['generateUnsignedExecuteReport']>[0]): Promise<UnsignedEVMTx> {
    const [_, version] = await this.typeAndVersion(offRamp)

    let manualExecTx
    const offchainTokenData = execReport.offchainTokenData.map(encodeEVMOffchainTokenData)

    switch (version) {
      case CCIPVersion.V1_2: {
        const contract = new Contract(
          offRamp,
          EVM2EVMOffRamp_1_2_ABI,
          this.provider,
        ) as unknown as TypedContract<typeof EVM2EVMOffRamp_1_2_ABI>
        const gasOverride = BigInt(opts.gasLimit ?? 0)
        manualExecTx = await contract.manuallyExecute.populateTransaction(
          {
            ...execReport,
            proofs: execReport.proofs.map((d) => hexlify(d)),
            messages: [execReport.message as CCIPMessage<typeof CCIPVersion.V1_2>],
            offchainTokenData: [offchainTokenData],
          },
          [gasOverride],
        )
        break
      }
      case CCIPVersion.V1_5: {
        const contract = new Contract(
          offRamp,
          EVM2EVMOffRamp_1_5_ABI,
          this.provider,
        ) as unknown as TypedContract<typeof EVM2EVMOffRamp_1_5_ABI>
        manualExecTx = await contract.manuallyExecute.populateTransaction(
          {
            ...execReport,
            proofs: execReport.proofs.map((d) => hexlify(d)),
            messages: [execReport.message as CCIPMessage<typeof CCIPVersion.V1_5>],
            offchainTokenData: [offchainTokenData],
          },
          [
            {
              receiverExecutionGasLimit: BigInt(opts.gasLimit ?? 0),
              tokenGasOverrides: execReport.message.tokenAmounts.map(() =>
                BigInt(opts.tokensGasLimit ?? opts.gasLimit ?? 0),
              ),
            },
          ],
        )
        break
      }
      case CCIPVersion.V1_6: {
        // normalize message
        const senderBytes = getAddressBytes(execReport.message.sender)
        // Addresses ≤32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes;
        // Addresses >32 bytes (e.g., TON 36B) are used as raw bytes without padding
        const sender =
          senderBytes.length <= 32 ? zeroPadValue(senderBytes, 32) : hexlify(senderBytes)
        const tokenAmounts = (execReport.message as CCIPMessage_V1_6_EVM).tokenAmounts.map(
          (ta) => ({
            ...ta,
            sourcePoolAddress: zeroPadValue(getAddressBytes(ta.sourcePoolAddress), 32),
            extraData: hexlify(getDataBytes(ta.extraData)),
          }),
        )
        const message = {
          ...(execReport.message as CCIPMessage_V1_6_EVM),
          sender,
          tokenAmounts,
        }
        const contract = new Contract(
          offRamp,
          OffRamp_1_6_ABI,
          this.provider,
        ) as unknown as TypedContract<typeof OffRamp_1_6_ABI>
        manualExecTx = await contract.manuallyExecute.populateTransaction(
          [
            {
              ...execReport,
              proofs: execReport.proofs.map((p) => hexlify(p)),
              sourceChainSelector: execReport.message.sourceChainSelector,
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
                receiverExecutionGasLimit: BigInt(opts.gasLimit ?? 0),
                tokenGasOverrides: execReport.message.tokenAmounts.map(() =>
                  BigInt(opts.tokensGasLimit ?? opts.gasLimit ?? 0),
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
    return { family: ChainFamily.EVM, transactions: [manualExecTx] }
  }

  /**
   * {@inheritDoc Chain.executeReport}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPExecTxNotConfirmedError} if execution transaction fails to confirm
   * @throws {@link CCIPExecTxRevertedError} if execution transaction reverts
   */
  async executeReport(opts: Parameters<Chain['executeReport']>[0]) {
    const wallet = opts.wallet
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsignedTxs = await this.generateUnsignedExecuteReport({
      ...opts,
      payer: await wallet.getAddress(),
    })
    const unsignedTx: TransactionRequest = unsignedTxs.transactions[0]!
    unsignedTx.nonce = await this.nextNonce(await wallet.getAddress())
    const populatedTx = await wallet.populateTransaction(unsignedTx)
    populatedTx.from = undefined // some signers don't like receiving pre-populated `from`
    const response = await submitTransaction(wallet, populatedTx, this.provider)
    this.logger.debug('manuallyExecute =>', response.hash)
    const receipt = await response.wait(1, 60_000)
    if (!receipt?.hash) throw new CCIPExecTxNotConfirmedError(response.hash)
    if (!receipt.status) throw new CCIPExecTxRevertedError(response.hash)
    const tx = await this.getTransaction(receipt)
    return this.getExecutionReceiptInTx(tx)
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteV2Message} */
  override async generateUnsignedExecuteV2Message({
    offRamp,
    encodedMessage,
    ccvAddresses,
    verifierResults,
    payer,
  }: Parameters<Chain['generateUnsignedExecuteV2Message']>[0]): Promise<UnsignedEVMTx> {
    const contract = new Contract(
      offRamp,
      OffRamp_2_0_ABI,
      this.provider,
    ) as unknown as TypedContract<typeof OffRamp_2_0_ABI>

    const tx = await contract.execute.populateTransaction(
      encodedMessage,
      ccvAddresses,
      verifierResults,
      0n,
    )
    tx.from = payer
    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /** {@inheritDoc Chain.executeV2Message} */
  override async executeV2Message(opts: Parameters<Chain['executeV2Message']>[0]) {
    const wallet = opts.wallet
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsignedTxs = await this.generateUnsignedExecuteV2Message({
      ...opts,
      payer: await wallet.getAddress(),
    })
    const unsignedTx: TransactionRequest = unsignedTxs.transactions[0]!
    unsignedTx.nonce = await this.nextNonce(await wallet.getAddress())
    unsignedTx.gasLimit = opts.gasLimit ?? estimateV2ExecuteGasLimit(opts.encodedMessage)
    const populatedTx = await wallet.populateTransaction(unsignedTx)
    populatedTx.from = undefined
    const response = await submitTransaction(wallet, populatedTx, this.provider)
    this.logger.debug('executeV2Message =>', response.hash)
    const receipt = await response.wait(1, 60_000)
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

  /** {@inheritDoc Chain.getTokenPoolConfig} */
  async getTokenPoolConfig(tokenPool: string): Promise<{
    token: string
    router: string
    typeAndVersion: string
  }> {
    const [_, , typeAndVersion] = await this.typeAndVersion(tokenPool)

    const contract = new Contract(
      tokenPool,
      interfaces.TokenPool_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof TokenPool_ABI>

    const token = contract.getToken()
    const router = contract.getRouter()
    return Promise.all([token, router]).then(([token, router]) => {
      return {
        token: token as string,
        router: router as string,
        typeAndVersion,
      }
    })
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    const [_, version] = await this.typeAndVersion(tokenPool)

    let supportedChains: Promise<NetworkInfo[]> | undefined
    if (remoteChainSelector) supportedChains = Promise.resolve([networkInfo(remoteChainSelector)])

    let remotePools: Promise<string[][]>
    let contract
    if (version < '1.5.1') {
      const contract_ = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_5,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_1_5_ABI>
      contract = contract_
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract_
              .getRemotePool(chain.chainSelector)
              .then((remotePool) => [decodeAddress(remotePool, chain.family)]),
          ),
        ),
      )
    } else {
      const contract_ = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_6,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_ABI>
      contract = contract_
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract_
              .getRemotePools(chain.chainSelector)
              .then((pools) => pools.map((remotePool) => decodeAddress(remotePool, chain.family))),
          ),
        ),
      )
    }
    const remoteInfo = supportedChains.then((chains) =>
      Promise.all(
        chains.map((chain) =>
          Promise.all([
            contract.getRemoteToken(chain.chainSelector),
            resultToObject(contract.getCurrentInboundRateLimiterState(chain.chainSelector)),
            resultToObject(contract.getCurrentOutboundRateLimiterState(chain.chainSelector)),
          ] as const),
        ),
      ),
    )
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
                inboundRateLimiterState: remoteInfo[i]![1].isEnabled ? remoteInfo[i]![1] : null,
                outboundRateLimiterState: remoteInfo[i]![2].isEnabled ? remoteInfo[i]![2] : null,
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
      case CCIPVersion.V1_6: {
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

  /** {@inheritDoc Chain.getCommitReport} */
  override async getVerifications(
    opts: Parameters<Chain['getVerifications']>[0],
  ): Promise<CCIPVerifications> {
    const { commitStore, request } = opts
    const [, version] = await this.typeAndVersion(commitStore)
    if (version >= CCIPVersion.V2_0) {
      const contract = new Contract(
        commitStore,
        interfaces.OffRamp_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof OffRamp_2_0_ABI>
      const ccvs = await contract.getCCVsForMessage(
        (request.message as CCIPMessage_V2_0).encodedMessage,
      )
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
            items: {
              destAddress: string
              sourceAddress: string
              verification: { data: string; timestamp: string }
            }[]
          }
          return {
            verificationPolicy,
            verifications: verifiers.items.map((item) => ({
              destAddress: item.destAddress,
              sourceAddress: item.sourceAddress,
              ccvData: item.verification.data,
              timestamp: new Date(item.verification.timestamp).getTime() / 1e3,
            })),
          }
        }
      }

      const url = `${CCV_INDEXER_URL}/v1/verifierresults/${request.message.messageId}`
      const res = await fetch(url)
      const json = await res.json()
      return json as CCIPVerifications
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
    const destRouter = await this.getRouterForOffRamp(
      opts.offRamp,
      opts.message.sourceChainSelector,
    )
    return estimateExecGas({ provider: this.provider, router: destRouter, ...opts })
  }
}
