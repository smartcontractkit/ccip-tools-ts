import { bcs } from '@mysten/sui/bcs'
import { Signer } from '@mysten/sui/cryptography'
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
import {
  getCcipStateAddress,
  getOffRampsForCcip,
  getOffRampsFromRampOwner,
  getOnRampsForCcip,
  resolveCcipStateAddress,
} from './discovery.ts'
import { type CommitEvent, streamSuiLogs, withLookupRetry } from './events.ts'
import { getSuiLeafHasher } from './hasher.ts'
import {
  deriveObjectID,
  getDynamicFieldIds,
  getLatestPackageId,
  getObjectFields,
  getObjectRef,
  getTableEntryFields,
  parseSuiNumbers,
} from './objects.ts'
import {
  CCIPArgumentInvalidError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPErrorCode,
  CCIPExecTxRevertedError,
  CCIPExecutionReportChainMismatchError,
  CCIPInsufficientBalanceError,
  CCIPLogDataInvalidError,
  CCIPLogsAddressRequiredError,
  CCIPNotImplementedError,
  CCIPSourceChainUnsupportedError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1, SuiExtraArgsV1 } from '../extra-args.ts'
import { createRateLimitedFetch, fetchProfileForUrl } from '../fetch.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { decodeMessage, normalizeDeep } from '../requests.ts'
import { decodeMoveExtraArgs, encodeMoveExtraArgs, getMoveAddress } from '../shared/bcs-codecs.ts'
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
  MessageInput,
  WithLogger,
} from '../types.ts'
import {
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  parseTypeAndVersion,
  passesTypeAndVersion,
  util,
} from '../utils.ts'
import { generateUnsignedExecutePTB, signAndExecuteSuiTx } from './exec.ts'
import type {
  CCIPMessage_V1_6_Sui,
  SuiFeeQuoterConfig,
  SuiOffRampSourceChainConfigFields,
  SuiOffRampStateFields,
  SuiOnRampDestChainConfigFields,
  SuiOnRampStateFields,
  SuiRmnRemoteConfig,
  SuiRmnRemoteStateFields,
  UnsignedSuiTx,
} from './types.ts'
export type { UnsignedSuiTx }

const DEFAULT_GAS_LIMIT = 1000000n

/** `ccip::rmn_remote`'s GLOBAL_CURSE_SUBJECT; cursing it curses every lane. */
const GLOBAL_CURSE_SUBJECT = '0x01000000000000000000000000000001'
/** SUI's native coin type; the default fee token when `message.feeToken` is unset. */
const SUI_NATIVE_COIN_TYPE = '0x2::sui::SUI'

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
    this.client.getTransactionBlock = memoize(this.client.getTransactionBlock.bind(this.client), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 5e3,
      transformKey: ([args]: Parameters<typeof this.client.getTransactionBlock>) => [
        args.digest,
        args.options?.showEffects,
        args.options?.showInput,
      ],
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
   * @throws {@link CCIPTopicsInvalidError} if topics format is invalid (thrown by {@link streamSuiLogs})
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

    // Topic validation (and building the per-topic MoveEventType filters) is
    // delegated to streamSuiLogs, which now accepts N topics merged into one
    // ascending stream.
    for await (const event of streamSuiLogs<Record<string, unknown>>(this, opts)) {
      const eventData = event.contents?.json
      const blockTimestamp = new Date(event.timestamp).getTime() / 1000
      if (!eventData) continue
      // Derive the topic from THIS event's own Move type, not the caller's
      // filter list: with several topics merged into one stream, only the
      // event's own type tells us which one it actually is.
      const topic = event.type.slice(event.type.lastIndexOf('::') + 2)
      if (!(await passesTypeAndVersion(this, opts.address, opts.typeAndVersions))) continue
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

    // A ccip state object (`<pkg>::state_object`, or a bare ccip package) is the
    // deployment's router handle and has no `type_and_version` of its own:
    // report a synthetic `StateObjectRouter` type carrying the fee quoter's
    // version, so router-resolving callers can recognize it.
    const pkg = normalizeSuiAddress(address.split('::')[0]!)
    const ccip = await resolveCcipStateAddress(address, this.client).catch(() => undefined)
    if (ccip?.split('::')[0] === pkg) {
      const tx = new Transaction()
      tx.moveCall({ target: `${pkg}::fee_quoter::type_and_version`, arguments: [] })
      const result = await this.client.devInspectTransactionBlock({
        sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
        transactionBlock: tx,
      })
      if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
        throw new CCIPError(
          CCIPErrorCode.UNKNOWN,
          `Failed to call ${pkg}::fee_quoter::type_and_version: ${
            result.effects.status.error || 'No return value'
          }`,
        )
      }
      const [data] = result.results[0].returnValues[0]
      const [, version] = parseTypeAndVersion(bcs.String.parse(getDataBytes(data)))
      return parseTypeAndVersion(`StateObjectRouter v${version}`)
    }

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

  /**
   * The ccip package modules which the ramps report as their static/dynamic
   * config. On Sui these are not separate contracts: `create_static_config` and
   * `create_dynamic_config` in the ramps hardcode `@ccip` for all of them, since
   * each is a module of (and its state a dynamic field of) the ccip package.
   */
  private ccipModules(ccip: string) {
    const pkg = ccip.split('::')[0]
    return {
      feeQuoter: `${pkg}::fee_quoter`,
      rmnRemote: `${pkg}::rmn_remote`,
      nonceManager: `${pkg}::nonce_manager`,
      tokenAdminRegistry: `${pkg}::token_admin_registry`,
    }
  }

  /**
   * Reads the state of a module of the ccip package. Each is held as a dynamic
   * object field of the deployment's CCIPObjectRef, keyed by its type.
   *
   * @param ccip - ccip state object address
   * @param type - `::<module>::<StateStruct>` suffix of the state's type
   * @returns the state object's fields, or undefined if that module has no state
   */
  private async getCcipModuleState(ccip: string, type: string) {
    const ccipObjectRef = await getObjectRef(ccip, this.client)
    const fields = await getDynamicFieldIds(ccipObjectRef, this.client)
    const stateId = Object.entries(fields).find(([objectType]) => objectType.endsWith(type))?.[1]
    if (!stateId) return
    return getObjectFields(stateId, this.client)
  }

  /**
   * Reads the deployment's RMN state.
   *
   * Sui has no RMNProxy, so unlike EVM there is no `getARM()` to unwrap into a
   * separate `rmn` address — `ccip::rmn_remote` is itself the RMN. What EVM
   * reaches through that indirection is reported here instead: the versioned
   * config and the curse state.
   */
  private async getRmnRemoteConfig(ccip: string): Promise<SuiRmnRemoteConfig | undefined> {
    const state = (await this.getCcipModuleState(
      ccip,
      '::rmn_remote::RMNRemoteState',
    )) as unknown as SuiRmnRemoteStateFields | undefined
    if (!state) return
    const cursedSubjects = state.cursed_subjects.fields.contents
      .filter((entry) => entry.fields.value)
      .map((entry) => hexlify(getDataBytes(entry.fields.key)))
    return {
      version: state.config_count,
      rmnHomeContractConfigDigest: hexlify(
        getDataBytes(state.config.fields.rmn_home_contract_config_digest),
      ),
      fSign: BigInt(state.config.fields.f_sign),
      signers: state.config.fields.signers.map(({ fields }) => ({
        onchainPublicKey: hexlify(getDataBytes(fields.onchain_public_key)),
        nodeIndex: BigInt(fields.node_index),
      })),
      cursedSubjects,
      isCursedGlobal: cursedSubjects.includes(GLOBAL_CURSE_SUBJECT),
    }
  }

  /**
   * Reads the fee quoter's static config plus its config for one destination
   * chain. Its `Table` fields hold prices and per-token overrides and are not
   * inlined in the object's JSON, so only the flat config fields come back here.
   */
  private async getFeeQuoterConfig(
    ccip: string,
    destChainSelector: bigint,
  ): Promise<SuiFeeQuoterConfig | undefined> {
    const state = await this.getCcipModuleState(ccip, '::fee_quoter::FeeQuoterState')
    if (!state) return
    const table = (state['dest_chain_configs'] as { fields: { id: { id: string } } }).fields.id.id
    const destChainConfig = await getTableEntryFields(table, destChainSelector, this.client)
    if (!destChainConfig) return
    // both structs are flat, so camelCasing their keys and widening the u64/u256
    // decimal strings to bigints yields exactly SuiFeeQuoterConfig
    return normalizeDeep(
      parseSuiNumbers({
        max_fee_juels_per_msg: state['max_fee_juels_per_msg'],
        link_token: state['link_token'],
        token_price_staleness_threshold: state['token_price_staleness_threshold'],
        fee_tokens: state['fee_tokens'],
        ...destChainConfig,
      }),
    ) as unknown as SuiFeeQuoterConfig
  }

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(onRamp: string, destChainSelector: bigint) {
    // accept the deployment's router handle (ccip state object) as well as the
    // onramp itself, so a router address round-trips through this API
    onRamp = await this.getOnRampForRouter(onRamp, destChainSelector)
    const [, , typeAndVersion] = await this.typeAndVersion(onRamp)
    const ccip = await getCcipStateAddress(onRamp, this.client)

    const state = (await getObjectFields(
      await getObjectRef(onRamp, this.client),
      this.client,
    )) as unknown as SuiOnRampStateFields
    const destChainConfig = (await getTableEntryFields(
      state.dest_chain_configs.fields.id.id,
      destChainSelector,
      this.client,
    )) as SuiOnRampDestChainConfigFields | undefined
    if (!destChainConfig)
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `OnRamp ${onRamp} has no config for dest chain ${destChainSelector}`,
        { context: { onRamp, destChainSelector: String(destChainSelector) } },
      )

    const sequenceNumber = BigInt(destChainConfig.sequence_number)
    return {
      chainSelector: BigInt(state.chain_selector),
      // Sui has no usable router contract (`ccip_router::RouterState` is left
      // unconfigured), so the ccip state object is the deployment's router
      // handle: the same address for both ramps, and accepted by every
      // router-taking API here
      router: ccip,
      ...this.ccipModules(ccip),
      feeAggregator: state.fee_aggregator,
      allowlistAdmin: state.allowlist_admin,
      owner: state.ownable_state.fields.owner,
      destChainSelector,
      allowlistEnabled: destChainConfig.allowlist_enabled,
      allowedSenders: destChainConfig.allowed_senders,
      // the onramp's per-dest `router` is the *remote* chain's router, not a
      // local one; keep it under a distinct name so `router` stays this chain's
      destRouter: this.decodeDestRouter(destChainConfig.router, destChainSelector),
      sequenceNumber,
      expectedNextSequenceNumber: sequenceNumber + 1n,
      feeQuoterConfig: await this.getFeeQuoterConfig(ccip, destChainSelector),
      rmnRemoteConfig: await this.getRmnRemoteConfig(ccip),
      typeAndVersion,
    }
  }

  /**
   * Decodes a per-dest configured `router` as a dest-family address, falling
   * back to the raw Move address when it isn't in the dest chain's format (e.g.
   * a Sui-side package used as the router handle for the lane).
   */
  private decodeDestRouter(router: string, destChainSelector: bigint): string {
    try {
      return decodeAddress(router, networkInfo(destChainSelector).family)
    } catch {
      return normalizeSuiAddress(router)
    }
  }

  /** {@inheritDoc Chain.getOffRampConfig} */
  async getOffRampConfig(offRamp: string, sourceChainSelector: bigint) {
    const [, , typeAndVersion] = await this.typeAndVersion(offRamp)
    const ccip = await getCcipStateAddress(offRamp, this.client)

    const state = (await getObjectFields(
      await getObjectRef(offRamp, this.client),
      this.client,
    )) as unknown as SuiOffRampStateFields
    // `source_chain_configs` is a VecMap, so every entry is inlined in the object
    const sourceChainConfig = state.source_chain_configs.fields.contents.find(
      (entry) => entry.fields.key === sourceChainSelector.toString(),
    )?.fields.value.fields as SuiOffRampSourceChainConfigFields | undefined
    if (!sourceChainConfig)
      throw new CCIPSourceChainUnsupportedError(sourceChainSelector, {
        context: { network: this.network.name, offRamp },
      })

    // the offramp hardcodes `router: @ccip`; report it in our canonical ccip form
    const routerHex = normalizeSuiAddress(sourceChainConfig.router)
    return {
      chainSelector: BigInt(state.chain_selector),
      router: routerHex === ccip.split('::')[0] ? ccip : routerHex,
      ...this.ccipModules(ccip),
      permissionlessExecutionThresholdSeconds: state.permissionless_execution_threshold_seconds,
      latestPriceSequenceNumber: BigInt(state.latest_price_sequence_number),
      owner: state.ownable_state.fields.owner,
      sourceChainSelector,
      isEnabled: sourceChainConfig.is_enabled,
      minSeqNr: BigInt(sourceChainConfig.min_seq_nr),
      isRmnVerificationDisabled: sourceChainConfig.is_rmn_verification_disabled,
      rmnRemoteConfig: await this.getRmnRemoteConfig(ccip),
      onRamps: [
        decodeAddress(
          getDataBytes(sourceChainConfig.on_ramp),
          networkInfo(sourceChainSelector).family,
        ),
      ],
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
    // Sui has no usable on-chain offramp registry: `ccip_router::RouterState`
    // only maps dest chain selectors to onramp packages (and is left
    // unconfigured), and neither ramp's state references the other. The ccip
    // package is the shared anchor — both ramps of a deployment report it from
    // `get_ccip_package_id` — so offramps are discovered from it, and the caller
    // matches the candidate whose source chain config lists the expected onramp.
    const ccip = await resolveCcipStateAddress(router, this.client)
    try {
      return await getOffRampsForCcip(ccip, this.client)
    } catch (err) {
      // Last resort for a deployment with no CCIP activity and pruned history:
      // pre-MCMS ramps are Ownable-owned by the deployer, which also holds the
      // offramp's OwnerCap. Needs a ramp to anchor ownership on, so it only
      // applies when the caller passed one rather than the router handle.
      if (/::(on|off)ramp$/.test(router)) {
        const latest = await getLatestPackageId(router, this.client)
        const offramps = await getOffRampsFromRampOwner(latest, this.client).catch(() => [])
        if (offramps.length) return offramps
      }
      throw err
    }
  }

  /**
   * {@inheritDoc Chain.getOnRampForRouter}
   * @throws {@link CCIPError} if no onramp of the deployment serves destChainSelector
   */
  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    // accepts the deployment's router handle (its ccip state object) or the
    // onramp itself; an onramp is returned unchanged
    if (router.endsWith('::onramp')) return router
    const ccip = await resolveCcipStateAddress(router, this.client)
    // a package which resolves to itself is the ccip package, not a ramp
    if (ccip.split('::')[0] !== router.split('::')[0]) return `${router.split('::')[0]}::onramp`

    const onRamps = await getOnRampsForCcip(ccip, this.client)
    if (onRamps.length === 1) return onRamps[0]!
    const configured: string[] = []
    for (const onRamp of onRamps) {
      if (await this.isDestChainConfigured(onRamp, destChainSelector)) configured.push(onRamp)
    }
    if (configured.length) {
      // Prefer the onramp whose own package is current: a retired upgrade lineage
      // answers view calls but its `OnRampState` is defined by the original
      // package, which the TS SDK cannot include as a transaction input
      // (`InvalidLinkage` on execution).
      for (const onRamp of configured) {
        const latest = await getLatestPackageId(onRamp, this.client)
        if (latest.split('::')[0] === onRamp.split('::')[0]) return onRamp
      }
      return configured[0]!
    }
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `No onramp of ccip ${ccip} is configured for dest chain ${destChainSelector}`,
      { context: { router, onRamps } },
    )
  }

  /** Whether an onramp has a dest chain config for `destChainSelector`. */
  private async isDestChainConfigured(onRamp: string, destChainSelector: bigint) {
    const state = (await getObjectFields(
      await getObjectRef(onRamp, this.client),
      this.client,
    )) as unknown as SuiOnRampStateFields
    return !!(await getTableEntryFields(
      state.dest_chain_configs.fields.id.id,
      destChainSelector,
      this.client,
    ))
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
    // Coin type strings (e.g. native "0x2::sui::SUI" or "0xabc::coin::COIN") are
    // not object IDs; they must be resolved through the coin registry instead.
    if (token.includes('::')) {
      if (token.split('::').length < 3) {
        throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading Sui token metadata')
      }
      return this.getCoinMetadataInfo(token)
    }

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

    return this.getCoinMetadataInfo(coinType)
  }

  /** Fetches `symbol`/`decimals` for a coin type from the on-chain coin registry. */
  private async getCoinMetadataInfo(coinType: string): Promise<{
    symbol: string
    decimals: number
  }> {
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
   * @param address - Ramp (onramp/offramp) or router (ccip state object) address.
   * @param _destChainSelector - Unused on Sui (registry is global to the deployment).
   * @returns Token admin registry address in `package::module` form.
   */
  async getTokenAdminRegistryFor(address: string, _destChainSelector?: bigint): Promise<string> {
    const ccip = await resolveCcipStateAddress(address, this.client)
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
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
    | undefined {
    return decodeMoveExtraArgs(extraArgs)
  }

  /**
   * Encodes extra arguments for Sui CCIP messages in BCS format.
   * Dispatches to the correct encoder based on the destination chain's extraArgs type:
   * - `SVMExtraArgsV1` (Solana dest): BCS `{computeUnits, accountIsWritableBitmap, ...}`
   * - `SuiExtraArgsV1` (Sui dest): BCS `{gasLimit, allowOutOfOrderExecution, ...}`
   * - `EVMExtraArgsV2` / `GenericExtraArgsV2` (EVM dest): BCS `{gasLimit: u256, ...}`
   * @param args - Extra arguments to encode.
   * @returns Encoded extra arguments as a hex string.
   */
  static encodeExtraArgs(args: ExtraArgs): string {
    return encodeMoveExtraArgs(args)
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
  async getFee(opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    return withLookupRetry(async () => {
      const args = await this.buildCcipSendArgs(opts.router, opts.destChainSelector, opts.message)

      const tx = new Transaction()
      tx.moveCall({
        target: `${args.latestOnRamp}::get_fee`,
        typeArguments: [args.coinType],
        arguments: [
          tx.object(args.ccipObjectRef),
          tx.object('0x6'), // Clock
          tx.pure.u64(opts.destChainSelector),
          tx.pure.vector('u8', Array.from(args.receiverBytes)),
          tx.pure.vector('u8', Array.from(args.dataBytes)),
          tx.pure.vector('address', args.tokenAddresses),
          tx.pure.vector('u64', args.tokenAmounts),
          tx.object(args.feeTokenMetadataId),
          tx.pure.vector('u8', Array.from(args.extraArgsBytes)),
        ],
      })

      const result = await this.client.devInspectTransactionBlock({
        sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
        transactionBlock: tx,
      })

      if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
        throw new CCIPDataFormatUnsupportedError(
          `Failed to call ${args.latestOnRamp}::get_fee: ${
            result.effects.status.error || 'No return value'
          }`,
        )
      }

      const [data] = result.results[0].returnValues[0]
      return BigInt(bcs.u64().parse(getDataBytes(data)))
    })
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  override generateUnsignedSendMessage(
    _opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('SuiChain.generateUnsignedSendMessage'))
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    const wallet = opts.wallet as Signer | undefined
    if (!(wallet instanceof Signer)) throw new CCIPWalletInvalidError(util.inspect(opts.wallet))

    const args = await this.buildCcipSendArgs(opts.router, opts.destChainSelector, opts.message)

    // Pick an onchain coin of the fee token to pay the fee with; the onramp
    // splits the exact fee out of it itself.
    const coins = await this.client.getCoins({
      owner: wallet.toSuiAddress(),
      coinType: args.coinType,
    })
    const fee = opts.message.fee
    const payment =
      coins.data.find((c) => (fee == null ? true : BigInt(c.balance) >= fee)) ?? coins.data[0]
    if (!payment) {
      throw new CCIPInsufficientBalanceError(
        '0',
        fee?.toString() ?? '0',
        args.coinType === SUI_NATIVE_COIN_TYPE ? 'SUI' : args.coinType,
      )
    }

    const tx = new Transaction()
    // create_token_transfer_params produces the (empty) TokenTransferParams hot potato
    const tokenParams = tx.moveCall({
      target: `${args.ccipPackage}::onramp_state_helper::create_token_transfer_params`,
      arguments: [tx.pure.vector('u8', Array.from(args.receiverBytes))],
    })
    tx.moveCall({
      target: `${args.latestOnRamp}::ccip_send`,
      typeArguments: [args.coinType],
      arguments: [
        tx.object(args.ccipObjectRef),
        tx.object(args.onRampState),
        tx.object('0x6'), // Clock
        tx.pure.u64(opts.destChainSelector),
        tx.pure.vector('u8', Array.from(args.receiverBytes)),
        tx.pure.vector('u8', Array.from(args.dataBytes)),
        tokenParams,
        tx.object(args.feeTokenMetadataId),
        tx.object(payment.coinObjectId),
        tx.pure.vector('u8', Array.from(args.extraArgsBytes)),
      ],
    })

    let digest: string
    try {
      const result = await this.client.signAndExecuteTransaction({
        signer: wallet,
        transaction: tx,
        options: { showEffects: true, showEvents: true },
      })

      if (result.effects?.status.status !== 'success') {
        const errorMsg = result.effects?.status.error ?? 'Unknown error'
        throw new CCIPExecTxRevertedError(result.digest, { context: { error: errorMsg } })
      }
      digest = result.digest
    } catch (e) {
      if (e instanceof CCIPExecTxRevertedError) throw e
      throw new CCIPError(
        CCIPErrorCode.TRANSACTION_NOT_FINALIZED,
        `Failed to send Sui message: ${(e as Error).message}`,
      )
    }

    this.logger.info(`Waiting for Sui transaction ${digest} to be finalized...`)
    await this.client.waitForTransaction({
      digest,
      options: { showEffects: true, showEvents: true },
    })

    const request = (await this.getMessagesInTx(digest))[0]
    if (!request) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `No CCIP message found in send transaction ${digest}`,
      )
    }
    return request
  }

  /**
   * Resolves the fee token's coin type and its `CoinMetadata` object id for a message.
   * Native SUI (or the zero address) is used when `message.feeToken` is unset.
   *
   * The fee quoter only accepts metadata objects from its own `fee_tokens` list,
   * so the accepted id is resolved from that list rather than from
   * `suix_getCoinMetadata` (which now returns the coin registry's `Currency`
   * object, not a `CoinMetadata`).
   */
  private async resolveFeeToken(
    message: MessageInput,
    ccip: string,
  ): Promise<{ coinType: string; metadataId: string }> {
    const feeToken = message.feeToken
    const native = feeToken == null || /^0x0+$/.test(feeToken)

    // Explicit metadata object id: pass it through (the onramp validates it on-chain)
    if (feeToken && !native && !feeToken.includes('::')) {
      const objectResponse = await this.client.getObject({
        id: feeToken,
        options: { showType: true },
      })
      const coinType = objectResponse.data?.type?.match(/CoinMetadata<(.+)>$/)?.[1]
      if (!coinType) {
        throw new CCIPArgumentInvalidError(
          'feeToken',
          `${feeToken} is not a coin type or CoinMetadata object id`,
        )
      }
      return { coinType, metadataId: normalizeSuiAddress(feeToken) }
    }

    const wantedCoinType = native ? SUI_NATIVE_COIN_TYPE : feeToken

    // Find the accepted CoinMetadata<wantedCoinType> object from the fee quoter's
    // fee_tokens list; fall back to suix_getCoinMetadata for deployments that
    // keep the id in the metadata response.
    const state = await this.getCcipModuleState(ccip, '::fee_quoter::FeeQuoterState')
    const feeTokens = Array.isArray(state?.['fee_tokens']) ? (state['fee_tokens'] as string[]) : []
    if (feeTokens.length) {
      const feeTokenObjects = await Promise.all(
        feeTokens.map((id) =>
          this.client
            .getObject({ id, options: { showType: true } })
            .then((obj) => [id, obj.data?.type] as const),
        ),
      )
      const match = feeTokenObjects.find(([, type]) =>
        type?.includes(`CoinMetadata<${wantedCoinType}>`),
      )?.[0]
      if (match) return { coinType: wantedCoinType, metadataId: match }
      throw new CCIPArgumentInvalidError(
        'feeToken',
        `${wantedCoinType} is not in the fee quoter's accepted fee tokens`,
      )
    }

    const metadata = await this.client.getCoinMetadata({ coinType: wantedCoinType })
    if (!metadata?.id) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading SUI CoinMetadata')
    }
    return { coinType: wantedCoinType, metadataId: metadata.id }
  }

  /**
   * Resolves the on-chain objects and encoded arguments shared by `get_fee` and `ccip_send`.
   */
  private async buildCcipSendArgs(
    router: string,
    destChainSelector: bigint,
    message: MessageInput,
  ): Promise<{
    latestOnRamp: string
    ccipPackage: string
    ccipObjectRef: string
    onRampState: string
    coinType: string
    feeTokenMetadataId: string
    receiverBytes: Uint8Array
    dataBytes: Uint8Array
    tokenAddresses: string[]
    tokenAmounts: bigint[]
    extraArgsBytes: Uint8Array
  }> {
    // Accept the deployment's router handle (ccip state object) or the onramp itself
    const onRamp = await this.getOnRampForRouter(router, destChainSelector)
    // View calls must target the latest package (old versions are version-gated),
    // but state pointers live on the ORIGINAL package: resolve the onramp state
    // from `onRamp`, and only the call target from `latestOnRamp`
    const latestOnRamp = await getLatestPackageId(onRamp, this.client)
    // ccip_send's signature references structs (e.g. OnRampState) defined by the
    // package's ORIGINAL version; calling the upgraded package would require the
    // original package as a transaction input, which the TypeScript SDK cannot
    // emit — the node rejects such calls with InvalidLinkage.
    if (latestOnRamp.split('::')[0] !== normalizeSuiAddress(onRamp.split('::')[0]!)) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `OnRamp ${onRamp} has been upgraded to ${latestOnRamp.split('::')[0]}; ` +
          'ccip_send on an upgraded Sui onramp is not supported by the TypeScript SDK ' +
          '(the original package cannot be included as a transaction input). ' +
          'Deploy a fresh (non-upgraded) onramp for this lane instead.',
        { context: { onRamp, latestOnRamp } },
      )
    }
    const ccip = await getCcipStateAddress(latestOnRamp, this.client)
    const ccipPackage = ccip.split('::')[0]!
    const [ccipObjectRef, onRampState] = await Promise.all([
      getObjectRef(ccip, this.client),
      getObjectRef(onRamp, this.client),
    ])

    const { coinType, metadataId } = await this.resolveFeeToken(message, ccip)

    if (!message.receiver) throw new CCIPArgumentInvalidError('receiver', String(message.receiver))
    const receiverBytes = getAddressBytes(getMoveAddress(message.receiver))
    const dataBytes = getDataBytes(message.data ?? '0x')

    const tokenAddresses: string[] = []
    const tokenAmounts: bigint[] = []
    for (const tokenAmount of message.tokenAmounts ?? []) {
      // token is a coin type (e.g. SUI) or a CoinMetadata object id
      tokenAddresses.push(
        tokenAmount.token.includes('::')
          ? ((await this.client.getCoinMetadata({ coinType: tokenAmount.token }))?.id ??
              (() => {
                throw new CCIPArgumentInvalidError('tokenAmounts', tokenAmount.token)
              })())
          : normalizeSuiAddress(tokenAmount.token),
      )
      tokenAmounts.push(BigInt(tokenAmount.amount))
    }

    // Encoded on-chain extra args; the encoder picks the destination family's format
    // from the fields present (EVM V2 gasLimit, Solana computeUnits)
    const { gasLimit, allowOutOfOrderExecution, computeUnits } =
      message.extraArgs as MessageInput['extraArgs'] & Partial<EVMExtraArgsV2 & SVMExtraArgsV1>
    const extraArgsBytes = getDataBytes(
      SuiChain.encodeExtraArgs({
        gasLimit: gasLimit ?? 0n,
        ...(allowOutOfOrderExecution != null && { allowOutOfOrderExecution }),
        ...(computeUnits != null && { computeUnits }),
      }),
    )

    return {
      latestOnRamp,
      ccipPackage,
      ccipObjectRef,
      onRampState,
      coinType,
      feeTokenMetadataId: metadataId,
      receiverBytes,
      dataBytes,
      tokenAddresses,
      tokenAmounts,
      extraArgsBytes,
    }
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
    const wallet = opts.wallet as Signer

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
