import { Address, Cell, beginCell } from '@ton/core'
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto'
import { TonClient, WalletContractV4 } from '@ton/ton'
import { type BytesLike, isBytesLike } from 'ethers'
import { memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import { type LogFilter, Chain } from '../chain.ts'
import { type ExtraArgs, type GenericExtraArgsV2, GenericExtraArgsV2Tag } from '../extra-args.ts'
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
import { getDataBytes, networkInfo } from '../utils.ts'
// import { parseTONLogs } from './utils.ts'
import { executeReport } from './exec.ts'
import { getTONLeafHasher } from './hasher.ts'
import type { CCIPMessage_V1_6_TON, TONWallet } from './types.ts'

const GENERIC_V2_EXTRA_ARGS_TAG = Number.parseInt(GenericExtraArgsV2Tag, 16)

/**
 *
 */
export class TONChain extends Chain<typeof ChainFamily.TON> {
  static {
    supportedChains[ChainFamily.TON] = TONChain
  }
  static readonly family = ChainFamily.TON
  static readonly decimals = 8

  readonly network: NetworkInfo<typeof ChainFamily.TON>
  readonly provider: TonClient

  /**
   *
   */
  constructor(client: TonClient, network: NetworkInfo<typeof ChainFamily.TON>) {
    super()
    this.provider = client
    this.network = network

    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
    })
  }

  /**
   *
   */
  static async fromUrl(url: string): Promise<TONChain> {
    const client = new TonClient({ endpoint: url })

    // Detect network from URL
    let networkId: string
    if (url.includes('testnet')) {
      networkId = 'ton-testnet'
    } else if (url.includes('mainnet') || url.includes('toncenter.com/api')) {
      networkId = 'ton-mainnet'
    } else {
      // Default to mainnet for unknown URLs
      networkId = 'ton-mainnet'
    }

    const network = networkInfo(networkId) as NetworkInfo<typeof ChainFamily.TON>
    return new TONChain(client, network)
  }

  /**
   *
   */
  async getBlockTimestamp(_version: number | 'finalized'): Promise<number> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   * Fetches a transaction by its hash.
   *
   * TON transactions are identified by (address, lt, hash).
   * Expected format: "workchain:address:lt:hash"
   * Example: "0:abc123...def:12345:abc123...def"
   *
   * @param hash - Transaction identifier in format "workchain:address:lt:hash"
   * @returns ChainTransaction with transaction details
   */
  async getTransaction(hash: string): Promise<ChainTransaction> {
    const parts = hash.split(':')

    if (parts.length !== 4) {
      throw new Error(
        `Invalid TON transaction hash format: "${hash}". Expected "workchain:address:lt:hash"`,
      )
    }

    const address = Address.parseRaw(`${parts[0]}:${parts[1]}`)
    const lt = parts[2]
    const txHash = parts[3]

    const tx = await this.provider.getTransaction(address, lt, txHash)

    if (!tx) {
      throw new Error(`Transaction not found: ${hash}`)
    }

    return {
      hash,
      logs: [], // TODO
      blockNumber: Number(tx.lt),
      timestamp: tx.now,
      from: address.toString(),
    }
  }

  /**
   *
   */
  async *getLogs(_opts: LogFilter & { versionAsHash?: boolean }) {
    await Promise.resolve()
    throw new Error('Not implemented')
  }

  /**
   *
   */
  override async fetchRequestsInTx(_tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
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

  /**
   *
   */
  async typeAndVersion(
    _address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getOffRampsForRouter(_router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getOnRampForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getCommitStoreForOffRamp(_offRamp: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number }> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getWalletAddress(_opts?: { wallet?: unknown }): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  static getWallet(_opts: { wallet?: unknown } = {}): Promise<any> {
    throw new Error('static TON wallet loading not available')
  }

  /**
   * Loads a TON wallet from various input formats.
   */
  async getWallet(opts: { wallet?: unknown } = {}): Promise<TONWallet> {
    // Handle private key string (hex or base64)
    if (typeof opts.wallet === 'string') {
      // Try mnemonic phrase first (space-separated words)
      const words = opts.wallet.trim().split(/\s+/)
      if (words.length >= 12 && words.length <= 24) {
        const keyPair = await mnemonicToPrivateKey(words)
        const contract = WalletContractV4.create({
          workchain: 0,
          publicKey: keyPair.publicKey,
        })
        return { contract, keyPair }
      }

      // Try hex or base64 secret key (64 bytes)
      let secretKey: Buffer

      if (opts.wallet.startsWith('0x')) {
        secretKey = Buffer.from(opts.wallet.slice(2), 'hex')
      } else {
        try {
          secretKey = Buffer.from(opts.wallet, 'base64')
          if (secretKey.length !== 64) {
            secretKey = Buffer.from(opts.wallet, 'hex')
          }
        } catch {
          secretKey = Buffer.from(opts.wallet, 'hex')
        }
      }

      if (secretKey.length === 64) {
        const keyPair = keyPairFromSecretKey(secretKey)
        const contract = WalletContractV4.create({
          workchain: 0,
          publicKey: keyPair.publicKey,
        })
        return { contract, keyPair }
      }

      throw new Error('Invalid key format. Expected 64-byte secret key or mnemonic phrase.')
    }

    // Handle TONWallet instance directly
    if (
      opts.wallet &&
      typeof opts.wallet === 'object' &&
      'contract' in opts.wallet &&
      'keyPair' in opts.wallet
    ) {
      return opts.wallet as TONWallet
    }

    // Delegate to static method (for CLI overrides)
    return (this.constructor as typeof TONChain).getWallet(opts)
  }

  // Static methods for decoding
  /**
   *
   */
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

  /**
   *
   */
  static decodeCommits(_log: Log_, _lane?: Lane): CommitReport[] | undefined {
    throw new Error('Not implemented')
  }

  /**
   *
   */
  static decodeReceipt(_log: Log_): ExecutionReceipt | undefined {
    throw new Error('Not implemented')
  }

  /**
   *
   */
  static getAddress(_bytes: BytesLike): string {
    throw new Error('Not implemented')
  }

  /**
   *
   */
  static getDestLeafHasher(lane: Lane): LeafHasher {
    return getTONLeafHasher(lane)
  }

  /**
   *
   */
  async getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    if (!('receiverObjectIds' in request.message)) {
      throw new Error('Invalid message, not v1.6 TON')
    }
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /**
   *
   */
  async executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts?: { wallet?: unknown; gasLimit?: number },
  ): Promise<ChainTransaction> {
    const wallet = await this.getWallet(opts)

    const result = await executeReport(
      this.provider,
      wallet,
      offRamp,
      execReport as ExecutionReport<CCIPMessage_V1_6_TON>,
      opts,
    )

    return this.getTransaction(result.hash)
  }

  /**
   *
   */
  static parse(data: unknown) {
    if (isBytesLike(data)) {
      const parsedExtraArgs = this.decodeExtraArgs(data)
      if (parsedExtraArgs) return parsedExtraArgs
    }
  }

  /**
   *
   */
  async getSupportedTokens(_address: string): Promise<string[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getRegistryTokenConfig(_address: string, _tokenName: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getTokenPoolConfigs(_tokenPool: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   *
   */
  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }
}
