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
  type TokenInfo,
  type TokenPoolConfig,
  type TokenPoolRemote,
  type TokenTransferFeeOpts,
  Chain,
} from '../chain.ts'
import {
  getCcipStateAddress,
  getOffRampsForCcip,
  getOffRampsFromRampOwner,
  getOnRampForSelectorFromRouterState,
  getOnRampsForCcip,
  moduleOfPackage,
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
  getPackageDisassembly,
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
  CCIPTokenPoolChainConfigNotFoundError,
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
    this.getTokenInfo = memoize(this.getTokenInfo.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getRegistryTokenConfig = memoize(this.getRegistryTokenConfig.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 100,
      expires: 300e3,
    })
    this.getTokenPoolConfig = memoize(this.getTokenPoolConfig.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 300e3,
    })
    this.getTokenPoolRemotes = memoize(this.getTokenPoolRemotes.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 100,
      expires: 60e3,
    })
    this.getFeeTokens = memoize(this.getFeeTokens.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 10,
    })
    this.getSupportedTokens = memoize(this.getSupportedTokens.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 10,
      expires: 300e3,
    })
    this.getOnRampForRouter = memoize(this.getOnRampForRouter.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 100,
      expires: 60e3,
    })
    // Token pool state resolution is the shared substrate of several methods
    // (config, remotes, local token) and reads stable on-chain state
    this.getTokenPoolStateRef_ = memoize(this.getTokenPoolStateRef_.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 50,
      expires: 300e3,
    })

    // Monkey-patched memoized RPC reads (same pattern as EVM/Solana): these
    // are the object-level lookups every split-out discovery helper shares;
    // state/config/metadata objects change only on upgrade, so short-TTL
    // caching collapses the repeated identical reads across call sites
    // (async memoization does not cache rejections, so transient backend lag
    // retries cleanly). Balance/coin queries and devInspect are left live.
    this.client.getTransactionBlock = memoize(this.client.getTransactionBlock.bind(this.client), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 60e3, // finalized tx contents are immutable
      transformKey: ([args]: Parameters<typeof this.client.getTransactionBlock>) => [
        args.digest,
        args.options?.showEffects,
        args.options?.showInput,
      ],
    })
    // Partial/mock clients (unit tests) may not carry every method; skip those
    if (typeof this.client.getObject === 'function')
      this.client.getObject = memoize(this.client.getObject.bind(this.client), {
        async: true,
        maxSize: 500,
        expires: 30e3,
        transformKey: ([args]: Parameters<typeof this.client.getObject>) => [
          args.id,
          JSON.stringify(args.options ?? null),
        ],
      })
    if (typeof this.client.getOwnedObjects === 'function')
      this.client.getOwnedObjects = memoize(this.client.getOwnedObjects.bind(this.client), {
        async: true,
        maxSize: 200,
        expires: 30e3,
        transformKey: ([args]: Parameters<typeof this.client.getOwnedObjects>) => [
          args.owner,
          args.cursor,
          args.limit,
          JSON.stringify(args.filter ?? null),
          JSON.stringify(args.options ?? null),
        ],
      })
    if (typeof this.client.getDynamicFields === 'function')
      this.client.getDynamicFields = memoize(this.client.getDynamicFields.bind(this.client), {
        async: true,
        maxSize: 200,
        expires: 60e3,
        transformKey: ([args]: Parameters<typeof this.client.getDynamicFields>) => [
          args.parentId,
          args.cursor,
          args.limit,
        ],
      })
    if (typeof this.client.getCoinMetadata === 'function')
      this.client.getCoinMetadata = memoize(this.client.getCoinMetadata.bind(this.client), {
        async: true,
        maxSize: 100, // coin metadata is immutable per coin type
        transformKey: ([args]: Parameters<typeof this.client.getCoinMetadata>) => [args.coinType],
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
      // View calls must target the package's latest version: the original
      // package's functions are version-gated and revert once upgraded.
      const latestPkg = normalizeSuiAddress(
        (await getLatestPackageId(ccip, this.client)).split('::')[0]!,
      )
      const tx = new Transaction()
      tx.moveCall({ target: `${latestPkg}::fee_quoter::type_and_version`, arguments: [] })
      const result = await this.client.devInspectTransactionBlock({
        sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
        transactionBlock: tx,
      })
      if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
        throw new CCIPError(
          CCIPErrorCode.UNKNOWN,
          `Failed to call ${latestPkg}::fee_quoter::type_and_version: ${
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
    const routerPkg = normalizeSuiAddress(router.split('::')[0]!)
    // A bare onramp package id: serve its own (latest) onramp directly
    if (!router.includes('::') && (await moduleOfPackage(routerPkg, this.client)) === 'onramp') {
      return getLatestPackageId(`${routerPkg}::onramp`, this.client)
    }

    const ccip = await resolveCcipStateAddress(router, this.client)
    // Deterministic first: the deployment's RouterState maps the dest chain
    // selector to its onramp package (current object state only); fall back to
    // the activity scan when no router maps this lane.
    const fromRouterState = await getOnRampForSelectorFromRouterState(
      ccip,
      destChainSelector,
      this.client,
    ).catch(() => undefined)
    if (fromRouterState) return fromRouterState

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
   * Yields execution receipts for an offramp (Sui override of
   * Chain.getExecutionReceipts).
   *
   * Sui fullnodes can no longer serve event queries over ranges whose txs were
   * pruned from the event-tx linkage ("Could not find the referenced transaction
   * events", on every provider tested); the indexer's transaction listing by the
   * offramp's execution moves is the only queryable event source, and each
   * listed tx carries its ExecutionStateChanged or SkippedAlreadyExecuted events.
   */
  override async *getExecutionReceipts(
    opts: Parameters<Chain['getExecutionReceipts']>[0],
  ): AsyncIterableIterator<CCIPExecution> {
    const { offRamp, messageId, sourceChainSelector, ...hints } = opts
    // executions target the LATEST offramp package (older versions are
    // version-gated and revert), so the indexer filter must too
    const offRampPkg = normalizeSuiAddress(
      (await getLatestPackageId(offRamp, this.client)).split('::')[0]!,
    )
    const startTimeMs = hints.startTime != null ? Number(hints.startTime) * 1000 : 0
    const startCheckpoint = hints.startBlock != null ? Number(hints.startBlock) : 0
    const yielded = new Set<string>()

    const execFns = ['init_execute', 'manually_init_execute']
    for (;;) {
      let found = 0
      for (const fn of execFns) {
        let cursor: string | null | undefined
        let outOfWindow = false
        for (;;) {
          if (outOfWindow) break
          const res = await withLookupRetry(() =>
            this.client.queryTransactionBlocks({
              filter: {
                MoveFunction: { package: offRampPkg, module: 'offramp', function: fn },
              },
              options: { showEvents: true },
              limit: 50,
              ...(cursor ? { cursor } : {}),
            }),
          )
          for (const block of res.data) {
            // indexer lists newest first; below the window everything is older
            const checkpoint = Number(block.checkpoint ?? 0)
            if (checkpoint && checkpoint < startCheckpoint) {
              outOfWindow = true
              break
            }
            const tsMs = Number(block.timestampMs ?? 0)
            if (tsMs && tsMs < startTimeMs) {
              outOfWindow = true
              break
            }
            if (yielded.has(block.digest)) continue
            yielded.add(block.digest)

            for (const [i, event] of (block.events ?? []).entries()) {
              const eventName = event.type.slice(event.type.lastIndexOf('::') + 2)
              // SkippedAlreadyExecuted is not an execution: only the state-change
              // receipts count
              if (eventName !== 'ExecutionStateChanged') continue
              const log: ChainLog = {
                address: offRamp,
                transactionHash: block.digest,
                index: i,
                blockNumber: checkpoint,
                blockTimestamp: tsMs / 1000,
                data: event.parsedJson as Record<string, unknown>,
                topics: [eventName],
              }
              const receipt = (this.constructor as ChainStatic).decodeReceipt(log)
              if (!receipt) continue
              if (messageId && receipt.messageId && receipt.messageId !== messageId) continue
              if (
                sourceChainSelector &&
                receipt.sourceChainSelector &&
                receipt.sourceChainSelector !== sourceChainSelector
              )
                continue
              yield { receipt, log }
              found++
              if (receipt.state === (2 as ExecutionState)) return
            }
          }
          if (!res.hasNextPage) break
          cursor = res.nextCursor
        }
      }
      if (!hints.watch) break
      if (!found) await new Promise((resolve) => setTimeout(resolve, 5000))
    }
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
    const { poolStateObjectId, tokenType, poolModule, latestPoolPackage } =
      await this.getTokenPoolStateRef_(tokenPool)

    // Call get_token function from the token pool contract with the type parameter
    const target = `${latestPoolPackage}::${poolModule}::get_token`
    const tx = new Transaction()
    tx.moveCall({
      target,
      typeArguments: [tokenType],
      arguments: [tx.object(poolStateObjectId)],
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
   * Resolves a token pool package to its pool state object and call targets,
   * deterministically from on-chain package metadata:
   *
   * 1. The pool package is assumed to have a single module ending in
   *    `_token_pool`; its disassembled source is read from the package object.
   * 2. The module's `*TokenPoolState` struct (from the disassembly) names the
   *    state object, whose id is derived from the package-owned state pointer
   *    (`<module>_object_id`, a derived-object parent).
   * 3. The state object's type names the module and the token coin type.
   * 4. The disassembly's `use <addr>::<cciimodule>` import names the ccip
   *    package the pool is registered with (no tx scanning).
   */
  private async getTokenPoolStateRef_(tokenPool: string): Promise<{
    poolStateObjectId: string
    tokenType: string
    poolModule: string
    latestPoolPackage: string
    ccipPackage: string | undefined
  }> {
    const normalizedTokenPool = normalizeSuiAddress(tokenPool)

    // single disassembled module ending in `_token_pool` names the pool module
    const disassembled = await getPackageDisassembly(normalizedTokenPool, this.client)
    const poolModules = Object.keys(disassembled).filter((name) => name.endsWith('_token_pool'))
    if (poolModules.length !== 1) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `Expected a single *_token_pool module in ${tokenPool}, got: ${poolModules.join(', ') || 'none'}`,
      )
    }
    const poolModule = poolModules[0]!
    const moduleSource = String(disassembled[poolModule])

    // The ccip package the pool is registered with, from its imports: any
    // ccip module (token_admin_registry, state_object, fee_quoter, ...), with
    // or without an `as` alias.
    const CCIP_MODULES =
      '(?:token_admin_registry|state_object|fee_quoter|onramp_state_helper|offramp_state_helper|' +
      'nonce_manager|rmn_remote|receiver_registry|eth_abi|publisher_wrapper)'
    const ccipImport = moduleSource.match(
      new RegExp(`use\\s+([0-9a-fA-F]{1,64})::${CCIP_MODULES}\\s*(?:as\\s+\\w+)?;`),
    )
    const ccipPackage = ccipImport?.[1] ? `0x${ccipImport[1]}` : undefined

    // the state pointer field (`<module>_object_id`) inside the package-owned pointer object
    const pointerFieldMatch = moduleSource.match(/\b(\w+_object_id)\s*:/)
    const pointerField = pointerFieldMatch?.[1] ?? `${poolModule}_object_id`
    const objects = await this.client.getOwnedObjects({
      owner: normalizedTokenPool,
      options: { showContent: true },
    })
    let stateObjectPointerId: string | undefined
    for (const obj of objects.data) {
      const content = obj.data?.content
      if (content?.dataType !== 'moveObject') continue
      stateObjectPointerId = (content.fields as Record<string, unknown>)[pointerField] as string
    }
    if (!stateObjectPointerId) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `No token pool state pointer found for ${tokenPool}`,
      )
    }

    // the `*TokenPoolState` struct(s) from the disassembly; the derived object
    // resolving to `<pkg>::<module>::<name>` is the pool state
    const stateNames = [...moduleSource.matchAll(/\bstruct\s+(\w*TokenPoolState)\b/g)].map(
      (match) => match[1]!,
    )
    if (!stateNames.length) {
      throw new CCIPError(
        CCIPErrorCode.UNKNOWN,
        `No *TokenPoolState struct found in ${tokenPool}::${poolModule}`,
      )
    }

    let poolStateObjectId: string | undefined
    let stateType: string | undefined
    for (const stateName of new Set(stateNames)) {
      const candidateId = deriveObjectID(stateObjectPointerId, new TextEncoder().encode(stateName))
      const info = await this.client
        .getObject({ id: candidateId, options: { showType: true } })
        .catch(() => null)
      const type = info?.data?.type
      if (!type) continue
      const [typeModule, typeName] = type.split('<')[0]!.split('::').slice(1)
      if (typeModule === poolModule && typeName === stateName) {
        poolStateObjectId = candidateId
        stateType = type
        break
      }
    }
    if (!poolStateObjectId || !stateType) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error resolving token pool state object')
    }

    // Extract the type parameter T from XxxTokenPoolState<T>
    const tokenType = stateType.match(/<(.+)>$/)?.[1]
    if (!tokenType) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Invalid pool state type format: ${stateType}`)
    }

    // Walk the state's package_ids to the latest pool package for the call
    // (type strings carry the original package, whose functions are version-gated)
    const stateInfo = await this.client.getObject({
      id: poolStateObjectId,
      options: { showContent: true },
    })
    const stateContent = stateInfo.data?.content
    const stateFields =
      stateContent?.dataType === 'moveObject'
        ? (stateContent.fields as Record<string, unknown>)
        : {}
    const packageIds =
      (stateFields['package_ids'] as unknown[] | undefined) ??
      ((stateFields['ownable_state'] as { fields?: Record<string, unknown> } | undefined)?.fields?.[
        'package_ids'
      ] as unknown[] | undefined)
    const latestPoolPackage =
      Array.isArray(packageIds) && packageIds.length
        ? (packageIds[packageIds.length - 1] as string)
        : stateType.split('<')[0]!.split('::')[0]!

    return { poolStateObjectId, tokenType, poolModule, latestPoolPackage, ccipPackage }
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

  /**
   * {@inheritDoc Chain.getBalance}
   * @throws {@link CCIPArgumentInvalidError} if holder or token is invalid
   */
  async getBalance(opts: GetBalanceOpts): Promise<bigint> {
    const owner = normalizeSuiAddress(opts.holder)
    if (!isValidSuiAddress(owner)) {
      throw new CCIPArgumentInvalidError('holder', String(opts.holder))
    }

    // Native SUI unless a token is given: coin type strings (
    // `0x…::module::SYMBOL`) pass through, CoinMetadata ids are resolved to
    // their coin type first
    let coinType = SUI_NATIVE_COIN_TYPE
    if (opts.token && !/^0x0+$/.test(opts.token)) {
      if (opts.token.includes('::')) {
        coinType = opts.token
      } else {
        const normalized = normalizeSuiAddress(opts.token)
        if (!isValidSuiAddress(normalized)) {
          throw new CCIPArgumentInvalidError('token', String(opts.token))
        }
        const objectResponse = await this.client.getObject({
          id: normalized,
          options: { showType: true },
        })
        coinType = objectResponse.data?.type?.match(/CoinMetadata<(.+)>$/)?.[1] ?? ''
        if (!coinType) {
          throw new CCIPArgumentInvalidError('token', `${opts.token} is not a CoinMetadata id`)
        }
      }
    }

    const balance = await this.client.getBalance({ owner, coinType })
    return BigInt(balance.totalBalance)
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

    // Pick onchain coins of the fee token to pay the fee with; the onramp
    // splits the exact fee out of the passed coin itself. When no single coin
    // covers the fee, the sender's coins are merged inside the PTB and the
    // merged coin is passed (the remaining balance stays owned by the sender).
    const coinPages = []
    let cursor
    do {
      const page = await this.client.getCoins({
        owner: wallet.toSuiAddress(),
        coinType: args.coinType,
        ...(cursor ? { cursor } : {}),
      })
      coinPages.push(...page.data)
      cursor = page.hasNextPage ? page.nextCursor : undefined
    } while (cursor)

    const fee = opts.message.fee
    const feeSymbol = args.coinType === SUI_NATIVE_COIN_TYPE ? 'SUI' : args.coinType
    let payment = coinPages.find((c) => (fee == null ? true : BigInt(c.balance) >= fee))
    const merge = [] as typeof coinPages
    if (!payment) {
      payment = coinPages[0]
      let total = BigInt(payment?.balance ?? 0)
      for (const coin of coinPages.slice(1)) {
        if (total >= (fee ?? 0n)) break
        merge.push(coin)
        total += BigInt(coin.balance)
      }
      if (!payment || total < (fee ?? 0n)) {
        throw new CCIPInsufficientBalanceError(total.toString(), fee?.toString() ?? '0', feeSymbol)
      }
    }

    const tx = new Transaction()
    // create_token_transfer_params produces the (empty) TokenTransferParams hot potato
    const tokenParams = tx.moveCall({
      target: `${args.ccipPackage}::onramp_state_helper::create_token_transfer_params`,
      arguments: [tx.pure.vector('u8', Array.from(args.receiverBytes))],
    })
    // Merge the fee coins with `coin::join` move calls: `MergeCoins` commands are
    // rejected by current nodes (`InvalidResultArity` on execution), and `join`
    // returns nothing — it mutates the primary coin in place, which is
    // re-referenced by its original input afterwards.
    const feeCoin = tx.object(payment.coinObjectId)
    for (const coin of merge) {
      tx.moveCall({
        target: '0x2::coin::join',
        typeArguments: [args.coinType],
        arguments: [feeCoin, tx.object(coin.coinObjectId)],
      })
    }

    // Gas must come from an independent SUI coin: the node rejects a coin that
    // is both the gas payment and a mutable program input ("cannot appear more
    // than one in one transaction"), so fee coins are excluded from gas picks.
    const GAS_BUDGET = 100_000_000n // 0.1 SUI, comfortably above send costs
    const usedCoinIds = new Set([
      payment.coinObjectId,
      ...merge.map(({ coinObjectId }) => coinObjectId),
    ])
    let gasCandidates = coinPages
    if (args.coinType !== SUI_NATIVE_COIN_TYPE) {
      gasCandidates = []
      let gasCursor
      do {
        const page = await this.client.getCoins({
          owner: wallet.toSuiAddress(),
          coinType: SUI_NATIVE_COIN_TYPE,
          ...(gasCursor ? { cursor: gasCursor } : {}),
        })
        gasCandidates.push(...page.data)
        gasCursor = page.hasNextPage ? page.nextCursor : undefined
      } while (gasCursor)
    }
    const gasCoin = gasCandidates.find(
      (coin) => !usedCoinIds.has(coin.coinObjectId) && BigInt(coin.balance) >= GAS_BUDGET,
    )
    if (!gasCoin) {
      throw new CCIPError(
        CCIPErrorCode.INSUFFICIENT_BALANCE,
        `No independent SUI coin with at least 0.1 SUI available for gas`,
      )
    }
    tx.setGasBudget(GAS_BUDGET)
    tx.setGasPayment([
      {
        objectId: gasCoin.coinObjectId,
        version: gasCoin.version,
        digest: gasCoin.digest,
      },
    ])

    // Token transfer: the token pool's `lock_or_burn` burns/locks the sender's
    // coin and fills the hot-potato TokenTransferParams, which `ccip_send` then
    // consumes to build the message's token amounts.
    const tokenTransfer = args.tokenTransfers[0]
    if (tokenTransfer) {
      const amount = args.tokenAmounts[0]!
      const tokenCoinPages = []
      let tokenCursor
      do {
        const page = await this.client.getCoins({
          owner: wallet.toSuiAddress(),
          coinType: tokenTransfer.coinType,
          ...(tokenCursor ? { cursor: tokenCursor } : {}),
        })
        tokenCoinPages.push(...page.data)
        tokenCursor = page.hasNextPage ? page.nextCursor : undefined
      } while (tokenCursor)

      let tokenPayment = tokenCoinPages.find((c) => BigInt(c.balance) >= amount)
      const tokenMerge = [] as typeof tokenCoinPages
      if (!tokenPayment) {
        tokenPayment = tokenCoinPages[0]
        let total = BigInt(tokenPayment?.balance ?? 0)
        for (const coin of tokenCoinPages.slice(1)) {
          if (total >= amount) break
          tokenMerge.push(coin)
          total += BigInt(coin.balance)
        }
        if (!tokenPayment || total < amount) {
          throw new CCIPInsufficientBalanceError(
            total.toString(),
            amount.toString(),
            tokenTransfer.coinType,
          )
        }
      }

      // `lock_or_burn` consumes the ENTIRE coin passed to it, so split the
      // exact transfer amount off first (the remainder stays with the sender).
      const tokenCoin = tx.object(tokenPayment.coinObjectId)
      for (const coin of tokenMerge) {
        tx.moveCall({
          target: '0x2::coin::join',
          typeArguments: [tokenTransfer.coinType],
          arguments: [tokenCoin, tx.object(coin.coinObjectId)],
        })
      }
      const transferCoin = tx.moveCall({
        target: '0x2::coin::split',
        typeArguments: [tokenTransfer.coinType],
        arguments: [tokenCoin, tx.pure.u64(amount)],
      })
      tx.moveCall({
        target: `${tokenTransfer.poolPackage}::${tokenTransfer.poolModule}::lock_or_burn`,
        typeArguments: [tokenTransfer.coinType],
        arguments: [
          tx.object(args.ccipObjectRef),
          tokenParams,
          transferCoin,
          tx.pure.u64(opts.destChainSelector),
          ...tokenTransfer.lockOrBurnParams.map((id) => tx.object(id)),
        ],
      })
    }

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
        feeCoin,
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
    tokenTransfers: {
      coinType: string
      poolPackage: string
      poolModule: string
      lockOrBurnParams: string[]
    }[]
    extraArgsBytes: Uint8Array
  }> {
    // Accept the deployment's router handle (ccip state object) or the onramp itself
    const onRamp = await this.getOnRampForRouter(router, destChainSelector)
    // View calls must target the latest package (old versions are version-gated),
    // but state pointers live on the ORIGINAL package: resolve the onramp state
    // from `onRamp`, and only the call target from `latestOnRamp`
    const latestOnRamp = await getLatestPackageId(onRamp, this.client)
    const ccip = await getCcipStateAddress(latestOnRamp, this.client)
    // `ccip` names the ORIGINAL ccip package (its state pointers live there), but
    // the `onramp_state_helper` call must target the package's latest version:
    // older versions are version-gated and revert.
    const ccipPackage = normalizeSuiAddress(
      (await getLatestPackageId(ccip, this.client)).split('::')[0]!,
    )
    const [ccipObjectRef, onRampState] = await Promise.all([
      getObjectRef(ccip, this.client),
      getObjectRef(onRamp, this.client),
    ])

    const { coinType, metadataId } = await this.resolveFeeToken(message, ccip)

    if (!message.receiver) throw new CCIPArgumentInvalidError('receiver', String(message.receiver))
    const receiverBytes = getAddressBytes(getMoveAddress(message.receiver))
    const dataBytes = getDataBytes(message.data ?? '0x')

    if ((message.tokenAmounts?.length ?? 0) > 1) {
      throw new CCIPArgumentInvalidError(
        'tokenAmounts',
        `Sui onramps support at most one token transfer per message (got ${message.tokenAmounts!.length})`,
      )
    }

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

    // Resolve each transferred token's pool config from the token admin registry;
    // `lock_or_burn` is called by the pool package, and its object params
    // (clock, deny list, token state, pool state) are configured per token.
    const tokenTransfers = []
    for (const metadataId of tokenAddresses) {
      const tx = new Transaction()
      tx.moveCall({
        target: `${ccipPackage}::token_admin_registry::get_token_config_data`,
        arguments: [tx.object(ccipObjectRef), tx.pure.address(metadataId)],
      })
      const result = await this.client.devInspectTransactionBlock({
        sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
        transactionBlock: tx,
      })
      const returnValues = result.results?.[0]?.returnValues
      if (result.effects.status.status !== 'success' || !returnValues?.length) {
        throw new CCIPDataFormatUnsupportedError(
          `Failed to call ${ccipPackage}::token_admin_registry::get_token_config_data for ${metadataId}: ${
            result.effects.status.error || 'No return value'
          }`,
        )
      }
      // (pool_package_id, pool_module, token_type, administrator,
      //  pending_administrator, type_proof, lock_or_burn_params, release_or_mint_params)
      const [poolPackage, poolModule, tokenType, , , , lockOrBurnParams] = returnValues.map(
        ([data]) => getDataBytes(data),
      )
      // Registry coin types may drop the `0x` prefix off the package address
      const parsedCoinType = bcs.String.parse(tokenType!)
      tokenTransfers.push({
        coinType: parsedCoinType.replace(
          /^([0-9a-fA-F]{1,64})::/,
          (_, addr: string) => `0x${addr}::`,
        ),
        poolPackage: normalizeSuiAddress(hexlify(poolPackage!)),
        poolModule: bcs.String.parse(poolModule!),
        lockOrBurnParams: (
          bcs.vector(bcs.Address).parse(lockOrBurnParams!) as unknown as Uint8Array[]
        ).map((id) => normalizeSuiAddress(hexlify(id))),
      })
    }

    // Encoded on-chain extra args; the encoder picks the destination family's format
    // from the fields present (EVM V2 gasLimit, Solana computeUnits)
    const extraArgs = (message.extraArgs ?? {}) as MessageInput['extraArgs'] &
      Partial<EVMExtraArgsV2 & SVMExtraArgsV1>
    const { gasLimit, allowOutOfOrderExecution, computeUnits } = extraArgs
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
      tokenTransfers,
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

    // Load-balanced proxies may serve the fresh execution from a backend that
    // hasn't indexed it yet (the tx returns without logs); poll instead of
    // misreporting a successful on-chain execution as reverted
    for (let attempt = 0; ; attempt++) {
      const tx = await this.getTransaction(digest)
      if (tx.logs.length) return this.getExecutionReceiptInTx(tx)
      if (attempt >= 5) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return this.getExecutionReceiptInTx(digest)
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
  async getSupportedTokens(registry: string): Promise<string[]> {
    // The token admin registry is a module of the ccip package; its tokens are
    // the keys of the `token_configs` LinkedTable<address, TokenConfig>.
    const statePkg = normalizeSuiAddress(registry.split('::')[0]!)
    const state = await this.getCcipModuleState(
      `${statePkg}::state_object`,
      '::token_admin_registry::TokenAdminRegistryState',
    )
    const tableId = (state?.['token_configs'] as { fields?: { id?: { id?: string } } } | undefined)
      ?.fields?.id?.id
    if (!tableId) return []

    const tokens: string[] = []
    let cursor: string | null | undefined
    do {
      const page = await this.client.getDynamicFields({
        parentId: tableId,
        ...(cursor ? { cursor } : {}),
      })
      for (const field of page.data) {
        const name = field.name
        if (name.type === 'address' && typeof name.value === 'string')
          tokens.push(normalizeSuiAddress(name.value))
      }
      cursor = page.hasNextPage ? page.nextCursor : null
    } while (cursor)
    return tokens
  }

  /** {@inheritDoc Chain.getRegistryTokenConfig} */
  async getRegistryTokenConfig(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }> {
    return withLookupRetry(() => this.getRegistryTokenConfig_(registry, token))
  }

  /** {@inheritDoc SuiChain.getRegistryTokenConfig} */
  private async getRegistryTokenConfig_(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }> {
    const ccip = `${normalizeSuiAddress(registry.split('::')[0]!)}::state_object`
    const latestPkg = normalizeSuiAddress(
      (await getLatestPackageId(ccip, this.client)).split('::')[0]!,
    )
    const ccipObjectRef = await getObjectRef(ccip, this.client)
    const metadataId = token.includes('::')
      ? ((await this.client.getCoinMetadata({ coinType: token }))?.id ?? '')
      : normalizeSuiAddress(token)
    if (!isValidSuiAddress(metadataId)) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Error loading Sui token metadata: ${token}`)
    }

    const tx = new Transaction()
    tx.moveCall({
      target: `${latestPkg}::token_admin_registry::get_token_config`,
      arguments: [tx.object(ccipObjectRef), tx.pure.address(metadataId)],
    })

    const result = await this.client.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionBlock: tx,
    })

    const returnValues = result.results?.[0]?.returnValues
    if (result.effects.status.status !== 'success' || !returnValues?.length) {
      throw new CCIPDataFormatUnsupportedError(
        `Failed to call ${latestPkg}::token_admin_registry::get_token_config for ${metadataId}: ${
          result.effects.status.error || 'No return value'
        }`,
      )
    }

    // (token_pool_package_id, administrator, pending_administrator)
    const [poolBytes, adminBytes, pendingBytes] = returnValues.map(([data]) =>
      normalizeSuiAddress(hexlify(new Uint8Array(data))),
    )

    const res: { administrator: string; pendingAdministrator?: string; tokenPool?: string } = {
      administrator: adminBytes!,
    }
    if (!/^0x0+$/.test(pendingBytes!)) res.pendingAdministrator = pendingBytes
    if (!/^0x0+$/.test(poolBytes!)) res.tokenPool = poolBytes

    return res
  }

  /** {@inheritDoc Chain.getTokenPoolConfig} */
  async getTokenPoolConfig(
    tokenPool: string,
    _feeOpts?: TokenTransferFeeOpts,
  ): Promise<TokenPoolConfig> {
    return withLookupRetry(() => this.getTokenPoolConfig_(tokenPool))
  }

  /** {@inheritDoc SuiChain.getTokenPoolConfig} */
  private async getTokenPoolConfig_(tokenPool: string): Promise<TokenPoolConfig> {
    const { poolStateObjectId, tokenType, poolModule, latestPoolPackage, ccipPackage } =
      await this.getTokenPoolStateRef_(tokenPool)

    // Local token: the pool state's `get_token` view returns its CoinMetadata id
    const tokenTx = new Transaction()
    tokenTx.moveCall({
      target: `${latestPoolPackage}::${poolModule}::get_token`,
      typeArguments: [tokenType],
      arguments: [tokenTx.object(poolStateObjectId)],
    })
    const tokenInspect = await this.client.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionBlock: tokenTx,
    })
    if (
      tokenInspect.effects.status.status !== 'success' ||
      !tokenInspect.results?.[0]?.returnValues?.[0]
    ) {
      throw new CCIPDataFormatUnsupportedError(
        `Failed to call ${latestPoolPackage}::${poolModule}::get_token: ${
          tokenInspect.effects.status.error || 'No return value'
        }`,
      )
    }
    const [tokenData] = tokenInspect.results[0].returnValues[0]
    const token = normalizeSuiAddress(hexlify(new Uint8Array(tokenData)))

    // typeAndVersion: the pool module's static version string
    const versionTx = new Transaction()
    versionTx.moveCall({ target: `${latestPoolPackage}::${poolModule}::type_and_version` })
    const versionInspect = await this.client.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      transactionBlock: versionTx,
    })
    const typeAndVersion =
      versionInspect.effects.status.status === 'success' &&
      versionInspect.results?.[0]?.returnValues?.[0]
        ? bcs.String.parse(getDataBytes(versionInspect.results[0].returnValues[0][0]))
        : undefined

    return {
      token,
      // the disassembly's `token_admin_registry` import names the ccip package
      router: ccipPackage ? `${ccipPackage}::state_object` : tokenType,
      ...(typeAndVersion && { typeAndVersion }),
    }
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    return withLookupRetry(() => this.getTokenPoolRemotes_(tokenPool, remoteChainSelector))
  }

  /** {@inheritDoc SuiChain.getTokenPoolRemotes} */
  private async getTokenPoolRemotes_(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    const { poolStateObjectId } = await this.getTokenPoolStateRef_(tokenPool)

    const info = await this.client.getObject({
      id: poolStateObjectId,
      options: { showContent: true },
    })
    const content = info.data?.content
    if (content?.dataType !== 'moveObject') {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Error loading token pool state content')
    }

    const tokenPoolState = (content.fields as Record<string, unknown>)['token_pool_state'] as
      { fields?: { remote_chain_configs?: { fields?: { contents?: unknown[] } } } } | undefined
    const contents = tokenPoolState?.fields?.remote_chain_configs?.fields?.contents ?? []

    const remotes: Record<string, TokenPoolRemote> = {}
    for (const entry of contents) {
      const fields = (entry as { fields?: Record<string, unknown> } | null)?.fields
      if (!fields || fields['key'] == null) continue
      const selector = BigInt(fields['key'] as string | number | bigint)
      if (remoteChainSelector !== undefined && selector !== remoteChainSelector) continue
      const { family } = networkInfo(selector)
      const value =
        (fields['value'] as { fields?: Record<string, unknown> } | undefined)?.fields ?? {}
      // EVM remotes store 32-byte left-padded addresses; other families keep
      // theirs. Decoding needs the family's chain class registered (import the
      // SDK root to register all of them).
      const remoteTokenBytes = getDataBytes((value['remote_token_address'] ?? '0x') as BytesLike)
      const remoteToken = decodeAddress(remoteTokenBytes, family)
      remotes[networkInfo(selector).name] = {
        remoteToken,
        // On-chain anomaly work-around: some pools (CCIP BnM) carry remote
        // pools whose bytes don't decode for their lane family; raw hex is
        // better than failing the whole listing for those.
        remotePools: ((value['remote_pools'] as unknown[] | undefined) ?? []).map((p) => {
          try {
            return decodeAddress(p as BytesLike, family)
          } catch {
            return hexlify(getDataBytes(p as never))
          }
        }),
        outboundRateLimiterState: null,
        inboundRateLimiterState: null,
      }
    }

    if (remoteChainSelector !== undefined && !remotes[networkInfo(remoteChainSelector).name]) {
      throw new CCIPTokenPoolChainConfigNotFoundError(
        tokenPool,
        tokenPool,
        networkInfo(remoteChainSelector).name,
      )
    }
    return remotes
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(router: string): Promise<Record<string, TokenInfo>> {
    const ccip = await resolveCcipStateAddress(router, this.client)
    const state = await this.getCcipModuleState(ccip, '::fee_quoter::FeeQuoterState')
    const feeTokens = Array.isArray(state?.['fee_tokens']) ? (state['fee_tokens'] as string[]) : []
    return Object.fromEntries(
      await Promise.all(
        feeTokens.map(async (metadataId) => {
          let info: TokenInfo
          try {
            info = await this.getTokenInfo(metadataId)
          } catch {
            info = { symbol: 'UNKNOWN', decimals: 0 }
          }
          return [metadataId, info] as const
        }),
      ),
    )
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
