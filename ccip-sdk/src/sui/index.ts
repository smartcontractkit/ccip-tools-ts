import { type BytesLike, isBytesLike } from 'ethers'
import type { PickDeep } from 'type-fest'

import { AptosChain } from '../aptos/index.ts'
import { type LogFilter, Chain } from '../chain.ts'
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
  ChainFamily,
} from '../types.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

export class SuiChain extends Chain<typeof ChainFamily.Sui> {
  static {
    supportedChains[ChainFamily.Sui] = SuiChain
  }
  static readonly family = ChainFamily.Sui
  static readonly decimals = 8

  readonly network: NetworkInfo<typeof ChainFamily.Sui>

  constructor(network: NetworkInfo<typeof ChainFamily.Sui>) {
    super()

    this.network = network
  }

  static async fromUrl(_url: string): Promise<SuiChain> {
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
  static decodeMessage(_log: Log_): CCIPMessage_V1_6_Sui | undefined {
    throw new Error('Not implemented')
  }

  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | undefined {
    return AptosChain.decodeExtraArgs(extraArgs)
  }

  static encodeExtraArgs(extraArgs: ExtraArgs): string {
    return AptosChain.encodeExtraArgs(extraArgs)
  }

  static decodeCommits(_log: Log_, _lane?: Lane): CommitReport[] | undefined {
    throw new Error('Not implemented')
  }

  static decodeReceipt(_log: Log_): ExecutionReceipt | undefined {
    throw new Error('Not implemented')
  }

  static getAddress(bytes: BytesLike): string {
    return AptosChain.getAddress(bytes)
  }

  static getDestLeafHasher(lane: Lane): LeafHasher {
    return getSuiLeafHasher(lane)
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
      throw new Error('Invalid message, not v1.6 Sui')
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
