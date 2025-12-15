import type { BytesLike } from 'ethers'
import type { PickDeep, SetOptional } from 'type-fest'

import { type LaneLatencyResponse, CCIPAPIClient } from './api/index.ts'
import type { UnsignedAptosTx } from './aptos/types.ts'
import { fetchCommitReport } from './commits.ts'
import {
  CCIPApiClientNotAvailableError,
  CCIPChainFamilyMismatchError,
  CCIPTransactionNotFinalizedError,
} from './errors/index.ts'
import type { UnsignedEVMTx } from './evm/types.ts'
import type {
  EVMExtraArgsV1,
  EVMExtraArgsV2,
  ExtraArgs,
  SVMExtraArgsV1,
  SuiExtraArgsV1,
} from './extra-args.ts'
import type { LeafHasher } from './hasher/common.ts'
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
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ExecutionState,
} from './types.ts'
import { util } from './utils.ts'

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
   * - `undefined` (default): Creates CCIPAPIClient with production endpoint
   *   (https://api.ccip.chain.link)
   * - `CCIPAPIClient`: Uses provided instance (allows custom URL, fetch, etc.)
   * - `null`: Disables API client entirely (getLaneLatency() will throw)
   *
   * Default: `undefined` (auto-create with production endpoint)
   */
  apiClient?: CCIPAPIClient | null
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
}

/**
 * Works like an interface for a base Chain class, but provides implementation (which can be
 * specialized) for some basic methods
 */
export abstract class Chain<F extends ChainFamily = ChainFamily> {
  /** Network configuration including chain selector, name, and family. */
  readonly network: NetworkInfo<F>
  /** Logger instance for debugging and informational output. */
  logger: Logger
  /** CCIP API client (null if opted out) */
  readonly apiClient: CCIPAPIClient | null

  /**
   * Base constructor for Chain class.
   * @param network - NetworkInfo object for the Chain instance
   * @param ctx - Optional context with logger and API client configuration
   */
  constructor(network: NetworkInfo, ctx?: ChainContext) {
    const { logger = console, apiClient } = ctx ?? {}

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
    } else if (apiClient !== undefined) {
      this.apiClient = apiClient // Use provided instance
    } else {
      this.apiClient = new CCIPAPIClient(undefined, { logger }) // Default
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
   * @throws CCIPBlockNotFoundError - When the specified block does not exist or is not yet finalized
   * @throws CCIPBlockTimeNotFoundError - When block exists but timestamp cannot be retrieved
   * @example
   * ```typescript
   * const timestamp = await chain.getBlockTimestamp(12345678)
   * console.log('Block time:', new Date(timestamp * 1000))
   * ```
   */
  abstract getBlockTimestamp(block: number | 'finalized'): Promise<number>
  /**
   * Fetch a transaction by its hash
   * @param hash - transaction hash
   * @returns generic transaction details
   * @throws CCIPTransactionNotFoundError - When transaction with the given hash does not exist
   * @example
   * ```typescript
   * const tx = await chain.getTransaction('0x123...')
   * console.log('Block:', tx.blockNumber)
   * console.log('Status:', tx.status)
   * ```
   */
  abstract getTransaction(hash: string): Promise<ChainTransaction>
  /**
   * Confirm a log tx is finalized or wait for it to be finalized
   * Throws if it isn't included (e.g. a reorg)
   */
  async waitFinalized(
    {
      log,
      tx,
    }: SetOptional<
      PickDeep<
        CCIPRequest,
        | `log.${'address' | 'blockNumber' | 'transactionHash' | 'topics' | 'tx.timestamp'}`
        | 'tx.timestamp'
      >,
      'tx'
    >,
    finality: number | 'finalized' = 'finalized',
    cancel$?: Promise<unknown>,
  ): Promise<true> {
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
      topics: [log.topics[0]],
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
   *     otherwise, returns logs backwards in time from endBlock;
   *     optionally, startTime may be provided to fetch logs forward starting from this time
   *   - `endBlock`: if omitted, use latest block
   *   - `endBefore`: optional hint signature for end of iteration, instead of endBlock
   *   - `address`: if provided, fetch logs for this address only (may be required in some
   *     networks/implementations)
   *   - `topics`: if provided, fetch logs for these topics only;
   *     if string[], it's assumed to be a list of topic0s (i.e. string[] or string[][0], event_ids);
   *     some networks/implementations may not be able to filter topics other than topic0s, so one may
   *     want to assume those are optimization hints, instead of hard filters, and verify results
   *   - `page`: if provided, try to use this page/range for batches
   * @returns An async iterable iterator of logs.
   *
   * @remarks
   * Behavior varies by chain family:
   * - **EVM**: Full topic filtering, supports both startBlock and endBlock
   * - **Solana**: Requires address (program ID), may have pagination limits
   * - **Aptos**: Different log structure and filtering capabilities
   *
   * Fetching forward (with startBlock) is generally faster when you know the starting point.
   * Fetching backward (without startBlock) is slower but can discover the most recent logs first.
   */
  abstract getLogs(opts: LogFilter): AsyncIterableIterator<Log_>

  /**
   * Fetch all CCIP requests in a transaction
   * @param tx - ChainTransaction or txHash to fetch requests from
   * @returns CCIP messages in the transaction (at least one)
   * @throws CCIPTransactionNotFoundError - When transaction does not exist
   * @throws CCIPMessageNotFoundInTxError - When transaction contains no CCIP messages
   * @throws CCIPMessageDecodeError - When CCIP message data cannot be decoded
   * @example
   * ```typescript
   * const chain = await EVMChain.fromUrl('https://rpc.sepolia.org')
   * const requests = await chain.fetchRequestsInTx('0x123...')
   * for (const req of requests) {
   *   console.log('Message ID:', req.message.header.messageId)
   *   console.log('Destination:', req.lane.destChainSelector)
   * }
   * ```
   **/
  abstract getMessagesInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]>

  /**
   * Scan for a CCIP request by message ID
   * @param messageId - message ID to fetch request for
   * @param onRamp - address may be required in some implementations, and throw if missing
   * @returns CCIPRequest
   * @throws CCIPMessageIdNotFoundError - When no message with the given ID is found
   * @throws CCIPOnRampRequiredError - When onRamp address is required but not provided
   **/
  getMessageById?(
    messageId: string,
    onRamp?: string,
    opts?: { page?: number },
  ): Promise<CCIPRequest>

  /**
   * Fetches all CCIP messages contained in a given commit batch.
   * @param request - CCIPRequest to fetch batch for.
   * @param commit - CommitReport range (min, max).
   * @param opts - Optional parameters (e.g., `page` for pagination width).
   * @throws CCIPMessageBatchIncompleteError - When not all messages in the batch could be fetched
   * @throws CCIPMessageNotInBatchError - When the request's message is not in the specified batch range
   */
  abstract fetchAllMessagesInBatch<
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
   * @throws CCIPContractTypeInvalidError - When the contract does not have a valid typeAndVersion
   * @throws CCIPTypeVersionInvalidError - When typeAndVersion string cannot be parsed
   * @example
   * ```typescript
   * const [type, version, raw] = await chain.typeAndVersion('0xOnRampAddress')
   * console.log(`${type} v${version}`) // "OnRamp v1.6.0"
   * ```
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
   * @see {@link getOnRampForRouter} - Inverse lookup
   */
  abstract getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string>
  /**
   * Fetch the Router address set in OffRamp config
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - source chain selector
   * @returns Router address
   * @see {@link getOnRampForOffRamp} - Get OnRamp from OffRamp
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
   * @see {@link getRouterForOnRamp} - Inverse lookup
   */
  abstract getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string>
  /**
   * Fetch the OnRamp address set in OffRamp config
   * Used to discover OffRamp connected to an OnRamp
   * @param offRamp - OffRamp contract address
   * @param sourceChainSelector - source chain selector
   * @returns OnRamp address
   * @see {@link getRouterForOffRamp} - Get Router from OffRamp
   */
  abstract getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string>
  /**
   * Fetch the CommitStore set in OffRamp config (CCIP v1.5 and earlier).
   * For CCIP v1.6 and later, it should return the offRamp address.
   * @param offRamp - OffRamp contract address.
   * @returns CommitStore address.
   * @see {@link getOnRampForOffRamp} - Get OnRamp from OffRamp
   * @see {@link getRouterForOffRamp} - Get Router from OffRamp
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
   * @throws CCIPTokenNotInRegistryError - When token is not found at the address
   * @example
   * ```typescript
   * const info = await chain.getTokenInfo('0xLINKAddress')
   * console.log(`${info.symbol}: ${info.decimals} decimals`)
   * ```
   */
  abstract getTokenInfo(token: string): Promise<TokenInfo>
  /**
   * Fetch TokenAdminRegistry configured in a given OnRamp, Router, etc
   * Needed to map a source token to its dest counterparts
   * @param address - Some contract for which we can fetch a TokenAdminRegistry
   * @see {@link getRegistryTokenConfig} - Get token config from registry
   * @see {@link getSupportedTokens} - List tokens in registry
   */
  abstract getTokenAdminRegistryFor(address: string): Promise<string>
  /**
   * Fetch the current fee for a given intended message
   * @param router - router address on this chain
   * @param destChainSelector - dest network selector
   * @param message - message to send
   * @throws CCIPContractNotRouterError - When the address is not a valid Router contract
   * @throws CCIPChainNotFoundError - When the destination chain is not supported
   * @throws CCIPTokenNotConfiguredError - When a token in the message is not supported
   * @example
   * ```typescript
   * import { networkInfo } from '@chainlink/ccip-sdk'
   *
   * const fee = await chain.getFee(
   *   '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59', // Router
   *   networkInfo('avalanche-testnet-fuji').chainSelector,
   *   { receiver: '0x...', data: '0x', tokenAmounts: [] }
   * )
   * console.log('Fee:', fee.toString(), 'wei')
   * ```
   * @see {@link generateUnsignedSendMessage} - Build unsigned tx with fee
   * @see {@link sendMessage} - Send message with wallet
   */
  abstract getFee(router: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint>
  /**
   * Generate unsigned txs for ccipSend'ing a message
   * @param sender - sender address
   * @param router - address of the Router contract
   * @param destChainSelector - chainSelector of destination chain
   * @param message - AnyMessage to send; if `fee` is not present, it'll be calculated
   * @param opts - Optional parameters: `approveMax` to approve maximum allowance for token transfers
   * @returns chain-family specific unsigned txs
   * @example
   * ```typescript
   * import { networkInfo } from '@chainlink/ccip-sdk'
   *
   * const unsignedTx = await chain.generateUnsignedSendMessage(
   *   '0xSenderAddress',
   *   '0xRouterAddress',
   *   networkInfo('avalanche-testnet-fuji').chainSelector,
   *   {
   *     receiver: '0xReceiverAddress',
   *     data: '0x',
   *     tokenAmounts: [],
   *   }
   * )
   * // Sign and send the transaction with your wallet
   * ```
   * @see {@link getFee} - Calculate fee before building tx
   * @see {@link sendMessage} - Higher-level method with wallet
   */
  abstract generateUnsignedSendMessage(
    sender: string,
    router: string,
    destChainSelector: bigint,
    message: AnyMessage & { fee?: bigint },
    opts?: { approveMax?: boolean },
  ): Promise<UnsignedTx[F]>
  /**
   * Send a CCIP message through a router using provided wallet.
   * @param router - Router address on this chain.
   * @param destChainSelector - Destination network selector.
   * @param message - Message to send.
   * @param opts - Optional parameters:
   *   - `wallet`: cli or environmental parameters to help pick a wallet
   *   - `approveMax`: approve the maximum amount of tokens to transfer
   * @throws CCIPWalletNotSignerError - When wallet cannot sign transactions
   * @throws CCIPContractNotRouterError - When the address is not a valid Router contract
   * @throws CCIPChainNotFoundError - When destination chain is not supported
   * @throws CCIPTokenNotConfiguredError - When a token in the message is not supported
   * @example
   * ```typescript
   * import { networkInfo } from '@chainlink/ccip-sdk'
   *
   * const request = await chain.sendMessage(
   *   '0xRouterAddress',
   *   networkInfo('avalanche-testnet-fuji').chainSelector,
   *   { receiver: '0x...', data: '0x', tokenAmounts: [] },
   *   { wallet: myWallet }
   * )
   * console.log('Message ID:', request.message.header.messageId)
   * ```
   * @see {@link getFee} - Get the fee before sending
   * @see {@link generateUnsignedSendMessage} - Generate unsigned transaction
   */
  abstract sendMessage(
    router: string,
    destChainSelector: bigint,
    message: AnyMessage & { fee?: bigint },
    opts: { wallet: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest>
  /**
   * Fetch supported offchain token data for a request from this network
   * @param request - CCIP request, with tx, logs and message
   * @returns array with one offchain token data for each token transfer in request
   */
  abstract fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]>
  /**
   * Generate unsigned tx to manuallyExecute a message
   * @param payer - address which will be used to transmit the report tx
   * @param offRamp - address of the OffRamp contract
   * @param execReport - execution report
   * @param opts - Execution options: `gasLimit` for ccipReceive override, `tokensGasLimit` for EVM tokenPool,
   *   `forceBuffer` for Solana chunked reports, `forceLookupTable` for Solana lookup tables
   * @returns chain-family specific unsigned txs
   * @see {@link calculateManualExecProof} - Build execution report with proofs
   * @see {@link executeReport} - Execute with wallet
   * @see {@link discoverOffRamp} - Find OffRamp address
   */
  abstract generateUnsignedExecuteReport(
    payer: string,
    offRamp: string,
    execReport: ExecutionReport,
    opts: {
      gasLimit?: number
      tokensGasLimit?: number
      forceBuffer?: boolean
      forceLookupTable?: boolean
    },
  ): Promise<UnsignedTx[F]>
  /**
   * Execute messages in report in an offRamp
   * @param offRamp - offRamp address on this dest chain
   * @param execReport - execution report containing messages to execute, proofs and offchainTokenData
   * @param opts - Execution options: `wallet` for signing, `gasLimit` override, `tokensGasLimit` for EVM,
   *   `forceBuffer` and `forceLookupTable` for Solana
   * @returns transaction of the execution
   * @throws CCIPWalletNotSignerError - When wallet cannot sign transactions
   * @throws CCIPExecTxRevertedError - When the execution transaction reverts
   * @throws CCIPExecTxNotConfirmedError - When the transaction is not confirmed within timeout
   * @example
   * ```typescript
   * import { calculateManualExecProof } from '@chainlink/ccip-sdk'
   *
   * const execReport = await calculateManualExecProof(request, { source, dest })
   * const tx = await dest.executeReport(offRamp, execReport, { wallet: myWallet })
   * console.log('Executed in tx:', tx.hash)
   * ```
   * @see {@link calculateManualExecProof} - Build execution report with proofs
   * @see {@link generateUnsignedExecuteReport} - Generate unsigned tx
   * @see {@link discoverOffRamp} - Find OffRamp address
   */
  abstract executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts: {
      wallet: unknown
      gasLimit?: number
      tokensGasLimit?: number
      forceBuffer?: boolean
      forceLookupTable?: boolean
    },
  ): Promise<ChainTransaction>

  /**
   * Look for a CommitReport at dest for given CCIP request
   * May be specialized by some subclasses
   *
   * @param commitStore - Commit store address
   * @param request - CCIPRequest to get commit info for
   * @param hints - Additional filtering hints
   * @returns CCIPCommit info, or reject if none found
   * @throws CCIPCommitNotFoundError - When no commit report is found for the request
   * @example
   * ```typescript
   * const commit = await destChain.fetchCommitReport(
   *   commitStoreAddress,
   *   request
   * )
   * console.log('Committed at block:', commit.log.blockNumber)
   * console.log('Merkle root:', commit.report.merkleRoot)
   * ```
   * @see {@link fetchExecutionReceipts} - Check if message was executed
   **/
  async fetchCommitReport(
    commitStore: string,
    request: PickDeep<CCIPRequest, 'lane' | 'message.sequenceNumber' | 'tx.timestamp'>,
    hints?: Pick<LogFilter, 'page' | 'watch'> & { startBlock?: number },
  ): Promise<CCIPCommit> {
    return fetchCommitReport(this, commitStore, request, hints)
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
   * Default/generic implementation of fetchExecutionReceipts
   * @param offRamp - Off-ramp address
   * @param request - CCIPRequest to get execution receipts for
   * @param commit - CCIPCommit info to help narrowing search for executions
   * @param hints - Additional filtering hints
   * @returns Async generator of CCIPExecution receipts
   * @example
   * ```typescript
   * for await (const exec of destChain.fetchExecutionReceipts(offRamp, request, commit)) {
   *   console.log('State:', exec.receipt.state) // 0=Untouched, 1=InProgress, 2=Success, 3=Failure
   *   if (exec.receipt.state === 2) {
   *     console.log('Successfully executed!')
   *   }
   * }
   * ```
   * @see {@link fetchCommitReport} - Check if message was committed first
   */
  async *fetchExecutionReceipts(
    offRamp: string,
    request: PickDeep<CCIPRequest, 'lane' | 'message.messageId' | 'tx.timestamp'>,
    commit?: CCIPCommit,
    hints?: Pick<LogFilter, 'page' | 'watch'>,
  ): AsyncIterableIterator<CCIPExecution> {
    const onlyLast = !commit?.log.blockNumber && !request.tx.timestamp // backwards
    for await (const log of this.getLogs({
      startBlock: commit?.log.blockNumber,
      startTime: request.tx.timestamp,
      address: offRamp,
      topics: ['ExecutionStateChanged'],
      ...hints,
    })) {
      const receipt = (this.constructor as ChainStatic).decodeReceipt(log)
      if (!receipt || receipt.messageId !== request.message.messageId) continue

      const timestamp = log.tx?.timestamp ?? (await this.getBlockTimestamp(log.blockNumber))
      yield { receipt, log, timestamp }
      if (onlyLast || receipt.state === ExecutionState.Success) break
    }
  }

  /**
   * List tokens supported by given TokenAdminRegistry contract.
   * @param address - Usually TokenAdminRegistry, but chain may support receiving Router, OnRamp, etc.
   * @param opts - Optional parameters (e.g., `page` for pagination range).
   * @returns Array of supported token addresses.
   * @example
   * ```typescript
   * const tokens = await chain.getSupportedTokens(tokenAdminRegistry)
   * for (const token of tokens) {
   *   const info = await chain.getTokenInfo(token)
   *   console.log(`${info.symbol}: ${token}`)
   * }
   * ```
   */
  abstract getSupportedTokens(address: string, opts?: { page?: number }): Promise<string[]>

  /**
   * Get TokenConfig for a given token address in a TokenAdminRegistry
   * @param registry - TokenAdminRegistry contract address
   * @param token - Token address
   * @example
   * ```typescript
   * const config = await chain.getRegistryTokenConfig(registry, tokenAddress)
   * console.log('Administrator:', config.administrator)
   * console.log('Token Pool:', config.tokenPool)
   * ```
   * @see {@link getTokenAdminRegistryFor} - Get registry address
   * @see {@link getTokenPoolConfigs} - Get pool configuration
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
   * @example
   * ```typescript
   * const poolConfig = await chain.getTokenPoolConfigs(tokenPoolAddress)
   * console.log('Token:', poolConfig.token)
   * console.log('Router:', poolConfig.router)
   * ```
   * @see {@link getTokenPoolRemotes} - Get remote chain configs
   * @see {@link getRegistryTokenConfig} - Get registry config
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
   * @example
   * ```typescript
   * const remotes = await chain.getTokenPoolRemotes(tokenPoolAddress)
   * for (const [network, remote] of Object.entries(remotes)) {
   *   console.log(`${network}: ${remote.remoteToken}`)
   * }
   * ```
   * @see {@link getTokenPoolConfigs} - Get pool configuration
   */
  abstract getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>>

  /**
   * Fetch list and info of supported feeTokens.
   * @param router - Router address on this chain.
   * @returns Mapping of token addresses to respective TokenInfo objects.
   * @example
   * ```typescript
   * const feeTokens = await chain.getFeeTokens(routerAddress)
   * for (const [address, info] of Object.entries(feeTokens)) {
   *   console.log(`${info.symbol} (${address})`)
   * }
   * ```
   */
  abstract getFeeTokens(router: string): Promise<Record<string, TokenInfo>>
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
   * Decode a receipt (ExecutioStateChanged) event
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
}

/** Function type for getting a Chain instance by ID, selector, or name. */
export type ChainGetter = (idOrSelectorOrName: number | string | bigint) => Promise<Chain>
