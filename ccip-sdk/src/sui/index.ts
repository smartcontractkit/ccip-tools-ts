import { Buffer } from 'buffer'

import { type SuiTransactionBlockResponse, SuiClient } from '@mysten/sui/client'
import type { Keypair } from '@mysten/sui/cryptography'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from '@mysten/sui/utils'
import { type BytesLike, dataLength, hexlify, isBytesLike } from 'ethers'
import type { PickDeep } from 'type-fest'

import { AptosChain } from '../aptos/index.ts'
import {
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  Chain,
} from '../chain.ts'
import {
  CCIPContractNotRouterError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPErrorCode,
  CCIPExecTxRevertedError,
  CCIPNotImplementedError,
  CCIPVersionFeatureUnavailableError,
} from '../errors/index.ts'
import { CCIPSuiLogInvalidError } from '../errors/specialized.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1, SuiExtraArgsV1 } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { getMessagesInBatch, getMessagesInTx } from '../requests.ts'
import { supportedChains } from '../supported-chains.ts'
import { getSuiLeafHasher } from './hasher.ts'
import {
  type AnyMessage,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type ExecutionState,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ChainFamily,
} from '../types.ts'
import { bytesToBuffer, decodeAddress, networkInfo, parseTypeAndVersion, util } from '../utils.ts'
import { discoverCCIP, discoverOfframp } from './discovery.ts'
import { type CommitEvent, getSuiEventsInTimeRange } from './events.ts'
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
import type { CCIPMessage_V1_6_Sui, SuiCCIPMessageLog } from './types.ts'

export const SUI_EXTRA_ARGS_V1_TAG = '21ea4ca9' as const
const DEFAULT_GAS_LIMIT = 1000000n

type SuiContractDir = {
  ccip?: string
  onRamp?: string
  offRamp?: string
  router?: string
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
  constructor(client: SuiClient, network: NetworkInfo<typeof ChainFamily.Sui>, ctx?: ChainContext) {
    super(network, ctx)

    this.client = client
    this.network = network
    this.contractsDir = {}

    // TODO: Graphql client should come from config
    let graphqlUrl: string
    if (this.network.name === 'sui-mainnet') {
      // Sui mainnet (sui:1)
      graphqlUrl = 'https://graphql.mainnet.sui.io/graphql'
    } else if (this.network.name === 'sui-testnet') {
      // Sui testnet (sui:2)
      graphqlUrl = 'https://graphql.testnet.sui.io/graphql'
    } else {
      // Localnet (sui:4) or unknown
      graphqlUrl = 'https://graphql.devnet.sui.io/graphql'
    }

    this.graphqlClient = new SuiGraphQLClient({
      url: graphqlUrl,
    })
  }

  /**
   * Creates a SuiChain instance from an RPC URL.
   * @param url - HTTP or WebSocket endpoint URL for the Sui network.
   * @returns A new SuiChain instance.
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<SuiChain> {
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
    } else {
      throw new CCIPError(
        CCIPErrorCode.CHAIN_FAMILY_UNSUPPORTED,
        `Unsupported Sui chain identifier: ${rawChainId}`,
      )
    }

    const network = networkInfo(chainId) as NetworkInfo<typeof ChainFamily.Sui>
    return new SuiChain(client, network, ctx)
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
    if (txResponse.events?.length) {
      for (const [i, event] of txResponse.events.entries()) {
        const eventType = event.type
        const packageId = eventType.split('::')[0]
        const eventName = eventType.split('::')[2]!

        events.push({
          address: packageId || '',
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
      from: txResponse.transaction?.data.sender || '',
    }
  }

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(opts: LogFilter & { versionAsHash?: boolean }) {
    if (!this.contractsDir.offRamp) {
      throw new CCIPContractNotRouterError('OffRamp address not set in contracts directory', 'Sui')
    }
    // Extract the event type from topics
    const topic = Array.isArray(opts.topics?.[0]) ? opts.topics[0][0] : opts.topics?.[0] || ''
    if (!topic || topic !== 'CommitReportAccepted') {
      throw new CCIPVersionFeatureUnavailableError(
        'Event type',
        topic || 'unknown',
        'CommitReportAccepted',
      )
    }

    const startTime = opts.startTime ? new Date(opts.startTime * 1000) : new Date(0)
    const endTime = opts.endBlock
      ? new Date(opts.endBlock)
      : new Date(startTime.getTime() + 1 * 24 * 60 * 60 * 1000) // default to +24h

    this.logger.info(
      `Fetching Sui events of type ${topic} from ${startTime.toISOString()} to ${endTime.toISOString()}`,
    )
    const events = await getSuiEventsInTimeRange<CommitEvent>(
      this.client,
      this.graphqlClient,
      `${this.contractsDir.offRamp}::offramp::CommitReportAccepted`,
      startTime,
      endTime,
    )

    for (const event of events) {
      const eventData = event.contents.json
      yield {
        address: this.contractsDir.offRamp,
        transactionHash: event.transaction?.digest || '',
        index: 0, // Sui events do not have an index, set to 0
        blockNumber: Number(event.transaction?.effects.checkpoint.sequenceNumber || 0),
        data: eventData,
        topics: [topic],
      }
    }
  }

  /** {@inheritDoc Chain.getMessagesInTx} */
  override async getMessagesInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return getMessagesInTx(this, typeof tx === 'string' ? await this.getTransaction(tx) : tx)
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  override async getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: { page?: number },
  ): Promise<R['message'][]> {
    return getMessagesInBatch(this, request, commit, opts)
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string) {
    // Remove ::onramp suffix if present, then add it back with the function name
    const packageId = address.replace(/::onramp$/, '')
    const target = `${packageId}::onramp::type_and_version`

    // Use the Transaction builder to create a move call
    const tx = new Transaction()

    // Add move call to the transaction
    tx.moveCall({
      target,
      arguments: [],
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

    // The return value is a String (vector<u8>)
    const returnValue = result.results[0].returnValues[0]
    const [data] = returnValue
    const bytes = new Uint8Array(data)

    // Parse the string: length (1 byte) + UTF-8 bytes
    const length = bytes[0]!
    const stringBytes = bytes.slice(1, 1 + length)

    return parseTypeAndVersion(new TextDecoder().decode(stringBytes))
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  async getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    this.contractsDir.onRamp = onRamp
    if (onRamp !== this.contractsDir.onRamp) {
      this.contractsDir.onRamp = onRamp
    }
    return Promise.resolve(this.contractsDir.onRamp)
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    throw new CCIPContractNotRouterError(offRamp, 'unknown')
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    // SUI native token is always 0x2::sui::SUI
    return Promise.resolve('0x2::sui::SUI')
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    const ccip = await discoverCCIP(this.client, router)
    const offramp = await discoverOfframp(this.client, ccip)
    this.contractsDir.offRamp = offramp
    this.contractsDir.ccip = ccip
    return [offramp]
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    if (!this.contractsDir.onRamp) {
      throw new CCIPContractNotRouterError('OnRamp address not set in contracts directory', 'Sui')
    }
    return Promise.resolve(this.contractsDir.onRamp)
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    if (!this.contractsDir.ccip) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'CCIP address not set in contracts directory')
    }
    const offrampPackageId = offRamp
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
    const onRampLength = configBytes[offset]!
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
    const normalizedTokenAddress = normalizeSuiAddress(token)
    if (!isValidSuiAddress(normalizedTokenAddress)) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading Sui token metadata')
    }

    const objectResponse = await this.client.getObject({
      id: normalizedTokenAddress,
      options: { showType: true },
    })

    const getCoinFromMetadata = (metadata: string) => {
      // Extract the type parameter from CoinMetadata<...>
      const match = metadata.match(/CoinMetadata<(.+)>$/)

      if (!match || !match[1]) {
        throw new CCIPError(CCIPErrorCode.UNKNOWN, `Invalid metadata format: ${metadata}`)
      }

      return match[1]
    }

    const coinType = getCoinFromMetadata(objectResponse.data?.type || '')
    if (coinType.split('::').length < 3) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading Sui token metadata')
    }

    let metadata = null
    try {
      metadata = await this.client.getCoinMetadata({ coinType })
    } catch (e) {
      console.error('Error fetching coin metadata:', e)
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading Sui token metadata')
    }

    if (!metadata) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading Sui token metadata')
    }

    return {
      symbol: metadata.symbol,
      decimals: metadata.decimals,
    }
  }

  /** {@inheritDoc Chain.getBalance} */
  async getBalance(_opts: GetBalanceOpts): Promise<bigint> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getBalance'))
  }

  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError())
  }

  // Static methods for decoding
  /**
   * Decodes a CCIP message from a Sui log event.
   * @param log - Log event data.
   * @returns Decoded CCIPMessage or undefined if not valid.
   */
  static decodeMessage(log: Log_): CCIPMessage | undefined {
    const { data } = log
    if (
      (typeof data !== 'string' || !data.startsWith('{')) &&
      (typeof data !== 'object' || isBytesLike(data))
    )
      throw new CCIPSuiLogInvalidError(util.inspect(log))
    const toCCIPMessage = (log: SuiCCIPMessageLog): CCIPMessage => {
      const toHex = (bytes: BytesLike | number[]) => hexlify(bytesToBuffer(bytes))

      // Normalize receiver address: if it's 32 bytes with 12 leading zeros, convert to 20 bytes
      const normalizeReceiver = (bytes: number[]): string => {
        if (bytes.length === 32) {
          // Check if first 12 bytes are all zeros (EVM address padded to 32 bytes)
          const isEVMAddress = bytes.slice(0, 12).every((b) => b === 0)
          if (isEVMAddress) {
            // Take only the last 20 bytes
            return toHex(bytes.slice(12))
          }
        }
        return toHex(bytes)
      }

      const decodedExtraArgs = AptosChain.decodeExtraArgs(toHex(log.message.extra_args))

      return {
        // Header fields (merged to root)
        messageId: toHex(log.message.header.message_id),
        sourceChainSelector: BigInt(log.message.header.source_chain_selector),
        destChainSelector: BigInt(log.message.header.dest_chain_selector),
        sequenceNumber: BigInt(log.message.header.sequence_number),
        nonce: BigInt(log.message.header.nonce),

        // Message body fields
        sender: log.message.sender,
        receiver: normalizeReceiver(log.message.receiver),
        data: toHex(log.message.data),
        extraArgs: toHex(log.message.extra_args),
        feeToken: log.message.fee_token,
        feeTokenAmount: BigInt(log.message.fee_token_amount),
        feeValueJuels: BigInt(log.message.fee_value_juels),
        tokenAmounts: log.message.token_amounts.map((ta) => ({
          sourcePoolAddress: ta.source_pool_address || '',
          destTokenAddress: toHex(ta.dest_token_address || []),
          extraData: toHex(ta.extra_data || []),
          amount: BigInt(ta.amount || 0),
          destExecData: toHex(ta.dest_exec_data || []),
          destGasAmount: BigInt(ta.dest_gas_amount || 0),
        })),
        ...decodedExtraArgs,
      } as CCIPMessage
    }
    try {
      return toCCIPMessage(data as SuiCCIPMessageLog)
    } catch (_) {
      return undefined
    }
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

    const eventData = log.data as CommitEvent
    const unblessedRoots = eventData.unblessed_merkle_roots
    if (!Array.isArray(unblessedRoots) || unblessedRoots.length === 0) {
      return
    }

    return unblessedRoots.map((root) => {
      return {
        sourceChainSelector: BigInt(root.source_chain_selector),
        onRampAddress: toHexFromBase64(root.on_ramp_address),
        minSeqNr: BigInt(root.min_seq_nr),
        maxSeqNr: BigInt(root.max_seq_nr),
        merkleRoot: toHexFromBase64(root.merkle_root),
      }
    })
  }

  /**
   * Decodes an execution receipt from a log entry.
   * @param log - The log entry to decode.
   * @returns Decoded execution receipt or undefined.
   */
  static decodeReceipt(log: Log_): ExecutionReceipt | undefined {
    // Check if this is an ExecutionStateChanged event
    const topic = (Array.isArray(log.topics) ? log.topics[0] : log.topics) as string
    if (topic !== 'ExecutionStateChanged') {
      return undefined
    }

    // Validate log data structure
    if (!log.data || typeof log.data !== 'object') {
      return undefined
    }

    const eventData = log.data as {
      message_hash?: number[]
      message_id?: number[]
      sequence_number?: string
      source_chain_selector?: string
      state?: number
    }

    // Verify required fields exist
    if (
      !eventData.message_id ||
      !Array.isArray(eventData.message_id) ||
      eventData.sequence_number === undefined ||
      eventData.state === undefined
    ) {
      return undefined
    }

    const toHex = (bytes: BytesLike | number[]) => hexlify(bytesToBuffer(bytes))

    // Convert message_id bytes array to hex string
    const messageId = toHex(eventData.message_id)

    // Convert message_hash bytes array to hex string (if present)
    const messageHash = eventData.message_hash ? toHex(eventData.message_hash) : undefined

    return {
      messageId,
      sequenceNumber: BigInt(eventData.sequence_number),
      state: eventData.state as ExecutionState,
      sourceChainSelector: eventData.source_chain_selector
        ? BigInt(eventData.source_chain_selector)
        : undefined,
      messageHash,
    }
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
  static isTxHash(v: unknown): v is string {
    if (typeof v !== 'string') return false
    const isHex64 = () => /^0x[0-9a-fA-F]{64}$/.test(v)
    // check in both hex and base58 formats
    return isHex64() || isValidTransactionDigest(v)
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
  async getFee(_opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getFee'))
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  override generateUnsignedSendMessage(
    _opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.generateUnsignedSendMessage'))
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(_opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.sendMessage'))
  }

  /** {@inheritDoc Chain.getOffchainTokenData} */
  getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteReport} */
  override generateUnsignedExecuteReport(
    _opts: Parameters<Chain['generateUnsignedExecuteReport']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.generateUnsignedExecuteReport'))
  }

  /** {@inheritDoc Chain.executeReport} */
  async executeReport(
    opts: Parameters<Chain['executeReport']>[0] & {
      receiverObjectIds?: string[]
    },
  ): Promise<CCIPExecution> {
    const { execReport } = opts
    if (!this.contractsDir.offRamp || !this.contractsDir.ccip) {
      throw new CCIPContractNotRouterError(
        'OffRamp or CCIP address not set in contracts directory',
        'Sui',
      )
    }
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
    if (opts.receiverObjectIds) {
      this.logger.info(
        `Overriding Sui Manual Execution receiverObjectIds with: ${opts.receiverObjectIds.join(', ')}`,
      )
      input.overrideReceiverObjectIds = opts.receiverObjectIds
    }
    const tx = buildManualExecutionPTB(input)

    // Set gas budget if provided
    if (opts.gasLimit) {
      tx.setGasBudget(opts.gasLimit)
    }

    this.logger.info(`Executing Sui CCIP executeReport transaction...`)
    // Sign and execute the transaction
    let result: SuiTransactionBlockResponse
    try {
      result = await this.client.signAndExecuteTransaction({
        signer: wallet,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      })
    } catch (e) {
      throw new CCIPError(
        CCIPErrorCode.TRANSACTION_NOT_FINALIZED,
        `Failed to send Sui executeReport transaction: ${(e as Error).message}`,
      )
    }

    // Check if transaction inmediately reverted
    if (result.effects?.status.status !== 'success') {
      const errorMsg = result.effects?.status.error || 'Unknown error'
      throw new CCIPExecTxRevertedError(result.digest, {
        context: { error: errorMsg },
      })
    }

    this.logger.info(`Waiting for Sui transaction ${result.digest} to be finalized...`)

    await this.client.waitForTransaction({
      digest: result.digest,
      options: {
        showEffects: true,
        showEvents: true,
      },
    })

    // Return the transaction as a ChainTransaction
    return this.getExecutionReceiptInTx(await this.getTransaction(result.digest))
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

  /** {@inheritDoc ChainStatic.buildMessageForDest} */
  static override buildMessageForDest(
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage & { extraArgs: SuiExtraArgsV1 } {
    const gasLimit =
      message.extraArgs && 'gasLimit' in message.extraArgs && message.extraArgs.gasLimit != null
        ? message.extraArgs.gasLimit
        : message.data && dataLength(message.data)
          ? DEFAULT_GAS_LIMIT
          : 0n
    const allowOutOfOrderExecution =
      message.extraArgs &&
      'allowOutOfOrderExecution' in message.extraArgs &&
      message.extraArgs.allowOutOfOrderExecution != null
        ? message.extraArgs.allowOutOfOrderExecution
        : true
    const tokenReceiver =
      message.extraArgs &&
      'tokenReceiver' in message.extraArgs &&
      message.extraArgs.tokenReceiver != null
        ? message.extraArgs.tokenReceiver
        : message.tokenAmounts?.length
          ? this.getAddress(message.receiver)
          : '0x0000000000000000000000000000000000000000000000000000000000000000'
    const receiverObjectIds =
      message.extraArgs &&
      'receiverObjectIds' in message.extraArgs &&
      message.extraArgs.receiverObjectIds?.length
        ? message.extraArgs.receiverObjectIds
        : message.extraArgs && 'accounts' in message.extraArgs && message.extraArgs.accounts?.length
          ? message.extraArgs.accounts // populates receiverObjectIds from accounts
          : []
    const extraArgs: SuiExtraArgsV1 = {
      gasLimit,
      allowOutOfOrderExecution,
      tokenReceiver,
      receiverObjectIds,
    }
    return {
      ...message,
      extraArgs,
      // if tokenReceiver, then message.receiver can (must?) be default
      ...(!!message.tokenAmounts?.length && {
        receiver: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }),
    }
  }
}
