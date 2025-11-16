import { type BytesLike, isBytesLike, isHexString } from 'ethers'

import { AptosChain } from '../aptos/index.ts'
import { type ChainTransaction, type LogFilter, Chain, ChainFamily } from '../chain.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1 } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import type {
  AnyMessage,
  CCIPRequest,
  CommitReport,
  ExecutionReceipt,
  ExecutionReport,
  Lane,
  Log_,
  NetworkInfo,
  OffchainTokenData,
} from '../types.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

export class SuiChain extends Chain<typeof ChainFamily.Sui> {
  static readonly family = ChainFamily.Sui
  static readonly decimals = 8

  readonly network: NetworkInfo<typeof ChainFamily.Sui>

  constructor() {
    super()
    throw new Error('Not implemented')
  }

  static async fromUrl(_url: string): Promise<SuiChain> {
    return Promise.reject(new Error('Not implemented'))
  }

  static txFromUrl(url: string, txHash: string): [Promise<SuiChain>, Promise<ChainTransaction>] {
    const chainPromise = SuiChain.fromUrl(url)
    const txPromise = isHexString(txHash, 32)
      ? chainPromise.then(async (chain) => chain.getTransaction(txHash))
      : Promise.reject(new Error(`Invalid transaction hash: ${txHash}`))
    return [chainPromise, txPromise]
  }

  async destroy(): Promise<void> {
    // Nothing to cleanup for Aptos implementation
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

  getTokenAdminRegistryForOnRamp(_onRamp: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getTokenPoolForToken(_registry: string, _token: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  async getRemoteTokenForTokenPool(
    _tokenPool: string,
    _remoteChainSelector: bigint,
  ): Promise<string> {
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

  static getDestLeafHasher(_lane: Lane): LeafHasher {
    throw new Error('Not implemented')
  }

  async getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    return Promise.reject(new Error('Not implemented'))
  }

  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<ChainTransaction> {
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
}

supportedChains[ChainFamily.Sui] = SuiChain
