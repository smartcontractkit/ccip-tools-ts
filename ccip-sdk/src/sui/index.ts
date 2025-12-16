import { type BytesLike, isBytesLike } from 'ethers'
import type { PickDeep } from 'type-fest'

import { AptosChain } from '../aptos/index.ts'
import { type LogFilter, Chain } from '../chain.ts'
import { CCIPNotImplementedError, CCIPSuiMessageVersionInvalidError } from '../errors/index.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1 } from '../extra-args.ts'
import { getSuiLeafHasher } from './hasher.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
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
} from '../types.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

/**
 * Sui chain implementation supporting Sui networks.
 * Note: This implementation is currently a placeholder.
 */
export class SuiChain extends Chain<typeof ChainFamily.Sui> {
  static {
    supportedChains[ChainFamily.Sui] = SuiChain
  }
  static readonly family = ChainFamily.Sui
  static readonly decimals = 8

  /**
   * Creates a new SuiChain instance.
   * @param network - Sui network configuration.
   */
  constructor(network: NetworkInfo<typeof ChainFamily.Sui>, ctx?: WithLogger) {
    super(network, ctx)
  }

  /**
   * Creates a SuiChain instance from an RPC URL.
   * @param _url - RPC endpoint URL.
   * @returns A new SuiChain instance.
   */
  static async fromUrl(_url: string, _ctx?: WithLogger): Promise<SuiChain> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.fromUrl'))
  }

  /** {@inheritDoc Chain.getBlockTimestamp} */
  async getBlockTimestamp(_version: number | 'finalized'): Promise<number> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getBlockTimestamp'))
  }

  /** {@inheritDoc Chain.getTransaction} */
  async getTransaction(_hash: string | number): Promise<ChainTransaction> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTransaction'))
  }

  /** {@inheritDoc Chain.getLogs} */
  // eslint-disable-next-line require-yield
  async *getLogs(_opts: LogFilter & { versionAsHash?: boolean }) {
    await Promise.resolve()
    throw new CCIPNotImplementedError()
  }

  /** {@inheritDoc Chain.fetchRequestsInTx} */
  override async fetchRequestsInTx(_tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.fetchRequestsInTx'))
  }

  /** {@inheritDoc Chain.fetchAllMessagesInBatch} */
  override async fetchAllMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    _request: R,
    _commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    _opts?: { page?: number },
  ): Promise<R['message'][]> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.fetchAllMessagesInBatch'))
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(
    _address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.typeAndVersion'))
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getRouterForOnRamp'))
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getRouterForOffRamp'))
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getNativeTokenForRouter'))
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  getOffRampsForRouter(_router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getOffRampsForRouter'))
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getOnRampForRouter'))
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getOnRampForOffRamp'))
  }

  /** {@inheritDoc Chain.getCommitStoreForOffRamp} */
  getCommitStoreForOffRamp(_offRamp: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getCommitStoreForOffRamp'))
  }

  /** {@inheritDoc Chain.getTokenForTokenPool} */
  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenForTokenPool'))
  }

  /** {@inheritDoc Chain.getTokenInfo} */
  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number }> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenInfo'))
  }

  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenAdminRegistryFor'))
  }

  // Static methods for decoding
  /**
   * Decodes a CCIP message from a Sui log event.
   * @param _log - Log event data.
   * @returns Decoded CCIPMessage or undefined if not valid.
   */
  static decodeMessage(_log: Log_): CCIPMessage_V1_6_Sui | undefined {
    throw new CCIPNotImplementedError()
  }

  /**
   * Decodes extra arguments from Sui CCIP messages.
   * @param extraArgs - Encoded extra arguments bytes.
   * @returns Decoded extra arguments or undefined if unknown format.
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | undefined {
    return AptosChain.decodeExtraArgs(extraArgs)
  }

  /**
   * Encodes extra arguments for Sui CCIP messages.
   * @param extraArgs - Extra arguments to encode.
   * @returns Encoded extra arguments as hex string.
   */
  static encodeExtraArgs(extraArgs: ExtraArgs): string {
    return AptosChain.encodeExtraArgs(extraArgs)
  }

  /**
   * Decodes commit reports from a Sui log event.
   * @param _log - Log event data.
   * @param _lane - Lane info for filtering.
   * @returns Array of CommitReport or undefined if not valid.
   */
  static decodeCommits(_log: Log_, _lane?: Lane): CommitReport[] | undefined {
    throw new CCIPNotImplementedError()
  }

  /**
   * Decodes an execution receipt from a Sui log event.
   * @param _log - Log event data.
   * @returns ExecutionReceipt or undefined if not valid.
   */
  static decodeReceipt(_log: Log_): ExecutionReceipt | undefined {
    throw new CCIPNotImplementedError()
  }

  /**
   * Converts bytes to a Sui address.
   * @param bytes - Bytes to convert.
   * @returns Sui address.
   */
  static getAddress(bytes: BytesLike): string {
    return AptosChain.getAddress(bytes)
  }

  /**
   * Validates a transaction hash format for Sui
   */
  static isTxHash(_v: unknown): _v is string {
    return false
  }

  /**
   * Gets the leaf hasher for Sui destination chains.
   * @param lane - Lane configuration.
   * @returns Leaf hasher function.
   */
  static getDestLeafHasher(lane: Lane, _ctx?: WithLogger): LeafHasher {
    return getSuiLeafHasher(lane)
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getFee'))
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  override generateUnsignedSendMessage(
    _sender: string,
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee?: bigint },
    _opts?: { approveMax?: boolean },
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.generateUnsignedSendMessage'))
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.sendMessage'))
  }

  /** {@inheritDoc Chain.fetchOffchainTokenData} */
  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    if (!('receiverObjectIds' in request.message)) {
      throw new CCIPSuiMessageVersionInvalidError()
    }
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteReport} */
  override generateUnsignedExecuteReport(
    _payer: string,
    _offRamp: string,
    _execReport: ExecutionReport,
    _opts: object,
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.generateUnsignedExecuteReport'))
  }

  /** {@inheritDoc Chain.executeReport} */
  async executeReport(
    _offRamp: string,
    _execReport: ExecutionReport,
    _opts?: { wallet?: unknown; gasLimit?: number },
  ): Promise<ChainTransaction> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.executeReport'))
  }

  /**
   * Parses raw Sui data into typed structures.
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
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getSupportedTokens'))
  }

  /** {@inheritDoc Chain.getRegistryTokenConfig} */
  async getRegistryTokenConfig(_address: string, _tokenName: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getRegistryTokenConfig'))
  }

  /** {@inheritDoc Chain.getTokenPoolConfigs} */
  async getTokenPoolConfigs(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenPoolConfigs'))
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenPoolRemotes'))
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getFeeTokens'))
  }
}
