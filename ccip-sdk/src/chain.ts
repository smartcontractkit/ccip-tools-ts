import util from 'util'

import type { BytesLike } from 'ethers'

import { fetchCommitReport } from './commits.ts'
import { fetchExecutionReceipts } from './execution.ts'
import type {
  EVMExtraArgsV1,
  EVMExtraArgsV2,
  ExtraArgs,
  SVMExtraArgsV1,
  SuiExtraArgsV1,
} from './extra-args.ts'
import type { LeafHasher } from './hasher/common.ts'
import type {
  AnyMessage,
  CCIPCommit,
  CCIPExecution,
  CCIPMessage,
  CCIPRequest,
  CommitReport,
  ExecutionReceipt,
  ExecutionReport,
  Lane,
  Log_,
  NetworkInfo,
  OffchainTokenData,
} from './types.ts'

export const ChainFamily = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
} as const
export type ChainFamily = (typeof ChainFamily)[keyof typeof ChainFamily]

export type LogFilter = {
  startBlock?: number
  startTime?: number
  endBlock?: number
  endBefore?: string
  address?: string
  topics?: string[] | string[][]
  page?: number
}

export type ChainTransaction = {
  chain: Chain
  hash: string
  logs: readonly Log_[]
  blockNumber: number
  timestamp: number
  from: string
  error?: unknown
}

export type TokenInfo = {
  readonly symbol: string
  readonly decimals: number
  readonly name?: string
}

export type RateLimiterState = {
  tokens: bigint
  capacity: bigint
  rate: bigint
} | null

export type TokenPoolRemote = {
  remoteToken: string
  remotePools: string[]
  inboundRateLimiterState: RateLimiterState
  outboundRateLimiterState: RateLimiterState
}

/**
 * Works like an interface for a base Chain class, but provides implementation (which can be
 * specialized) for some basic methods
 */
export abstract class Chain<F extends ChainFamily = ChainFamily> {
  abstract readonly network: NetworkInfo<F>
  destroy?(): void | Promise<void>

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
   * @param opts - options object
   * @param opts.startBlock - if provided, fetch and generate logs forward starting from this block;
   *   otherwise, returns logs backwards in time from endBlock;
   *   optionally, startTime may be provided to fetch logs forward starting from this time;
   * @param opts.endBlock - if omitted, use latest block
   * @param opts.endBefore - optional hint signature for end of iteration, instead of endBlock
   * @param opts.address - if provided, fetch logs for this address only (may be required in some
   *   networks/implementations)
   * @param opts.topics - if provided, fetch logs for these topics only;
   *   if string[], it's assumed to be a list of topic0s (i.e. string[] or string[][0], event_ids);
   *   some networks/implementations may not be able to filter topics other than topic0s, so one may
   *   want to assume those are optimization hints, instead of hard filters, and verify results
   * @param opts.page - if provided, try to use this page/range for batches
   * @returns an async iterable iterator of logs
   */
  abstract getLogs(opts: LogFilter): AsyncIterableIterator<Log_>
  /**
   * Fetch the typeAndVersion tag of a given CCIP contract
   * @param address - CCIP contract address
   * @returns typeAndVersion tag, validated and split
   */
  abstract typeAndVersion(
    address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  >

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
   * Fetch the CommitStore set in OffRamp config (CCIP<=v1.5)
   * For CCIP>=v1.6, it should return the offRamp address
   * @param offRamp - OffRamp contract address
   * @returns CommitStore address
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
   * Build, derive, load or fetch a wallet for this instance which will be used in any tx send operation
   * @param opts.wallet - cli or environmental parameters to help pick a wallet
   * @returns address of fetched (and stored internally) account
   */
  abstract getWalletAddress(opts?: { wallet?: unknown }): Promise<string>
  /**
   * Fetch the current fee for a given intended message
   * @param router - router address on this chain
   * @param destChainSelector - dest network selector
   * @param message - message to send
   */
  abstract getFee(router: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint>
  /**
   * Send a CCIP message through a router using loaded wallet
   * @param router - router address on this chain
   * @param destChainSelector - dest network selector
   * @param message - message to send
   * @param opts.wallet - cli or environmental parameters to help pick a wallet
   * @param opts.approveMax - approve the maximum amount of tokens to transfer
   */
  abstract sendMessage(
    router: string,
    destChainSelector: bigint,
    message: AnyMessage & { fee?: bigint },
    opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<ChainTransaction>
  /**
   * Fetch supported offchain token data for a request from this network
   * @param request - CCIP request, with tx, logs and message
   * @returns array with one offchain token data for each token transfer in request
   */
  abstract fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]>
  /**
   * Execute messages in report in an offRamp
   * @param offRamp - offRamp address on this dest chain
   * @param execReport - execution report containing messages to execute, proofs and offchainTokenData
   * @param opts - general options for execution
   * @returns transaction hash of the execution
   */
  abstract executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts?: Record<string, unknown>,
  ): Promise<ChainTransaction>

  /**
   * Look for a CommitReport at dest for given CCIP request
   * May be specialized by some subclasses
   *
   * @param dest - Destination network provider
   * @param request - CCIP request info
   * @param hints - Additional filtering hints
   * @returns CCIP commit info
   **/
  async fetchCommitReport(
    commitStore: string,
    request: {
      lane: Lane
      message: { header: { sequenceNumber: bigint } }
      timestamp?: number
    },
    hints?: { startBlock?: number; page?: number },
  ): Promise<CCIPCommit> {
    return fetchCommitReport(this, commitStore, request, hints)
  }

  /**
   * Default/generic implementation of fetchExecutionReceipts
   * @param offRamp - Off-ramp address
   * @param messageIds - Set of message IDs to fetch receipts for
   * @param hints - Additional filtering hints
   * @returns Async generator of CCIP execution receipts
   */
  async *fetchExecutionReceipts(
    offRamp: string,
    messageIds: Set<string>,
    hints?: { startBlock?: number; startTime?: number; page?: number; commit?: CommitReport },
  ): AsyncGenerator<CCIPExecution> {
    yield* fetchExecutionReceipts(this, offRamp, messageIds, hints)
  }

  /**
   * List tokens supported by given TokenAdminRegistry contract
   * @param address - Usually TokenAdminRegistry, but chain may support receiving Router, OnRamp, etc
   * @param opts.page - Page range, if needed
   * @retursn array of supported token addresses
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
   * Get TokenPool remote configurations
   * @param tokenPool - Token pool address
   * @param remoteChainSelector - If provided, only return remotes for the specified chain (may error if remote not supported)
   * @param Record of network *names* and remote configurations (remoteToken, remotePools, rateLimitStates)
   */
  abstract getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>>

  /**
   * Fetch list and info of supported feeTokens
   * @param router address on this chain
   * @returns mapping of token addresses to respective TokenInfo objects
   */
  abstract getFeeTokens(router: string): Promise<Record<string, TokenInfo>>
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type ChainStatic<F extends ChainFamily = ChainFamily> = Function & {
  readonly family: F
  readonly decimals: number
  /**
   * async constructor: builds a Chain from a rpc endpoint url
   * @param url - rpc endpoint url
   */
  fromUrl(url: string): Promise<Chain<F>>
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
   * @returns LeafHasher is a function that takes a message and returns a hash of it
   */
  getDestLeafHasher(lane: Lane): LeafHasher
  /**
   * Try to parse an error or bytearray generated by this chain family
   * @param error - catched object, string or bytearray
   * @returns Ordered record with messages/properties, or undefined if not a recognized error
   */
  parse?(data: unknown): Record<string, unknown> | undefined | null
}

export type ChainGetter = (idOrSelectorOrName: number | string | bigint) => Promise<Chain>
