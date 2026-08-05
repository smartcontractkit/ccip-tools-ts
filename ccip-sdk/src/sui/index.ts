import { bcs } from '@mysten/sui/bcs'
import type { Keypair } from '@mysten/sui/cryptography'
import { JsonRpcHTTPTransport, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from '@mysten/sui/utils'
import { type BytesLike, dataLength, hexlify, isBytesLike, isHexString } from 'ethers'
import { memoize } from 'micro-memoize'
import type { SetOptional } from 'type-fest'

import {
  type BlockInfo,
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  type TokenTransferFeeOpts,
  Chain,
} from '../chain.ts'
import { getCcipStateAddress, getOffRampForCcip } from './discovery.ts'
import { type CommitEvent, streamSuiLogs, withLookupRetry } from './events.ts'
import { getSuiLeafHasher } from './hasher.ts'
import { deriveObjectID, getLatestPackageId, getObjectRef } from './objects.ts'
import {
  CCIPArgumentInvalidError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPErrorCode,
  CCIPExecutionReportChainMismatchError,
  CCIPLogDataInvalidError,
  CCIPLogsAddressRequiredError,
  CCIPNotImplementedError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1, SuiExtraArgsV1 } from '../extra-args.ts'
import { createRateLimitedFetch, fetchProfileForUrl } from '../fetch.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { decodeMessage } from '../requests.ts'
import { decodeMoveExtraArgs, getMoveAddress } from '../shared/bcs-codecs.ts'
import { supportedChains } from '../supported-chains.ts'
import type {
  AnyMessage,
  CCIPExecution,
  CCIPMessage,
  CCIPRequest,
  ChainLog,
  ChainTransaction,
  CommitReport,
  ExecutionInput,
  ExecutionReceipt,
  ExecutionState,
  Lane,
  LeanNumbers,
  WithLogger,
} from '../types.ts'
import {
  decodeAddress,
  decodeOnRampAddress,
  getDataBytes,
  parseTypeAndVersion,
  util,
} from '../utils.ts'
import { generateUnsignedExecutePTB, signAndExecuteSuiTx } from './exec.ts'
import type { CCIPMessage_V1_6_Sui, UnsignedSuiTx } from './types.ts'
export type { UnsignedSuiTx }

const DEFAULT_GAS_LIMIT = 1000000n

/**
 * Sui chain implementation supporting Sui networks.
 */
export class SuiChain extends Chain<typeof ChainFamily.Sui> {
  static {
    supportedChains[ChainFamily.Sui] = SuiChain
  }
  static readonly family = ChainFamily.Sui
  static readonly decimals = 9 // SUI has 9 decimals

  override readonly network: NetworkInfo<typeof ChainFamily.Sui>
  readonly client: SuiJsonRpcClient

  /**
   * Creates a new SuiChain instance.
   * @param client - Sui client for interacting with the Sui network.
   * @param network - Network information for this chain.
   */
  constructor(
    client: SuiJsonRpcClient,
    network: NetworkInfo<typeof ChainFamily.Sui>,
    ctx?: ChainContext,
  ) {
    super(network, ctx)

    this.client = client
    this.network = network

    // typeAndVersion is a devInspect per call, but changes only on package
    // upgrades; dedupe repeated lookups (ramps activities call it 2+ times
    // per attempt) while still picking up upgrades within a minute
    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
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
    const fetchFn = ctx?.fetch ?? createRateLimitedFetch(fetchProfileForUrl(url), ctx)
    const transport = new JsonRpcHTTPTransport({ url, fetch: fetchFn })

    // Create a temporary client to detect the network (network name unknown yet)
    const tempClient = new SuiJsonRpcClient({ transport, network: url })

    // Get chain identifier from the client and map to network info format
    const rawChainId = await tempClient.getChainIdentifier().catch(() => null)
    if (rawChainId === null) {
      throw new CCIPDataFormatUnsupportedError(`Unable to fetch chain identifier from URL: ${url}`)
    }

    // Map Sui chain identifiers to our network info format
    // Reference: https://docs.sui.io/guides/developer/getting-started/connect
    let chainId: string
    let suiNetwork: string
    if (rawChainId === '35834a8a') {
      chainId = 'sui:1' // mainnet
      suiNetwork = 'mainnet'
    } else if (rawChainId === '4c78adac') {
      chainId = 'sui:2' // testnet
      suiNetwork = 'testnet'
    } else if (rawChainId === 'b0c08dea') {
      chainId = 'sui:4' // devnet
      suiNetwork = 'devnet'
    } else {
      throw new CCIPError(
        CCIPErrorCode.CHAIN_FAMILY_UNSUPPORTED,
        `Unsupported Sui chain identifier: ${rawChainId}`,
      )
    }

    const client = new SuiJsonRpcClient({ transport, network: suiNetwork })
    const network = networkInfo(chainId) as NetworkInfo<typeof ChainFamily.Sui>
    const chain = new SuiChain(client, network, ctx)
    return Object.assign(chain, { url })
  }

  /**
   * Gets checkpoint metadata for a sequence number or tag.
   * Sui checkpoints are finalized once committed, so 'finalized' and 'latest'
   * both resolve to the latest checkpoint. Non-positive numbers are treated as
   * depths relative to latest (e.g. -5 means 5 checkpoints behind latest).
   * @param block - Checkpoint sequence number, depth, or tag.
   * @returns Checkpoint number and Unix timestamp (seconds).
   */
  async getBlockInfo(block: number | 'finalized' | 'latest'): Promise<BlockInfo> {
    let seq: number
    if ((typeof block === 'number' || typeof block === 'bigint') && block > 0) {
      seq = block
    } else {
      const latest = Number(await this.client.getLatestCheckpointSequenceNumber())
      seq =
        typeof block === 'number' || typeof block === 'bigint'
          ? Math.max(0, latest + Number(block))
          : latest
    }
    const checkpoint = await this.client.getCheckpoint({
      id: String(seq),
    })
    return {
      number: Number(checkpoint.sequenceNumber),
      timestamp: Number(checkpoint.timestampMs) / 1000,
    }
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

    const timestamp = Number(txResponse.timestampMs || 0) / 1000
    // Extract events from the transaction
    const events: ChainLog[] = []
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
          blockTimestamp: timestamp,
          data: event.parsedJson as Record<string, unknown>,
          topics: [eventName],
        })
      }
    }

    return {
      hash: digest,
      logs: events,
      blockNumber: Number(txResponse.checkpoint || 0),
      timestamp,
      from: txResponse.transaction?.data.sender || '',
    }
  }

  /**
   * {@inheritDoc Chain.getLogs}
   * @throws {@link CCIPLogsAddressRequiredError} if address is not provided
   * @throws {@link CCIPTopicsInvalidError} if topics format is invalid
   */
  async *getLogs(opts: LeanNumbers<LogFilter> & { versionAsHash?: boolean }) {
    if (opts.watch) {
      opts = {
        ...opts,
        watch:
          opts.watch instanceof AbortSignal
            ? AbortSignal.any([opts.watch, this.abort])
            : this.abort,
      }
    }
    if (!opts.address) throw new CCIPLogsAddressRequiredError()

    // Extract the event type from topics
    if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string') {
      throw new CCIPTopicsInvalidError(opts.topics!)
    }
    const topic = opts.topics[0]

    for await (const event of streamSuiLogs<Record<string, unknown>>(this, opts)) {
      const eventData = event.contents?.json
      const blockTimestamp = new Date(event.timestamp).getTime() / 1000
      if (!eventData) continue
      yield {
        address: opts.address,
        transactionHash: event.transaction!.digest,
        index: Number(event.sequenceNumber) || 0,
        blockNumber: Number(event.transaction?.effects.checkpoint.sequenceNumber || 0),
        blockTimestamp,
        data: eventData,
        topics: [topic],
      }
    }
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

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(onRamp: string, destChainSelector: bigint) {
    const [, , typeAndVersion] = await this.typeAndVersion(onRamp)

    // fee_quoter lives in the ccip package (reachable from any ramp via
    // get_ccip_package_id); report it by its original package id
    const ccip = await getCcipStateAddress(onRamp, this.client)
    const feeQuoter = `${ccip.split('::')[0]}::fee_quoter`

    return {
      // source-side router: Sui has no router contract; the onramp package itself
      // plays that role (consistent with getOnRampForRouter)
      router: onRamp,
      destChainSelector,
      feeQuoter,
      typeAndVersion,
    }
  }

  /** {@inheritDoc Chain.getOffRampConfig} */
  async getOffRampConfig(offRamp: string, sourceChainSelector: bigint) {
    const [, , typeAndVersion] = await this.typeAndVersion(offRamp)
    const latestOffRamp = await getLatestPackageId(offRamp, this.client)
    const functionName = 'get_source_chain_config'
    const target = latestOffRamp.includes('::')
      ? `${latestOffRamp}::${functionName}`
      : `${latestOffRamp}::offramp::${functionName}`

    const ccip = await getCcipStateAddress(latestOffRamp, this.client)
    // state pointers live on the original packages; view calls target latest
    const offrampStateObject = await getObjectRef(offRamp, this.client)
    const ccipObjectRef = await getObjectRef(ccip, this.client)
    const tx = new Transaction()
    tx.moveCall({
      target,
      arguments: [
        tx.object(ccipObjectRef),
        tx.object(offrampStateObject),
        tx.pure.u64(sourceChainSelector),
      ],
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

    const [data] = result.results[0].returnValues[0]
    const configBytes = new Uint8Array(data)
    let offset = 0

    const routerBytes = configBytes.slice(offset, offset + 32)
    offset += 32
    // Sui offramp hardcodes `router: @ccip` (placeholder — no router contract);
    // expose it in our canonical ccip form (`pkg::state_object`) when it matches
    const routerHex = normalizeSuiAddress(hexlify(routerBytes))
    const router = routerHex === ccip.split('::')[0] ? ccip : routerHex

    const isEnabled = configBytes[offset]! !== 0
    offset += 1

    const minSeqNrBytes = configBytes.slice(offset, offset + 8)
    offset += 8
    const minSeqNr = new DataView(minSeqNrBytes.buffer, minSeqNrBytes.byteOffset).getBigUint64(
      0,
      true,
    )

    const isRmnVerificationDisabled = configBytes[offset]! !== 0
    offset += 1

    const onRampLength = configBytes[offset]!
    offset += 1
    const onRampBytes = configBytes.slice(offset, offset + onRampLength)
    const onRamp = decodeAddress(onRampBytes, networkInfo(sourceChainSelector).family)

    return {
      router,
      sourceChainSelector,
      onRamps: [onRamp],
      isEnabled,
      minSeqNr,
      isRmnVerificationDisabled,
      typeAndVersion,
    }
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
   * {@inheritDoc Chain.getTokenForTokenPool}
   * @throws {@link CCIPError} if token pool type is invalid or state not found
   * @throws {@link CCIPDataFormatUnsupportedError} if view call fails
   */
  override async getTokenForTokenPool(tokenPool: string): Promise<string> {
    return withLookupRetry(() => this.getTokenForTokenPool_(tokenPool))
  }

  /** {@inheritDoc SuiChain.getTokenForTokenPool} */
  private async getTokenForTokenPool_(tokenPool: string): Promise<string> {
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

    // Walk the state's package_ids to the latest pool package for the call
    // (type strings carry the original package, whose functions are version-gated)
    const poolContent = info.data?.content
    const packageIds =
      poolContent?.dataType === 'moveObject'
        ? (poolContent.fields as Record<string, unknown>)['package_ids']
        : undefined
    const latestPoolPackage =
      Array.isArray(packageIds) && packageIds.length
        ? (packageIds[packageIds.length - 1] as string)
        : type.split('<')[0]!.split('::')[0]!
    const poolModule = type.split('<')[0]!.split('::')[1]!

    // Call get_token function from managed_token_pool contract with the type parameter
    const target = `${latestPoolPackage}::${poolModule}::get_token`
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
    return withLookupRetry(() => this.getTokenInfo_(token))
  }

  /** {@inheritDoc SuiChain.getTokenInfo} */
  private async getTokenInfo_(token: string): Promise<{ symbol: string; decimals: number }> {
    const normalizedTokenAddress = normalizeSuiAddress(token)
    if (!isValidSuiAddress(normalizedTokenAddress)) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading Sui token metadata')
    }

    const objectResponse = await this.client.getObject({
      id: normalizedTokenAddress,
      options: { showType: true, showContent: true },
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
      // Read symbol/decimals from the metadata object itself; the node's
      // coin-registry lookup (suix_getCoinMetadata) is unreliable on some
      // indexers (returns null for existing metadata objects)
      const content = objectResponse.data?.content
      if (content?.dataType === 'moveObject') {
        const fields = content.fields as { symbol?: unknown; decimals?: unknown }
        if (typeof fields.symbol === 'string' && typeof fields.decimals === 'number') {
          return { symbol: fields.symbol, decimals: fields.decimals }
        }
      }
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

    let metadata
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

  /**
   * Gets the token admin registry for a ramp of this CCIP deployment.
   * The token admin registry is a module of the ccip package, reachable from
   * any ramp of the deployment through `get_ccip_package_id`.
   * @param address - Ramp (onramp/offramp/router) package address.
   * @param _destChainSelector - Unused on Sui (registry is global to the deployment).
   * @returns Token admin registry address in `package::module` form.
   */
  async getTokenAdminRegistryFor(address: string, _destChainSelector?: bigint): Promise<string> {
    const ccip = await getCcipStateAddress(address, this.client)
    return `${ccip.split('::')[0]}::token_admin_registry`
  }

  // Static methods for decoding
  /**
   * Decodes a CCIP message from a Sui log event.
   * @param log - Log event data.
   * @returns Decoded CCIPMessage or undefined if not valid.
   * @throws {@link CCIPSuiLogInvalidError} if log data format is invalid
   */
  static decodeMessage(log: ChainLog): CCIPMessage | undefined {
    const { data } = log
    if (
      (typeof data !== 'string' || !data.startsWith('{')) &&
      (typeof data !== 'object' || isBytesLike(data))
    )
      throw new CCIPLogDataInvalidError(util.inspect(log), { chain: this.family })
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
    { data, topics }: SetOptional<Pick<ChainLog, 'data' | 'topics'>, 'topics'>,
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
          merkleRoot: hexlify(getDataBytes(root.merkle_root)) as `0x${string}`,
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
  }: SetOptional<Pick<ChainLog, 'data' | 'topics'>, 'topics'>): ExecutionReceipt | undefined {
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

  /**
   * {@inheritDoc Chain.generateUnsignedExecute}
   * @throws {@link CCIPExecutionReportChainMismatchError} if input is not a Sui v1.6 execution report
   */
  override async generateUnsignedExecute(
    opts: Parameters<Chain['generateUnsignedExecute']>[0],
  ): Promise<UnsignedSuiTx> {
    const resolved = await this.resolveExecuteOpts(opts)
    if (!resolved.offRamp.includes('::')) resolved.offRamp += '::offramp'
    if (!('message' in resolved.input)) {
      throw new CCIPExecutionReportChainMismatchError('Sui')
    }

    return generateUnsignedExecutePTB(
      this.client,
      resolved.offRamp,
      resolved.input as ExecutionInput<CCIPMessage_V1_6_Sui>,
      {
        gasLimit: resolved.gasLimit,
        receiverObjectIds: (resolved as { receiverObjectIds?: string[] }).receiverObjectIds,
      },
    )
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
    const wallet = opts.wallet as Keypair

    if (opts.receiverObjectIds) {
      this.logger.info(
        `Overriding Sui Manual Execution receiverObjectIds with: ${opts.receiverObjectIds.join(', ')}`,
      )
    }

    const unsignedTx = await this.generateUnsignedExecute({
      ...opts,
      payer: '',
    })

    const digest = await signAndExecuteSuiTx(this.client, wallet, unsignedTx, this.logger)

    // Return the transaction as a ChainTransaction
    return this.getExecutionReceiptInTx(await this.getTransaction(digest))
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
  async getTokenPoolConfig(_tokenPool: string, _feeOpts?: TokenTransferFeeOpts): Promise<never> {
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
   * @throws {@link CCIPArgumentInvalidError} if extraArgs contains unknown fields for SuiExtraArgsV1
   */
  static override buildMessageForDest(
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage & { extraArgs: SuiExtraArgsV1 } {
    /** Valid field names for SuiExtraArgsV1, including recognised aliases. */
    const SUI_EXTRA_ARGS_FIELDS = new Set([
      'gasLimit',
      'allowOutOfOrderExecution',
      'tokenReceiver',
      'receiverObjectIds',
      'accounts', // alias for receiverObjectIds
    ])
    if (message.extraArgs) {
      const unknown = Object.keys(message.extraArgs).filter(
        (k) => k !== '_tag' && !SUI_EXTRA_ARGS_FIELDS.has(k),
      )
      if (unknown.length)
        throw new CCIPArgumentInvalidError(
          'extraArgs',
          `unknown field(s) for SuiExtraArgsV1: ${unknown.map((k) => JSON.stringify(k)).join(', ')}`,
        )
    }
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
    const [tokenReceiver, receiver] =
      message.extraArgs && 'tokenReceiver' in message.extraArgs && !!message.extraArgs.tokenReceiver
        ? [this.getAddress(message.extraArgs.tokenReceiver), this.getAddress(message.receiver)] // explicit tokenReceiver, keep both
        : message.tokenAmounts?.length
          ? [
              this.getAddress(message.receiver),
              '0x0000000000000000000000000000000000000000000000000000000000000000',
            ] // if sending tokens without tokenReceiver, set receiver to default and tokenReceiver to message.receiver
          : [
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              this.getAddress(message.receiver),
            ] // otherwise, tokenReceiver is default and receiver is message.receiver
    const receiverObjectIds =
      message.extraArgs &&
      'receiverObjectIds' in message.extraArgs &&
      message.extraArgs.receiverObjectIds?.length
        ? message.extraArgs.receiverObjectIds.map(this.getAddress.bind(this))
        : message.extraArgs && 'accounts' in message.extraArgs && message.extraArgs.accounts?.length
          ? message.extraArgs.accounts.map(this.getAddress.bind(this)) // populates receiverObjectIds from accounts
          : []

    const extraArgs: SuiExtraArgsV1 = {
      gasLimit,
      allowOutOfOrderExecution,
      tokenReceiver,
      receiverObjectIds,
    }

    return {
      ...message,
      receiver,
      extraArgs,
    }
  }
}
