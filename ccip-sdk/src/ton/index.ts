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
  type WithLogger,
  ChainFamily,
} from '../types.ts'
import { getDataBytes, networkInfo } from '../utils.ts'
// import { parseTONLogs } from './utils.ts'
import { executeReport } from './exec.ts'
import { getTONLeafHasher } from './hasher.ts'
import type { CCIPMessage_V1_6_TON, TONWallet } from './types.ts'

const GENERIC_V2_EXTRA_ARGS_TAG = Number.parseInt(GenericExtraArgsV2Tag, 16)

/**
 * TON chain implementation supporting TON networks.
 */
export class TONChain extends Chain<typeof ChainFamily.TON> {
  static {
    supportedChains[ChainFamily.TON] = TONChain
  }
  static readonly family = ChainFamily.TON
  static readonly decimals = 9 // TON uses 9 decimals (nanotons)

  readonly provider: TonClient

  /**
   * Creates a new TONChain instance.
   * @param client - TonClient instance.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   */
  constructor(client: TonClient, network: NetworkInfo, ctx?: WithLogger) {
    super(network, ctx)
    this.provider = client

    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
    })
  }

  /**
   * Creates a TONChain instance from an RPC URL.
   * Verifies the connection and detects the network.
   * @param url - RPC endpoint URL.
   * @param ctx - Context containing logger.
   * @returns A new TONChain instance.
   */
  static async fromUrl(url: string, ctx?: WithLogger): Promise<TONChain> {
    // Validate URL format for TON endpoints
    if (
      !url.includes('toncenter') &&
      !url.includes('ton') &&
      !url.includes('localhost') &&
      !url.includes('127.0.0.1')
    ) {
      throw new Error(`Invalid TON RPC URL: ${url}`)
    }

    const client = new TonClient({ endpoint: url })

    // Verify connection by making an actual RPC call
    try {
      await client.getMasterchainInfo()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to connect to TON endpoint ${url}: ${message}`)
    }

    // Detect network from URL
    let networkId: string
    if (url.includes('testnet')) {
      networkId = 'ton-testnet'
    } else if (url.includes('sandbox') || url.includes('localhost') || url.includes('127.0.0.1')) {
      networkId = 'ton-localnet'
    } else {
      // Default to mainnet for production endpoints
      networkId = 'ton-mainnet'
    }

    return new TONChain(client, networkInfo(networkId), ctx)
  }

  /** {@inheritDoc Chain.getBlockTimestamp} */
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

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(_opts: LogFilter & { versionAsHash?: boolean }): AsyncIterableIterator<Log_> {
    await Promise.resolve()
    throw new Error('Not implemented')
    yield undefined as never
  }

  /** {@inheritDoc Chain.fetchRequestsInTx} */
  override async fetchRequestsInTx(_tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.fetchAllMessagesInBatch} */
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

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(
    _address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  getOffRampsForRouter(_router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getCommitStoreForOffRamp} */
  getCommitStoreForOffRamp(_offRamp: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getTokenForTokenPool} */
  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getTokenInfo} */
  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number }> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new Error('Not implemented'))
  }

  /**
   * Static wallet loading not available for TON.
   * @param _opts - Wallet options (unused).
   * @returns Never resolves, always throws.
   */
  static getWallet(_opts: { wallet?: unknown } = {}): Promise<TONWallet> {
    throw new Error('static TON wallet loading not available')
  }

  /**
   * Loads a TON wallet from various input formats.
   * @param opts - Wallet options (mnemonic, secret key, or TONWallet instance).
   * @returns TONWallet instance.
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
   * Decodes a CCIP message from a TON log event.
   * @param _log - Log with data field.
   * @returns Decoded CCIPMessage or undefined if not valid.
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
   * Decodes commit reports from a TON log event.
   * @param _log - Log with data field.
   * @param _lane - Lane info for filtering.
   * @returns Array of CommitReport or undefined if not valid.
   */
  static decodeCommits(_log: Log_, _lane?: Lane): CommitReport[] | undefined {
    throw new Error('Not implemented')
  }

  /**
   * Decodes an execution receipt from a TON log event.
   * @param _log - Log with data field.
   * @returns ExecutionReceipt or undefined if not valid.
   */
  static decodeReceipt(_log: Log_): ExecutionReceipt | undefined {
    throw new Error('Not implemented')
  }

  /**
   * Converts bytes to a TON address.
   * @param _bytes - Bytes to convert.
   * @returns TON address string.
   */
  static getAddress(_bytes: BytesLike): string {
    throw new Error('Not implemented')
  }

  /**
   * Gets the leaf hasher for TON destination chains.
   * @param lane - Lane configuration.
   * @param _ctx - Context containing logger.
   * @returns Leaf hasher function.
   */
  static getDestLeafHasher(lane: Lane, _ctx?: WithLogger): LeafHasher {
    return getTONLeafHasher(lane)
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  generateUnsignedSendMessage(
    _sender: string,
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee?: bigint },
    _opts?: { approveMax?: boolean },
  ): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.fetchOffchainTokenData} */
  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    if (!('receiverObjectIds' in request.message)) {
      throw new Error('Invalid message, not v1.6 TON')
    }
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteReport} */
  generateUnsignedExecuteReport(
    _payer: string,
    _offRamp: string,
    _execReport: ExecutionReport,
    _opts?: { wallet?: unknown; gasLimit?: number },
  ): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.executeReport} */
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
   * Parses raw TON data into typed structures.
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
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getRegistryTokenConfig} */
  async getRegistryTokenConfig(_address: string, _tokenName: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getTokenPoolConfigs} */
  async getTokenPoolConfigs(_tokenPool: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new Error('Not implemented'))
  }
}
