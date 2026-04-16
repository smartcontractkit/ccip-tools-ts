import { type BytesLike, dataLength, keccak256 } from 'ethers'
import type { PickDeep, SetOptional } from 'type-fest'

import { type LaneLatencyResponse, CCIPAPIClient } from './api/index.ts'
import type { UnsignedAptosTx } from './aptos/types.ts'
import { getOnchainCommitReport } from './commits.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPArgumentInvalidError,
  CCIPChainFamilyMismatchError,
  CCIPExecTxRevertedError,
  CCIPNotImplementedError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTransactionNotFinalizedError,
} from './errors/index.ts'
import type { UnsignedEVMTx } from './evm/types.ts'
import { calculateManualExecProof } from './execution.ts'
import type {
  EVMExtraArgsV1,
  EVMExtraArgsV2,
  ExtraArgs,
  GenericExtraArgsV3,
  SVMExtraArgsV1,
  SuiExtraArgsV1,
} from './extra-args.ts'
import type { LeafHasher } from './hasher/common.ts'
import { decodeMessageV1 } from './messages.ts'
import { getOffchainTokenData } from './offchain.ts'
import { getMessagesInTx } from './requests.ts'
import { DEFAULT_GAS_LIMIT } from './shared/constants.ts'
import type { UnsignedSolanaTx } from './solana/types.ts'
import type { UnsignedSuiTx } from './sui/types.ts'
import type { UnsignedTONTx } from './ton/types.ts'
import {
  type AnyMessage,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVerifications,
  type CCIPVersion,
  type ChainFamily,
  type ChainLog,
  type ChainTransaction,
  type CommitReport,
  type ExecutionInput,
  type ExecutionReceipt,
  type Lane,
  type Logger,
  type MessageInput,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ExecutionState,
} from './types.ts'
import { networkInfo, util, withRetry } from './utils.ts'

/** All valid field names for GenericExtraArgsV2. */
const V2_FIELDS = new Set(['gasLimit', 'allowOutOfOrderExecution'])

/** All valid field names for GenericExtraArgsV3. */
const V3_FIELDS = new Set([
  'gasLimit',
  'blockConfirmations',
  'ccvs',
  'ccvArgs',
  'executor',
  'executorArgs',
  'tokenReceiver',
  'tokenArgs',
])

/** Throw {@link CCIPArgumentInvalidError} if any key in extraArgs is not in the allowed set. */
function assertNoUnknownFields(
  extraArgs: Partial<ExtraArgs>,
  allowed: Set<string>,
  variant: string,
): void {
  const unknown = Object.keys(extraArgs).filter((k) => k !== '_tag' && !allowed.has(k))
  if (unknown.length)
    throw new CCIPArgumentInvalidError(
      'extraArgs',
      `unknown field(s) for ${variant}: ${unknown.map((k) => JSON.stringify(k)).join(', ')}`,
    )
}

/** Check if extraArgs contains any V3-only fields (i.e. fields in V3 but not in V2). */
function hasV3ExtraArgs(extraArgs: Partial<ExtraArgs> | undefined): boolean {
  if (!extraArgs) return false
  return Object.keys(extraArgs).some((k) => V3_FIELDS.has(k) && !V2_FIELDS.has(k))
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
 * const api = CCIPAPIClient.fromUrl('https://staging-api.example.com', { logger })
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
   * - `string`: Creates CCIPAPIClient with provided URL
   * - `CCIPAPIClient`: Uses provided instance (allows custom URL, fetch, etc.)
   * - `null`: Disables API client entirely (getLaneLatency() will throw)
   *
   * Default: `undefined` (auto-create with production endpoint)
   */
  apiClient?: CCIPAPIClient | string | null

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
 * Per-token transfer fee computed by {@link Chain.getTotalFeesEstimate}.
 */
export type TokenTransferFee = {
  /** Amount deducted from the transferred token by the pool (amount * bps / 10_000).
   *  The recipient receives `amount - feeDeducted` on the destination chain. */
  feeDeducted: bigint
  /** The BPS rate applied (basis points, where 10_000 = 100%). */
  bps: number
}

/**
 * Token price returned by {@link Chain.getTokenPrice}.
 */
export type TokenPrice = {
  /** Price per whole token in the quote currency (USD by default, e.g., 9.11 for LINK at $9.11). */
  price: number
}

/**
 * Total fees estimate returned by {@link Chain.getTotalFeesEstimate}.
 */
export type TotalFeesEstimate = {
  /** Fee from Router.getFee(), denominated in the message's feeToken
   *  (native token when feeToken is omitted). */
  ccipFee: bigint
  /** Token transfer fee, present only when the message includes a token transfer. */
  tokenTransferFee?: TokenTransferFee
}

/**
 * Token transfer fee configuration returned by TokenPool v2.0 contracts.
 *
 * @remarks
 * Contains two fee dimensions per finality mode (default vs custom/FTF):
 * - A flat USD surcharge (in cents) added to the CCIP fee via FeeQuoter
 * - A BPS rate deducted directly from the transferred token amount by the pool
 *
 * "Default" fields apply when `blockConfirmations = 0` (standard finality).
 * "Custom" fields apply when `blockConfirmations > 0` (Faster-Than-Finality).
 */
export type TokenTransferFeeConfig = {
  /** Gas overhead added to the execution cost estimate for token transfers on the destination chain. */
  destGasOverhead: number
  /** Byte overhead added to the data availability cost estimate for token transfers. */
  destBytesOverhead: number
  /** USD surcharge (in cents) added to the CCIP fee under standard finality (`blockConfirmations = 0`). */
  defaultBlockConfirmationsFeeUSDCents: number
  /** USD surcharge (in cents) added to the CCIP fee under FTF (`blockConfirmations > 0`). */
  customBlockConfirmationsFeeUSDCents: number
  /** BPS rate deducted from the transferred token amount under standard finality. */
  defaultBlockConfirmationsTransferFeeBps: number
  /** BPS rate deducted from the transferred token amount under FTF. */
  customBlockConfirmationsTransferFeeBps: number
  /** Whether token transfer fees are enabled for this pool. */
  isEnabled: boolean
}

/**
 * Options for fetching token transfer fee config as part of {@link Chain.getTokenPoolConfig}.
 */
export type TokenTransferFeeOpts = {
  /** Destination chain selector to query fee config for. */
  destChainSelector: bigint
  /** Number of block confirmations requested (0 = standard finality, positive = FTF). */
  blockConfirmationsRequested: number
  /** Hex-encoded bytes passed as tokenArgs to the pool contract. */
  tokenArgs: string
}

/**
 * Available lane feature keys.
 * These represent features or thresholds that can be configured per-lane.
 */
export const LaneFeature = {
  /**
   * Minimum block confirmations for Faster-Than-Finality (FTF).
   * - **absent**: the lane does not support FTF (pre-v2.0 lane).
   * - **0**: the lane supports FTF, but it is not enabled for this
   *   token (e.g. the token pool predates FTF, or FTF is configured
   *   to use default finality only).
   * - **\> 0**: FTF is enabled; this is the minimum number of block
   *   confirmations required to use it.
   */
  MIN_BLOCK_CONFIRMATIONS: 'MIN_BLOCK_CONFIRMATIONS',
  /**
   * Rate limiter bucket state for the lane/token with default finality.
   */
  RATE_LIMITS: 'RATE_LIMITS',
  /**
   * Rate limiter bucket state when using non-default finality (FTF).
   * Only meaningful when FTF is supported on this lane, i.e.
   * {@link LaneFeature.MIN_BLOCK_CONFIRMATIONS} is present and \> 0.
   * If absent, the default rate limits ({@link LaneFeature.RATE_LIMITS}) apply even when using custom finality.
   */
  CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS: 'CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS',
} as const
/** Type representing one of the lane feature keys. */
export type LaneFeature = (typeof LaneFeature)[keyof typeof LaneFeature]

/**
 * Lane features record.
 * Maps feature keys to their values.
 */
export interface LaneFeatures extends Record<LaneFeature, unknown> {
  /** Minimum block confirmations for FTF. */
  MIN_BLOCK_CONFIRMATIONS: number
  /** Rate limiter bucket state for the lane/token with default finality. */
  RATE_LIMITS: RateLimiterState
  /**
   * Rate limiter bucket state when using non-default finality (FTF).
   * If absent, the default rate limits ({@link LaneFeatures.RATE_LIMITS}) apply even when using custom finality.
   */
  CUSTOM_BLOCK_CONFIRMATIONS_RATE_LIMITS: RateLimiterState
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
 *
 * The `customBlockConfirmationsOutboundRateLimiterState` and
 * `customBlockConfirmationsInboundRateLimiterState` fields are present only for
 * TokenPool v2.0+ contracts. These provide separate rate limits applied when
 * Faster-Than-Finality (FTF) custom block confirmations are used.
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
  /** Outbound rate limiter state for tokens leaving this chain. */
  outboundRateLimiterState: RateLimiterState
  /** Inbound rate limiter state for tokens coming into this chain. */
  inboundRateLimiterState: RateLimiterState
} & (
  | {
      /** Outbound rate limiter state for tokens leaving this chain (FTF/v2). */
      customBlockConfirmationsOutboundRateLimiterState: RateLimiterState
      /** Inbound rate limiter state for tokens coming into this chain (FTF/v2). */
      customBlockConfirmationsInboundRateLimiterState: RateLimiterState
    }
  | object
)

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
  /**
   * Min custom block confirmations for Faster-Than-Finality (FTF),
   * if TokenPool version \>= v2.0.0 and FTF is supported on this lane.
   * `0` indicates FTF is supported but not enabled for this token; `>0` indicates FTF is enabled
   *  with this many minimum confirmations.
   */
  minBlockConfirmations?: number
  /**
   * Token transfer fee configuration from the pool contract.
   * Only present when {@link TokenTransferFeeOpts} is provided to
   * {@link Chain.getTokenPoolConfig} and the pool supports it (v2.0+).
   */
  tokenTransferFeeConfig?: TokenTransferFeeConfig
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
  [ChainFamily.Sui]: UnsignedSuiTx
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
 * Common options for {@link Chain.generateUnsignedExecute} and {@link Chain.execute} methods.
 */
export type ExecuteOpts = (
  | {
      /** address of the OffRamp contract */
      offRamp: string
      /** input payload to execute message; contains proofs for v1 and verifications for v2 */
      input: ExecutionInput
    }
  | {
      /**
       * messageId of message to execute; requires `apiClient`.
       * The SDK will fetch execution inputs (offRamp, proofs/verifications) from the CCIP API.
       */
      messageId: string
    }
) & {
  /** gasLimit or computeUnits limit override for the ccipReceive call */
  gasLimit?: number
  /** For EVM (v1.5..v1.6), overrides gasLimit on tokenPool call */
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
    } else if (apiClient && typeof apiClient !== 'string') {
      this.apiClient = apiClient // Use provided instance
      this.apiRetryConfig = { ...DEFAULT_API_RETRY_CONFIG, ...apiRetryConfig }
    } else {
      this.apiClient = CCIPAPIClient.fromUrl(apiClient, ctx) // default=undefined or provided string as URL
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
  abstract getLogs(opts: LogFilter): AsyncIterableIterator<ChainLog>

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
   * To be implemented for chains supporting CCIPVersion v1.6.0 and earlier
   *
   * @param request - CCIPRequest to fetch batch for
   * @param range - batch range \{ minSeqnr, maxSeqNr \}, e.g. from {@link CommitReport}
   * @param opts - Optional parameters (e.g., `page` for pagination width)
   * @returns Array of messages in the batch
   *
   * @throws {@link CCIPMessageBatchIncompleteError} if not all messages in range could be fetched
   *
   * @example Get all messages in a batch
   * ```typescript
   * const verifications = await dest.getVerifications({ offRamp, request })
   * const messages = await source.getMessagesInBatch(request, verifications.report)
   * console.log(`Found ${messages.length} messages in batch`)
   * ```
   */
  getMessagesInBatch?<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    range: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: { page?: number },
  ): Promise<R['message'][]>

  /**
   * Fetch input data needed for executing messages
   * Should be called on the *source* instance
   * @param opts - getExecutionInput options containing request and verifications
   * @returns `input` payload to be passed to {@link execute}
   * @see {@link execute} - method to execute a message
   */
  async getExecutionInput({
    request,
    verifications,
    ...opts
  }: {
    request: CCIPRequest
    verifications: CCIPVerifications
  } & Pick<LogFilter, 'page'>): Promise<ExecutionInput> {
    if ('verifications' in verifications) {
      // >=v2 verifications is enough for execution
      return {
        encodedMessage: (request.message as CCIPMessage<typeof CCIPVersion.V2_0>).encodedMessage,
        ...verifications,
      }
    }
    // other messages in same batch are available from `source` side;
    // not needed for chain families supporting only >=v2
    const messagesInBatch = await this.getMessagesInBatch!(request, verifications.report, opts)
    const execReportProof = calculateManualExecProof(
      messagesInBatch,
      request.lane,
      request.message.messageId,
      verifications.report.merkleRoot,
      this,
    )
    const offchainTokenData = await this.getOffchainTokenData(request)
    return {
      ...execReportProof,
      message: request.message,
      offchainTokenData,
    } as ExecutionInput
  }
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
   * Fetch the OnRamps addresses set in OffRamp config.
   * Used to discover OffRamp connected to an OnRamp.
   *
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - Source chain selector
   * @returns Promise resolving to OnRamps addresses
   *
   * @example Get onRamp from offRamp config
   * ```typescript
   * const [onRamp] = await dest.getOnRampsForOffRamp(offRampAddress, sourceSelector)
   * console.log(`OnRamp: ${onRamp}`)
   * ```
   */
  abstract getOnRampsForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string[]>
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
   * It logs but doesn't throw in case it can't fetch attestation, as the transfers may not be
   * from the expected attestation providers. It returns default offchainData=undefined for those.
   *
   * @param request - CCIP request, with tx.hash and message
   * @returns Promise resolving to array with one offchain token data for each token transfer
   *
   * @example Get offchain token data for USDC transfer
   * ```typescript
   * const offchainData = await source.getOffchainTokenData(request)
   * // Use in execution report
   * ```
   */
  async getOffchainTokenData(
    request: PickDeep<CCIPRequest, 'tx.hash' | `message`>,
  ): Promise<OffchainTokenData[]> {
    return getOffchainTokenData(request, this)
  }

  /**
   * Resolves {@link ExecuteOpts} that may contain a `messageId` (API shorthand) into the
   * canonical `{ offRamp, input }` form required by {@link generateUnsignedExecute}.
   *
   * When `opts` already contains `input` the method is a no-op and returns it unchanged.
   * When `opts` contains only a `messageId` it calls `apiClient.getExecutionInput` and merges
   * the result back with any extra opts fields (e.g. `gasLimit`).
   * If opts.gasLimit is undefined and `estimateReceiveExecution` is available, try to estimate gasLimitOverride
   *
   * @throws {@link CCIPApiClientNotAvailableError} if `messageId` is provided but no apiClient
   */
  protected async resolveExecuteOpts(
    opts: ExecuteOpts,
  ): Promise<Extract<ExecuteOpts, { input: unknown }>> {
    let opts_: Extract<typeof opts, { input: unknown }>
    if ('input' in opts) {
      opts_ = opts
    } else if (!this.apiClient) throw new CCIPApiClientNotAvailableError()
    else {
      const { offRamp, ...input } = await this.apiClient.getExecutionInput(opts.messageId)
      opts_ = { ...opts, offRamp, input }
    }

    if (
      opts_.gasLimit == null &&
      this.estimateReceiveExecution &&
      (!('message' in opts_.input) ||
        !opts_.input.message.tokenAmounts.length ||
        opts_.input.message.tokenAmounts.every((ta) => 'destTokenAddress' in ta))
    ) {
      let message
      if ('message' in opts_.input) {
        message = {
          ...opts_.input.message,
          // pass `tokenAmount` with `destTokenAddress` to estimate
          destTokenAmounts: opts_.input.message.tokenAmounts,
        }
      } else {
        const decoded = decodeMessageV1(opts_.input.encodedMessage)
        message = {
          ...decoded,
          messageId: keccak256(opts_.input.encodedMessage),
          destTokenAmounts: decoded.tokenTransfer,
        }
      }
      try {
        const estimated = await this.estimateReceiveExecution({
          offRamp: opts_.offRamp,
          message,
        })
        this.logger.debug('Estimated receiver execution:', estimated)
        if (
          ('gasLimit' in message && estimated > message.gasLimit) ||
          ('ccipReceiveGasLimit' in message && estimated > message.ccipReceiveGasLimit)
        ) {
          opts_.gasLimit = Math.ceil(Number(estimated) * 1.1)
          opts_.tokensGasLimit ??= 0
        }
      } catch (err) {
        // ignore if receiver fails, let estimation of execute method itself throw if needed
        this.logger.debug('Failed to auto-estimateReceiveExecution for:', opts, err)
      }
    }

    return opts_
  }

  /**
   * Generate unsigned tx to manuallyExecute a message.
   *
   * @param opts - {@link ExecuteOpts} with payer address which will send the exec tx
   * @returns Promise resolving to chain-family specific unsigned txs
   *
   * @example Generate unsigned execution tx
   * ```typescript
   * const unsignedTx = await dest.generateUnsignedExecute({
   *   offRamp: offRampAddress,
   *   input,
   *   payer: walletAddress,
   * })
   * // Sign and send with external wallet
   * ```
   */
  abstract generateUnsignedExecute(
    opts: ExecuteOpts & {
      /** address which will be used to send the report tx */
      payer: string
    },
  ): Promise<UnsignedTx[F]>
  /**
   * Execute messages in report in an offRamp.
   *
   * @param opts - {@link ExecuteOpts} with chain-specific wallet to sign and send tx.
   * @returns Promise resolving to transaction of the execution.
   *
   * @throws {@link CCIPWalletNotSignerError} if wallet is not a valid signer.
   * @throws {@link CCIPExecTxNotConfirmedError} if execution transaction fails to confirm.
   * @throws {@link CCIPExecTxRevertedError} if execution transaction reverts.
   * @throws {@link CCIPMerkleRootMismatchError} if merkle proof is invalid.
   *
   * @example Manual execution using message ID (simplified, requires API)
   * ```typescript
   * const receipt = await dest.execute({ messageId: '0x...', wallet })
   * ```
   *
   * @example Manual execution using transaction hash
   * ```typescript
   * const input = await source.getExecutionInput({ request, verifications })
   * const receipt = await dest.execute({ offRamp, input, wallet })
   * ```
   */
  abstract execute(
    opts: ExecuteOpts & {
      // Signer instance (chain-dependent)
      wallet: unknown
    },
  ): Promise<CCIPExecution>

  /**
   * Look for a CommitReport at dest for given CCIP request.
   * May be specialized by some subclasses.
   *
   * @param opts - getVerifications options
   * @returns CCIPVerifications
   *
   * @throws {@link CCIPCommitNotFoundError} if no commit found for the request (transient)
   *
   * @example Get commit for a request
   * ```typescript
   * const verifications = await dest.getVerifications({
   *   offRamp: offRampAddress,
   *   request,
   * })
   * console.log(`Committed at block: ${verifications.log.blockNumber}`)
   * ```
   */
  async getVerifications({
    offRamp,
    request,
    ...hints
  }: {
    /** address of offRamp or commitStore contract */
    offRamp: string
    /** CCIPRequest subset object */
    request: PickDeep<
      CCIPRequest,
      'lane' | `message.${'sequenceNumber' | 'messageId'}` | 'tx.timestamp'
    >
  } & Pick<LogFilter, 'page' | 'watch' | 'startBlock'>): Promise<CCIPVerifications> {
    return getOnchainCommitReport(this, offRamp, request, hints)
  }

  /**
   * Fetches estimated lane latency to a destination chain.
   * Uses this chain's selector as the source.
   *
   * @param destChainSelector - Destination CCIP chain selector (bigint)
   * @param numberOfBlocks - Optional number of block confirmations to use for latency
   *   calculation. When omitted or 0, uses the lane's default finality. When provided
   *   as a positive integer, the API returns latency for that custom finality value.
   * @returns Promise resolving to {@link LaneLatencyResponse} containing:
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
   * } catch (err) {
   *   if (err instanceof CCIPHttpError) {
   *     console.error(`API error: ${err.context.apiErrorCode}`)
   *   }
   * }
   * ```
   *
   * @example Get latency with custom block confirmations
   * ```typescript
   * const latency = await chain.getLaneLatency(4949039107694359620n, 10)
   * console.log(`Latency with 10 confirmations: ${Math.round(latency.totalMs / 60000)} minutes`)
   * ```
   */
  async getLaneLatency(
    destChainSelector: bigint,
    numberOfBlocks?: number,
  ): Promise<LaneLatencyResponse> {
    if (!this.apiClient) {
      throw new CCIPApiClientNotAvailableError()
    }
    return this.apiClient.getLaneLatency(
      this.network.chainSelector,
      destChainSelector,
      numberOfBlocks,
    )
  }

  /**
   * Retrieve features for a lane (router/destChainSelector/token triplet).
   *
   * @param _opts - Options containing router address, destChainSelector, and optional token
   *   address (the token to be transferred in a hypothetical message on this lane)
   * @returns Promise resolving to partial lane features record
   *
   * @throws {@link CCIPNotImplementedError} if not implemented for this chain family
   *
   * @example Get lane features
   * ```typescript
   * const features = await chain.getLaneFeatures({
   *   router: '0x...',
   *   destChainSelector: 4949039107694359620n,
   * })
   * // MIN_BLOCK_CONFIRMATIONS has three states:
   * // - undefined: FTF is not supported on this lane (pre-v2.0)
   * // - 0: the lane supports FTF, but it is not enabled for this token
   * // - > 0: FTF is enabled with this many block confirmations
   * const ftf = features.MIN_BLOCK_CONFIRMATIONS
   * if (ftf != null && ftf > 0) {
   *   console.log(`FTF enabled with ${ftf} confirmations`)
   * } else if (ftf === 0) {
   *   console.log('FTF supported on this lane but not enabled for this token')
   * }
   * ```
   */
  getLaneFeatures(_opts: {
    router: string
    destChainSelector: bigint
    token?: string
  }): Promise<Partial<LaneFeatures>> {
    return Promise.reject(new CCIPNotImplementedError('getLaneFeatures'))
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
    verifications,
    ...hints
  }: {
    /** address of OffRamp contract */
    offRamp: string
    /** filter: yield only executions for this message */
    messageId?: string
    /** filter: yield only executions for this source chain */
    sourceChainSelector?: bigint
    /** optional commit associated with the request, can be used for optimizations in some families */
    verifications?: CCIPVerifications
  } & Pick<
    LogFilter,
    'page' | 'watch' | 'startBlock' | 'startTime'
  >): AsyncIterableIterator<CCIPExecution> {
    if (verifications && 'log' in verifications) hints.startBlock ??= verifications.log.blockNumber
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
   * @param feeOpts - Optional parameters to also fetch token transfer fee config.
   * @returns {@link TokenPoolConfig} containing token, router, version info, and optionally fee config.
   * @throws {@link CCIPNotImplementedError} on Sui or TON chains
   */
  abstract getTokenPoolConfig(
    tokenPool: string,
    feeOpts?: TokenTransferFeeOpts,
  ): Promise<TokenPoolConfig>

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

  /**
   * Returns a copy of a message, populating missing fields like `extraArgs` with defaults.
   * It's expected to return a message suitable at least for basic token transfers.
   *
   * @param message - AnyMessage (from source), containing at least `receiver`.
   * @returns A message suitable for `sendMessage` to this destination chain family.
   *
   * @remarks
   * V3 (GenericExtraArgsV3) is auto-detected when any V3-only field is present
   * (e.g. `blockConfirmations`, `ccvs`, `ccvArgs`, `executor`, `executorArgs`,
   * `tokenReceiver`, `tokenArgs`). Otherwise defaults to V2 (EVMExtraArgsV2).
   *
   * @throws {@link CCIPArgumentInvalidError} if extraArgs contains unknown fields for the detected version.
   */
  static buildMessageForDest(
    this: ChainStatic,
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage {
    const receiver = this.getAddress(message.receiver) // validate receiver address for dest chain family
    const gasLimit = message.data && dataLength(message.data) ? DEFAULT_GAS_LIMIT : 0n

    // Detect if user wants V3 by checking for any V3-only field
    if (hasV3ExtraArgs(message.extraArgs)) {
      if (message.extraArgs)
        assertNoUnknownFields(message.extraArgs, V3_FIELDS, 'GenericExtraArgsV3')
      let tokenReceiver = ''
      if (
        message.extraArgs &&
        'tokenReceiver' in message.extraArgs &&
        message.extraArgs.tokenReceiver
      ) {
        tokenReceiver = this.getAddress(message.extraArgs.tokenReceiver) // validate
      }
      // V3 defaults (GenericExtraArgsV3)
      return {
        ...message,
        receiver,
        extraArgs: {
          gasLimit,
          blockConfirmations: 0,
          ccvs: [],
          ccvArgs: [],
          executor: '',
          executorArgs: '0x',
          tokenArgs: '0x',
          ...message.extraArgs,
          tokenReceiver,
        },
      }
    }

    if (message.extraArgs) assertNoUnknownFields(message.extraArgs, V2_FIELDS, 'EVMExtraArgsV2')
    // Default to V2 (GenericExtraArgsV2, aka EVMExtraArgsV2)
    return {
      ...message,
      receiver,
      extraArgs: {
        gasLimit,
        allowOutOfOrderExecution: true,
        ...message.extraArgs,
      },
    }
  }

  /**
   * Estimate total fees for a cross-chain message.
   *
   * Returns two components:
   * - **ccipFee**: from `Router.getFee()`, denominated in the message's
   *   `feeToken` (native token if omitted). Includes gas, DON costs, and
   *   FeeQuoter-level token transfer overhead (all CCIP versions).
   * - **tokenTransferFee**: pool-level BPS fee deducted from the transferred
   *   token amount (v2.0+ only). The recipient receives
   *   `amount - feeDeducted` on the destination chain. Absent on pre-v2.0
   *   lanes or data-only messages.
   *
   * @param _opts - {@link SendMessageOpts} without approveMax
   * @returns Promise resolving to {@link TotalFeesEstimate}
   * @throws {@link CCIPNotImplementedError} if not implemented for this chain family
   */
  getTotalFeesEstimate(_opts: Omit<SendMessageOpts, 'approveMax'>): Promise<TotalFeesEstimate> {
    return Promise.reject(new CCIPNotImplementedError('getTotalFeesEstimate'))
  }

  /**
   * Fetch the on-chain USD price of a token from the FeeQuoter or PriceRegistry.
   *
   * @remarks
   * On EVM, the price contract is resolved via the Router's OnRamp:
   * PriceRegistry for v1.2/v1.5 lanes, FeeQuoter for v1.6+ lanes.
   * When `timestamp` is provided on EVM, the price is read at the
   * block closest to that timestamp (requires archive node).
   * On Solana and Aptos, the FeeQuoter is resolved directly from the
   * Router config; `timestamp` is not yet supported and will be ignored.
   *
   * @param opts - Options identifying the token:
   *   - `router` — Router address on this chain.
   *   - `token` — Token address. Pass `ZeroAddress` for the native token
   *     (auto-resolved to the wrapped native via {@link Chain.getNativeTokenForRouter}).
   *   - `timestamp` — *(optional)* Unix timestamp in seconds. When provided
   *     on EVM, returns the price at the block closest to this time.
   *     Ignored on Solana and Aptos.
   * @returns Promise resolving to {@link TokenPrice} with the USD price per whole token.
   * @throws {@link CCIPNotImplementedError} if not implemented for this chain family
   *
   * @example
   * ```typescript
   * const { price } = await chain.getTokenPrice({
   *   router: routerAddress,
   *   token: linkAddress,
   * })
   * console.log(`LINK: $${price.toFixed(2)}`)
   * ```
   */
  getTokenPrice(_opts: { router: string; token: string; timestamp?: number }): Promise<TokenPrice> {
    return Promise.reject(new CCIPNotImplementedError('getTokenPrice'))
  }

  /**
   * Estimate `ccipReceive` execution cost (gas, computeUnits) for this destination chain.
   *
   * @param opts - Either:
   *   - `{ offRamp, message }` — estimate from message fields directly. `message` must include
   *     `sourceChainSelector`, `messageId`, `receiver`, and optionally `sender`, `data`,
   *     `destTokenAmounts`.
   *   - `{ messageId }` — fetch the message from the CCIP API via `getMessageById`, resolve
   *     the offRamp from the message metadata or `getExecutionInput`, then estimate.
   *     Requires `apiClient` to be available.
   * @returns Estimated execution cost (gas for EVM, compute units for Solana)
   */
  estimateReceiveExecution?(
    opts:
      | {
          offRamp: string
          message: {
            sourceChainSelector: bigint
            messageId: string
            receiver: string
            sender?: string
            data?: BytesLike
            destTokenAmounts?: readonly ((
              | { token: string }
              | { destTokenAddress: string; extraData?: string }
            ) & { amount: bigint })[]
          }
        }
      | { messageId: string },
  ): Promise<number>
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
  decodeMessage(log: Pick<ChainLog, 'data'>): CCIPMessage | undefined
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
  decodeCommits(log: Pick<ChainLog, 'data'>, lane?: Lane): CommitReport[] | undefined
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
  decodeReceipt(log: Pick<ChainLog, 'data'>): ExecutionReceipt | undefined
  /**
   * Receive a bytes array and try to decode and normalize it as an address of this chain family.
   *
   * @param bytes - Bytes array (Uint8Array, HexString or Base64)
   * @returns Address in this chain family's format
   *
   * @throws {@link CCIPAddressInvalidEvmError} if invalid EVM address
   * @throws {@link CCIPDataFormatUnsupportedError} if invalid Aptos/Sui address
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
