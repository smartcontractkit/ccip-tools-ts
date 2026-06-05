import {
  type BytesLike,
  type JsonRpcApiProvider,
  type Log,
  type LogParams,
  type Network,
  type Result,
  type Signer,
  type TransactionReceipt,
  type TransactionReceiptParams,
  type TransactionRequest,
  type TransactionResponse,
  Contract,
  JsonRpcProvider,
  WebSocketProvider,
  ZeroAddress,
  ZeroHash,
  getAddress,
  getNumber,
  hexlify,
  isBytesLike,
  isError,
  isHexString,
  randomBytes,
  toBeHex,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import { memoize } from 'micro-memoize'
import type { PickDeep, SetFieldType, SetRequired, TupleOf } from 'type-fest'

import {
  type BlockInfo,
  type ChainContext,
  type GetBalanceOpts,
  type LogFilter,
  type RateLimiterState,
  type TokenPoolConfig,
  type TokenPoolRemote,
  type TokenPrice,
  type TokenTransferFeeOpts,
  type TotalFeesEstimate,
  Chain,
} from '../chain.ts'
import { fetchVerifications } from '../commits.ts'
import {
  CCIPAddressInvalidError,
  CCIPBlockNotFoundError,
  CCIPContractNotRouterError,
  CCIPContractTypeInvalidError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPExecTxNotConfirmedError,
  CCIPExecTxRevertedError,
  CCIPFinalityNotAllowedError,
  CCIPHasherVersionUnsupportedError,
  CCIPLogDataInvalidError,
  CCIPSourceChainUnsupportedError,
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTransactionNotFoundError,
  CCIPVersionRequiresLaneError,
  CCIPVersionUnsupportedError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import {
  type ExtraArgs,
  type FinalityAllowed,
  type FinalityRequested,
  decodeFinalityAllowed,
  encodeFinality,
} from '../extra-args.ts'
import { getDestTokenAmount } from '../gas.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { decodeMessageV1 } from '../messages.ts'
import { type NetworkInfo, ChainFamily, NetworkType, networkInfo } from '../networks.ts'
import { CCTP_FINALITY_FAST, getUsdcBurnFees } from '../offchain.ts'
import { buildMessageForDest, decodeMessage } from '../requests.ts'
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
  type WithLogger,
  CCIPVersion,
} from '../types.ts'
import {
  decodeAddress,
  decodeOnRampAddress,
  encodeAddressToAny,
  getAddressBytes,
  getDataBytes,
  getSomeBlockNumberBefore,
  parseTypeAndVersion,
} from '../utils.ts'
import type Token_ABI from './abi/BurnMintERC677Token.ts'
import type Receiver_2_0_ABI from './abi/CCIPReceiver_2_0.ts'
import type CCTPVerifier_2_0_ABI from './abi/CCTPVerifier_2_0.ts'
import CommitStore_1_2_ABI from './abi/CommitStore_1_2.ts'
import CommitStore_1_5_ABI from './abi/CommitStore_1_5.ts'
import type FeeQuoter_1_6_ABI from './abi/FeeQuoter_1_6.ts'
import type FeeQuoter_2_0_ABI from './abi/FeeQuoter_2_0.ts'
import type TokenPool_1_5_ABI from './abi/LockReleaseTokenPool_1_5.ts'
import type TokenPool_ABI from './abi/LockReleaseTokenPool_1_6_1.ts'
import EVM2EVMOffRamp_1_2_ABI from './abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from './abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from './abi/OffRamp_1_6.ts'
import OffRamp_2_0_ABI from './abi/OffRamp_2_0.ts'
import EVM2EVMOnRamp_1_2_ABI from './abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import OnRamp_2_0_ABI from './abi/OnRamp_2_0.ts'
import type PriceRegistry_1_2 from './abi/PriceRegistry_1_2.ts'
import type Router_ABI from './abi/Router.ts'
import type TokenAdminRegistry_1_5_ABI from './abi/TokenAdminRegistry_1_5.ts'
import type TokenPool_2_0_ABI from './abi/TokenPool_2_0.ts'
import type USDCTokenPoolProxy_2_0_ABI from './abi/USDCTokenPoolProxy_2_0.ts'
import type VersionedVerifierResolver_2_0_ABI from './abi/VersionedVerifierResolver_2_0.ts'
import {
  type TokenPoolAndProxyABI,
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
import { type EVMEndBlockTag, getEvmLogs } from './logs.ts'
import type { CCIPMessage_V1_6_EVM, CCIPMessage_V2_0, CleanAddressable } from './messages.ts'
import { encodeEVMOffchainTokenData } from './offchain.ts'
import { type UnsignedEVMTx, resultToObject } from './types.ts'
export type { UnsignedEVMTx }

/** Raw on-chain TokenBucket struct returned by TokenPool rate limiter queries. */
type RateLimiterBucket = { tokens: bigint; isEnabled: boolean; capacity: bigint; rate: bigint }

/** Converts an on-chain bucket to the public RateLimiterState, stripping `isEnabled`. */
function toRateLimiterState(b: RateLimiterBucket): RateLimiterState {
  return b.isEnabled ? { tokens: b.tokens, capacity: b.capacity, rate: b.rate } : null
}

// remote/alien addresses encoding for EVM
// Addresses <32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes;
// Addresses >32 bytes (e.g., TON 4+32=36B) are used as raw bytes without padding
function encodeAddressToEvm(address: BytesLike): string {
  return hexlify(encodeAddressToAny(address))
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
    this.abort.addEventListener('abort', () => this.provider.destroy(), { once: true })

    const getBlockInfo = memoize(this.getBlockInfo.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 1024,
    })
    this.getBlockInfo = getBlockInfo

    /** ethers doesn't support logs' new `blockTimestamp` property; to workaround having to do
     * another roundtrip for it, we hook in these Provider methods, which have access to the 'raw'
     * payloads of getTransactionReceipts and getLogs, cache the timestamps, and populate from
     * cached this.getBlockInfo inside getTransaction and getEvmLogs */
    type RawLog = { blockNumber: number | string; blockTimestamp?: string | number }
    this.provider._wrapTransactionReceipt = (
      value: TransactionReceiptParams,
      network: Network,
    ): TransactionReceipt => {
      // on provider.getTransactionReceipt, cache logs block timestamp, hidden by ethers
      if (value.logs.length && (value.logs[0] as RawLog).blockTimestamp)
        getBlockInfo.cache.set(
          [getNumber(value.logs[0]!.blockNumber)],
          Promise.resolve({
            number: getNumber(value.logs[0]!.blockNumber),
            timestamp: getNumber((value.logs[0]! as RawLog).blockTimestamp!),
          }),
        )
      return (
        this.provider.constructor as typeof JsonRpcApiProvider
      ).prototype._wrapTransactionReceipt.call(this.provider, value, network)
    }
    this.provider._wrapLog = (value: LogParams, network: Network): Log => {
      // on provider.getLogs, cache logs block timestamp, hidden by ethers
      if ((value as RawLog).blockTimestamp)
        getBlockInfo.cache.set(
          [getNumber(value.blockNumber)],
          Promise.resolve({
            number: getNumber(value.blockNumber),
            timestamp: getNumber((value as RawLog).blockTimestamp!),
          }),
        )
      return (this.provider.constructor as typeof JsonRpcApiProvider).prototype._wrapLog.call(
        this.provider,
        value,
        network,
      )
    }

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), { async: true, maxArgs: 1 })

    this.getTransaction = memoize(this.getTransaction.bind(this), {
      async: true,
      maxSize: 100,
      expires: 5e3, // 5 seconds, to allow for confirmed->finalized transition
      transformKey: ([tx]: [TransactionReceipt | string]) =>
        typeof tx !== 'string' ? [tx.hash] : [tx],
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 1024,
    })
    this.getNativeTokenForRouter = memoize(this.getNativeTokenForRouter.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 10,
    })
    this.getTokenInfo = memoize(this.getTokenInfo.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getTokenAdminRegistryFor = memoize(this.getTokenAdminRegistryFor.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getFeeTokens = memoize(this.getFeeTokens.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 10,
    })
    this.detectUsdcDomains = memoize(this.detectUsdcDomains.bind(this), { async: true })
    this.resolveVerifier = memoize(this.resolveVerifier.bind(this), { async: true })
    this.getFeeQuoterFor = memoize(this.getFeeQuoterFor.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getOnRampConfig = memoize(this.getOnRampConfig.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 10,
      expires: 60e3,
    })
    this.getOffRampConfig = memoize(this.getOffRampConfig.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 10,
      expires: 60e3,
    })
    this._getFeeQuoterDest = memoize(this._getFeeQuoterDest.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 10,
      expires: 60e3,
    })
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
  static async _getProvider(url: string, abort?: AbortSignal): Promise<JsonRpcApiProvider> {
    let providerReady: Promise<JsonRpcApiProvider>
    if (url.startsWith('ws')) {
      const provider = new WebSocketProvider(url, undefined, { staticNetwork: true })
      abort?.addEventListener('abort', () => void provider.destroy(), { once: true })
      providerReady = new Promise((resolve, reject) => {
        provider.websocket.onerror = reject
        provider
          ._waitUntilReady()
          .then(() => resolve(provider))
          .catch(reject)
      })
    } else if (url.startsWith('http')) {
      const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true })
      abort?.addEventListener('abort', () => provider.destroy(), { once: true })
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
    return this.fromProvider(await this._getProvider(url, ctx?.abort), ctx)
  }

  /** {@inheritDoc Chain.getBlockInfo} */
  async getBlockInfo(block: EVMEndBlockTag): Promise<BlockInfo> {
    const res = await this.provider.getBlock(block) // cached
    if (!res) throw new CCIPBlockNotFoundError(block)
    return { number: res.number, timestamp: res.timestamp }
  }

  /** {@inheritDoc Chain.getTransaction} */
  async getTransaction(hash: string | TransactionReceipt): Promise<ChainTransaction> {
    const tx = typeof hash === 'string' ? await this.provider.getTransactionReceipt(hash) : hash
    if (!tx)
      throw new CCIPTransactionNotFoundError(hash as string, {
        context: { network: this.network.name },
      })
    const { timestamp } = await this.getBlockInfo(tx.blockNumber)
    const chainTx = {
      ...tx,
      timestamp,
      logs: [] as ChainLog[],
    }
    const logs: ChainLog[] = tx.logs.map((l) =>
      Object.assign(l, { blockTimestamp: timestamp, tx: chainTx }),
    )
    chainTx.logs = logs
    return chainTx
  }

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(
    filter: SetFieldType<LogFilter, 'endBlock', EVMEndBlockTag>,
  ): AsyncIterableIterator<Log & { blockTimestamp: number }> {
    if (filter.watch) {
      filter = {
        ...filter,
        watch:
          filter.watch instanceof AbortSignal
            ? AbortSignal.any([filter.watch, this.abort])
            : this.abort,
      }
    }
    yield* getEvmLogs(filter, this)
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  override getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      | 'lane'
      | `log.${'topics' | 'address' | 'blockNumber' | 'blockTimestamp'}`
      | 'message.sequenceNumber'
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
    return super.getMessagesInBatch(request, range, opts_)
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string) {
    const contract = new Contract(
      address,
      VersionedContractABI,
      this.provider,
    ) as unknown as TypedContract<typeof VersionedContractABI>
    const res = parseTypeAndVersion(await contract.typeAndVersion())
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
        // The fragment is authoritative; any valid Interface works as a passthrough because
        // ethers' decodeEventLog is fragment-driven. The v1.6 reference is incidental —
        // v2.0 CCIPMessageSent events decode through this same path (see requestsFragments).
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
            merkleRoot: result.merkleRoot as `0x${string}`,
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
        const result = resultToObject(
          interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics),
        ) as unknown as {
          [k: string]: unknown
          state: bigint
          messageNumber?: bigint
          sequenceNumber: bigint
        }
        result.sequenceNumber = result.messageNumber ?? result.sequenceNumber
        return {
          ...result,
          state: Number(result.state) as ExecutionState,
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
    let bytes_ = getAddressBytes(bytes)
    if (bytes_.length < 20) throw new CCIPAddressInvalidError(bytes, this.family)
    else if (bytes_.length > 20) {
      if (bytes_.slice(0, bytes_.length - 20).every((b) => b === 0)) {
        bytes_ = bytes_.slice(-20)
      } else {
        throw new CCIPAddressInvalidError(hexlify(bytes_), this.family)
      }
    }
    return getAddress(hexlify(bytes_))
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
   * Fetch FeeQuoter dest state for a given contract and remote chainSelector
   */
  async _getFeeQuoterDest(feeQuoter: string, destChainSelector: bigint) {
    const [type, version, typeAndVersion] = await this.typeAndVersion(feeQuoter)
    if (type !== 'FeeQuoter' && type !== 'PriceRegistry')
      throw new CCIPContractTypeInvalidError(feeQuoter, type, ['FeeQuoter', 'PriceRegistry'], {
        context: { type, version, typeAndVersion },
      })
    let contract
    if (type === 'PriceRegistry') {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      contract = new Contract(
        feeQuoter,
        interfaces.PriceRegistry_v1_2,
        this.provider,
      ) as unknown as TypedContract<typeof PriceRegistry_1_2>
      const [destChainGasPrice, stalenessThreshold] = await Promise.all([
        contract.getDestinationChainGasPrice(destChainSelector),
        contract.getStalenessThreshold(),
      ])
      return resultToObject({
        destChainGasPrice,
        stalenessThreshold,
        typeAndVersion,
      })
    }
    if (version < CCIPVersion.V2_0) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      contract = new Contract(
        feeQuoter,
        interfaces.FeeQuoter_v1_6,
        this.provider,
      ) as unknown as TypedContract<typeof FeeQuoter_1_6_ABI>
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      contract = new Contract(
        feeQuoter,
        interfaces.FeeQuoter_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof FeeQuoter_2_0_ABI>
    }
    return {
      ...(await resultToObject(contract.getStaticConfig())),
      ...(await resultToObject(contract.getDestChainConfig(destChainSelector))),
      typeAndVersion,
    }
  }

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(onRamp: string, destChainSelector: bigint) {
    const [, version, typeAndVersion] = await this.typeAndVersion(onRamp)
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
        const [staticConfig, dynamicConfig] = await Promise.all([
          resultToObject(contract.getStaticConfig()),
          resultToObject(contract.getDynamicConfig()),
        ])
        if (destChainSelector && staticConfig.destChainSelector !== destChainSelector) {
          throw new CCIPSourceChainUnsupportedError(destChainSelector, {
            context: {
              network: this.network.name,
              onRamp,
              actualDestChainSelector: staticConfig.destChainSelector,
            },
          })
        }
        return {
          feeQuoter: dynamicConfig.priceRegistry,
          ...staticConfig,
          ...dynamicConfig,
          priceRegistryConfig: await this._getFeeQuoterDest(
            dynamicConfig.priceRegistry,
            destChainSelector,
          ),
          typeAndVersion,
        }
      }
      case CCIPVersion.V1_6: {
        const contract = new Contract(
          onRamp,
          interfaces.OnRamp_v1_6,
          this.provider,
        ) as unknown as TypedContract<typeof OnRamp_1_6_ABI>
        const [staticConfig, dynamicConfig, destChainConfigRaw] = await Promise.all([
          resultToObject(contract.getStaticConfig()),
          resultToObject(contract.getDynamicConfig()),
          contract.getDestChainConfig(destChainSelector),
        ])
        const [_, allowlistEnabled, router] = destChainConfigRaw
        const destChainConfig = { allowlistEnabled, router }
        return {
          ...staticConfig,
          destChainSelector,
          ...dynamicConfig,
          ...resultToObject(destChainConfig),
          feeQuoterConfig: await this._getFeeQuoterDest(dynamicConfig.feeQuoter, destChainSelector),
          typeAndVersion,
        }
      }
      case CCIPVersion.V2_0: {
        const contract = new Contract(
          onRamp,
          interfaces.OnRamp_v2_0,
          this.provider,
        ) as unknown as TypedContract<typeof OnRamp_2_0_ABI>
        const [staticConfig, dynamicConfig, destChainConfig] = await Promise.all([
          resultToObject(contract.getStaticConfig()),
          resultToObject(contract.getDynamicConfig()),
          resultToObject(contract.getDestChainConfig(destChainSelector)),
        ])
        return {
          ...staticConfig,
          ...dynamicConfig,
          destChainSelector,
          ...destChainConfig,
          feeQuoterConfig: await this._getFeeQuoterDest(dynamicConfig.feeQuoter, destChainSelector),
          typeAndVersion,
        }
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }
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

  /** {@inheritDoc Chain.getOffRampConfig} */
  async getOffRampConfig(offRamp: string, sourceChainSelector: bigint) {
    const [, version, typeAndVersion] = await this.typeAndVersion(offRamp)
    const sourceFamily = networkInfo(sourceChainSelector).family
    let offRampABI, commitStoreABI
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
        commitStoreABI = CommitStore_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        commitStoreABI ??= CommitStore_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const [staticConfig, dynamicConfig] = await Promise.all([
          resultToObject(contract.getStaticConfig()),
          resultToObject(contract.getDynamicConfig()),
        ])
        const csContract = new Contract(
          staticConfig.commitStore,
          commitStoreABI,
          this.provider,
        ) as unknown as TypedContract<typeof commitStoreABI>
        const [csStaticConfig, csDynamicConfig] = await Promise.all([
          resultToObject(csContract.getStaticConfig()),
          resultToObject(csContract.getDynamicConfig()),
        ])
        if (sourceChainSelector && staticConfig.sourceChainSelector !== sourceChainSelector) {
          throw new CCIPSourceChainUnsupportedError(sourceChainSelector, {
            context: {
              network: this.network.name,
              offRamp,
              actualSourceChainSelector: staticConfig.sourceChainSelector,
            },
          })
        }
        return {
          ...csStaticConfig,
          ...csDynamicConfig,
          ...staticConfig,
          ...dynamicConfig,
          onRamps: [staticConfig.onRamp],
          typeAndVersion,
        }
      }
      case CCIPVersion.V1_6: {
        offRampABI = OffRamp_1_6_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof OffRamp_1_6_ABI>
        const [staticConfig, dynamicConfig, { onRamp, ...sourceChainConfig }] = await Promise.all([
          resultToObject(contract.getStaticConfig()),
          resultToObject(contract.getDynamicConfig()),
          resultToObject(contract.getSourceChainConfig(sourceChainSelector)),
        ])
        const onRamps = []
        try {
          onRamps.push(decodeOnRampAddress(onRamp, sourceFamily))
        } catch {
          // ignore
        }
        return {
          sourceChainSelector,
          ...staticConfig,
          ...dynamicConfig,
          ...sourceChainConfig,
          onRamps,
          typeAndVersion,
        }
      }
      case CCIPVersion.V2_0: {
        offRampABI = OffRamp_2_0_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof OffRamp_2_0_ABI>
        const [staticConfig, sourceChainConfig] = await Promise.all([
          resultToObject(contract.getStaticConfig()),
          resultToObject(contract.getSourceChainConfig(sourceChainSelector)),
        ])
        const onRamps = sourceChainConfig.onRamps.map((o) => decodeOnRampAddress(o, sourceFamily))
        return {
          ...staticConfig,
          sourceChainSelector,
          ...sourceChainConfig,
          onRamps,
          typeAndVersion,
        }
      }
      default:
        throw new CCIPVersionUnsupportedError(version)
    }
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
        return getV12LeafHasher(sourceChainSelector, destChainSelector, onRamp)
      case CCIPVersion.V1_6:
        return getV16LeafHasher(sourceChainSelector, destChainSelector, onRamp, ctx)
      default:
        throw new CCIPHasherVersionUnsupportedError('EVM', version)
    }
  }

  /**
   * Gets any available OnRamp for the given router.
   * @param address - Router or OnRamp contract address.
   * @returns OnRamp contract address.
   */
  async _getSomeOnRampFor(address: string): Promise<string> {
    const [type, , typeAndVersion] = await this.typeAndVersion(address)
    if (type.includes('OnRamp')) return address
    else if (type !== 'Router') throw new CCIPContractNotRouterError(address, typeAndVersion)
    // when given a router, we take any onRamp we can find, as usually they all use same registry
    const someOtherNetwork =
      this.network.networkType === NetworkType.Testnet
        ? this.network.name === 'ethereum-testnet-sepolia'
          ? 'avalanche-testnet-fuji'
          : 'ethereum-testnet-sepolia'
        : this.network.name === 'ethereum-mainnet'
          ? 'avalanche-mainnet'
          : 'ethereum-mainnet'
    return this.getOnRampForRouter(address, networkInfo(someOtherNetwork).chainSelector)
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPContractNotRouterError} if address is not a Router, OnRamp, or OffRamp
   */
  async getTokenAdminRegistryFor(address: string): Promise<string> {
    const [type, version] = await this.typeAndVersion(address)
    if (type === 'TokenAdminRegistry') {
      return address
    } else if (type.includes('TokenPool')) {
      address = (await this.getTokenPoolConfig(address)).router
      return this.getTokenAdminRegistryFor(address)
    } else if (type === 'Router') {
      address = await this._getSomeOnRampFor(address)
      return this.getTokenAdminRegistryFor(address)
    } else if (!type.includes('Ramp')) {
      const [, , typeAndVersion] = await this.typeAndVersion(address)
      throw new CCIPContractNotRouterError(address, typeAndVersion)
    }
    const isOnRamp = type.includes('OnRamp')
    const contract = new Contract(
      address,
      version < CCIPVersion.V1_6
        ? isOnRamp
          ? interfaces.EVM2EVMOnRamp_v1_5
          : interfaces.EVM2EVMOffRamp_v1_5
        : version < CCIPVersion.V2_0
          ? isOnRamp
            ? interfaces.OnRamp_v1_6
            : interfaces.OffRamp_v1_6
          : isOnRamp
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
    return (await resultToObject(contract.getStaticConfig())).tokenAdminRegistry
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
    const [type, version, typeAndVersion] = await this.typeAndVersion(address)
    if (type === 'FeeQuoter' || type === 'PriceRegistry') {
      return address
    } else if (type === 'Router') {
      address = await this._getSomeOnRampFor(address)
      return this.getFeeQuoterFor(address) // use cache
    } else if (!type.includes('Ramp')) {
      throw new CCIPContractNotRouterError(address, typeAndVersion)
    }
    const isOnRamp = type.includes('OnRamp')

    if (version < CCIPVersion.V1_6) {
      const rampAbi =
        version < CCIPVersion.V1_5
          ? isOnRamp
            ? EVM2EVMOnRamp_1_2_ABI
            : EVM2EVMOffRamp_1_2_ABI
          : isOnRamp
            ? EVM2EVMOnRamp_1_5_ABI
            : EVM2EVMOffRamp_1_5_ABI
      const contract = new Contract(address, rampAbi, this.provider) as unknown as TypedContract<
        typeof rampAbi
      >
      const { priceRegistry } = await resultToObject(contract.getDynamicConfig())
      return priceRegistry
    }

    const rampAbi =
      version < CCIPVersion.V2_0
        ? isOnRamp
          ? OnRamp_1_6_ABI
          : OffRamp_1_6_ABI
        : isOnRamp
          ? OnRamp_2_0_ABI
          : OffRamp_2_0_ABI
    const contract = new Contract(address, rampAbi, this.provider) as unknown as TypedContract<
      typeof rampAbi
    >
    return (await resultToObject(contract.getDynamicConfig())).feeQuoter
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    await this.checkSendMessage(opts)
    const { router, destChainSelector, message } = opts
    const populatedMessage = buildMessageForDest(message, networkInfo(destChainSelector).family)
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return contract.getFee(destChainSelector, {
      receiver: encodeAddressToEvm(populatedMessage.receiver),
      data: hexlify(populatedMessage.data ?? '0x'),
      tokenAmounts: populatedMessage.tokenAmounts ?? [],
      feeToken: populatedMessage.feeToken || ZeroAddress,
      extraArgs: hexlify(
        (this.constructor as typeof EVMChain).encodeExtraArgs(populatedMessage.extraArgs),
      ),
    })
  }

  /**
   * Detect whether a token pool is a USDC/CCTP pool via typeAndVersion, then resolve
   * the CCTPVerifier address and fetch source/dest CCTP domain IDs.
   *
   * @param tokenPool - The token pool address to check.
   * @param destChainSelector - Destination chain selector for getDomain().
   * @param ccvs - Cross-chain verifier addresses from extraArgs (fallback for verifier discovery).
   * @returns Source and dest CCTP domain IDs, or undefined if not a USDC pool.
   */
  private async detectUsdcDomains(
    tokenPool: string,
    destChainSelector: bigint,
    ccvs: string[] = [],
  ): Promise<{ sourceDomain: number; destDomain: number } | undefined> {
    // 1. Check if pool is USDCTokenPoolProxy
    let poolType: string
    try {
      ;[poolType] = await this.typeAndVersion(tokenPool)
    } catch {
      return undefined
    }
    if (poolType !== 'USDCTokenPoolProxy') return undefined

    // 2. Find CCTPVerifier address
    let verifierAddress: string | undefined

    // 2a. Try pool's getStaticConfig (returns resolver/verifier address)
    try {
      const proxy = new Contract(
        tokenPool,
        interfaces.USDCTokenPoolProxy_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof USDCTokenPoolProxy_2_0_ABI>
      const [, , cctpVerifier] = await proxy.getStaticConfig()
      const candidate = cctpVerifier as string
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
      const verifier = new Contract(
        verifierAddress,
        interfaces.CCTPVerifier_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof CCTPVerifier_2_0_ABI>
      const [staticConfig, domainResult] = await Promise.all([
        verifier.getStaticConfig(),
        verifier.getDomain(destChainSelector),
      ])
      return {
        sourceDomain: Number(staticConfig[3]), // localDomainIdentifier
        destDomain: Number(domainResult.domainIdentifier),
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
        ) as unknown as TypedContract<typeof VersionedVerifierResolver_2_0_ABI>
        return (await resolver.getOutboundImplementation(destChainSelector, '0x')) as string
      }
      if (candidateType === 'CCTPVerifier') return candidate
    } catch {
      /* not a valid versioned contract */
    }
    return undefined
  }

  /** {@inheritDoc Chain.getTokenPrice} */
  override async getTokenPrice(opts: {
    router: string
    token: string
    timestamp?: number
  }): Promise<TokenPrice> {
    let { token } = opts

    // Resolve native token (ZeroAddress) to wrapped native
    if (token === ZeroAddress) {
      token = await this.getNativeTokenForRouter(opts.router)
    }

    const priceContractAddress = await this.getFeeQuoterFor(opts.router)

    // Both PriceRegistry (v1.2/v1.5) and FeeQuoter (v1.6+) expose
    // getTokenPrice(address) → { value: uint224, timestamp: uint32 }
    const contract = new Contract(
      priceContractAddress,
      interfaces.FeeQuoter_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof FeeQuoter_1_6_ABI>

    // If timestamp provided, resolve to block number for historical query
    let blockTag: number | undefined
    if (opts.timestamp != null) {
      const { number: latestBlock } = (await this.provider.getBlock('latest'))!
      blockTag = await getSomeBlockNumberBefore(
        async (block: number) => (await this.provider.getBlock(block))!.timestamp,
        latestBlock,
        opts.timestamp,
        this,
      )
    }

    const [result, { decimals }] = await Promise.all([
      blockTag != null
        ? contract.getTokenPrice.staticCall(token, { blockTag })
        : contract.getTokenPrice(token),
      this.getTokenInfo(token),
    ])

    const rawPrice = BigInt(result.value)
    return { price: Number(rawPrice) * 10 ** (decimals - 36) }
  }

  /** {@inheritDoc Chain.getTotalFeesEstimate} */
  override async getTotalFeesEstimate(
    opts: Parameters<Chain['getTotalFeesEstimate']>[0],
  ): Promise<TotalFeesEstimate> {
    const tokenAmounts = opts.message.tokenAmounts
    const ccipFee$ = this.getFee(opts)

    if (!tokenAmounts?.length) {
      return { ccipFee: await ccipFee$ }
    }

    const { token, amount } = tokenAmounts[0]!

    // Determine finality and tokenArgs from extraArgs
    const extraArgs = opts.message.extraArgs
    let finality: FinalityRequested = 0
    let tokenArgs: string = '0x'
    if (extraArgs && 'finality' in extraArgs && extraArgs.finality != null) {
      finality = extraArgs.finality
      if (extraArgs.tokenArgs) tokenArgs = hexlify(extraArgs.tokenArgs)
    }

    // Skip pool-level fee lookup for pre-v2.0 lanes
    const onRamp = await this.getOnRampForRouter(opts.router, opts.destChainSelector)
    const [, version] = await this.typeAndVersion(onRamp)
    if (version < CCIPVersion.V2_0) {
      return { ccipFee: await ccipFee$ }
    }

    const onRampContract = new Contract(
      onRamp,
      interfaces.OnRamp_v2_0,
      this.provider,
    ) as unknown as TypedContract<typeof OnRamp_2_0_ABI>

    const poolAddress = (await onRampContract.getPoolBySourceToken(
      opts.destChainSelector,
      token,
    )) as string

    const [ccipFee, { tokenTransferFeeConfig }, usdcDomains] = await Promise.all([
      ccipFee$,
      this.getTokenPoolConfig(poolAddress, {
        destChainSelector: opts.destChainSelector,
        finality,
        tokenArgs,
      }),
      this.detectUsdcDomains(
        poolAddress,
        opts.destChainSelector,
        extraArgs && 'ccvs' in extraArgs ? extraArgs.ccvs : [],
      ),
    ])

    // USDC path: use Circle CCTP burn fees
    if (usdcDomains) {
      const burnFees = await getUsdcBurnFees(
        usdcDomains.sourceDomain,
        usdcDomains.destDomain,
        this.network.networkType,
      )
      const fast = finality !== 0
      // Tiers are sorted ascending by finalityThreshold; findLast for fast ensures
      // we pick the highest tier still within the fast threshold.
      const tier = fast
        ? burnFees.findLast((t) => t.finalityThreshold <= CCTP_FINALITY_FAST)
        : burnFees.find((t) => t.finalityThreshold > CCTP_FINALITY_FAST)
      if (tier && tier.minimumFee > 0) {
        return {
          ccipFee,
          tokenTransferFee: {
            feeDeducted:
              (BigInt(amount) * BigInt(Math.round(tier.minimumFee * 1000))) / 10_000_000n,
            bps: tier.minimumFee,
          },
        }
      }
      return { ccipFee }
    }

    // Non-USDC path: use on-chain tokenTransferFeeConfig
    if (!tokenTransferFeeConfig || !tokenTransferFeeConfig.isEnabled) {
      return { ccipFee }
    }

    const useCustom = finality !== 0
    const bps = useCustom
      ? tokenTransferFeeConfig.fastFinalityTransferFeeBps
      : tokenTransferFeeConfig.finalityTransferFeeBps

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

    const feeToken = message.feeToken || ZeroAddress
    const receiver = encodeAddressToEvm(message.receiver)
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
    const { offRamp, input, gasLimit, tokensGasLimit } = await this.resolveExecuteOpts(opts)
    if ('verifications' in input) {
      const contract = new Contract(
        offRamp,
        interfaces.OffRamp_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof OffRamp_2_0_ABI>

      const message = decodeMessageV1(input.encodedMessage)
      const ccvs = input.verifications.map(({ destAddress }) => destAddress)
      const verifierResults = input.verifications.map(({ ccvData }) => hexlify(ccvData))
      const gasLimitOverride = BigInt(gasLimit ?? 0)
      const execTx = await contract.execute.populateTransaction(
        input.encodedMessage,
        ccvs,
        verifierResults,
        gasLimitOverride,
      )
      // `execute()` swallows inner failures on first-exec; floor at executionGasLimit*1.2.
      // On estimateGas failure, leave gasLimit unset and still return the tx so wallets
      // can run their own estimation and surface the native revert reason (mirrors v1.x below).
      try {
        const estimated = await contract.execute.estimateGas(
          input.encodedMessage,
          ccvs,
          verifierResults,
          gasLimitOverride,
        )
        const declaredBudget = BigInt(message.executionGasLimit)
        const bufferedFloor = (declaredBudget * 120n) / 100n
        execTx.gasLimit = estimated > bufferedFloor ? estimated : bufferedFloor
      } catch (err) {
        this.logger.warn(
          'Gas estimation for execute failed, returning tx without gasLimit. Error:',
          err,
        )
      }
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
              tokenGasOverrides: input.message.tokenAmounts.map(() => BigInt(tokensGasLimit ?? 0)),
            },
          ],
        )
        break
      }
      case CCIPVersion.V1_6: {
        const sender = encodeAddressToEvm(input.message.sender)
        const tokenAmounts = (input.message as CCIPMessage_V1_6_EVM).tokenAmounts.map((ta) => ({
          ...ta,
          sourcePoolAddress: encodeAddressToEvm(ta.sourcePoolAddress),
          extraData: hexlify(getDataBytes(ta.extraData)),
        }))
        const message = {
          ...(input.message as CCIPMessage_V1_6_EVM),
          sender,
          data: hexlify(getDataBytes(input.message.data || '0x')),
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
                  BigInt(tokensGasLimit ?? 0),
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
    try {
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
    } catch (err) {
      this.logger.warn(
        'Gas estimation for manuallyExecute failed, using default fallback. Error:',
        err,
      )
    }

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
   * @param feeOpts - Optional parameters to also fetch token transfer fee config:
   *   - `destChainSelector` — destination chain selector.
   *   - `finality` — requested finality ('finalized', 'safe', or block depth number).
   *   - `tokenArgs` — hex-encoded bytes passed to the pool contract.
   * @returns Token pool config containing token, router, typeAndVersion, and optionally
   *          finalityDepth, finalitySafe, and tokenTransferFeeConfig.
   *          LockReleaseV2 TPs also return its `lockBox` address
   *
   * @remarks
   * For pools with version \>= 2.0, also returns `finalityDepth` and `finalitySafe` for
   * Faster-Than-Finality (FTF) and FCR support. Pre-2.0 pools omit these fields.
   * When `feeOpts` is provided and the pool is v2.0+, also fetches token transfer fee config.
   */
  async getTokenPoolConfig(
    tokenPool: string,
    feeOpts?: TokenTransferFeeOpts,
  ): Promise<SetRequired<TokenPoolConfig, 'typeAndVersion'>> {
    const [type, version, typeAndVersion] = await this.typeAndVersion(tokenPool)

    let token,
      router,
      allowedFinality,
      tokenTransferFeeConfig,
      previousPool: string | undefined,
      lockBox: string | undefined
    if (version < CCIPVersion.V2_0) {
      const contract = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_6,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_ABI>
      token = contract.getToken()
      router = contract.getRouter()
      if (type.endsWith('AndProxy')) {
        const proxy = new Contract(
          tokenPool,
          interfaces.TokenPoolAndProxy,
          this.provider,
        ) as unknown as TypedContract<typeof TokenPoolAndProxyABI>
        const previousPool_ = await proxy.getPreviousPool().catch(() => null)
        if (previousPool_ && previousPool_ !== ZeroAddress)
          previousPool = previousPool_ as CleanAddressable<typeof previousPool_>
      }
    } else {
      if (type === 'USDCTokenPoolProxy') {
        const proxy = new Contract(
          tokenPool,
          interfaces.USDCTokenPoolProxy_v2_0,
          this.provider,
        ) as unknown as TypedContract<typeof USDCTokenPoolProxy_2_0_ABI>
        previousPool = (await proxy.getPools())['cctpV2PoolWithCCV'] as CleanAddressable<
          Awaited<ReturnType<(typeof proxy)['getPools']>>
        >['cctpV2PoolWithCCV']
      }
      const contract = new Contract(
        previousPool ?? tokenPool,
        interfaces.TokenPool_v2_0,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_2_0_ABI>
      token = contract.getToken()
      router = contract.getDynamicConfig().then(([router]) => router)
      if (type.includes('LockRelease')) {
        const lockBox_ = await resultToObject(contract.getLockBox().catch(() => null))
        if (lockBox_ && !lockBox_.match(/^(0x)?0*$/)) lockBox = lockBox_
      }
      allowedFinality = contract.getAllowedFinalityConfig().catch((err) => {
        this.logger.debug(
          typeAndVersion,
          'threw when fetching getAllowedFinalityConfig, defaulting to 0:',
          err,
        )
        if (isError(err, 'CALL_EXCEPTION')) return 0
        throw CCIPError.from(err)
      })
      if (feeOpts) {
        tokenTransferFeeConfig = token.then((tokenAddr) =>
          contract
            .getTokenTransferFeeConfig(
              tokenAddr as string,
              feeOpts.destChainSelector,
              toBeHex(encodeFinality(feeOpts.finality), 4),
              feeOpts.tokenArgs,
            )
            .then((result) => ({
              destGasOverhead: Number(result.destGasOverhead),
              destBytesOverhead: Number(result.destBytesOverhead),
              finalityFeeUSDCents: Number(result.finalityFeeUSDCents),
              fastFinalityFeeUSDCents: Number(result.fastFinalityFeeUSDCents),
              finalityTransferFeeBps: Number(result.finalityTransferFeeBps),
              fastFinalityTransferFeeBps: Number(result.fastFinalityTransferFeeBps),
              isEnabled: result.isEnabled,
            }))
            .catch((err) => {
              if (isError(err, 'CALL_EXCEPTION')) return undefined
              throw CCIPError.from(err, 'UNKNOWN')
            }),
        )
      }
    }
    let previousTypeAndVersion
    if (previousPool) previousTypeAndVersion = this.typeAndVersion(previousPool)

    return Promise.all([
      token,
      router,
      allowedFinality,
      tokenTransferFeeConfig,
      previousTypeAndVersion,
    ]).then(([token, router, allowedFinality, tokenTransferFeeConfig, previousTypeAndVersion]) => {
      return {
        token: token as CleanAddressable<typeof token>,
        router: router as CleanAddressable<typeof router>,
        typeAndVersion,
        ...(allowedFinality != null && decodeFinalityAllowed(allowedFinality)),
        ...(tokenTransferFeeConfig != null && { tokenTransferFeeConfig }),
        ...(previousPool != null && {
          previousPool,
          previousTypeAndVersion: previousTypeAndVersion![2],
        }),
        ...(!!lockBox && { lockBox }),
      }
    })
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
   *   (`fastOutboundRateLimiterState` / `fastInboundRateLimiterState`).
   *
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if remote token is not configured for a chain.
   */
  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    const { typeAndVersion, previousPool } = await this.getTokenPoolConfig(tokenPool)
    const [type, version] = parseTypeAndVersion(typeAndVersion)

    if (type === 'USDCTokenPoolProxy' && version >= CCIPVersion.V2_0) {
      // USDC v2 proxys need to fetch most data from the implementation pool
      tokenPool = previousPool!
    }
    // all versions share the same getSupportedChains() interface, and >=v1.5 getRemoteToken
    const contract = new Contract(
      tokenPool,
      interfaces.TokenPool_v2_0,
      this.provider,
    ) as unknown as TypedContract<typeof TokenPool_2_0_ABI>

    const supportedChains: Promise<NetworkInfo[]> = remoteChainSelector
      ? Promise.resolve([networkInfo(remoteChainSelector)])
      : (async () => {
          const chains = await contract.getSupportedChains()
          return chains.map(networkInfo)
        })()

    const remoteTokens: Promise<string[]> = supportedChains.then((chains) =>
      Promise.all(
        chains.map((chain) =>
          contract.getRemoteToken(chain.chainSelector).then((remoteToken) => {
            if (!remoteToken || remoteToken.match(/^(0x)?0*$/))
              throw new CCIPTokenPoolChainConfigNotFoundError(tokenPool, tokenPool, chain.name)
            return decodeAddress(remoteToken, chain.family)
          }),
        ),
      ),
    )

    const remotePools: Promise<string[][]> = supportedChains.then((chains) => {
      let remotePools
      if (version < '1.5.1') {
        const contract = new Contract(
          tokenPool,
          interfaces.TokenPool_v1_5,
          this.provider,
        ) as unknown as TypedContract<typeof TokenPool_1_5_ABI>
        // all versions >=v1.5.1 supports getRemotePools, but v1.5.0, which returns single pool
        remotePools = Promise.all(
          chains.map(async (chain) => [await contract.getRemotePool(chain.chainSelector)]),
        )
      } else {
        remotePools = Promise.all(
          chains.map((chain) => contract.getRemotePools(chain.chainSelector)),
        )
      }
      return remotePools.then((remotePools) =>
        remotePools.map((pools, i) =>
          pools
            .filter((pool) => pool && !pool.match(/^(0x)?0*$/))
            .map((pool) => decodeAddress(pool, chains[i]!.family)),
        ),
      )
    })

    const remoteRateLimits = supportedChains.then(
      (chains): Promise<Readonly<TupleOf<2 | 4, RateLimiterBucket>>[]> => {
        if (version < CCIPVersion.V2_0) {
          // <v2 == v1.4..v1.6 TPs have compatible getCurrent(Out|In)boundRateLimiterState methods;
          // assumes v1 *AndProxy (i.e. non-null previousPool) has v1 previousPool
          const contract = new Contract(
            previousPool ?? tokenPool,
            interfaces.TokenPool_v1_6,
            this.provider,
          ) as unknown as TypedContract<typeof TokenPool_ABI>
          return Promise.all(
            chains.map((chain) =>
              Promise.all([
                contract.getCurrentOutboundRateLimiterState(chain.chainSelector),
                contract.getCurrentInboundRateLimiterState(chain.chainSelector),
              ] as const),
            ),
          )
        }
        return Promise.all(
          chains.map((chain) =>
            Promise.all([
              contract.getCurrentRateLimiterState(chain.chainSelector, false),
              contract.getCurrentRateLimiterState(chain.chainSelector, true),
            ] as const).then(([[outbound, inbound], [fastOutbound, fastInbound]]) => {
              return [outbound, inbound, fastOutbound, fastInbound] as const
            }),
          ),
        )
      },
    )

    return Promise.all([supportedChains, remotePools, remoteTokens, remoteRateLimits]).then(
      ([supportedChains, remotePools, remoteTokens, remoteRateLimits]) =>
        Object.fromEntries(
          supportedChains.map(
            (chain, i) =>
              [
                chain.name,
                {
                  remoteToken: remoteTokens[i]!,
                  remotePools: remotePools[i]!,
                  outboundRateLimiterState: toRateLimiterState(remoteRateLimits[i]![0]),
                  inboundRateLimiterState: toRateLimiterState(remoteRateLimits[i]![1]),
                  ...(remoteRateLimits[i]!.length === 4 && {
                    fastOutboundRateLimiterState: toRateLimiterState(remoteRateLimits[i]![2]),
                    fastInboundRateLimiterState: toRateLimiterState(remoteRateLimits[i]![3]),
                  }),
                },
              ] as const,
          ),
        ),
    )
  }

  /**
   * {@inheritDoc Chain.getFeeTokens}
   * @throws {@link CCIPVersionUnsupportedError} if OnRamp version is not supported
   */
  async getFeeTokens(address: string) {
    const feeQuoter = await this.getFeeQuoterFor(address)
    const contract = new Contract(
      feeQuoter,
      interfaces.FeeQuoter_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof FeeQuoter_1_6_ABI>
    const tokens = await contract.getFeeTokens()

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

      // race API client + indexer URLs
      const verifications = await fetchVerifications(request.message.messageId, {
        apiClient: this.apiClient,
        indexer: opts.indexer ?? this.network.networkType,
        watch:
          opts.watch instanceof AbortSignal
            ? AbortSignal.any([opts.watch, this.abort])
            : this.abort,
      })
      return { verificationPolicy, verifications }
    } else if (request.lane.version < CCIPVersion.V1_6) {
      // v1.2..v1.5 EVM (only) have separate CommitStore
      const { commitStore } = (await this.getOffRampConfig(
        opts.offRamp,
        request.lane.sourceChainSelector,
      )) as Extract<Awaited<ReturnType<EVMChain['getOffRampConfig']>>, { commitStore: unknown }>
      opts.offRamp = commitStore
    }
    // fallback <=v1.6
    return super.getVerifications(opts)
  }

  /** {@inheritDoc Chain.getExecutionReceipts} */
  override async *getExecutionReceipts(
    opts: Parameters<Chain['getExecutionReceipts']>[0],
  ): AsyncIterableIterator<CCIPExecution> {
    const { messageId, sourceChainSelector } = opts
    const [, version] = await this.typeAndVersion(opts.offRamp)
    let opts_: Parameters<Chain['getExecutionReceipts']>[0] & Parameters<EVMChain['getLogs']>[0]
    if (version < CCIPVersion.V1_6) {
      opts_ = {
        ...opts,
        topics: [
          interfaces.EVM2EVMOffRamp_v1_5.getEvent('ExecutionStateChanged')!.topicHash,
          null,
          messageId ?? null,
        ],
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
      }
    }
    yield* super.getExecutionReceipts(opts_)
  }

  /** {@inheritDoc Chain.estimateReceiveExecution} */
  override async estimateReceiveExecution(
    opts: Parameters<NonNullable<Chain['estimateReceiveExecution']>>[0],
  ): Promise<number> {
    let opts_, destRouter
    if (!('offRamp' in opts)) {
      const { message, metadata } = await this.getMessageById(opts.messageId)

      const offRamp =
        ('offRampAddress' in message && message.offRampAddress) ||
        metadata?.offRamp ||
        (await this.apiClient!.getExecutionInput(opts.messageId)).offRamp
      destRouter = await this.getRouterForOffRamp(offRamp, message.sourceChainSelector)
      opts_ = {
        offRamp,
        message: {
          ...message,
          destTokenAmounts: await Promise.all(
            message.tokenAmounts.map((tokenAmount) =>
              getDestTokenAmount({ dest: this, tokenAmount }),
            ),
          ),
        },
      }
    } else {
      destRouter = await this.getRouterForOffRamp(opts.offRamp, opts.message.sourceChainSelector)
      opts_ = {
        ...opts,
        message: {
          messageId: hexlify(randomBytes(32)),
          ...opts.message,
          destTokenAmounts: await Promise.all(
            (opts.message.tokenAmounts ?? []).map((tokenAmount) =>
              getDestTokenAmount({ dest: this, tokenAmount }),
            ),
          ),
        },
      }
    }

    // v2: check allowed finality
    if (
      'finality' in opts_.message &&
      opts_.message.finality &&
      opts_.message.finality !== 'finalized'
    ) {
      let allowedFinality: FinalityAllowed = {
        finalityDepth: 1,
        finalitySafe: true,
      } // default=loose for non-receivers
      try {
        const receiver = new Contract(
          opts_.message.receiver,
          interfaces.Receiver_v2_0,
          this.provider,
        ) as unknown as TypedContract<typeof Receiver_2_0_ABI>
        if (await receiver.supportsInterface(receiver.ccipReceive.fragment.selector))
          allowedFinality = { finalityDepth: 0 } // default=finalized for legacy receivers

        const [, , , allowedFinality_] = await receiver.getCCVsAndFinalityConfig(
          opts_.message.sourceChainSelector,
          opts_.message.sender ?? ZeroHash,
        )
        allowedFinality = decodeFinalityAllowed(allowedFinality_)
      } catch (err) {
        this.logger.debug(
          `Failed to fetch allowed finality config from receiver="${opts_.message.receiver}", defaulting to: ${JSON.stringify(allowedFinality)}. Error:`,
          err,
        )
      }
      if (opts_.message.finality === 'safe') {
        if (!allowedFinality.finalitySafe)
          throw new CCIPFinalityNotAllowedError(opts_.message.finality, allowedFinality, {
            context: {
              source: networkInfo(opts_.message.sourceChainSelector).name,
              sender: opts_.message.sender,
              dest: this.network.name,
              receiver: opts_.message.receiver,
            },
          })
      } else if (opts_.message.finality < allowedFinality.finalityDepth) {
        throw new CCIPFinalityNotAllowedError(opts_.message.finality, allowedFinality, {
          context: {
            source: networkInfo(opts_.message.sourceChainSelector).name,
            sender: opts_.message.sender,
            dest: this.network.name,
            receiver: opts_.message.receiver,
          },
        })
      }
    }

    return estimateExecGas({ provider: this.provider, router: destRouter, ...opts_ })
  }
}
