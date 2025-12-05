import { Cell, beginCell } from '@ton/core'
import { type BytesLike, isBytesLike } from 'ethers'
import type { PickDeep } from 'type-fest'

import { type LogFilter, Chain } from '../chain.ts'
import { type ExtraArgs, GenericExtraArgsV2 } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPMessage_V1_6,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  ChainFamily,
} from '../types.ts'
import { getDataBytes } from '../utils.ts'
import { getTONLeafHasher } from './hasher.ts'

type CCIPMessage_V1_6_TON = CCIPMessage_V1_6 & GenericExtraArgsV2
const GENERIC_V2_EXTRA_ARGS_TAG = Number.parseInt(GenericExtraArgsV2, 16)

export class TONChain extends Chain<typeof ChainFamily.TON> {
  static {
    supportedChains[ChainFamily.TON] = TONChain
  }
  static readonly family = ChainFamily.TON
  static readonly decimals = 8

  readonly network: NetworkInfo<typeof ChainFamily.TON>

  constructor(network: NetworkInfo<typeof ChainFamily.TON>) {
    super()

    this.network = network
  }

  static async fromUrl(_url: string): Promise<TONChain> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getBlockTimestamp(_version: number | 'finalized'): Promise<number> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getTransaction(_hash: string | number): Promise<ChainTransaction> {
    return Promise.reject(new Error('Not implemented'))
  }

  // eslint-disable-next-line require-yield
  async *getLogs(_opts: LogFilter & { versionAsHash?: boolean }) {
    await Promise.resolve()
    throw new Error('Not implemented')
  }

  override async fetchRequestsInTx(_tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  override async fetchAllMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.header.sequenceNumber'
    >,
  >(
    _request: R,
    _commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    _opts?: { page?: number },
  ): Promise<R['message'][]> {
    return Promise.reject(new Error('Not implemented'))
  }

  async typeAndVersion(
    _address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
    return Promise.reject(new Error('Not implemented'))
  }

  getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  getOffRampsForRouter(_router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getOnRampForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  getCommitStoreForOffRamp(_offRamp: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number }> {
    return Promise.reject(new Error('Not implemented'))
  }

  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getWalletAddress(_opts?: { wallet?: unknown }): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  // Static methods for decoding
  static decodeMessage(_log: Log_): CCIPMessage_V1_6_TON | undefined {
    throw new Error('Not implemented')
  }

  /**
   * Encodes extra args from TON messages into BOC serialization format.
   *
   * @param args - Extra arguments containing gas limit and execution flags
   * @returns Hex string of BOC-encoded extra args (0x-prefixed)
   */
  static encodeExtraArgs(args: ExtraArgs): string {
    if (!args) return '0x'
    if ('gasLimit' in args && 'allowOutOfOrderExecution' in args) {
      const cell = beginCell()
        .storeUint(GENERIC_V2_EXTRA_ARGS_TAG, 32) // magic tag
        .storeUint(args.gasLimit, 256) // gasLimit
        .storeBit(args.allowOutOfOrderExecution) // bool
        .endCell()

      // Return full BOC including headers
      return '0x' + cell.toBoc().toString('hex')
    }
    return '0x'
  }

  /**
   * Decodes BOC-encoded extra arguments from TON messages
   * Parses the BOC format and extracts extra args, validating the magic tag
   * to ensure correct type. Returns undefined if parsing fails or tag doesn't match.
   *
   * @param extraArgs - BOC-encoded extra args as hex string or bytes
   * @returns Decoded GenericExtraArgsV2 object or undefined if invalid
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ): (GenericExtraArgsV2 & { _tag: 'GenericExtraArgsV2' }) | undefined {
    const data = Buffer.from(getDataBytes(extraArgs))

    try {
      // Parse BOC format to extract cell data
      const cell = Cell.fromBoc(data)[0]
      const slice = cell.beginParse()

      // Load and verify magic tag to ensure correct extra args type
      const magicTag = slice.loadUint(32)
      if (magicTag !== GENERIC_V2_EXTRA_ARGS_TAG) return undefined

      return {
        _tag: 'GenericExtraArgsV2',
        gasLimit: slice.loadUintBig(256),
        allowOutOfOrderExecution: slice.loadBit(),
      }
    } catch {
      // Return undefined for any parsing errors (invalid BOC, malformed data, etc.)
      return undefined
    }
  }

  static decodeCommits(_log: Log_, _lane?: Lane): CommitReport[] | undefined {
    throw new Error('Not implemented')
  }

  static decodeReceipt(_log: Log_): ExecutionReceipt | undefined {
    throw new Error('Not implemented')
  }

  static getAddress(_bytes: BytesLike): string {
    throw new Error('Not implemented')
  }

  static getDestLeafHasher(lane: Lane): LeafHasher {
    return getTONLeafHasher(lane)
  }

  async getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    return Promise.reject(new Error('Not implemented'))
  }

  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    return Promise.reject(new Error('Not implemented'))
  }

  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    if (!('receiverObjectIds' in request.message)) {
      throw new Error('Invalid message, not v1.6 TON')
    }
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  async executeReport(
    _offRamp: string,
    _execReport: ExecutionReport,
    _opts?: { wallet?: unknown; gasLimit?: number },
  ): Promise<ChainTransaction> {
    return Promise.reject(new Error('Not implemented'))
  }

  static parse(data: unknown) {
    if (isBytesLike(data)) {
      const parsedExtraArgs = this.decodeExtraArgs(data)
      if (parsedExtraArgs) return parsedExtraArgs
    }
  }

  async getSupportedTokens(_address: string): Promise<string[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getRegistryTokenConfig(_address: string, _tokenName: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getTokenPoolConfigs(_tokenPool: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }
}
