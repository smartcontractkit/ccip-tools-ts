import { bcs } from '@mysten/sui/bcs'
import { type SuiTransactionBlockResponse, SuiClient } from '@mysten/sui/client'
import type { Keypair } from '@mysten/sui/cryptography'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from '@mysten/sui/utils'
import { type BytesLike, dataLength, hexlify, isBytesLike, isHexString } from 'ethers'
import type { PickDeep, SetOptional } from 'type-fest'

import {
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  Chain,
} from '../chain.ts'
import { getCcipStateAddress, getOffRampForCcip } from './discovery.ts'
import { type CommitEvent, streamSuiLogs } from './events.ts'
import { getSuiLeafHasher } from './hasher.ts'
import {
  deriveObjectID,
  fetchTokenConfigs,
  getLatestPackageId,
  getObjectRef,
  getReceiverModule,
} from './objects.ts'
import {
  CCIPContractNotRouterError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPErrorCode,
  CCIPExecTxRevertedError,
  CCIPExecutionReportChainMismatchError,
  CCIPLogsAddressRequiredError,
  CCIPNotImplementedError,
  CCIPSuiLogInvalidError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1, SuiExtraArgsV1 } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { decodeMessage, getMessagesInBatch } from '../requests.ts'
import { decodeMoveExtraArgs, getMoveAddress } from '../shared/bcs-codecs.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ChainTransaction,
  type CommitReport,
  type ExecutionInput,
  type ExecutionReceipt,
  type ExecutionState,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ChainFamily,
} from '../types.ts'
import {
  decodeAddress,
  decodeOnRampAddress,
  getDataBytes,
  networkInfo,
  parseTypeAndVersion,
  util,
} from '../utils.ts'
import {
  type SuiManuallyExecuteInput,
  type TokenConfig,
  buildManualExecutionPTB,
} from './manuallyExec/index.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

const DEFAULT_GAS_LIMIT = 1000000n

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

  /**
   * Creates a new SuiChain instance.
   * @param client - Sui client for interacting with the Sui network.
   * @param network - Network information for this chain.
   */
  constructor(client: SuiClient, network: NetworkInfo<typeof ChainFamily.Sui>, ctx?: ChainContext) {
    super(network, ctx)

    this.client = client
    this.network = network

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
   * @throws {@link CCIPDataFormatUnsupportedError} if unable to fetch chain identifier
   * @throws {@link CCIPError} if chain identifier is not supported
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
    const chain = new SuiChain(client, network, ctx)
    return Object.assign(chain, { url })
  }

  /** {@inheritDoc Chain.getBlockTimestamp} */
  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    if (typeof block !== 'number' || block <= 0) return Math.floor(Date.now() / 1000)
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
        const splitIdx = eventType.lastIndexOf('::')
        const address = eventType.substring(0, splitIdx)
        const eventName = eventType.substring(splitIdx + 2)

        events.push({
          address: address,
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

  /**
   * {@inheritDoc Chain.getLogs}
   * @throws {@link CCIPLogsAddressRequiredError} if address is not provided
   * @throws {@link CCIPTopicsInvalidError} if topics format is invalid
   */
  async *getLogs(opts: LogFilter & { versionAsHash?: boolean }) {
    if (!opts.address) throw new CCIPLogsAddressRequiredError()

    // Extract the event type from topics
    if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string') {
      throw new CCIPTopicsInvalidError(opts.topics!)
    }
    const topic = opts.topics[0]

    for await (const event of streamSuiLogs<Record<string, unknown>>(this, opts)) {
      const eventData = event.contents?.json
      if (!eventData) continue
      yield {
        address: opts.address,
        transactionHash: event.transaction!.digest,
        index: Number(event.sequenceNumber) || 0,
        blockNumber: Number(event.transaction?.effects.checkpoint.sequenceNumber || 0),
        data: eventData,
        topics: [topic],
      }
    }
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  override async getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    range: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: Pick<LogFilter, 'page'>,
  ): Promise<R['message'][]> {
    return getMessagesInBatch(this, request, range, opts)
  }

  /**
   * {@inheritDoc Chain.typeAndVersion}
   * @throws {@link CCIPDataFormatUnsupportedError} if view call fails
   */
  async typeAndVersion(address: string) {
    // requires address to have `::<module>` suffix
    address = await getLatestPackageId(address, this.client)
    const target = `${address}::type_and_version`

    // Use the Transaction builder to create a move call
    const tx = new Transaction()
    // Add move call to the transaction
    tx.moveCall({ target, arguments: [] })

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

    const [data] = result.results[0].returnValues[0]
    const res = bcs.String.parse(getDataBytes(data))
    return parseTypeAndVersion(res)
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  async getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    // In Sui, the router is the onRamp package itself
    return Promise.resolve(onRamp)
  }

  /**
   * {@inheritDoc Chain.getRouterForOffRamp}
   * @throws {@link CCIPContractNotRouterError} always (Sui architecture doesn't have separate router)
   */
  getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    throw new CCIPContractNotRouterError(offRamp, 'unknown')
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(): Promise<string> {
    // SUI native token is always 0x2::sui::SUI
    return Promise.resolve('0x2::sui::SUI')
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    router = await getLatestPackageId(router, this.client)
    const ccip = await getCcipStateAddress(router, this.client)
    const offramp = await getOffRampForCcip(ccip, this.client)
    return [offramp]
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    // For Sui, the router is the onramp package address
    return Promise.resolve(router)
  }

  /**
   * {@inheritDoc Chain.getOnRampsForOffRamp}
   * @throws {@link CCIPDataFormatUnsupportedError} if view call fails
   */
  async getOnRampsForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string[]> {
    offRamp = await getLatestPackageId(offRamp, this.client)
    const functionName = 'get_source_chain_config'
    // Preserve module suffix if present, otherwise add it
    const target = offRamp.includes('::')
      ? `${offRamp}::${functionName}`
      : `${offRamp}::offramp::${functionName}`

    // Discover the CCIP package from the offramp
    const ccip = await getCcipStateAddress(offRamp, this.client)

    // Get the OffRampState object
    const offrampStateObject = await getObjectRef(offRamp, this.client)
    const ccipObjectRef = await getObjectRef(ccip, this.client)
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
    return [decodeAddress(onRampBytes, networkInfo(sourceChainSelector).family)]
  }

  /**
   * {@inheritDoc Chain.getTokenForTokenPool}
   * @throws {@link CCIPError} if token pool type is invalid or state not found
   * @throws {@link CCIPDataFormatUnsupportedError} if view call fails
   */
  async getTokenForTokenPool(tokenPool: string): Promise<string> {
    const normalizedTokenPool = normalizeSuiAddress(tokenPool)

    // Get objects owned by this package (looking for state pointers)
    const objects = await this.client.getOwnedObjects({
      owner: normalizedTokenPool,
      options: { showType: true, showContent: true },
    })

    const tpType = objects.data
      .find((obj) => obj.data?.type?.includes('token_pool::'))
      ?.data?.type?.split('::')[1]

    const allowedTps = ['managed_token_pool', 'burn_mint_token_pool', 'lock_release_token_pool']
    if (!tpType || !allowedTps.includes(tpType)) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Invalid token pool type: ${tpType}`)
    }

    // Find the state pointer object
    let stateObjectPointerId: string | undefined
    for (const obj of objects.data) {
      const content = obj.data?.content
      if (content?.dataType !== 'moveObject') continue

      const fields = content.fields as Record<string, unknown>
      // Look for a pointer field that references the state object
      stateObjectPointerId = fields[`${tpType}_object_id`] as string
    }

    if (!stateObjectPointerId) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `No token pool state pointer found for ${tokenPool}`,
      )
    }

    const stateNamesPerTP: Record<string, string> = {
      managed_token_pool: 'ManagedTokenPoolState',
      burn_mint_token_pool: 'BurnMintTokenPoolState',
      lock_release_token_pool: 'LockReleaseTokenPoolState',
    }

    const poolStateObject = deriveObjectID(
      stateObjectPointerId,
      new TextEncoder().encode(stateNamesPerTP[tpType]),
    )

    // Get object info to get the coin type
    const info = await this.client.getObject({
      id: poolStateObject,
      options: { showType: true, showContent: true },
    })

    const type = info.data?.type
    if (!type) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading token pool state object type')
    }

    // Extract the type parameter T from ManagedTokenPoolState<T>
    const typeMatch = type.match(/(?:Managed|BurnMint|LockRelease)TokenPoolState<(.+)>$/)
    if (!typeMatch || !typeMatch[1]) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Invalid pool state type format: ${type}`)
    }
    const tokenType = typeMatch[1]

    // Call get_token function from managed_token_pool contract with the type parameter
    const target = type.split('<')[0]?.split('::').slice(0, 2).join('::') + '::get_token'
    if (!target) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Invalid pool state type format: ${type}`)
    }
    const tx = new Transaction()
    tx.moveCall({
      target,
      typeArguments: [tokenType],
      arguments: [tx.object(poolStateObject)],
    })

    const result = await this.client.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionBlock: tx,
    })

    if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
      throw new CCIPDataFormatUnsupportedError(
        `Failed to call ${target}: ${result.effects.status.error || 'No return value'}`,
      )
    }

    // Parse the return value to get the coin metadata address (32 bytes)
    const returnValue = result.results[0].returnValues[0]
    const [data] = returnValue
    const coinMetadataBytes = new Uint8Array(data)
    const coinMetadataAddress = normalizeSuiAddress(hexlify(coinMetadataBytes))

    return coinMetadataAddress
  }

  /**
   * {@inheritDoc Chain.getTokenInfo}
   * @throws {@link CCIPError} if token address is invalid or metadata cannot be loaded
   */
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

    let coinType: string
    const objectType = objectResponse.data?.type

    // Check if this is a CoinMetadata object or a coin type string
    if (objectType?.includes('CoinMetadata')) {
      coinType = getCoinFromMetadata(objectType)
    } else if (token.includes('::')) {
      // This is a coin type string (e.g., "0xabc::coin::COIN")
      coinType = token
    } else {
      // This is a package address or unknown format
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `Token address ${token} is not a CoinMetadata object or coin type. Expected format: package::module::Type`,
      )
    }

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
   * @throws {@link CCIPSuiLogInvalidError} if log data format is invalid
   */
  static decodeMessage(log: Log_): CCIPMessage | undefined {
    const { data } = log
    if (
      (typeof data !== 'string' || !data.startsWith('{')) &&
      (typeof data !== 'object' || isBytesLike(data))
    )
      throw new CCIPSuiLogInvalidError(util.inspect(log))
    // offload massaging to generic decodeJsonMessage
    try {
      return decodeMessage(data)
    } catch (_) {
      // return undefined
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
    return decodeMoveExtraArgs(extraArgs)
  }

  /**
   * Encodes extra arguments for CCIP messages.
   * @param _extraArgs - Extra arguments to encode.
   * @returns Encoded extra arguments as a hex string.
   * @throws {@link CCIPNotImplementedError} always (not yet implemented)
   */
  static encodeExtraArgs(_extraArgs: ExtraArgs): string {
    throw new CCIPNotImplementedError()
  }

  /**
   * Decodes commit reports from a log entry.
   * @param log - The log entry to decode.
   * @param lane - Optional lane information.
   * @returns Array of decoded commit reports or undefined.
   */
  static decodeCommits(
    { data, topics }: SetOptional<Pick<Log_, 'data' | 'topics'>, 'topics'>,
    lane?: Lane,
  ): CommitReport[] | undefined {
    // Check if this is an CommitReportAccepted event
    if (topics?.[0] && topics[0] !== 'CommitReportAccepted') return

    // Basic log data structure validation
    if (!data || typeof data !== 'object' || !('unblessed_merkle_roots' in data)) return

    const eventData = data as CommitEvent
    const rootsRaw = eventData.blessed_merkle_roots.concat(eventData.unblessed_merkle_roots)
    return rootsRaw
      .map((root) => {
        return {
          sourceChainSelector: BigInt(root.source_chain_selector),
          onRampAddress: decodeOnRampAddress(root.on_ramp_address),
          minSeqNr: BigInt(root.min_seq_nr),
          maxSeqNr: BigInt(root.max_seq_nr),
          merkleRoot: hexlify(getDataBytes(root.merkle_root)),
        }
      })
      .filter((r) =>
        lane
          ? r.sourceChainSelector === lane.sourceChainSelector && r.onRampAddress === lane.onRamp
          : true,
      )
  }

  /**
   * Decodes an execution receipt from a log entry.
   * @param log - The log entry to decode.
   * @returns Decoded execution receipt or undefined.
   */
  static decodeReceipt({
    data,
    topics,
  }: SetOptional<Pick<Log_, 'data' | 'topics'>, 'topics'>): ExecutionReceipt | undefined {
    // Check if this is an ExecutionStateChanged event
    if (topics?.[0] && topics[0] !== 'ExecutionStateChanged') return

    // Basic log data structure validation
    if (!data || typeof data !== 'object' || !('message_id' in data) || !('state' in data)) {
      return
    }

    const eventData = data as {
      message_hash: BytesLike
      message_id: BytesLike
      sequence_number: string
      source_chain_selector: string
      state: number
    }

    return {
      messageId: hexlify(getDataBytes(eventData.message_id)),
      sequenceNumber: BigInt(eventData.sequence_number),
      state: Number(eventData.state) as ExecutionState,
      sourceChainSelector: BigInt(eventData.source_chain_selector),
      messageHash: hexlify(getDataBytes(eventData.message_hash)),
    }
  }

  /**
   * Converts bytes to a Sui address.
   * @param bytes - Bytes to convert.
   * @returns Sui address.
   */
  static getAddress(bytes: BytesLike | readonly number[]): string {
    return getMoveAddress(bytes)
  }

  /**
   * Validates a transaction hash format for Sui
   */
  static isTxHash(v: unknown): v is string {
    if (typeof v !== 'string') return false
    // check in both hex and base58 formats
    return isHexString(v, 32) || isValidTransactionDigest(v)
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

  /** {@inheritDoc Chain.generateUnsignedExecute} */
  override generateUnsignedExecute(
    _opts: Parameters<Chain['generateUnsignedExecute']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.generateUnsignedExecute'))
  }

  /**
   * {@inheritDoc Chain.execute}
   * @throws {@link CCIPError} if transaction submission fails
   * @throws {@link CCIPExecTxRevertedError} if transaction reverts
   */
  async execute(
    opts: Parameters<Chain['execute']>[0] & {
      receiverObjectIds?: string[]
    },
  ): Promise<CCIPExecution> {
    if (!('input' in opts && 'message' in opts.input)) {
      throw new CCIPExecutionReportChainMismatchError('Sui')
    }
    const { input, offRamp } = opts
    const wallet = opts.wallet as Keypair

    // Discover the CCIP package from the offramp
    const ccip = await getCcipStateAddress(offRamp, this.client)

    const ccipObjectRef = await getObjectRef(ccip, this.client)
    const offrampStateObject = await getObjectRef(offRamp, this.client)
    const receiverConfig = await getReceiverModule(
      this.client,
      ccip,
      ccipObjectRef,
      input.message.receiver,
    )
    let tokenConfigs: TokenConfig[] = []
    if (input.message.tokenAmounts.length !== 0) {
      tokenConfigs = await fetchTokenConfigs(
        this.client,
        ccip,
        ccipObjectRef,
        input.message.tokenAmounts as CCIPMessage<typeof CCIPVersion.V1_6>['tokenAmounts'],
      )
    }

    const suiInput: SuiManuallyExecuteInput = {
      executionReport: input as ExecutionInput<CCIPMessage_V1_6_Sui>,
      offrampAddress: offRamp,
      ccipAddress: ccip,
      ccipObjectRef,
      offrampStateObject,
      receiverConfig,
      tokenConfigs,
    }
    if (opts.receiverObjectIds) {
      this.logger.info(
        `Overriding Sui Manual Execution receiverObjectIds with: ${opts.receiverObjectIds.join(', ')}`,
      )
      suiInput.overrideReceiverObjectIds = opts.receiverObjectIds
    }
    const tx = buildManualExecutionPTB(suiInput)

    // Set gas budget if provided
    if (opts.gasLimit) {
      tx.setGasBudget(opts.gasLimit)
    }

    this.logger.info(`Executing Sui CCIP execute transaction...`)
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
        `Failed to send Sui execute transaction: ${(e as Error).message}`,
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

  /** {@inheritDoc Chain.getTokenPoolConfig} */
  async getTokenPoolConfig(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenPoolConfig'))
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getTokenPoolRemotes'))
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.getFeeTokens'))
  }

  /**
   * Returns a copy of a message, populating missing fields like `extraArgs` with defaults.
   * It's expected to return a message suitable at least for basic token transfers.
   *
   * @param message - AnyMessage (from source), containing at least `receiver`
   * @returns A message suitable for `sendMessage` to this destination chain family
   */
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
      message.extraArgs.tokenReceiver != null &&
      typeof message.extraArgs.tokenReceiver === 'string'
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
