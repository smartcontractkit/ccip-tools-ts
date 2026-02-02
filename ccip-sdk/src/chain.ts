import { type BytesLike, dataLength } from 'ethers'
import type { PickDeep, SetOptional } from 'type-fest'

import { type LaneInfoResponse, type LaneLatencyResponse, CCIPAPIClient } from './api/index.ts'
import type { UnsignedAptosTx } from './aptos/types.ts'
import { getCommitReport } from './commits.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPChainFamilyMismatchError,
  CCIPExecTxRevertedError,
  CCIPTransactionNotFinalizedError,
} from './errors/index.ts'
import { DEFAULT_GAS_LIMIT } from './evm/const.ts'
import type { UnsignedEVMTx } from './evm/types.ts'
import type {
  EVMExtraArgsV1,
  EVMExtraArgsV2,
  ExtraArgs,
  SVMExtraArgsV1,
  SuiExtraArgsV1,
} from './extra-args.ts'
import type { LeafHasher } from './hasher/common.ts'
import { getMessagesInTx } from './requests.ts'
import type { UnsignedSolanaTx } from './solana/types.ts'
import type { UnsignedTONTx } from './ton/types.ts'
import {
  type AnyMessage,
  type CCIPCommit,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ChainFamily,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type Lane,
  type Log_,
  type Logger,
  type MessageInput,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ExecutionState,
} from './types.ts'
import { util, withRetry } from './utils.ts'

/**
 * Context for Chain class initialization.
 * Extends WithLogger with optional API client configuration.
 *
 * @example Default behavior (auto-create API client)
 * ```typescript
 * const chain = await EVMChain.fromUrl(rpcUrl, { logger })
 * await chain.getLaneLatency(destSelector) // Works - uses production API
 * ```
 *
 * @example Custom API endpoint
 * ```typescript
 * const api = new CCIPAPIClient('https://staging-api.example.com', { logger })
 * const chain = await EVMChain.fromUrl(rpcUrl, { apiClient: api, logger })
 * ```
 *
 * @example Explicit opt-out (decentralized mode)
 * ```typescript
 * const chain = await EVMChain.fromUrl(rpcUrl, { apiClient: null, logger })
 * await chain.getLaneLatency(destSelector) // Throws CCIPApiClientNotAvailableError
 * ```
 */
export type ChainContext = WithLogger & {
  /**
   * CCIP API client instance for lane information queries.
   *
   * - `undefined` (default): Creates CCIPAPIClient with {@link DEFAULT_API_BASE_URL}
   * - `CCIPAPIClient`: Uses provided instance (allows custom URL, fetch, etc.)
   * - `null`: Disables API client entirely (getLaneLatency() will throw)
   *
   * Default: `undefined` (auto-create with production endpoint)
   */
  apiClient?: CCIPAPIClient | null

  /**
   * Retry configuration for API fallback operations.
   * Controls exponential backoff behavior for transient errors.
   * Default: DEFAULT_API_RETRY_CONFIG
   */
  apiRetryConfig?: ApiRetryConfig
}

/**
 * Configuration for retry behavior with exponential backoff.
 */
export type ApiRetryConfig = {
  /** Maximum number of retry attempts for transient errors.*/
  maxRetries?: number

  /** Initial delay in milliseconds before the first retry. */
  initialDelayMs?: number

  /** Multiplier applied to delay after each retry (exponential backoff). Set to 1 for fixed delays. */
  backoffMultiplier?: number

  /** Maximum delay in milliseconds between retries (caps exponential growth). */
  maxDelayMs?: number

  /** Whether to respect the error's retryAfterMs hint when available. If true, uses max(calculated delay, error.retryAfterMs). */
  respectRetryAfterHint?: boolean
}

export const DEFAULT_API_RETRY_CONFIG: Required<ApiRetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  respectRetryAfterHint: true,
}

/**
 * Filter options for getLogs queries across chains.
 */
export type LogFilter = {
  /** Starting block number (inclusive). */
  startBlock?: number
  /** Starting Unix timestamp (inclusive). */
  startTime?: number
  /** Ending block number (inclusive). */
  endBlock?: number | 'finalized' | 'latest'
  /** Solana: optional hint txHash for end of iteration. */
  endBefore?: string
  /** watch mode: polls for new logs after fetching since start (required), until endBlock finality tag
   *  (e.g. endBlock=finalized polls only finalized logs); can be a promise to cancel loop
   */
  watch?: boolean | Promise<unknown>
  /** Contract address to filter logs by. */
  address?: string
  /** Topics to filter logs by. */
  topics?: (string | string[] | null)[]
  /** Page size for pagination. */
  page?: number
}

/**
 * Token metadata information.
 */
export type TokenInfo = {
  /** Token symbol (e.g., "LINK"). */
  readonly symbol: string
  /** Number of decimals for the token. */
  readonly decimals: number
  /** Optional human-readable token name. */
  readonly name?: string
}

/**
 * Options for getBalance query.
 */
export type GetBalanceOpts = {
  /** Token address. Use null/undefined for native token balance. */
  token?: string | null
  /** Holder address to query balance for. */
  holder: string
}

/**
 * Rate limiter state for token pool configurations.
 * Null if rate limiting is disabled.
 */
export type RateLimiterState = {
  /** Current token balance in the rate limiter bucket. */
  tokens: bigint
  /** Maximum capacity of the rate limiter bucket. */
  capacity: bigint
  /** Rate at which tokens are replenished. */
  rate: bigint
} | null

/**
 * Remote token pool configuration for a specific chain.
 */
export type TokenPoolRemote = {
  /** Address of the remote token on the destination chain. */
  remoteToken: string
  /** Addresses of remote token pools. */
  remotePools: string[]
  /** Inbound rate limiter state for tokens coming into this chain. */
  inboundRateLimiterState: RateLimiterState
  /** Outbound rate limiter state for tokens leaving this chain. */
  outboundRateLimiterState: RateLimiterState
}

/**
 * Maps chain family to respective unsigned transaction type.
 */
export type UnsignedTx = {
  [ChainFamily.EVM]: UnsignedEVMTx
  [ChainFamily.Solana]: UnsignedSolanaTx
  [ChainFamily.Aptos]: UnsignedAptosTx
  [ChainFamily.TON]: UnsignedTONTx
  [ChainFamily.Sui]: never // TODO
  [ChainFamily.Unknown]: never
}

/**
 * Common options for {@link Chain.getFee}, {@link Chain.generateUnsignedSendMessage} and {@link Chain.sendMessage} methods.
 */
export type SendMessageOpts = {
  /** Router address on this chain */
  router: string
  /** Destination network selector. */
  destChainSelector: bigint
  /** Message to send. If `fee` is omitted, it'll be calculated */
  message: MessageInput
  /** Approve the maximum amount of tokens to transfer */
  approveMax?: boolean
}

/**
 * Common options for {@link Chain.generateUnsignedExecuteReport} and {@link Chain.executeReport} methods.
 */
export type ExecuteReportOpts = {
  /** address of the OffRamp contract */
  offRamp: string
  /** execution report */
  execReport: ExecutionReport
  /** gasLimit or computeUnits limit override for the ccipReceive call */
  gasLimit?: number
  /** For EVM, overrides gasLimit on tokenPool call */
  tokensGasLimit?: number
  /** For Solana, send report in chunks to OffRamp, to later execute */
  forceBuffer?: boolean
  /** For Solana, create and extend addresses in a lookup table before executing */
  forceLookupTable?: boolean
}

/**
 * Works like an interface for a base Chain class, but provides implementation (which can be
 * specialized) for some basic methods
 */
export abstract class Chain<F extends ChainFamily = ChainFamily> {
  readonly network: NetworkInfo<F>
  logger: Logger
  /** CCIP API client (null if opted out) */
  readonly apiClient: CCIPAPIClient | null
  /** Retry configuration for API fallback operations (null if API client is disabled) */
  readonly apiRetryConfig: Required<ApiRetryConfig> | null

  /**
   * Base constructor for Chain class.
   * @param network - NetworkInfo object for the Chain instance
   * @param ctx - Optional context with logger and API client configuration
   * @throws {@link CCIPChainFamilyMismatchError} if network family doesn't match the Chain subclass
   */
  constructor(network: NetworkInfo, ctx?: ChainContext) {
    const { logger = console, apiClient, apiRetryConfig } = ctx ?? {}

    if (network.family !== (this.constructor as ChainStatic).family)
      throw new CCIPChainFamilyMismatchError(
        this.constructor.name,
        (this.constructor as ChainStatic).family,
        network.family,
      )
    this.network = network as NetworkInfo<F>
    this.logger = logger

    // API client initialization: default enabled, null = explicit opt-out
    if (apiClient === null) {
      this.apiClient = null // Explicit opt-out
      this.apiRetryConfig = null // No retry config needed without API client
    } else if (apiClient !== undefined) {
      this.apiClient = apiClient // Use provided instance
      this.apiRetryConfig = { ...DEFAULT_API_RETRY_CONFIG, ...apiRetryConfig }
    } else {
      this.apiClient = new CCIPAPIClient(undefined, { logger }) // Default
      this.apiRetryConfig = { ...DEFAULT_API_RETRY_CONFIG, ...apiRetryConfig }
    }
  }

  /** Cleanup method to release resources (e.g., close connections). */
  destroy?(): void | Promise<void>

  /** Custom inspector for Node.js util.inspect. */
  [util.inspect.custom]() {
    return `${this.constructor.name} { ${this.network.name} }`
  }

  /**
   * Fetch the timestamp of a given block
   * @param block - positive block number, negative finality depth or 'finalized' tag
   * @returns timestamp of the block, in seconds
   * @throws {@link CCIPBlockNotFoundError} if block does not exist
   */
  abstract getBlockTimestamp(block: number | 'finalized'): Promise<number>
  /**
   * Fetch a transaction by its hash
   * @param hash - transaction hash
   * @returns generic transaction details
   * @throws {@link CCIPTransactionNotFoundError} if transaction not found
   */
  abstract getTransaction(hash: string): Promise<ChainTransaction>
  /**
   * Confirm a log tx is finalized or wait for it to be finalized.
   * @param opts - Options containing the request, finality level, and optional cancel promise
   * @returns true when the transaction is finalized
   * @throws {@link CCIPTransactionNotFinalizedError} if the transaction is not included (e.g., due to a reorg)
   */
  async waitFinalized({
    request: { log, tx },
    finality = 'finalized',
    cancel$,
  }: {
    request: SetOptional<
      PickDeep<
        CCIPRequest,
        | `log.${'address' | 'blockNumber' | 'transactionHash' | 'topics' | 'tx.timestamp'}`
        | 'tx.timestamp'
      >,
      'tx'
    >
    finality?: number | 'finalized'
    cancel$?: Promise<unknown>
  }): Promise<true> {
    const timestamp = log.tx?.timestamp ?? tx?.timestamp
    if (!timestamp || Date.now() / 1e3 - timestamp > 60) {
      // only try to fetch tx if request is old enough (>60s)
      const [trans, finalizedTs] = await Promise.all([
        this.getTransaction(log.transactionHash),
        this.getBlockTimestamp(finality),
      ])
      if (trans.timestamp <= finalizedTs) return true
    }
    for await (const l of this.getLogs({
      address: log.address,
      startBlock: log.blockNumber,
      endBlock: finality,
      topics: [log.topics[0]!],
      watch: cancel$ ?? true,
    })) {
      if (l.transactionHash === log.transactionHash) {
        return true
      } else if (l.blockNumber > log.blockNumber) {
        break
      }
    }
    throw new CCIPTransactionNotFinalizedError(log.transactionHash)
  }
  /**
   * An async generator that yields logs based on the provided options.
   * @param opts - Options object containing:
   *   - `startBlock`: if provided, fetch and generate logs forward starting from this block;
   *        otherwise, returns logs backwards in time from endBlock;
   *        optionally, startTime may be provided to fetch logs forward starting from this time
   *   - `startTime`: instead of a startBlock, a start timestamp may be provided;
   *        if either is provided, fetch logs forward from this starting point; otherwise, backwards
   *   - `endBlock`: if omitted, use latest block; can be a block number, 'latest', 'finalized' or
   *        negative finality block depth
   *   - `endBefore`: optional hint signature for end of iteration, instead of endBlock
   *   - `address`: if provided, fetch logs for this address only (may be required in some
   *     networks/implementations)
   *   - `topics`: if provided, fetch logs for these topics only;
   *     if string[], it's assumed to be a list of topic0s (i.e. string[] or string[][0], event_ids);
   *     some networks/implementations may not be able to filter topics other than topic0s, so one may
   *     want to assume those are optimization hints, instead of hard filters, and verify results
   *   - `page`: if provided, try to use this page/range for batches
   *   - `watch`: true or cancellation promise, getLogs continuously after initial fetch
   * @returns An async iterable iterator of logs.
   * @throws {@link CCIPLogsWatchRequiresFinalityError} if watch mode is used without a finality endBlock tag
   * @throws {@link CCIPLogsWatchRequiresStartError} if watch mode is used without startBlock or startTime
   * @throws {@link CCIPLogsAddressRequiredError} if address is required but not provided (chain-specific)
   */
  abstract getLogs(opts: LogFilter): AsyncIterableIterator<Log_>

  /**
   * Fetch all CCIP requests in a transaction
   * @param tx - ChainTransaction or txHash to fetch requests from
   * @returns CCIP messages in the transaction (at least one)
   * @throws {@link CCIPMessageNotFoundInTxError} if no CCIP messages found in transaction
   */
  async getMessagesInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    const txHash = typeof tx === 'string' ? tx : tx.hash
    try {
      if (typeof tx === 'string') tx = await this.getTransaction(tx)
      return getMessagesInTx(this, tx)
    } catch (err) {
      // if getTransaction or decoding fails, try API if available with retry
      // apiClient and apiRetryConfig are coupled: both exist or both are null
      if (this.apiClient && this.apiRetryConfig) {
        const apiRequests = await withRetry(
          async () => {
            const messageIds = await this.apiClient!.getMessageIdsInTx(txHash)
            if (messageIds.length === 0) {
              // Treat empty results as the original error condition
              throw err
            }
            return Promise.all(messageIds.map((id) => this.apiClient!.getMessageById(id)))
          },
          { ...this.apiRetryConfig, logger: this.logger },
        )
        if (apiRequests.length > 0) {
          return apiRequests
        }
      }
      throw err
    }
  }

  /**
   * Fetch a message by ID.
   * Default implementation uses the CCIP API.
   * Subclasses may override to fetch from chain as fallback.
   * @param messageId - message ID to fetch request for
   * @param _opts - onRamp may be required in some implementations
   * @returns CCIPRequest containing the message details
   * @throws {@link CCIPApiClientNotAvailableError} if apiClient was disabled (set to `null`)
   * @throws {@link CCIPMessageIdNotFoundError} if message not found
   * @throws {@link CCIPHttpError} if API request fails
   **/
  async getMessageById(
    messageId: string,
    _opts?: { page?: number; onRamp?: string },
  ): Promise<CCIPRequest> {
    if (!this.apiClient) throw new CCIPApiClientNotAvailableError()
    // apiClient and apiRetryConfig are coupled: both exist or neither does
    return withRetry(() => this.apiClient!.getMessageById(messageId), {
      ...this.apiRetryConfig!,
      logger: this.logger,
    })
  }

  /**
   * Fetches all CCIP messages contained in a given commit batch.
   * @param request - CCIPRequest to fetch batch for.
   * @param commit - CommitReport range (min, max).
   * @param opts - Optional parameters (e.g., `page` for pagination width).
   * @returns Array of messages in the batch.
   * @throws {@link CCIPMessageBatchIncompleteError} if not all messages in range could be fetched
   */
  abstract getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: { page?: number },
  ): Promise<R['message'][]>
  /**
   * Fetch typeAndVersion for a given CCIP contract address
   * @param address - CCIP contract address
   * @returns type - parsed type of the contract, e.g. `OnRamp`
   * @returns version - parsed version of the contract, e.g. `1.6.0`
   * @returns typeAndVersion - original (unparsed) typeAndVersion() string
   * @returns suffix - suffix of the version, if any (e.g. `-dev`)
   * @throws {@link CCIPTypeVersionInvalidError} if contract doesn't have valid typeAndVersion
   */
  abstract typeAndVersion(
    address: string,
  ): Promise<[type: string, version: string, typeAndVersion: string, suffix?: string]>

  /**
   * Fetch the Router address set in OnRamp config
   * Used to discover OffRamp connected to OnRamp
   * @param onRamp - OnRamp contract address
   * @param destChainSelector - destination chain selector
   * @returns Router address
   */
  abstract getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string>
  /**
   * Fetch the Router address set in OffRamp config
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - source chain selector
   * @returns Router address
   */
  abstract getRouterForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string>
  /**
   * Get the native token address for a Router
   * @param router - router contract address
   * @returns native token address (usually wrapped)
   */
  abstract getNativeTokenForRouter(router: string): Promise<string>
  /**
   * Fetch the OffRamps allowlisted in a Router
   * Used to discover OffRamp connected to an OnRamp
   * @param router - Router contract address
   * @param sourceChainSelector - source chain selector
   * @returns array of OffRamp addresses
   */
  abstract getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]>
  /**
   * Fetch the OnRamp registered in a Router for a destination chain
   * @param router - Router contract address
   * @param destChainSelector - destination chain selector
   * @returns OnRamp addresses
   */
  abstract getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string>
  /**
   * Fetch the OnRamp address set in OffRamp config
   * Used to discover OffRamp connected to an OnRamp
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - source chain selector
   * @returns OnRamp address
   */
  abstract getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string>
  /**
   * Fetch the CommitStore set in OffRamp config (CCIP v1.5 and earlier).
   * For CCIP v1.6 and later, it should return the offRamp address.
   * @param offRamp - OffRamp contract address.
   * @returns CommitStore address.
   */
  abstract getCommitStoreForOffRamp(offRamp: string): Promise<string>
  /**
   * Fetch the TokenPool's token/mint
   * @param tokenPool - TokenPool address
   * @returns Token or mint address
   */
  abstract getTokenForTokenPool(tokenPool: string): Promise<string>
  /**
   * Fetch token metadata
   * @param token - Token address
   * @returns Token symbol and decimals, and optionally name
   */
  abstract getTokenInfo(token: string): Promise<TokenInfo>
  /**
   * Query token balance for an address.
   *
   * @param opts - Balance query options
   * @returns Token balance information including raw and formatted values
   * @throws {@link CCIPNotImplementedError} if chain family doesn't support this method
   *
   * @example Query native token balance
   * ```typescript
   * const balance = await chain.getBalance({ address: '0x123...' })
   * console.log(`Native balance: ${balance}`) // balance in wei
   * ```
   *
   * @example Query ERC20 token balance
   * ```typescript
   * const balance = await chain.getBalance({
   *   address: '0x123...',
   *   token: '0xLINK...'
   * })
   * console.log(`LINK balance: ${balance}`) // balance in smallest units
   * ```
   */
  abstract getBalance(opts: GetBalanceOpts): Promise<bigint>
  /**
   * Fetch TokenAdminRegistry configured in a given OnRamp, Router, etc
   * Needed to map a source token to its dest counterparts
   * @param address - Some contract for which we can fetch a TokenAdminRegistry (OnRamp, Router, etc.)
   * @returns TokenAdminRegistry address
   */
  abstract getTokenAdminRegistryFor(address: string): Promise<string>
  /**
   * Fetch the current fee for a given intended message
   * @param opts - {@link SendMessageOpts} without approveMax
   * @returns Fee amount in the feeToken's smallest units
   */
  abstract getFee(opts: Omit<SendMessageOpts, 'approveMax'>): Promise<bigint>
  /**
   * Generate unsigned txs for ccipSend'ing a message
   * @param opts - {@link SendMessageOpts} with sender address
   * @returns chain-family specific unsigned txs
   */
  abstract generateUnsignedSendMessage(
    opts: SendMessageOpts & {
      /** Sender address (address of wallet which will send the message) */
      sender: string
    },
  ): Promise<UnsignedTx[F]>
  /**
   * Send a CCIP message through a router using provided wallet.
   * @param opts - {@link SendMessageOpts} with chain-specific wallet for signing
   * @returns CCIP request
   * @throws {@link CCIPWalletNotSignerError} if wallet cannot sign transactions
   *
   * @example
   * ```typescript
   * const request = await chain.sendMessage({
   *   router: '0x...',
   *   destChainSelector: 4949039107694359620n,
   *   message: {
   *     receiver: '0x...',
   *     data: '0x1337',
   *     tokenAmounts: [{ token: '0x...', amount: 100n }],
   *     feeToken: '0xLinkToken',
   *   },
   *   wallet: signer,
   * })
   * console.log(`Message ID: ${request.message.messageId}`)
   * ```
   */
  abstract sendMessage(
    opts: SendMessageOpts & {
      /** Signer instance (chain-dependent) */
      wallet: unknown
    },
  ): Promise<CCIPRequest>
  /**
   * Fetch supported offchain token data for a request from this network
   * @param request - CCIP request, with tx, logs and message
   * @returns array with one offchain token data for each token transfer in request
   */
  abstract getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]>
  /**
   * Generate unsigned tx to manuallyExecute a message
   * @param opts - {@link ExecuteReportOpts} with payer address which will send the exec tx
   * @returns chain-family specific unsigned txs
   */
  abstract generateUnsignedExecuteReport(
    opts: ExecuteReportOpts & {
      /** address which will be used to send the report tx */
      payer: string
    },
  ): Promise<UnsignedTx[F]>
  /**
   * Execute messages in report in an offRamp
   * @param opts - {@link ExecuteReportOpts} with chain-specific wallet to sign and send tx
   * @returns transaction of the execution
   *
   * @example
   * ```typescript
   * const execReportProof = calculateManualExecProof(
   *   messagesInBatch: await source.getMessagesInBatch(request, commit.report),
   *   request.lane,
   *   request.message.messageId,
   *   commit.report.merkleRoot,
   *   dest,
   * )
   * const receipt = await dest.executeReport({
   *   offRamp,
   *   execReport: {
   *     ...execReportProof,
   *     message: request.message,
   *     offchainTokenData: await source.getOffchainTokenData(request),
   *   },
   *   wallet,
   * })
   * console.log(`Message ID: ${request.message.messageId}`)
   * ```
   * @throws {@link CCIPWalletNotSignerError} if wallet cannot sign transactions
   * @throws {@link CCIPExecTxNotConfirmedError} if execution transaction fails to confirm
   */
  abstract executeReport(
    opts: ExecuteReportOpts & {
      // Signer instance (chain-dependent)
      wallet: unknown
    },
  ): Promise<CCIPExecution>

  /**
   * Look for a CommitReport at dest for given CCIP request
   * May be specialized by some subclasses
   * @param opts - getCommitReport options
   * @returns CCIPCommit info
   * @throws {@link CCIPCommitNotFoundError} if no commit found for the request
   */
  async getCommitReport({
    commitStore,
    request,
    ...hints
  }: {
    /** address of commitStore (OffRamp in \>=v1.6) */
    commitStore: string
    /** CCIPRequest subset object */
    request: PickDeep<CCIPRequest, 'lane' | 'message.sequenceNumber' | 'tx.timestamp'>
  } & Pick<LogFilter, 'page' | 'watch' | 'startBlock'>): Promise<CCIPCommit> {
    return getCommitReport(this, commitStore, request, hints)
  }

  /**
   * Fetches estimated lane latency to a destination chain.
   * Uses this chain's selector as the source.
   *
   * @param destChainSelector - Destination CCIP chain selector (bigint)
   * @returns Promise resolving to {@link LaneLatencyResponse} containing:
   *   - `lane.sourceNetworkInfo` - Source chain metadata (name, selector, chainId)
   *   - `lane.destNetworkInfo` - Destination chain metadata
   *   - `lane.routerAddress` - Router contract address on source chain
   *   - `totalMs` - Estimated delivery time in milliseconds
   *
   * @throws {@link CCIPApiClientNotAvailableError} if apiClient was disabled (set to `null`)
   * @throws {@link CCIPHttpError} if API request fails (network error, 4xx, 5xx status)
   *
   * @remarks
   * Each call makes a fresh API request. Consider caching results if making
   * frequent calls for the same lane.
   *
   * @example Get estimated delivery time
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
   * try {
   *   const latency = await chain.getLaneLatency(4949039107694359620n) // Arbitrum
   *   console.log(`Estimated delivery: ${Math.round(latency.totalMs / 60000)} minutes`)
   *   console.log(`Router: ${latency.lane.routerAddress}`)
   * } catch (err) {
   *   if (err instanceof CCIPHttpError) {
   *     console.error(`API error: ${err.context.apiErrorCode}`)
   *   }
   * }
   * ```
   */
  async getLaneLatency(destChainSelector: bigint): Promise<LaneLatencyResponse> {
    if (!this.apiClient) {
      throw new CCIPApiClientNotAvailableError()
    }
    return this.apiClient.getLaneLatency(this.network.chainSelector, destChainSelector)
  }

  /**
   * Fetches lane information including OnRamp address and CCIP version for a destination chain.
   * Uses API to discover router address, then on-chain calls to get OnRamp and version.
   *
   * @param destChainSelector - Destination CCIP chain selector (bigint)
   * @param opts - Optional parameters:
   *   - `router`: Router address (if provided, skips API call)
   * @returns Promise resolving to {@link Lane} with onRamp address and version
   *
   * @throws {@link CCIPApiClientNotAvailableError} if apiClient was disabled and no router provided
   * @throws {@link CCIPLaneNotFoundError} if lane not found via API
   * @throws {@link CCIPHttpError} if API request fails
   *
   * @example Get lane info using API to discover router
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
   * const lane = await chain.getLane(4949039107694359620n) // Arbitrum
   * console.log(`OnRamp: ${lane.onRamp}`)
   * console.log(`Version: ${lane.version}`)
   * ```
   *
   * @example Get lane info with known router (no API needed)
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com', { apiClient: null })
   * const lane = await chain.getLane(4949039107694359620n, { router: '0x80226fc0Ee2b...' })
   * console.log(`Version: ${lane.version}`)
   * ```
   */
  async getLane(destChainSelector: bigint, opts?: { router?: string }): Promise<Lane> {
    let router = opts?.router

    // If router not provided, get it from API
    if (!router) {
      if (!this.apiClient) {
        throw new CCIPApiClientNotAvailableError()
      }
      const laneInfo: LaneInfoResponse = await this.apiClient.getLaneInfo(
        this.network.chainSelector,
        destChainSelector,
      )
      router = laneInfo.routerAddress
    }

    // Get OnRamp from Router
    const onRamp = await this.getOnRampForRouter(router, destChainSelector)

    // Get version from OnRamp
    const [, version] = await this.typeAndVersion(onRamp)

    return {
      sourceChainSelector: this.network.chainSelector,
      destChainSelector,
      onRamp,
      version: version as CCIPVersion,
    }
  }

  /**
   * Default/generic implementation of getExecutionReceipts
   * @param opts - getExecutionReceipts options
   * @returns Async generator of CCIPExecution receipts
   */
  async *getExecutionReceipts({
    offRamp,
    messageId,
    sourceChainSelector,
    commit,
    ...hints
  }: {
    /** address of OffRamp contract */
    offRamp: string
    /** filter: yield only executions for this message */
    messageId?: string
    /** filter: yield only executions for this source chain */
    sourceChainSelector?: bigint
    /** optional commit associated with the request, can be used for optimizations in some families */
    commit?: CCIPCommit
  } & Pick<
    LogFilter,
    'page' | 'watch' | 'startBlock' | 'startTime'
  >): AsyncIterableIterator<CCIPExecution> {
    hints.startBlock ??= commit?.log.blockNumber
    const onlyLast = !hints.startTime && !hints.startBlock // backwards
    for await (const log of this.getLogs({
      address: offRamp,
      topics: ['ExecutionStateChanged'],
      ...hints,
    })) {
      const receipt = (this.constructor as ChainStatic).decodeReceipt(log)
      // filters
      if (
        !receipt ||
        (messageId && receipt.messageId !== messageId) ||
        (sourceChainSelector &&
          receipt.sourceChainSelector &&
          receipt.sourceChainSelector !== sourceChainSelector)
      )
        continue

      const timestamp = log.tx?.timestamp ?? (await this.getBlockTimestamp(log.blockNumber))
      yield { receipt, log, timestamp }
      if (onlyLast || receipt.state === ExecutionState.Success) break
    }
  }

  /**
   * Fetch first execution receipt inside a transaction.
   * @internal
   * @param tx - transaction hash or transaction object
   * @returns CCIP execution object
   * @throws {@link CCIPExecTxRevertedError} if no execution receipt found in transaction
   */
  async getExecutionReceiptInTx(tx: string | ChainTransaction): Promise<CCIPExecution> {
    if (typeof tx === 'string') tx = await this.getTransaction(tx)
    for (const log of tx.logs) {
      const rcpt = (this.constructor as ChainStatic).decodeReceipt(log)
      if (!rcpt) continue

      const timestamp = tx.timestamp
      return { receipt: rcpt, log, timestamp }
    }
    throw new CCIPExecTxRevertedError(tx.hash)
  }

  /**
   * List tokens supported by given TokenAdminRegistry contract.
   * @param address - Usually TokenAdminRegistry, but chain may support receiving Router, OnRamp, etc.
   * @param opts - Optional parameters (e.g., `page` for pagination range).
   * @returns Array of supported token addresses.
   */
  abstract getSupportedTokens(address: string, opts?: { page?: number }): Promise<string[]>

  /**
   * Get TokenConfig for a given token address in a TokenAdminRegistry
   * @param registry - TokenAdminRegistry contract address
   * @param token - Token address
   * @returns Token configuration including administrator and optional tokenPool
   * @throws {@link CCIPTokenNotInRegistryError} if token not found in registry
   */
  abstract getRegistryTokenConfig(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }>

  /**
   * Get TokenPool state and configurations
   * @param tokenPool - Token pool address
   * @returns Token pool configuration including token address, router, and optional typeAndVersion
   */
  abstract getTokenPoolConfigs(tokenPool: string): Promise<{
    token: string
    router: string
    typeAndVersion?: string
  }>

  /**
   * Get TokenPool remote configurations.
   * @param tokenPool - Token pool address.
   * @param remoteChainSelector - If provided, only return remotes for the specified chain (may error if remote not supported).
   * @returns Record of network names and remote configurations (remoteToken, remotePools, rateLimitStates).
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if remoteChainSelector is specified but not configured
   */
  abstract getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>>

  /**
   * Fetch list and info of supported feeTokens.
   * @param router - Router address on this chain.
   * @returns Mapping of token addresses to respective TokenInfo objects.
   */
  abstract getFeeTokens(router: string): Promise<Record<string, TokenInfo>>

  /** {@inheritDoc ChainStatic.buildMessageForThisDest} */
  static buildMessageForThisDest(
    message: Parameters<ChainStatic['buildMessageForThisDest']>[0],
    laneVersion?: CCIPVersion,
  ): AnyMessage {
    // Store as unused variable for now (will be used later for ExtraArgs selection)
    void laneVersion

    // default to GenericExtraArgsV2, aka EVMExtraArgsV2
    return {
      ...message,
      extraArgs: {
        gasLimit: message.data && dataLength(message.data) ? DEFAULT_GAS_LIMIT : 0n,
        allowOutOfOrderExecution: true,
        ...message.extraArgs,
      },
    }
  }

  /**
   * Estimate `ccipReceive` execution cost (gas, computeUnits) for this *dest*
   * @param opts - estimation options
   * @returns estimated execution cost (gas or computeUnits)
   */
  estimateReceiveExecution?(opts: {
    offRamp: string
    receiver: string
    message: {
      sourceChainSelector: bigint
      messageId: string
      sender?: string
      data?: BytesLike
      destTokenAmounts?: readonly {
        token: string
        amount: bigint
      }[]
    }
  }): Promise<number>
}

/** Static methods and properties available on Chain class constructors. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type ChainStatic<F extends ChainFamily = ChainFamily> = Function & {
  readonly family: F
  readonly decimals: number
  /**
   * async constructor: builds a Chain from a rpc endpoint url
   * @param url - rpc endpoint url
   * @param ctx - optional context with logger and API client configuration
   */
  fromUrl(url: string, ctx?: ChainContext): Promise<Chain<F>>
  /**
   * Try to decode a CCIP message *from* a log/event *originated* from this *source* chain,
   * but which may *target* other dest chain families
   * iow: the parsing is specific to this chain family, but content may be intended to alien chains
   * e.g: EVM-born (abi.encoded) bytearray may output message.computeUnits for Solana
   * @param log - Chain generic log
   * @returns decoded CCIP message with merged extraArgs
   */
  decodeMessage(log: Pick<Log_, 'data'>): CCIPMessage | undefined
  /**
   * Try to decode an extraArgs array serialized for this chain family
   * @param extraArgs - extra args bytes (Uint8Array, HexString or base64)
   * @returns object containing decoded extraArgs and their tags
   */
  decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
    | undefined
  encodeExtraArgs(extraArgs: ExtraArgs): string
  /**
   * Decode a commit (CommitReportAccepted) event
   * @param log - Chain generic log
   * @param lane - if passed, filter or validate reports by lane
   * @returns Array of commit reports contained in the log
   */
  decodeCommits(log: Pick<Log_, 'data'>, lane?: Lane): CommitReport[] | undefined
  /**
   * Decode a receipt (ExecutionStateChanged) event
   * @param log - Chain generic log
   * @returns ExecutionReceipt or undefined if not a recognized receipt
   */
  decodeReceipt(log: Pick<Log_, 'data'>): ExecutionReceipt | undefined
  /**
   * Receive a bytes array and try to decode and normalize it as an address of this chain family
   * @param bytes - Bytes array (Uint8Array, HexString or Base64)
   * @returns Address in this chain family's format
   */
  getAddress(bytes: BytesLike): string
  /**
   * Validates a transaction hash format for this chain family
   */
  isTxHash(v: unknown): v is string
  /**
   * Format an address for human-friendly display.
   * Defaults to getAddress if not overridden.
   * @param address - Address string in any recognized format
   * @returns Human-friendly address string for display
   */
  formatAddress?(address: string): string
  /**
   * Format a transaction hash for human-friendly display.
   * @param hash - Transaction hash string
   * @returns Human-friendly hash string for display
   */
  formatTxHash?(hash: string): string
  /**
   * Create a leaf hasher for this dest chain and lane
   * @param lane - source, dest and onramp lane info
   * @param ctx - context object containing logger
   * @returns LeafHasher is a function that takes a message and returns a hash of it
   */
  getDestLeafHasher(lane: Lane, ctx?: WithLogger): LeafHasher
  /**
   * Try to parse an error or bytearray generated by this chain family
   * @param data - Caught object, string or bytearray
   * @returns Ordered record with messages/properties, or undefined if not a recognized error
   */
  parse?(data: unknown): Record<string, unknown> | undefined | null
  /**
   * Returns a copy of a message, populating missing fields like `extraArgs` with defaults
   * It's expected to return a message suitable at least for basic token transfers
   * @param message - AnyMessage (from source), containing at least `receiver`
   * @param laneVersion - optional lane version for selecting appropriate ExtraArgs type
   * @returns A message suitable for `sendMessage` to this destination chain family
   */
  buildMessageForThisDest(message: MessageInput, laneVersion?: CCIPVersion): AnyMessage
}

/** Function type for getting a Chain instance by ID, selector, or name. */
export type ChainGetter = (idOrSelectorOrName: number | string | bigint) => Promise<Chain>
