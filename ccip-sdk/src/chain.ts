import { type BytesLike, dataLength } from 'ethers'
import type { PickDeep, SetOptional } from 'type-fest'

import { type LaneLatencyResponse, CCIPAPIClient } from './api/index.ts'
import type { UnsignedAptosTx } from './aptos/types.ts'
import { getCommitReport } from './commits.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPChainFamilyMismatchError,
  CCIPExecTxRevertedError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTransactionNotFinalizedError,
} from './errors/index.ts'
import { DEFAULT_GAS_LIMIT } from './evm/const.ts'
import type { UnsignedEVMTx } from './evm/types.ts'
import type {
  EVMExtraArgsV1,
  EVMExtraArgsV2,
  ExtraArgs,
  GenericExtraArgsV3,
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
import { networkInfo, util, withRetry } from './utils.ts'

/** Field names unique to GenericExtraArgsV3 (not present in V2). */
const V3_ONLY_FIELDS = [
  'blockConfirmations',
  'ccvs',
  'ccvArgs',
  'executor',
  'executorArgs',
  'tokenReceiver',
  'tokenArgs',
] as const

/** Check if extraArgs contains any V3-only fields. */
function hasV3ExtraArgs(extraArgs: Partial<ExtraArgs> | undefined): boolean {
  if (!extraArgs) return false
  return V3_ONLY_FIELDS.some((field) => field in extraArgs)
}

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
 *
 * @remarks
 * - Returns the rate limiter bucket state when rate limiting is **enabled**
 * - Returns `null` when rate limiting is **disabled** (unlimited throughput)
 *
 * @example Handling nullable state
 * ```typescript
 * const remote = await chain.getTokenPoolRemotes(poolAddress)
 * const state = remote['ethereum-mainnet'].inboundRateLimiterState
 *
 * if (state === null) {
 *   console.log('Rate limiting disabled - unlimited throughput')
 * } else {
 *   console.log(`Capacity: ${state.capacity}, Available: ${state.tokens}`)
 * }
 * ```
 */
export type RateLimiterState = {
  /** Current token balance in the rate limiter bucket. */
  tokens: bigint
  /** Maximum capacity of the rate limiter bucket. */
  capacity: bigint
  /** Rate at which tokens are replenished (tokens per second). */
  rate: bigint
} | null

/**
 * Remote token pool configuration for a specific destination chain.
 *
 * @remarks
 * Each entry represents the configuration needed to transfer tokens
 * from the current chain to a specific destination chain.
 */
export type TokenPoolRemote = {
  /** Address of the remote token on the destination chain. */
  remoteToken: string
  /**
   * Addresses of remote token pools on the destination chain.
   *
   * @remarks
   * Multiple pools may exist for:
   * - Redundancy (failover if one pool is unavailable)
   * - Capacity aggregation across pools
   * - Version management (different pool implementations)
   */
  remotePools: string[]
  /** Inbound rate limiter state for tokens coming into this chain. */
  inboundRateLimiterState: RateLimiterState
  /** Outbound rate limiter state for tokens leaving this chain. */
  outboundRateLimiterState: RateLimiterState
}

/**
 * Token pool configuration returned by {@link Chain.getTokenPoolConfig}.
 *
 * @remarks
 * Contains the core configuration of a token pool including the token it manages,
 * the router it's registered with, and optionally its version identifier.
 */
export type TokenPoolConfig = {
  /** Address of the token managed by this pool. */
  token: string
  /** Address of the CCIP router this pool is registered with. */
  router: string
  /**
   * Version identifier string (e.g., "BurnMintTokenPool 1.5.1").
   *
   * @remarks
   * May be undefined for older pool implementations that don't expose this method.
   */
  typeAndVersion?: string
}

/**
 * Token configuration from a TokenAdminRegistry, returned by {@link Chain.getRegistryTokenConfig}.
 *
 * @remarks
 * The TokenAdminRegistry tracks which administrator controls each token
 * and which pool is authorized to handle transfers.
 */
export type RegistryTokenConfig = {
  /** Address of the current administrator for this token. */
  administrator: string
  /** Address of pending administrator (if ownership transfer is in progress). */
  pendingAdministrator?: string
  /** Address of the token pool authorized to handle this token's transfers. */
  tokenPool?: string
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
   * Fetch the timestamp of a given block.
   *
   * @param block - Positive block number, negative finality depth, or 'finalized' tag
   * @returns Promise resolving to timestamp of the block, in seconds
   *
   * @throws {@link CCIPBlockNotFoundError} if block does not exist
   *
   * @example Get finalized block timestamp
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
   * const timestamp = await chain.getBlockTimestamp('finalized')
   * console.log(`Finalized at: ${new Date(timestamp * 1000).toISOString()}`)
   * ```
   */
  abstract getBlockTimestamp(block: number | 'finalized'): Promise<number>
  /**
   * Fetch a transaction by its hash.
   *
   * @param hash - Transaction hash
   * @returns Promise resolving to generic transaction details
   *
   * @throws {@link CCIPTransactionNotFoundError} if transaction does not exist (transient)
   *
   * @example Fetch transaction details
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
   * try {
   *   const tx = await chain.getTransaction('0xabc123...')
   *   console.log(`Block: ${tx.blockNumber}, Timestamp: ${tx.timestamp}`)
   * } catch (err) {
   *   if (err instanceof CCIPTransactionNotFoundError && err.isTransient) {
   *     // Transaction may be pending
   *   }
   * }
   * ```
   */
  abstract getTransaction(hash: string): Promise<ChainTransaction>
  /**
   * Confirm a log tx is finalized or wait for it to be finalized.
   *
   * @param opts - Options containing the request, finality level, and optional cancel promise
   * @returns true when the transaction is finalized
   *
   * @throws {@link CCIPTransactionNotFinalizedError} if the transaction is not included (e.g., due to a reorg)
   *
   * @example Wait for message finality
   * ```typescript
   * const request = await source.getMessagesInTx(txHash)
   * try {
   *   await source.waitFinalized({ request: request[0] })
   *   console.log('Transaction finalized')
   * } catch (err) {
   *   if (err instanceof CCIPTransactionNotFinalizedError) {
   *     console.log('Transaction not yet finalized')
   *   }
   * }
   * ```
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
   * Fetch all CCIP requests in a transaction.
   *
   * @param tx - ChainTransaction or txHash to fetch requests from
   * @returns Promise resolving to CCIP messages in the transaction (at least one)
   *
   * @throws {@link CCIPTransactionNotFoundError} if transaction does not exist
   * @throws {@link CCIPMessageNotFoundInTxError} if no CCIPSendRequested events in tx
   *
   * @example Get messages from transaction
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
   * const requests = await chain.getMessagesInTx('0xabc123...')
   * for (const req of requests) {
   *   console.log(`Message ID: ${req.message.messageId}`)
   * }
   * ```
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
   * Fetch a CCIP message by its unique message ID.
   *
   * @remarks
   * Uses the CCIP API to retrieve message details. The returned request includes
   * a `metadata` field with API-specific information.
   *
   * @example
   * ```typescript
   * const request = await chain.getMessageById(messageId)
   * console.log(`Sender: ${request.message.sender}`)
   *
   * if (request.metadata) {
   *   console.log(`Status: ${request.metadata.status}`)
   *   if (request.metadata.deliveryTime) {
   *     console.log(`Delivered in ${request.metadata.deliveryTime}ms`)
   *   }
   * }
   * ```
   *
   * @param messageId - The unique message ID (0x + 64 hex chars)
   * @param _opts - Optional: `onRamp` hint for non-EVM chains
   * @returns CCIPRequest with `metadata` populated from API
   * @throws {@link CCIPApiClientNotAvailableError} if API disabled
   * @throws {@link CCIPMessageIdNotFoundError} if message not found
   * @throws {@link CCIPOnRampRequiredError} if onRamp is required but not provided
   * @throws {@link CCIPHttpError} if API request fails
   */
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
   *
   * @param request - CCIPRequest to fetch batch for
   * @param commit - CommitReport range (min, max)
   * @param opts - Optional parameters (e.g., `page` for pagination width)
   * @returns Array of messages in the batch
   *
   * @throws {@link CCIPMessageBatchIncompleteError} if not all messages in range could be fetched
   *
   * @example Get all messages in a batch
   * ```typescript
   * const commit = await dest.getCommitReport({ commitStore, request })
   * const messages = await source.getMessagesInBatch(request, commit.report)
   * console.log(`Found ${messages.length} messages in batch`)
   * ```
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
   * Fetch typeAndVersion for a given CCIP contract address.
   *
   * @param address - CCIP contract address
   * @returns Promise resolving to tuple:
   *   - `type` - Parsed type of the contract, e.g. `OnRamp`
   *   - `version` - Parsed version of the contract, e.g. `1.6.0`
   *   - `typeAndVersion` - Original (unparsed) typeAndVersion() string
   *   - `suffix` - Suffix of the version, if any (e.g. `-dev`)
   *
   * @throws {@link CCIPTypeVersionInvalidError} if typeAndVersion string cannot be parsed
   *
   * @example Check contract version
   * ```typescript
   * const [type, version] = await chain.typeAndVersion(contractAddress)
   * console.log(`Contract: ${type} v${version}`)
   * if (version < '1.6.0') {
   *   console.log('Legacy contract detected')
   * }
   * ```
   */
  abstract typeAndVersion(
    address: string,
  ): Promise<[type: string, version: string, typeAndVersion: string, suffix?: string]>

  /**
   * Fetch the Router address set in OnRamp config.
   * Used to discover OffRamp connected to OnRamp.
   *
   * @param onRamp - OnRamp contract address
   * @param destChainSelector - Destination chain selector
   * @returns Promise resolving to Router address
   *
   * @throws {@link CCIPContractTypeInvalidError} if address is not an OnRamp
   *
   * @example Get router from onRamp
   * ```typescript
   * const router = await chain.getRouterForOnRamp(onRampAddress, destSelector)
   * console.log(`Router: ${router}`)
   * ```
   */
  abstract getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string>
  /**
   * Fetch the Router address set in OffRamp config.
   *
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - Source chain selector
   * @returns Promise resolving to Router address
   *
   * @throws {@link CCIPContractTypeInvalidError} if address is not an OffRamp
   *
   * @example Get router from offRamp
   * ```typescript
   * const router = await chain.getRouterForOffRamp(offRampAddress, sourceSelector)
   * console.log(`Router: ${router}`)
   * ```
   */
  abstract getRouterForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string>
  /**
   * Get the native token address for a Router.
   *
   * @param router - Router contract address
   * @returns Promise resolving to native token address (usually wrapped)
   *
   * @example Get wrapped native token
   * ```typescript
   * const weth = await chain.getNativeTokenForRouter(routerAddress)
   * console.log(`Wrapped native: ${weth}`)
   * ```
   */
  abstract getNativeTokenForRouter(router: string): Promise<string>
  /**
   * Fetch the OffRamps allowlisted in a Router.
   * Used to discover OffRamp connected to an OnRamp.
   *
   * @param router - Router contract address
   * @param sourceChainSelector - Source chain selector
   * @returns Promise resolving to array of OffRamp addresses
   *
   * @example Get offRamps for a source chain
   * ```typescript
   * const offRamps = await dest.getOffRampsForRouter(routerAddress, sourceSelector)
   * console.log(`Found ${offRamps.length} offRamp(s)`)
   * ```
   */
  abstract getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]>
  /**
   * Fetch the OnRamp registered in a Router for a destination chain.
   *
   * @param router - Router contract address
   * @param destChainSelector - Destination chain selector
   * @returns Promise resolving to OnRamp address
   *
   * @throws {@link CCIPLaneNotFoundError} if no lane exists to destination
   *
   * @example Get onRamp for destination
   * ```typescript
   * const onRamp = await source.getOnRampForRouter(routerAddress, destSelector)
   * console.log(`OnRamp: ${onRamp}`)
   * ```
   */
  abstract getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string>
  /**
   * Fetch the OnRamp address set in OffRamp config.
   * Used to discover OffRamp connected to an OnRamp.
   *
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - Source chain selector
   * @returns Promise resolving to OnRamp address
   *
   * @example Get onRamp from offRamp config
   * ```typescript
   * const onRamp = await dest.getOnRampForOffRamp(offRampAddress, sourceSelector)
   * console.log(`OnRamp: ${onRamp}`)
   * ```
   */
  abstract getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string>
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
   */
  abstract getCommitStoreForOffRamp(offRamp: string): Promise<string>
  /**
   * Fetch the TokenPool's token/mint.
   *
   * @param tokenPool - TokenPool address
   * @returns Promise resolving to token or mint address
   *
   * @example Get token for pool
   * ```typescript
   * const token = await chain.getTokenForTokenPool(tokenPoolAddress)
   * console.log(`Token: ${token}`)
   * ```
   */
  abstract getTokenForTokenPool(tokenPool: string): Promise<string>
  /**
   * Fetch token metadata.
   *
   * @param token - Token address
   * @returns Promise resolving to token symbol, decimals, and optionally name
   *
   * @example Get token info
   * ```typescript
   * const info = await chain.getTokenInfo(tokenAddress)
   * console.log(`${info.symbol}: ${info.decimals} decimals`)
   * ```
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
   * const balance = await chain.getBalance({ holder: '0x123...' })
   * console.log(`Native balance: ${balance}`) // balance in wei
   * ```
   *
   * @example Query ERC20 token balance
   * ```typescript
   * const balance = await chain.getBalance({
   *   holder: '0x123...',
   *   token: '0xLINK...'
   * })
   * console.log(`LINK balance: ${balance}`) // balance in smallest units
   * ```
   */
  abstract getBalance(opts: GetBalanceOpts): Promise<bigint>
  /**
   * Fetch TokenAdminRegistry configured in a given OnRamp, Router, etc.
   * Needed to map a source token to its dest counterparts.
   *
   * @param address - Contract address (OnRamp, Router, etc.)
   * @returns Promise resolving to TokenAdminRegistry address
   *
   * @example Get token registry
   * ```typescript
   * const registry = await chain.getTokenAdminRegistryFor(onRampAddress)
   * console.log(`Registry: ${registry}`)
   * ```
   */
  abstract getTokenAdminRegistryFor(address: string): Promise<string>
  /**
   * Fetch the current fee for a given intended message.
   *
   * @param opts - {@link SendMessageOpts} without approveMax
   * @returns Fee amount in the feeToken's smallest units
   *
   * @example Calculate message fee
   * ```typescript
   * const fee = await chain.getFee({
   *   router: routerAddress,
   *   destChainSelector: destSelector,
   *   message: { receiver: '0x...', data: '0x' },
   * })
   * console.log(`Fee: ${fee} wei`)
   * ```
   */
  abstract getFee(opts: Omit<SendMessageOpts, 'approveMax'>): Promise<bigint>
  /**
   * Generate unsigned txs for ccipSend'ing a message.
   *
   * @param opts - {@link SendMessageOpts} with sender address
   * @returns Promise resolving to chain-family specific unsigned txs
   *
   * @example Generate unsigned transaction
   * ```typescript
   * const unsignedTx = await chain.generateUnsignedSendMessage({
   *   router: routerAddress,
   *   destChainSelector: destSelector,
   *   message: { receiver: '0x...', data: '0x1337' },
   *   sender: walletAddress,
   * })
   * // Sign and send with external wallet
   * ```
   */
  abstract generateUnsignedSendMessage(
    opts: SendMessageOpts & {
      /** Sender address (address of wallet which will send the message) */
      sender: string
    },
  ): Promise<UnsignedTx[F]>
  /**
   * Send a CCIP message through a router using provided wallet.
   *
   * @param opts - {@link SendMessageOpts} with chain-specific wallet for signing
   * @returns Promise resolving to CCIP request with message details
   *
   * @throws {@link CCIPWalletNotSignerError} if wallet is not a valid signer
   * @throws {@link CCIPLaneNotFoundError} if no lane exists to destination
   *
   * @example Send cross-chain message
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
   * Fetch supported offchain token data for a request from this network.
   *
   * @param request - CCIP request, with tx, logs and message
   * @returns Promise resolving to array with one offchain token data for each token transfer
   *
   * @throws {@link CCIPUsdcAttestationError} if USDC attestation fetch fails (transient)
   * @throws {@link CCIPLbtcAttestationError} if LBTC attestation fetch fails (transient)
   *
   * @example Get offchain token data for USDC transfer
   * ```typescript
   * const offchainData = await source.getOffchainTokenData(request)
   * // Use in execution report
   * ```
   */
  abstract getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]>
  /**
   * Generate unsigned tx to manuallyExecute a message.
   *
   * @param opts - {@link ExecuteReportOpts} with payer address which will send the exec tx
   * @returns Promise resolving to chain-family specific unsigned txs
   *
   * @example Generate unsigned execution tx
   * ```typescript
   * const unsignedTx = await dest.generateUnsignedExecuteReport({
   *   offRamp: offRampAddress,
   *   execReport,
   *   payer: walletAddress,
   * })
   * // Sign and send with external wallet
   * ```
   */
  abstract generateUnsignedExecuteReport(
    opts: ExecuteReportOpts & {
      /** address which will be used to send the report tx */
      payer: string
    },
  ): Promise<UnsignedTx[F]>
  /**
   * Execute messages in report in an offRamp.
   *
   * @param opts - {@link ExecuteReportOpts} with chain-specific wallet to sign and send tx
   * @returns Promise resolving to transaction of the execution
   *
   * @throws {@link CCIPWalletNotSignerError} if wallet is not a valid signer
   * @throws {@link CCIPExecTxRevertedError} if execution transaction reverts
   * @throws {@link CCIPMerkleRootMismatchError} if merkle proof is invalid
   *
   * @example Manual execution of pending message
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
   * console.log(`Executed: ${receipt.log.transactionHash}`)
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
   * Look for a CommitReport at dest for given CCIP request.
   * May be specialized by some subclasses.
   *
   * @param opts - getCommitReport options
   * @returns CCIPCommit info
   *
   * @throws {@link CCIPCommitNotFoundError} if no commit found for the request (transient)
   *
   * @example Get commit for a request
   * ```typescript
   * const commit = await dest.getCommitReport({
   *   commitStore: offRampAddress, // v1.6+
   *   request,
   * })
   * console.log(`Committed at block: ${commit.log.blockNumber}`)
   * ```
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
   * Default/generic implementation of getExecutionReceipts.
   * Yields execution receipts for a given offRamp.
   *
   * @param opts - getExecutionReceipts options
   * @returns Async generator of CCIPExecution receipts
   *
   * @example Watch for execution receipts
   * ```typescript
   * for await (const exec of dest.getExecutionReceipts({
   *   offRamp: offRampAddress,
   *   messageId: request.message.messageId,
   *   startBlock: commit.log.blockNumber,
   * })) {
   *   console.log(`State: ${exec.receipt.state}`)
   *   if (exec.receipt.state === ExecutionState.Success) break
   * }
   * ```
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
   *
   * @internal
   * @param tx - Transaction hash or transaction object
   * @returns CCIP execution object
   *
   * @throws {@link CCIPExecTxRevertedError} if no execution receipt found in transaction
   *
   * @example Get receipt from execution tx
   * ```typescript
   * const exec = await dest.getExecutionReceiptInTx(execTxHash)
   * console.log(`State: ${exec.receipt.state}`)
   * ```
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
   *
   * @param address - Usually TokenAdminRegistry, but chain may support receiving Router, OnRamp, etc.
   * @param opts - Optional parameters (e.g., `page` for pagination range)
   * @returns Promise resolving to array of supported token addresses
   *
   * @example Get all supported tokens
   * ```typescript
   * const tokens = await chain.getSupportedTokens(registryAddress)
   * console.log(`${tokens.length} tokens supported`)
   * ```
   */
  abstract getSupportedTokens(address: string, opts?: { page?: number }): Promise<string[]>

  /**
   * Fetch token configuration from a TokenAdminRegistry.
   *
   * @remarks
   * The TokenAdminRegistry is a contract that tracks token administrators and their
   * associated pools. Each token has an administrator who can update pool configurations.
   *
   * @example Query a token's registry configuration
   * ```typescript
   * const config = await chain.getRegistryTokenConfig(registryAddress, tokenAddress)
   * console.log(`Administrator: ${config.administrator}`)
   * if (config.tokenPool) {
   *   console.log(`Pool: ${config.tokenPool}`)
   * }
   * ```
   *
   * @param registry - TokenAdminRegistry contract address.
   * @param token - Token address to query.
   * @returns {@link RegistryTokenConfig} containing administrator and pool information.
   * @throws {@link CCIPTokenNotInRegistryError} if token is not registered.
   */
  abstract getRegistryTokenConfig(registry: string, token: string): Promise<RegistryTokenConfig>

  /**
   * Fetch configuration of a token pool.
   *
   * @remarks
   * Return type varies by chain:
   * - **EVM**: `typeAndVersion` is always present (required)
   * - **Solana**: Includes extra `tokenPoolProgram` field
   * - **Aptos**: Standard fields only
   * - **Sui/TON**: Throws {@link CCIPNotImplementedError}
   *
   * @example Type-safe access to chain-specific fields
   * ```typescript
   * // Use instanceof to narrow the chain type
   * if (chain instanceof SolanaChain) {
   *   const config = await chain.getTokenPoolConfig(poolAddress)
   *   console.log(config.tokenPoolProgram) // TypeScript knows this exists!
   * } else if (chain instanceof EVMChain) {
   *   const config = await chain.getTokenPoolConfig(poolAddress)
   *   console.log(config.typeAndVersion) // TypeScript knows this is required!
   * }
   * ```
   *
   * @param tokenPool - Token pool contract address.
   * @returns {@link TokenPoolConfig} containing token, router, and version info.
   * @throws {@link CCIPNotImplementedError} on Sui or TON chains
   */
  abstract getTokenPoolConfig(tokenPool: string): Promise<TokenPoolConfig>

  /**
   * Fetch remote chain configurations for a token pool.
   *
   * @remarks
   * A token pool maintains configurations for each destination chain it supports.
   * The returned Record maps chain names to their respective configurations.
   *
   * @example Get all supported destinations
   * ```typescript
   * const remotes = await chain.getTokenPoolRemotes(poolAddress)
   * // Returns: {
   * //   "ethereum-mainnet": { remoteToken: "0x...", remotePools: [...], ... },
   * //   "ethereum-mainnet-arbitrum-1": { remoteToken: "0x...", remotePools: [...], ... },
   * //   "solana-mainnet": { remoteToken: "...", remotePools: [...], ... }
   * // }
   *
   * // Access a specific chain's config
   * const arbConfig = remotes['ethereum-mainnet']
   * console.log(`Remote token: ${arbConfig.remoteToken}`)
   * ```
   *
   * @example Filter to a specific destination
   * ```typescript
   * import { networkInfo } from '@chainlink/ccip-sdk'
   *
   * const arbitrumSelector = 4949039107694359620n
   * const remotes = await chain.getTokenPoolRemotes(poolAddress, arbitrumSelector)
   * // Returns only: { "arbitrum-mainnet": { ... } }
   *
   * const chainName = networkInfo(arbitrumSelector).name
   * const config = remotes[chainName]
   * ```
   *
   * @param tokenPool - Token pool address on the current chain.
   * @param remoteChainSelector - Optional chain selector to filter results to a single destination.
   * @returns Record where keys are chain names (e.g., "ethereum-mainnet") and values are {@link TokenPoolRemote} configs.
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if remoteChainSelector is specified but not configured.
   */
  abstract getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>>
  /**
   * Fetch remote chain configuration for a token pool for a specific destination.
   *
   * @remarks
   * Convenience wrapper around {@link getTokenPoolRemotes} that returns a single
   * configuration instead of a Record. Use this when you need configuration for
   * a specific destination chain.
   *
   * @example
   * ```typescript
   * const arbitrumSelector = 4949039107694359620n
   * const remote = await chain.getTokenPoolRemote(poolAddress, arbitrumSelector)
   * console.log(`Remote token: ${remote.remoteToken}`)
   * console.log(`Remote pools: ${remote.remotePools.join(', ')}`)
   * ```
   *
   * @param tokenPool - Token pool address on the current chain.
   * @param remoteChainSelector - Chain selector of the desired remote chain.
   * @returns TokenPoolRemote config for the specified remote chain.
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if no configuration found for the specified remote chain.
   */
  async getTokenPoolRemote(
    tokenPool: string,
    remoteChainSelector: bigint,
  ): Promise<TokenPoolRemote> {
    const remotes = await this.getTokenPoolRemotes(tokenPool, remoteChainSelector)
    const network = networkInfo(remoteChainSelector)
    const remoteConfig = remotes[network.name]
    if (!remoteConfig) {
      throw new CCIPTokenPoolChainConfigNotFoundError(tokenPool, tokenPool, network.name)
    }
    return remoteConfig
  }

  /**
   * Fetch list and info of supported feeTokens.
   *
   * @param router - Router address on this chain
   * @returns Promise resolving to mapping of token addresses to TokenInfo objects
   *
   * @example Get available fee tokens
   * ```typescript
   * const feeTokens = await chain.getFeeTokens(routerAddress)
   * for (const [addr, info] of Object.entries(feeTokens)) {
   *   console.log(`${info.symbol}: ${addr}`)
   * }
   * ```
   */
  abstract getFeeTokens(router: string): Promise<Record<string, TokenInfo>>

  /** {@inheritDoc ChainStatic.buildMessageForDest} */
  static buildMessageForDest(
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage {
    const gasLimit = message.data && dataLength(message.data) ? DEFAULT_GAS_LIMIT : 0n

    // Detect if user wants V3 by checking for any V3-only field
    if (hasV3ExtraArgs(message.extraArgs)) {
      // V3 defaults (GenericExtraArgsV3)
      return {
        ...message,
        extraArgs: {
          gasLimit,
          blockConfirmations: 0,
          ccvs: [],
          ccvArgs: [],
          executor: '',
          executorArgs: '0x',
          tokenReceiver: '',
          tokenArgs: '0x',
          ...message.extraArgs,
        },
      }
    }

    // Default to V2 (GenericExtraArgsV2, aka EVMExtraArgsV2)
    return {
      ...message,
      extraArgs: {
        gasLimit,
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

/**
 * Static methods and properties available on Chain class constructors.
 *
 * @example Using static methods
 * ```typescript
 * // Create chain from URL
 * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
 *
 * // Decode message from log
 * const message = EVMChain.decodeMessage(log)
 *
 * // Validate address format
 * const normalized = EVMChain.getAddress('0xABC...')
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type ChainStatic<F extends ChainFamily = ChainFamily> = Function & {
  readonly family: F
  readonly decimals: number
  /**
   * Async constructor: builds a Chain from an RPC endpoint URL.
   *
   * @param url - RPC endpoint URL
   * @param ctx - Optional context with logger and API client configuration
   * @returns Promise resolving to Chain instance
   *
   * @throws {@link CCIPChainNotFoundError} if chain cannot be identified
   *
   * @example Create chain from RPC
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')
   * console.log(`Connected to: ${chain.network.name}`)
   * ```
   */
  fromUrl(url: string, ctx?: ChainContext): Promise<Chain<F>>
  /**
   * Try to decode a CCIP message from a log/event originated from this source chain.
   * The parsing is specific to this chain family, but content may target other chains.
   *
   * @param log - Chain generic log
   * @returns Decoded CCIP message with merged extraArgs, or undefined if not a CCIP message
   *
   * @example Decode message from log
   * ```typescript
   * const message = EVMChain.decodeMessage(log)
   * if (message) {
   *   console.log(`Message ID: ${message.messageId}`)
   * }
   * ```
   */
  decodeMessage(log: Pick<Log_, 'data'>): CCIPMessage | undefined
  /**
   * Try to decode an extraArgs array serialized for this chain family.
   *
   * @param extraArgs - Extra args bytes (Uint8Array, HexString or base64)
   * @returns Object containing decoded extraArgs and their tag, or undefined
   *
   * @throws {@link CCIPExtraArgsParseError} if bytes cannot be decoded
   *
   * @example Decode extra args
   * ```typescript
   * const decoded = EVMChain.decodeExtraArgs(message.extraArgs)
   * if (decoded?._tag === 'EVMExtraArgsV2') {
   *   console.log(`Gas limit: ${decoded.gasLimit}`)
   * }
   * ```
   */
  decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
    | undefined
  /**
   * Encode extraArgs for this chain family.
   *
   * @param extraArgs - Extra args object to encode
   * @returns Encoded hex string
   *
   * @example Encode extra args
   * ```typescript
   * const encoded = EVMChain.encodeExtraArgs({
   *   gasLimit: 200000n,
   *   strict: false,
   * })
   * ```
   */
  encodeExtraArgs(extraArgs: ExtraArgs): string
  /**
   * Decode a commit (CommitReportAccepted) event.
   *
   * @param log - Chain generic log
   * @param lane - If passed, filter or validate reports by lane
   * @returns Array of commit reports contained in the log, or undefined
   *
   * @example Decode commit from log
   * ```typescript
   * const commits = EVMChain.decodeCommits(log, lane)
   * if (commits) {
   *   console.log(`Found ${commits.length} commit(s)`)
   * }
   * ```
   */
  decodeCommits(log: Pick<Log_, 'data'>, lane?: Lane): CommitReport[] | undefined
  /**
   * Decode a receipt (ExecutionStateChanged) event.
   *
   * @param log - Chain generic log
   * @returns ExecutionReceipt or undefined if not a recognized receipt
   *
   * @example Decode execution receipt
   * ```typescript
   * const receipt = EVMChain.decodeReceipt(log)
   * if (receipt) {
   *   console.log(`State: ${receipt.state}, Message: ${receipt.messageId}`)
   * }
   * ```
   */
  decodeReceipt(log: Pick<Log_, 'data'>): ExecutionReceipt | undefined
  /**
   * Receive a bytes array and try to decode and normalize it as an address of this chain family.
   *
   * @param bytes - Bytes array (Uint8Array, HexString or Base64)
   * @returns Address in this chain family's format
   *
   * @throws {@link CCIPAddressInvalidEvmError} if invalid EVM address
   * @throws {@link CCIPAptosAddressInvalidError} if invalid Aptos address
   *
   * @example Normalize address
   * ```typescript
   * const normalized = EVMChain.getAddress('0xABC123...')
   * console.log(normalized) // checksummed address
   * ```
   */
  getAddress(bytes: BytesLike): string
  /**
   * Validates a transaction hash format for this chain family.
   *
   * @param v - Value to validate
   * @returns True if value is a valid transaction hash format
   *
   * @example Validate transaction hash
   * ```typescript
   * if (EVMChain.isTxHash(userInput)) {
   *   const tx = await chain.getTransaction(userInput)
   * }
   * ```
   */
  isTxHash(v: unknown): v is string
  /**
   * Format an address for human-friendly display.
   * Defaults to getAddress if not overridden.
   *
   * @param address - Address string in any recognized format
   * @returns Human-friendly address string for display
   *
   * @example Format address for display
   * ```typescript
   * const display = EVMChain.formatAddress?.(rawAddress) ?? rawAddress
   * console.log(display)
   * ```
   */
  formatAddress?(address: string): string
  /**
   * Format a transaction hash for human-friendly display.
   *
   * @param hash - Transaction hash string
   * @returns Human-friendly hash string for display
   *
   * @example Format tx hash for display
   * ```typescript
   * const display = EVMChain.formatTxHash?.(rawHash) ?? rawHash
   * console.log(display)
   * ```
   */
  formatTxHash?(hash: string): string
  /**
   * Create a leaf hasher for this dest chain and lane.
   *
   * @param lane - Source, dest and onramp lane info
   * @param ctx - Context object containing logger
   * @returns LeafHasher function that takes a message and returns its hash
   *
   * @throws {@link CCIPHasherVersionUnsupportedError} if hasher version unsupported
   *
   * @example Create leaf hasher
   * ```typescript
   * const hasher = EVMChain.getDestLeafHasher(lane, { logger })
   * const leafHash = hasher(message)
   * ```
   */
  getDestLeafHasher(lane: Lane, ctx?: WithLogger): LeafHasher
  /**
   * Try to parse an error or bytearray generated by this chain family.
   *
   * @param data - Caught object, string or bytearray
   * @returns Ordered record with messages/properties, or undefined/null if not recognized
   *
   * @example Parse contract error
   * ```typescript
   * try {
   *   await chain.sendMessage(opts)
   * } catch (err) {
   *   const parsed = EVMChain.parse?.(err)
   *   if (parsed) console.log('Contract error:', parsed)
   * }
   * ```
   */
  parse?(data: unknown): Record<string, unknown> | undefined | null
  /**
   * Returns a copy of a message, populating missing fields like `extraArgs` with defaults
   * It's expected to return a message suitable at least for basic token transfers
   * @param message - AnyMessage (from source), containing at least `receiver`
   * @returns A message suitable for `sendMessage` to this destination chain family
   */
  buildMessageForDest(message: MessageInput): AnyMessage
}

/** Function type for getting a Chain instance by ID, selector, or name. */
export type ChainGetter = (idOrSelectorOrName: number | string | bigint) => Promise<Chain>
