import type { BytesLike } from 'ethers'
import type { PickDeep } from 'type-fest'

import type { UnsignedAptosTx } from './aptos/types.ts'
import { fetchCommitReport } from './commits.ts'
import type { UnsignedEVMTx } from './evm/index.ts'
import type {
  EVMExtraArgsV1,
  EVMExtraArgsV2,
  ExtraArgs,
  SVMExtraArgsV1,
  SuiExtraArgsV1,
} from './extra-args.ts'
import type { LeafHasher } from './hasher/common.ts'
import type { UnsignedSolanaTx } from './solana/types.ts'
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
 * Filter options for getLogs queries across chains.
 */
export type LogFilter = {
  /** Starting block number (inclusive). */
  startBlock?: number
  /** Starting Unix timestamp (inclusive). */
  startTime?: number
  /** Ending block number (inclusive). */
  endBlock?: number
  /** Optional hint signature for end of iteration. */
  endBefore?: string
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
  [ChainFamily.Sui]: never // TODO
}

/**
 * Works like an interface for a base Chain class, but provides implementation (which can be
 * specialized) for some basic methods
 */
export abstract class Chain<F extends ChainFamily = ChainFamily> {
  readonly network: NetworkInfo<F>
  logger: Logger

  /**
   * Base constructor for Chain class.
   * @param network - NetworkInfo object for the Chain instance
   */
  constructor(network: NetworkInfo, { logger = console }: WithLogger = {}) {
    if (network.family !== (this.constructor as ChainStatic).family)
      throw new Error(`Invalid network family for ${this.constructor.name}: ${network.family}`)
    this.network = network as NetworkInfo<F>
    this.logger = logger
  }

  /** Cleanup method to release resources (e.g., close connections). */
  destroy?(): void | Promise<void>

  /** Custom inspector for Node.js util.inspect. */
  [util.inspect.custom]() {
    return `${this.constructor.name} { ${this.network.name} }`
  }

  /**
   * Fetch the timestamp of a given block
   * @param block - block number or 'finalized'
   * @returns timestamp of the block, in seconds
   */
  abstract getBlockTimestamp(block: number | 'finalized'): Promise<number>
  /**
   * Fetch a transaction by its hash
   * @param hash - transaction hash
   * @returns generic transaction details
   */
  abstract getTransaction(hash: string): Promise<ChainTransaction>
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
   */
  abstract getLogs(opts: LogFilter): AsyncIterableIterator<Log_>

  /**
   * Fetch all CCIP requests in a transaction
   * @param tx - ChainTransaction or txHash to fetch requests from
   * @returns CCIP messages in the transaction (at least one)
   **/
  abstract fetchRequestsInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]>

  /**
   * Scan for a CCIP request by message ID
   * @param messageId - message ID to fetch request for
   * @param onRamp - address may be required in some implementations, and throw if missing
   * @returns CCIPRequest
   **/
  fetchRequestById?(
    messageId: string,
    onRamp?: string,
    opts?: { page?: number },
  ): Promise<CCIPRequest>

  /**
   * Fetches all CCIP messages contained in a given commit batch.
   * @param request - CCIPRequest to fetch batch for.
   * @param commit - CommitReport range (min, max).
   * @param opts - Optional parameters (e.g., `page` for pagination width).
   */
  abstract fetchAllMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.header.sequenceNumber'
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
   * Fetch TokenAdminRegistry configured in a given OnRamp, Router, etc
   * Needed to map a source token to its dest counterparts
   * @param onRamp - Some contract for which we can fetch a TokenAdminRegistry
   */
  abstract getTokenAdminRegistryFor(address: string): Promise<string>
  /**
   * Fetch the current fee for a given intended message
   * @param router - router address on this chain
   * @param destChainSelector - dest network selector
   * @param message - message to send
   */
  abstract getFee(router: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint>
  /**
   * Generate unsigned txs for ccipSend'ing a message
   * @param sender - sender address
   * @param router - address of the Router contract
   * @param destChainSelector - chainSelector of destination chain
   * @param message - AnyMessage to send; if `fee` is not present, it'll be calculated
   * @param approveMax - if tokens approvals are needed, opt into approving maximum allowance
   * @returns chain-family specific unsigned txs
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
   * @param gasLimit - gasLimit or computeUnits limit override for the ccipReceive call
   * @param tokensGasLimit - For EVM, overrides gasLimit on tokenpPool call
   * @param forceBuffer - For Solana, send report in chunks to OffRamp, to later execute
   * @param forceLookupTable - For Solana, create and extend addresses in a lookup table before executing
   * @returns chain-family specific unsigned txs
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
   * @param opts - general options for execution (see [[generateUnsignedExecuteReport]])
   * @param wallet - chain-specific wallet or signer instance, to sign transactions
   * @returns transaction of the execution
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
   **/
  async fetchCommitReport(
    commitStore: string,
    request: PickDeep<CCIPRequest, 'lane' | 'message.header.sequenceNumber' | 'tx.timestamp'>,
    hints?: { startBlock?: number; page?: number },
  ): Promise<CCIPCommit> {
    return fetchCommitReport(this, commitStore, request, hints)
  }

  /**
   * Default/generic implementation of fetchExecutionReceipts
   * @param offRamp - Off-ramp address
   * @param request - CCIPRequest to get execution receipts for
   * @param commit - CCIPCommit info to help narrowing search for executions
   * @param hints - Additional filtering hints
   * @returns Async generator of CCIPExecution receipts
   */
  async *fetchExecutionReceipts(
    offRamp: string,
    request: PickDeep<CCIPRequest, 'lane' | 'message.header.messageId' | 'tx.timestamp'>,
    commit?: CCIPCommit,
    hints?: { page?: number },
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
      if (!receipt || receipt.messageId !== request.message.header.messageId) continue

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
   */
  abstract getSupportedTokens(address: string, opts?: { page?: number }): Promise<string[]>

  /**
   * Get TokenConfig for a given token address in a TokenAdminRegistry
   * @param address - TokenAdminRegistry contract address
   * @param token - Token address
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
}

/** Static methods and properties available on Chain class constructors. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type ChainStatic<F extends ChainFamily = ChainFamily> = Function & {
  readonly family: F
  readonly decimals: number
  /**
   * async constructor: builds a Chain from a rpc endpoint url
   * @param url - rpc endpoint url
   */
  fromUrl(url: string, ctx?: WithLogger): Promise<Chain<F>>
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
