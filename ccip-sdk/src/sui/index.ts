import { SuiClient } from '@mysten/sui/client'
import type { Keypair } from '@mysten/sui/cryptography'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { Transaction } from '@mysten/sui/transactions'
import { type BytesLike, isBytesLike } from 'ethers'
import { memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import { AptosChain } from '../aptos/index.ts'
import { type LogFilter, Chain } from '../chain.ts'
import {
  CCIPContractNotRouterError,
  CCIPDataFormatUnsupportedError,
  CCIPExecTxRevertedError,
  CCIPNotImplementedError,
  CCIPSuiMessageVersionInvalidError,
  CCIPVersionFeatureUnavailableError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1 } from '../extra-args.ts'
import { getSuiLeafHasher } from './hasher.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
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
import { decodeAddress, networkInfo } from '../utils.ts'
import { getSuiEventsInTimeRange } from './events.ts'
import {
  type SuiManuallyExecuteInput,
  type TokenConfig,
  buildManualExecutionPTB,
} from './manuallyExec/index.ts'
import {
  fetchTokenConfigs,
  getCcipObjectRef,
  getOffRampStateObject,
  getReceiverModule,
} from './objects.ts'

type SuiContractDir = {
  ccip: string
  onRamp: string
  offRamp: string
  router: string
}

/**
 * Sui chain implementation supporting Sui networks.
 * Note: This implementation is currently a placeholder.
 */
export class SuiChain extends Chain<typeof ChainFamily.Sui> {
  static {
    supportedChains[ChainFamily.Sui] = SuiChain
  }
  static readonly family = ChainFamily.Sui
  static readonly decimals = 9 // SUI has 9 decimals

  override readonly network: NetworkInfo<typeof ChainFamily.Sui>
  readonly client: SuiClient
  readonly graphqlClient: SuiGraphQLClient

  // contracts dir <chainSelectorName, SuiContractDir>
  readonly contractsDir: SuiContractDir

  /**
   * Creates a new SuiChain instance.
   * @param client - Sui client for interacting with the Sui network.
   * @param network - Network information for this chain.
   */
  constructor(client: SuiClient, network: NetworkInfo<typeof ChainFamily.Sui>) {
    super(network)

    this.client = client
    this.network = network
    this.contractsDir = {} as SuiContractDir // TODO: Inject correct contract addresses

    // TODO: Graphql client should come from config
    let graphqlUrl: string
    const selector = network.chainSelector
    if (selector === 17529533435026248318n) {
      // Sui mainnet (sui:1)
      graphqlUrl = 'https://graphql.mainnet.sui.io/graphql'
    } else if (selector === 9762610643973837292n) {
      // Sui testnet (sui:2)
      graphqlUrl = 'https://graphql.testnet.sui.io/graphql'
    } else {
      // Localnet (sui:4) or unknown
      graphqlUrl = 'https://graphql.devnet.sui.io/graphql'
    }

    this.graphqlClient = new SuiGraphQLClient({
      url: graphqlUrl,
    })

    // Memoize getWallet to avoid recreating keypairs
    const originalGetWallet = this.getWallet.bind(this)
    this.getWallet = memoize(originalGetWallet, { maxSize: 1, maxArgs: 0 })
  }

  /**
   * Creates a SuiChain instance from an RPC URL.
   * @param url - HTTP or WebSocket endpoint URL for the Sui network.
   * @returns A new SuiChain instance.
   */
  static async fromUrl(url: string): Promise<SuiChain> {
    const client = new SuiClient({ url })

    // Get chain identifier from the client and map to network info format
    const rawChainId = await client.getChainIdentifier().catch(() => null)
    if (rawChainId === null) {
      throw new CCIPDataFormatUnsupportedError(`Unable to fetch chain identifier from URL: ${url}`)
    }

    // Map Sui chain identifiers to our network info format
    // Reference: https://docs.sui.io/guides/developer/getting-started/connect
    let chainId: string
    if (rawChainId === '35834a8a') {
      chainId = 'sui:1' // mainnet
    } else if (rawChainId === '4c78adac') {
      chainId = 'sui:2' // testnet
    } else if (rawChainId === 'b0c08dea') {
      chainId = 'sui:4' // devnet
    } else if (rawChainId) {
      // Unknown chain, try to infer from URL
      if (url.includes('mainnet')) {
        chainId = 'sui:1'
      } else if (url.includes('testnet')) {
        chainId = 'sui:2'
      } else if (url.includes('devnet')) {
        chainId = 'sui:4'
      } else {
        chainId = 'sui:4' // default to devnet for unknown
      }
    } else {
      // If we can't get chain identifier, try to infer from URL
      if (url.includes('mainnet')) {
        chainId = 'sui:1'
      } else if (url.includes('testnet')) {
        chainId = 'sui:2'
      } else if (url.includes('devnet')) {
        chainId = 'sui:4'
      } else {
        chainId = 'sui:4' // default to devnet
      }
    }

    const network = networkInfo(chainId) as NetworkInfo<typeof ChainFamily.Sui>
    return new SuiChain(client, network)
  }

  /** {@inheritDoc Chain.getBlockTimestamp} */
  async getBlockTimestamp(block: number): Promise<number> {
    const checkpoint = await this.client.getCheckpoint({
      id: String(block),
    })
    return Number(checkpoint.timestampMs) / 1000
  }

  /** {@inheritDoc Chain.getTransaction} */
  async getTransaction(hash: string | number): Promise<ChainTransaction> {
    // For Sui, hash should be a transaction digest (string)
    const digest = typeof hash === 'number' ? String(hash) : hash

    const txResponse = await this.client.getTransactionBlock({
      digest,
      options: {
        showEvents: true,
        showEffects: true,
        showInput: true,
      },
    })

    // Extract events from the transaction
    const events: Log_[] = []
    if (txResponse.events) {
      for (let i = 0; i < txResponse.events.length; i++) {
        const event = txResponse.events[i]
        const eventType = event.type
        const packageId = eventType.split('::')[0]
        const moduleName = eventType.split('::')[1]
        const eventName = eventType.split('::')[2]

        events.push({
          address: `${packageId}::${moduleName}`,
          transactionHash: digest,
          index: i,
          blockNumber: Number(txResponse.checkpoint || 0),
          data: event.parsedJson as Record<string, unknown>,
          topics: [eventName],
        })
      }
    }

    return {
      hash: digest,
      logs: events,
      blockNumber: Number(txResponse.checkpoint || 0),
      timestamp: Number(txResponse.timestampMs || 0) / 1000,
      from: txResponse.transaction?.data?.sender || '',
    }
  }

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(opts: LogFilter & { versionAsHash?: boolean }) {
    // Extract the event type from topics
    const topic = Array.isArray(opts.topics?.[0]) ? opts.topics[0][0] : opts.topics?.[0] || ''
    if (!topic || (topic !== 'ReportAccepted' && topic !== 'CommitReportAccepted')) {
      throw new CCIPVersionFeatureUnavailableError(
        'Event type',
        topic || 'unknown',
        'ReportAccepted or CommitReportAccepted',
      )
    }

    const eventTypes = {
      ReportAccepted: `${this.contractsDir.offRamp}::offramp::ReportAccepted`,
      CommitReportAccepted: `${this.contractsDir.offRamp}::offramp::CommitReportAccepted`,
    }

    const startTime = opts.startTime ? new Date(opts.startTime * 1000) : new Date(0)
    const endTime = opts.endBlock
      ? new Date(opts.endBlock)
      : new Date(startTime.getTime() + 1 * 24 * 60 * 60 * 1000) // default to +24h

    type SuiEventData = {
      package_id: string
      module_name: string
      tx_digest: string
      checkpoint: number
      event_name: string
      [key: string]: unknown
    }

    const events = await getSuiEventsInTimeRange<SuiEventData>(
      this.client,
      this.graphqlClient,
      eventTypes[topic],
      startTime,
      endTime,
    )

    for (const event of events) {
      const eventData = event.contents.json
      yield {
        address: eventData.package_id + '::' + eventData.module_name,
        transactionHash: event.transaction?.digest || '',
        index: 0, // Sui events do not have an index, set to 0
        blockNumber: Number(event.transaction?.effects.checkpoint.sequenceNumber || 0),
        data: eventData,
        topics: [eventData.event_name],
      }
    }
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
  async getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    if (onRamp === this.contractsDir.onRamp) {
      return Promise.resolve(this.contractsDir.router)
    }
    throw new CCIPContractNotRouterError(onRamp, 'unknown')
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  async getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    if (offRamp === this.contractsDir.offRamp) {
      return Promise.resolve(this.contractsDir.router)
    }
    throw new CCIPContractNotRouterError(offRamp, 'unknown')
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    // SUI native token is always 0x2::sui::SUI
    return Promise.resolve('0x2::sui::SUI')
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    if (router === this.contractsDir.router) {
      return Promise.resolve([this.contractsDir.offRamp])
    }
    return Promise.resolve([])
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    if (router === this.contractsDir.router) {
      return Promise.resolve(this.contractsDir.onRamp)
    }
    throw new CCIPContractNotRouterError(router, 'unknown')
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(_offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const offrampPackageId = this.contractsDir.offRamp
    const functionName = 'get_source_chain_config'
    const target = `${offrampPackageId}::offramp::${functionName}`

    // Get the OffRampState object
    const offrampStateObject = await getOffRampStateObject(this.client, offrampPackageId)
    const ccipObjectRef = await getCcipObjectRef(this.client, this.contractsDir.ccip)
    // Use the Transaction builder to create a move call
    const tx = new Transaction()

    // Add move call to the transaction with OffRampState object and source chain selector
    tx.moveCall({
      target,
      arguments: [
        tx.object(ccipObjectRef),
        tx.object(offrampStateObject),
        tx.pure.u64(sourceChainSelector),
      ],
    })

    // Execute with devInspectTransactionBlock for read-only call
    const result = await this.client.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionBlock: tx,
    })

    if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
      throw new CCIPDataFormatUnsupportedError(
        `Failed to call ${target}: ${result.effects.status.error || 'No return value'}`,
      )
    }

    // The return value is a SourceChainConfig struct with the following fields:
    // - Router (address = 32 bytes)
    // - IsEnabled (bool = 1 byte)
    // - MinSeqNr (u64 = 8 bytes)
    // - IsRmnVerificationDisabled (bool = 1 byte)
    // - OnRamp (vector<u8> = length + bytes)
    const returnValue = result.results[0].returnValues[0]
    const [data] = returnValue
    const configBytes = new Uint8Array(data)

    let offset = 0

    // Skip Router (32 bytes)
    offset += 32

    // Skip IsEnabled (1 byte)
    offset += 1

    // Skip MinSeqNr (8 bytes)
    offset += 8

    // Skip IsRmnVerificationDisabled (1 byte)
    offset += 1

    // OnRamp (vector<u8>)
    const onRampLength = configBytes[offset]
    offset += 1
    const onRampBytes = configBytes.slice(offset, offset + onRampLength)

    // Decode the address from the onRamp bytes
    return decodeAddress(onRampBytes, networkInfo(sourceChainSelector).family)
  }

  /** {@inheritDoc Chain.getCommitStoreForOffRamp} */
  getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp)
  }

  /** {@inheritDoc Chain.getTokenForTokenPool} */
  getTokenForTokenPool(_tokenPool: string): Promise<string> {
    throw new CCIPNotImplementedError()
  }

  /** {@inheritDoc Chain.getTokenInfo} */
  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    // Handle native SUI token
    if (token === '0x2::sui::SUI' || token.includes('::sui::SUI')) {
      return { symbol: 'SUI', decimals: 9 }
    }

    try {
      // For Coin types, try to fetch metadata from the coin metadata object
      // Format: 0xPACKAGE::module::TYPE
      const coinMetadata = await this.client.getCoinMetadata({ coinType: token })

      if (coinMetadata) {
        return {
          symbol: coinMetadata.symbol || 'UNKNOWN',
          decimals: coinMetadata.decimals,
        }
      }
    } catch (error) {
      console.log(`Failed to fetch coin metadata for ${token}:`, error)
    }

    // Fallback: parse from token type string if possible
    const parts = token.split('::')
    const symbol = parts[parts.length - 1] || 'UNKNOWN'

    return {
      symbol: symbol.toUpperCase(),
      decimals: 9, // Default to 9 decimals (SUI standard)
    }
  }

  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError())
  }

  /**
   * Gets a wallet/keypair for signing transactions.
   * This method should be overridden in your environment to provide the actual wallet.
   * @param _opts - Optional wallet configuration.
   * @returns A Sui Keypair for signing transactions.
   */
  static getWallet(_opts?: { wallet?: unknown }): Promise<Keypair> {
    return Promise.reject(
      new CCIPWalletInvalidError(
        'Wallet loading not configured. Override SuiChain.getWallet in your environment.',
      ),
    )
  }

  /**
   * Gets a wallet/keypair for signing transactions (instance method).
   * Delegates to the static getWallet method.
   * @param opts - Optional wallet configuration.
   * @returns A Sui Keypair for signing transactions.
   */
  async getWallet(opts?: { wallet?: unknown }): Promise<Keypair> {
    return (this.constructor as typeof SuiChain).getWallet(opts)
  }

  /**
   * Gets the wallet address for the current wallet.
   * @param opts - Optional wallet configuration.
   * @returns The Sui address as a string.
   */
  async getWalletAddress(opts?: { wallet?: unknown }): Promise<string> {
    const wallet = await this.getWallet(opts)
    return wallet.toSuiAddress()
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
   * @param _extraArgs - Encoded extra arguments bytes.
   * @returns Decoded extra arguments or undefined if unknown format.
   */
  static decodeExtraArgs(
    _extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | undefined {
    throw new CCIPNotImplementedError()
  }

  /**
   * Encodes extra arguments for CCIP messages.
   * @param _extraArgs - Extra arguments to encode.
   * @returns Encoded extra arguments as a hex string.
   */
  static encodeExtraArgs(_extraArgs: ExtraArgs): string {
    throw new CCIPNotImplementedError()
  }

  /**
   * Decodes commit reports from a log entry.
   * @param log - The log entry to decode.
   * @param _lane - Optional lane information.
   * @returns Array of decoded commit reports or undefined.
   */
  static decodeCommits(log: Log_, _lane?: Lane): CommitReport[] | undefined {
    if (!log.data || typeof log.data !== 'object' || !('unblessed_merkle_roots' in log.data)) {
      return
    }

    const toHexFromBase64 = (b64: string) => '0x' + Buffer.from(b64, 'base64').toString('hex')

    const unblessedRoots = log.data.unblessed_merkle_roots
    if (!Array.isArray(unblessedRoots) || unblessedRoots.length === 0) {
      return
    }

    type UnblessedRoot = {
      source_chain_selector: string
      on_ramp_address: string
      min_seq_nr: string
      max_seq_nr: string
      merkle_root: string
    }

    return unblessedRoots.map((root: unknown) => {
      const typedRoot = root as UnblessedRoot
      return {
        sourceChainSelector: BigInt(typedRoot.source_chain_selector),
        onRampAddress: log.address,
        minSeqNr: BigInt(typedRoot.min_seq_nr),
        maxSeqNr: BigInt(typedRoot.max_seq_nr),
        merkleRoot: toHexFromBase64(typedRoot.merkle_root),
      }
    })
  }

  /**
   * Decodes an execution receipt from a log entry.
   * @param _log - The log entry to decode.
   * @returns Decoded execution receipt or undefined.
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
    execReport: ExecutionReport,
    opts: { wallet: unknown; gasLimit?: number },
  ): Promise<ChainTransaction> {
    const wallet = opts.wallet as Keypair
    const ccipObjectRef = await getCcipObjectRef(this.client, this.contractsDir.ccip)
    const offrampStateObject = await getOffRampStateObject(this.client, this.contractsDir.offRamp)
    const receiverConfig = await getReceiverModule(
      this.client,
      this.contractsDir.ccip,
      ccipObjectRef,
      execReport.message.receiver,
    )
    let tokenConfigs: TokenConfig[] = []
    if (execReport.message.tokenAmounts.length !== 0) {
      tokenConfigs = await fetchTokenConfigs(
        this.client,
        this.contractsDir.ccip,
        ccipObjectRef,
        execReport.message.tokenAmounts as CCIPMessage<typeof CCIPVersion.V1_6>['tokenAmounts'],
      )
    }
    const input: SuiManuallyExecuteInput = {
      executionReport: execReport as ExecutionReport<CCIPMessage_V1_6_Sui>,
      offrampAddress: this.contractsDir.offRamp,
      ccipAddress: this.contractsDir.ccip,
      ccipObjectRef,
      offrampStateObject,
      receiverConfig,
      tokenConfigs,
    }
    const tx = buildManualExecutionPTB(input)

    // Set gas budget if provided
    if (opts?.gasLimit) {
      tx.setGasBudget(opts.gasLimit)
    }

    // Sign and execute the transaction
    const result = await this.client.signAndExecuteTransaction({
      signer: wallet,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    })

    // Check if transaction was successful
    if (result.effects?.status?.status !== 'success') {
      const errorMsg = result.effects?.status?.error || 'Unknown error'
      throw new CCIPExecTxRevertedError(result.digest, {
        context: { error: errorMsg },
      })
    }

    // Return the transaction as a ChainTransaction
    return this.getTransaction(result.digest)
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
