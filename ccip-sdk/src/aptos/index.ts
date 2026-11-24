import {
  type AptosSettings,
  type Client,
  type ClientRequest,
  type ClientResponse,
  Aptos,
  AptosApiError,
  AptosConfig,
  Deserializer,
  Network,
  SimpleTransaction,
  TransactionResponseType,
} from '@aptos-labs/ts-sdk'
import { type BytesLike, concat, isBytesLike, isHexString, keccak256 } from 'ethers'
import { memoize } from 'micro-memoize'

import {
  type BlockInfo,
  type ChainContext,
  type GetBalanceOpts,
  type LogFilter,
  type TokenInfo,
  type TokenPoolConfig,
  type TokenPoolConfigOpts,
  type TokenPoolRemote,
  type TokenPoolRemotesOpts,
  type TokenPrice,
  Chain,
} from '../chain.ts'
import {
  CCIPAptosExtraArgsV2RequiredError,
  CCIPAptosNetworkUnknownError,
  CCIPAptosRegistryTypeInvalidError,
  CCIPAptosTransactionInvalidError,
  CCIPAptosTransactionTypeInvalidError,
  CCIPError,
  CCIPExtraArgsEncodingUnsupportedError,
  CCIPLogDataInvalidError,
  CCIPTokenNotRegisteredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import {
  type EVMExtraArgsV2,
  type ExtraArgs,
  type GenericExtraArgsV3,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
  decodeFinalityAllowed,
} from '../extra-args.ts'
import { createRateLimitedFetch, fetchProfileForUrl, redactEndpointUrl } from '../fetch.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { decodeMessageV1 } from '../messages.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { buildMessageForDest, decodeMessage, normalizeDeep } from '../requests.ts'
import {
  BcsEVMExtraArgsV2Codec,
  BcsSVMExtraArgsV1Codec,
  decodeMoveExtraArgs,
  getMoveAddress,
} from '../shared/bcs-codecs.ts'
import { decodeExtraArgsV3, encodeExtraArgsV3 } from '../shared/extra-args-v3.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVerifications,
  type ChainLog,
  type ChainTransaction,
  type CommitReport,
  type ExecutionInput,
  type ExecutionReceipt,
  type Lane,
  type WithLogger,
  CCIPVersion,
} from '../types.ts'
import {
  convertKeysToCamelCase,
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  jsonParse,
  parseTypeAndVersion,
  util,
} from '../utils.ts'
import { generateUnsignedExecuteReport, generateUnsignedExecuteV2 } from './exec.ts'
import { getAptosLeafHasher } from './hasher.ts'
import {
  type AptosLogStreamOpts,
  canonicalAptosLogAddress,
  getAptosExecutionFailureLog,
  getUserTxByVersion,
  getVersionTimestamp,
  streamAptosLogs,
} from './logs.ts'
import { generateUnsignedCcipSend, getFee } from './send.ts'
import { getTokenInfo } from './token.ts'
import { type UnsignedAptosTx, isAptosAccount } from './types.ts'
export type { UnsignedAptosTx }

/**
 * Creates an Aptos SDK `Client` that routes all HTTP calls through the supplied fetch function.
 * Non-2xx responses are returned (not thrown) so the SDK can build its own `AptosApiError`.
 */
function createAptosFetchClient(fetchFn: typeof fetch): Client {
  return {
    async provider<Req, Res>(req: ClientRequest<Req>): Promise<ClientResponse<Res>> {
      const url = new URL(req.url)
      if (req.params) {
        for (const [k, v] of Object.entries(
          req.params as Record<string, string | number | boolean | null | undefined>,
        )) {
          if (v != null) url.searchParams.set(k, String(v))
        }
      }
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers ?? {})) {
        if (v != null) headers[k] = String(v)
      }
      // The SDK moves contentType into headers before calling provider(), so
      // req.contentType is undefined here. Check the header value directly.
      const resolvedCT = headers['content-type'] ?? req.contentType ?? 'application/json'
      type FetchBody = NonNullable<Parameters<typeof fetch>[1]>['body']
      let body: FetchBody
      if (req.body != null) {
        headers['content-type'] ??= resolvedCT
        body = resolvedCT.includes('json') ? JSON.stringify(req.body) : (req.body as FetchBody)
      }
      const resp = await fetchFn(url.toString(), { method: req.method, headers, body })
      const text = await resp.text()
      let data: unknown = text
      const respCT = resp.headers.get('content-type') ?? ''
      if (respCT.includes('json') || (!respCT && text)) {
        try {
          data = text ? JSON.parse(text) : undefined
        } catch {
          // keep text as-is
        }
      }
      const respHeaders: Record<string, string> = {}
      resp.headers.forEach((v, k) => {
        respHeaders[k] = v
      })
      return {
        status: resp.status,
        statusText: resp.statusText,
        data: data as Res,
        headers: respHeaders,
        config: req,
        request: null,
        response: null,
      }
    },
  }
}

/**
 * Aptos-specific {@link ChainContext} extras. Optional and local to this module on
 * purpose: the shared ChainContext stays family-agnostic, while Aptos' GraphQL index
 * (the indexer behind `provider.queryIndexer`, used by the getLogs fast path and the
 * execution-failure scans) accepts its own URL override.
 */
export type AptosChainContext = ChainContext & {
  /**
   * Aptos GraphQL indexer base URL, honored verbatim by the provider's
   * `queryIndexer` calls. Honored when the chain builds its own `AptosConfig`
   * (i.e. no explicit `client` in the settings); when omitted, the Aptos SDK's
   * per-network default applies (see `AptosConfig.getRequestUrl` — and note a
   * `Network.CUSTOM` config throws without one). The fullnode URL is never used
   * to infer an indexer URL.
   */
  indexerUrl?: string
}

/**
 * Aptos chain implementation supporting Aptos networks.
 */
export class AptosChain extends Chain<typeof ChainFamily.Aptos> {
  static {
    supportedChains[ChainFamily.Aptos] ??= AptosChain
  }
  /** Chain family identifier for Aptos networks. */
  static readonly family = ChainFamily.Aptos
  /** Native token decimals (8 for APT). */
  static readonly decimals = 8

  /** The Aptos SDK provider for blockchain interactions. */
  provider: Aptos

  /** Retrieves token information for a given token address. */
  getTokenInfo: (token: string) => Promise<TokenInfo>
  /** @internal */
  _getAccountModulesNames: (address: string) => Promise<string[]>

  /**
   * Creates a new AptosChain instance.
   * @param provider - Aptos SDK provider instance.
   * @param network - Network information for this chain.
   */
  constructor(provider: Aptos, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)

    this.provider = provider

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 1,
      expires: 60e3, // 1min
    })
    this.getTransaction = memoize(this.getTransaction.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 5e3,
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 600e3,
    })
    this.getOnRampConfig = memoize(this.getOnRampConfig.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 2,
      expires: 60e3, // 1min
    })
    this.getOffRampConfig = memoize(this.getOffRampConfig.bind(this), {
      maxSize: 100,
      maxArgs: 2,
      async: true,
      expires: 60e3, // 1min
    })
    this.getTokenInfo = memoize((token) => getTokenInfo(this.provider, token), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 600e3,
    })

    this._getAccountModulesNames = memoize(
      (address) =>
        this.provider
          .getAccountModules({ accountAddress: address })
          .then((modules) => modules.map(({ abi }) => abi!.name)),
      { async: true, maxSize: 100, maxArgs: 1, expires: 600e3 },
    )
    this.getOnRampForRouter = memoize(this.getOnRampForRouter.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 2,
      expires: 60e3, // 1min
    })
    // which contract an address is, and where its core package is, never change
    this._getModule = memoize(this._getModule.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 2,
    })
    this._getCcipPackage = memoize(this._getCcipPackage.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 1,
    })
    this._getRampAddress = memoize(this._getRampAddress.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 2,
    })
    this._getRegistries = memoize(this._getRegistries.bind(this), {
      async: true,
      maxSize: 100,
      maxArgs: 1,
      expires: 600e3,
    })
    this.provider.getTransactionByVersion = memoize(
      this.provider.getTransactionByVersion.bind(this.provider),
      {
        async: true,
        maxSize: 100,
        expires: 5e3,
        transformKey: ([arg]: [{ ledgerVersion: bigint | number }]) => [Number(arg.ledgerVersion)],
      },
    )
  }

  /**
   * Creates an AptosChain instance from an existing Aptos provider.
   * @param provider - Aptos SDK provider instance.
   * @param ctx - context containing logger.
   * @returns A new AptosChain instance.
   */
  static async fromProvider(provider: Aptos, ctx?: WithLogger): Promise<AptosChain> {
    return new this(provider, networkInfo(`aptos:${await provider.getChainId()}`), ctx)
  }

  /**
   * Creates an AptosChain instance from Aptos configuration settings.
   *
   * Installs a fetch-based `Client` shim so that all Aptos REST calls are routed
   * through `ctx.fetch` (when provided) or through the built-in rate-limited fetch.
   * If the settings already include an explicit `client`, that client is used as-is.
   *
   * Use {@link AptosChain.fromProvider} instead when you have a fully constructed
   * `Aptos` instance and want no shim to be installed.
   *
   * @param settings - Aptos configuration settings (AptosSettings or AptosConfig).
   * @param ctx - context containing logger, an optional fetch override, and an
   *   optional {@link AptosChainContext.indexerUrl} indexer URL override.
   * @returns A new AptosChain instance.
   */
  static async fromAptosConfig(
    settings: AptosSettings | AptosConfig,
    ctx?: AptosChainContext,
  ): Promise<AptosChain> {
    // Detect whether the caller explicitly set a custom HTTP client adapter:
    // - For raw AptosSettings: `client` is undefined unless explicitly set.
    // - For a pre-built AptosConfig: the SDK always fills in `config.client` with a default
    //   whose `.provider` is named `"aptosClient"`. Any other name or identity indicates a
    //   user-supplied adapter.
    const explicitClient = settings.client
    const hasExplicitClient =
      explicitClient != null && explicitClient.provider.name !== 'aptosClient'
    let effectiveConfig: AptosConfig
    if (hasExplicitClient) {
      effectiveConfig = settings instanceof AptosConfig ? settings : new AptosConfig(settings)
    } else {
      const fetchFn =
        ctx?.fetch ?? createRateLimitedFetch(fetchProfileForUrl(settings.fullnode ?? ''), ctx)
      effectiveConfig = new AptosConfig({
        network: settings.network,
        fullnode: settings.fullnode,
        faucet: settings.faucet,
        // The ctx indexer URL is the authoritative override; otherwise the SDK's
        // per-network default applies (the fullnode URL is never used to infer one).
        indexer: ctx?.indexerUrl ?? settings.indexer,
        pepper: settings.pepper,
        prover: settings.prover,
        clientConfig: settings.clientConfig,
        fullnodeConfig: settings.fullnodeConfig,
        indexerConfig: settings.indexerConfig,
        faucetConfig: settings.faucetConfig,
        client: createAptosFetchClient(fetchFn),
      })
    }
    const provider = new Aptos(effectiveConfig)
    return this.fromProvider(provider, ctx)
  }

  /**
   * Creates an AptosChain instance from a URL or network identifier.
   * @param url - RPC URL, Aptos Network enum value or [fullNodeUrl, Network] tuple.
   * @param ctx - context containing logger
   * @returns A new AptosChain instance.
   * @throws {@link CCIPAptosNetworkUnknownError} if network cannot be determined from URL
   */
  static async fromUrl(
    url: string | Network | readonly [string, Network],
    ctx?: AptosChainContext,
  ): Promise<AptosChain> {
    let network: Network
    if (Array.isArray(url)) {
      ;[url, network] = url
    } else if (Object.values(Network).includes(url as Network)) network = url as Network
    else if (url.includes('mainnet')) network = Network.MAINNET
    else if (url.includes('testnet')) network = Network.TESTNET
    else if (url.includes('local')) network = Network.LOCAL
    else throw new CCIPAptosNetworkUnknownError(util.inspect(redactEndpointUrl(url)))
    // Pass raw AptosSettings (not a pre-built AptosConfig) so fromAptosConfig can
    // detect the absence of an explicit `client` and install the fetch shim.
    // No indexer inference from the fullnode URL: the SDK's per-network default
    // applies unless ctx.indexerUrl overrides it (wired in fromAptosConfig).
    const settings: AptosSettings = {
      network,
      fullnode: typeof url === 'string' && url.includes('://') ? url : undefined,
    }
    return this.fromAptosConfig(settings, ctx)
  }

  /** {@inheritDoc Chain.getBlockInfo} */
  async getBlockInfo(version: number | 'finalized' | 'latest'): Promise<BlockInfo> {
    let version_ = typeof version !== 'number' ? 0 : version
    if (version_ <= 0) version_ = +(await this.provider.getLedgerInfo()).ledger_version + version_
    const timestamp = await getVersionTimestamp(this.provider, version_)
    return { number: version_, timestamp }
  }

  /**
   * {@inheritDoc Chain.getTransaction}
   * @throws {@link CCIPAptosTransactionInvalidError} if hash/version format is invalid
   * @throws {@link CCIPAptosTransactionTypeInvalidError} if transaction is not a user transaction
   */
  async getTransaction(hashOrVersion: string | number): Promise<ChainTransaction> {
    let tx
    if (isHexString(hashOrVersion, 32)) {
      tx = await this.provider.getTransactionByHash({
        transactionHash: hashOrVersion,
      })
    } else if (!isNaN(+hashOrVersion)) {
      tx = await getUserTxByVersion(this.provider, +hashOrVersion)
    } else {
      throw new CCIPAptosTransactionInvalidError(hashOrVersion)
    }
    if (tx.type !== TransactionResponseType.User) throw new CCIPAptosTransactionTypeInvalidError()

    const timestamp = +tx.timestamp / 1e6
    const logs: ChainLog[] = tx.events.map((event, index) => ({
      address: event.type.slice(0, event.type.lastIndexOf('::')),
      transactionHash: tx.hash,
      index,
      blockNumber: +tx.version, // we use version as Aptos' blockNumber, as blockHeight isn't very useful
      blockTimestamp: timestamp,
      data: event.data as Record<string, unknown>,
      topics: [event.type.slice(event.type.lastIndexOf('::') + 2)],
    }))
    const failureLog = getAptosExecutionFailureLog(tx)
    if (failureLog) logs.push(failureLog)
    return {
      hash: tx.hash,
      blockNumber: +tx.version,
      from: tx.sender,
      timestamp,
      logs,
      ...(failureLog && {
        // Same camelCase+bigint shape decodeReceipt gives the receipt's returnData,
        // so tx.error and the CCIPExecution.error a consumer gets downstream agree.
        error: convertKeysToCamelCase(
          (failureLog.data as Record<string, unknown>).return_data,
          (v) => (typeof v === 'string' && v.match(/^\d+$/) ? BigInt(v) : v),
        ),
      }),
    }
  }

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(opts: AptosLogStreamOpts): AsyncIterableIterator<ChainLog> {
    if (opts.watch) {
      opts = {
        ...opts,
        watch:
          opts.watch instanceof AbortSignal
            ? AbortSignal.any([opts.watch, this.abort])
            : this.abort,
      }
    }
    // logs come from modules: a 2.0 ramp can be given by its state address or its package (a 1.6
    // package has all the modules, so the stream rejects it)
    const { address } = opts
    if (address && !address.includes('::')) {
      const module = await this._getModule(address, 'offramp').catch(() => address)
      const version = await this.typeAndVersion(module).then(
        ([, v]) => v,
        () => undefined,
      )
      if (version && version >= CCIPVersion.V2_0) opts = { ...opts, address: module }
    }
    yield* streamAptosLogs(this, opts)
  }

  /**
   * Canonicalizes BOTH sides of the base class's exact `offRamp` address match.
   *
   * Aptos log addresses are `<address>::<module>` (Move event types are
   * `<address>::<module>::<Struct>`; getTransaction slices the struct off) with
   * the address exactly as the node rendered it, while callers pass the OffRamp
   * in whatever form their source used — bare and possibly short from the API
   * (the CLI's `show <messageId>`) or a decoded message, `<address>::offramp`
   * from SDK discovery, any casing. Both are converted to
   * `<long-address>::offramp` up front, so an exact compare downstream matches
   * successes and failures alike instead of silently dropping every receipt.
   * A 2.0 OffRamp given by its state address compares as its `<package>::offramp`.
   */
  override async getExecutionReceiptsInTx(
    tx: string | ChainTransaction,
    filters?: Parameters<Chain['getExecutionReceiptsInTx']>[1],
  ): Promise<CCIPExecution[]> {
    const offRamp = filters?.offRamp
    if (!offRamp) return super.getExecutionReceiptsInTx(tx, filters)
    if (typeof tx === 'string') tx = await this.getTransaction(tx)
    // the module of a 2.0 OffRamp given by its state address (the bare package needs no lookup)
    const offRampModule = await this._getModule(offRamp, 'offramp').catch(() => offRamp)
    return super.getExecutionReceiptsInTx(
      {
        ...tx,
        logs: tx.logs.map((log) => ({ ...log, address: canonicalAptosLogAddress(log.address) })),
      },
      { ...filters, offRamp: canonicalAptosLogAddress(offRampModule) },
    )
  }

  /** {@inheritDoc Chain.getVerifications} */
  override async getVerifications(
    opts: Parameters<Chain['getVerifications']>[0],
  ): Promise<CCIPVerifications> {
    const { offRamp, request } = opts
    if (request.lane.version < CCIPVersion.V2_0) return super.getVerifications(opts)
    // 2.0: the OffRamp tells the CCVs it requires for the message, exactly as it was emitted
    const [requiredCCVs, optionalCCVs, optionalThreshold] = await this.provider.view<
      [string[], string[], number]
    >({
      payload: {
        function:
          `${await this._getModule(offRamp, 'offramp')}::get_ccvs_for_message` as `${string}::${string}::get_ccvs_for_message`,
        functionArguments: [getDataBytes(await this.resolveEncodedMessage(request))],
      },
    })
    const verificationPolicy = {
      requiredCCVs: requiredCCVs.map(getMoveAddress),
      optionalCCVs: optionalCCVs.map(getMoveAddress),
      optionalThreshold: Number(optionalThreshold),
    }
    const verifications = await this.fetchCCVResults(
      request.message.messageId,
      verificationPolicy,
      opts,
    )
    return { verificationPolicy, verifications }
  }

  /**
   * `<package>::<module>` of a CCIP contract, from any form of its address: the module itself; its
   * package (on 1.6, one package has every module, and `module` selects one); or, for a 2.0 Router
   * or ramp, its state address: the form in which remote chains and messages reference it.
   * @internal
   */
  async _getModule(address: string, module = 'router'): Promise<string> {
    if (address.includes('::')) return address
    try {
      await this.typeAndVersion(`${address}::${module}`)
      return `${address}::${module}`
    } catch (err) {
      const info = await this._getAccountInfo(address).catch(() => undefined)
      if (!info?.module) throw err
      return info.module
    }
  }

  /**
   * The address of a ramp in every output, from any form of it: `<package>::<module>` on 1.6, and
   * the state address in 2.0, as remote chains and messages reference it.
   * @internal
   */
  async _getRampAddress(address: string, module: string): Promise<string> {
    const rampModule = await this._getModule(address, module)
    const [, version] = await this.typeAndVersion(rampModule)
    if (version < CCIPVersion.V2_0) return rampModule
    const [stateAddress] = await this.provider.view<[string]>({
      payload: {
        function: `${rampModule}::get_state_address` as `${string}::${string}::${string}`,
      },
    })
    return getMoveAddress(stateAddress)
  }

  /**
   * Package of the CCIP core modules (`fee_quoter`, `token_admin_registry`, `auth`) for a contract:
   * its own package on 1.6, and the `ChainlinkCCIP` package which its package depends on in 2.0,
   * where every contract is a package of its own.
   * @internal
   */
  async _getCcipPackage(address: string): Promise<string> {
    const pkg = address.split('::')[0]!
    if (
      await this.typeAndVersion(`${pkg}::fee_quoter`).then(
        () => true,
        () => false,
      )
    )
      return pkg
    const { module, ccip } = await this._getAccountInfo(pkg)
    // a state address: as for its package
    if (module && !module.startsWith(`${pkg}::`)) return this._getCcipPackage(module)
    return ccip ?? pkg
  }

  /**
   * What the resources of an account tell of CCIP 2.0: the Router or ramp `module` which the
   * account is the state address of (it holds `<package>::<module>::<Module>State`) or the package
   * of, and the `ccip` core package which a package depends on.
   */
  private async _getAccountInfo(address: string): Promise<{ module?: string; ccip?: string }> {
    const isRamp = (name?: string) => ['router', 'onramp', 'offramp'].includes(name!)
    const info: { module?: string; ccip?: string } = {}
    for (const { type, data } of await this.provider.getAccountResources({
      accountAddress: address,
    })) {
      const [pkg, name] = type.split('::')
      if (isRamp(name)) info.module = `${pkg}::${name}`
      if (type !== '0x1::code::PackageRegistry') continue
      const { packages } = data as {
        packages: {
          modules: { name: string }[]
          deps: { account: string; package_name: string }[]
        }[]
      }
      info.ccip = packages
        .flatMap(({ deps }) => deps)
        .find(({ package_name }) => package_name === 'ChainlinkCCIP')?.account
      const module = packages.flatMap(({ modules }) => modules).find(({ name }) => isRamp(name))
      if (module) info.module ??= `${address}::${module.name}`
    }
    return info
  }

  /**
   * Router package of a CCIP 2.0 deployment, which only the dest chain configs of its OnRamps
   * name; else, its core package, which serves the registry and fee reads too.
   */
  private async _getRouterV2(address: string): Promise<string> {
    const ccip = await this._getCcipPackage(address)
    const [onRamps] = await this.provider.view<[string[]]>({
      payload: { function: `${ccip}::auth::get_allowed_onramps` as `${string}::auth::${string}` },
    })
    for (const onRamp of onRamps) {
      const [, configs] = await this.provider
        .view<[string[], { router?: string }[]]>({
          payload: {
            function:
              `${await this._getModule(onRamp, 'onramp')}::get_all_dest_chain_configs` as `${string}::${string}::${string}`,
          },
        })
        .catch(() => [[], []] as const)
      const router = configs.find(({ router }) => router)?.router
      if (router) return router
    }
    return ccip
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string): ReturnType<Chain['typeAndVersion']> {
    // needs a `::<module>` suffix; a bare package address defaults to `::router`, like the
    // router entrypoints in send.ts do — every CCIP 1.6 module shares the package's address
    if (!address.includes('::')) return this.typeAndVersion(await this._getModule(address))
    const [typeAndVersion] = await this.provider.view<[string]>({
      payload: {
        function: `${address}::type_and_version` as `${string}::${string}::type_and_version`,
      },
    })
    return parseTypeAndVersion(typeAndVersion)
  }

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(onRamp: string, destChainSelector: bigint) {
    const onRampModule = await this._getModule(onRamp, 'onramp')
    const feeQuoter = `${await this._getCcipPackage(onRampModule)}::fee_quoter`
    const [, version, typeAndVersion] = await this.typeAndVersion(onRampModule)
    const view = async <T = Record<string, unknown>>(fn: string, ...args: unknown[]) =>
      (
        await this.provider.view<[T]>({
          payload: {
            function: fn as `${string}::${string}::${string}`,
            functionArguments: args as [],
          },
        })
      )[0]
    let config: Record<string, unknown> & {
      router: string
      sequenceNumber?: number
      allowlistEnabled?: boolean
      routerStateAddress?: string
    }
    if (version < CCIPVersion.V2_0) {
      const [sequenceNumber, allowlistEnabled, router, routerStateAddress] =
        await this.provider.view<
          [
            sequence_number: string,
            allowlist_enabled: boolean,
            router: string,
            router_state_address: string,
          ]
        >({
          payload: {
            function:
              `${onRampModule}::get_dest_chain_config_v2` as `${string}::${string}::get_dest_chain_config_v2`,
            functionArguments: [destChainSelector],
          },
        })
      config = { sequenceNumber: +sequenceNumber, allowlistEnabled, router, routerStateAddress }
    } else {
      // 2.0: every field of the OnRamp's configs, as the contract names them; only the dest chain
      // config is essential, so the contract can change the others
      const optional = (fn: string, ...args: unknown[]) =>
        view(`${onRampModule}::${fn}`, ...args).catch(() => undefined)
      config = {
        ...(await optional('get_static_config')),
        ...(await optional('get_dynamic_config')),
        ...(await view<{ router: string }>(
          `${onRampModule}::get_dest_chain_config`,
          destChainSelector,
        )),
        expectedNextMessageNumber: await optional(
          'get_expected_next_message_number',
          destChainSelector,
        ),
      }
    }
    const feeQuoterConfig = await view(`${feeQuoter}::get_static_config`)
    const feeQuoterDestConfig = await view(`${feeQuoter}::get_dest_chain_config`, destChainSelector)
    const address = await this._getRampAddress(onRampModule, 'onramp')
    return normalizeDeep(
      {
        onRamp: address,
        // a 2.0 OnRamp's address is its state's: its module emits the logs (their `contract`)
        ...(address !== onRampModule && { contract: onRampModule }),
        feeQuoter,
        destChainSelector,
        ...config,
        router: config.router.includes('::') ? config.router : `${config.router}::router`,
        feeQuoterConfig: { ...feeQuoterConfig, ...feeQuoterDestConfig },
        typeAndVersion,
      },
      {
        sourceFamily: (this.constructor as typeof AptosChain).family,
        destFamily: networkInfo(destChainSelector).family,
      },
    )
  }

  /** {@inheritDoc Chain.getOffRampConfig} */
  async getOffRampConfig(offRamp: string, sourceChainSelector: bigint) {
    const offRampModule = await this._getModule(offRamp, 'offramp')
    const [, version, typeAndVersion] = await this.typeAndVersion(offRampModule)
    // a 2.0 OffRamp does not name its Router
    const router =
      version < CCIPVersion.V2_0
        ? `${offRampModule.split('::')[0]}::router`
        : `${await this._getRouterV2(offRampModule)}::router`
    const [sourceChainConfig] = await this.provider.view<
      [Record<string, unknown> & { on_ramp?: string; on_ramps?: string[] }]
    >({
      payload: {
        function:
          `${offRampModule}::get_source_chain_config` as `${string}::${string}::get_source_chain_config`,
        functionArguments: [sourceChainSelector],
      },
    })
    const sourceFamily = networkInfo(sourceChainSelector).family
    const address = await this._getRampAddress(offRampModule, 'offramp')
    return normalizeDeep(
      {
        offRamp: address,
        // a 2.0 OffRamp's address is its state's: its module emits the logs (their `contract`)
        ...(address !== offRampModule && { contract: offRampModule }),
        sourceChainSelector,
        ...sourceChainConfig,
        // 1.6 names one OnRamp, by its package; 2.0 lists them, as the source chain and the
        // messages reference them
        onRamps: sourceChainConfig.on_ramps ?? [
          decodeOnRampAddress(sourceChainConfig.on_ramp!, sourceFamily),
        ],
        router,
        typeAndVersion,
      },
      { sourceFamily, destFamily: (this.constructor as typeof AptosChain).family },
    )
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.resolve('0xa')
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    const pkg = router.split('::')[0]!
    const ccip = await this._getCcipPackage(router)
    if (ccip === pkg) return [pkg + '::offramp']
    // 2.0: the OffRamps which the core package allows, by their state addresses
    const [offRamps] = await this.provider.view<[string[]]>({
      payload: { function: `${ccip}::auth::get_allowed_offramps` as `${string}::auth::${string}` },
    })
    return offRamps.map(getMoveAddress)
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    const pkg = router.split('::')[0]!
    // 1.6: the Router and the OnRamp are modules of one package
    let onRamp = `${pkg}::onramp`
    const isSamePackage = await this.typeAndVersion(onRamp).then(
      () => true,
      () => false,
    )
    if (!isSamePackage) {
      // else, the Router routes each destination to the package of an OnRamp
      const [onRampPkg] = await this.provider.view<[string]>({
        payload: {
          function: `${pkg}::router::get_on_ramp` as `${string}::router::get_on_ramp`,
          functionArguments: [destChainSelector],
        },
      })
      onRamp = `${onRampPkg}::onramp`
    }
    return this._getRampAddress(onRamp, 'onramp')
  }

  /** {@inheritDoc Chain.getBalance} */
  async getBalance(opts: GetBalanceOpts): Promise<bigint> {
    const { holder, token } = opts
    const asset = token ?? '0x1::aptos_coin::AptosCoin'

    const balance = await this.provider.getBalance({
      accountAddress: holder,
      asset,
    })
    return BigInt(balance)
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPAptosRegistryTypeInvalidError} if registry type is invalid
   */
  async getTokenAdminRegistryFor(address: string): Promise<string> {
    const [registry] = (await this._getRegistries(address)) as [string]
    const [type] = await this.typeAndVersion(registry)
    if (type !== 'TokenAdminRegistry') {
      throw new CCIPAptosRegistryTypeInvalidError(registry, type)
    }
    return registry
  }

  /**
   * Token registries of the core package of a contract (or of a registry itself). CCIP 2.0 adds
   * `token_admin_registry_v2`, which the ramps ask before the 1.6 one.
   * @internal
   */
  async _getRegistries(address: string): Promise<string[]> {
    const registry = `${await this._getCcipPackage(address)}::token_admin_registry`
    try {
      await this.typeAndVersion(`${registry}_v2`)
      return [`${registry}_v2`, registry]
    } catch (err) {
      // only the node's answer that there is no such module selects the 1.6 registry alone
      if ((err as AptosApiError).data?.error_code !== 'module_not_found') throw err
      return [registry]
    }
  }

  /**
   * Decodes a CCIP message from an Aptos log event.
   * @param log - Log with data field.
   * @returns Decoded CCIPMessage or undefined if not valid.
   * @throws {@link CCIPAptosLogInvalidError} if log data format is invalid
   */
  static decodeMessage(log: {
    data: BytesLike | Record<string, unknown>
  }): CCIPMessage | undefined {
    const { data } = log
    if (
      (typeof data !== 'string' || !data.startsWith('{')) &&
      (typeof data !== 'object' || isBytesLike(data))
    )
      throw new CCIPLogDataInvalidError(util.inspect(log), { chain: ChainFamily.Aptos })
    try {
      const event = typeof data === 'string' ? jsonParse<Record<string, unknown>>(data) : data
      // a 2.0 event carries the message encoded (MessageV1, as in every family), next to other
      // fields, which pass through with their integers as bigints
      if (isBytesLike(event.encoded_message))
        return decodeMessage({
          messageId: keccak256(event.encoded_message),
          ...(convertKeysToCamelCase(event, (v) =>
            (typeof v === 'string' && v.match(/^\d+$/)) || typeof v === 'number' ? BigInt(v) : v,
          ) as Record<string, unknown>),
          ...decodeMessageV1(event.encoded_message),
        })
      // offload massaging to generic decodeJsonMessage
      return decodeMessage(data)
    } catch {
      // return undefined
    }
  }

  /**
   * Decodes extra arguments from Aptos CCIP messages.
   * @param extraArgs - Encoded extra arguments bytes.
   * @returns Decoded extra arguments or undefined if unknown format.
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
    | undefined {
    return decodeMoveExtraArgs(extraArgs) ?? decodeExtraArgsV3(extraArgs, ChainFamily.Aptos)
  }

  /**
   * Encodes extra arguments for Aptos CCIP messages.
   * @param extraArgs - Extra arguments to encode.
   * @returns Encoded extra arguments as hex string.
   * @throws {@link CCIPAptosExtraArgsEncodingError} if extra args format is not supported
   */
  static encodeExtraArgs(extraArgs: ExtraArgs): string {
    if ('finality' in extraArgs) return encodeExtraArgsV3(extraArgs, ChainFamily.Aptos)
    else if ('gasLimit' in extraArgs && 'allowOutOfOrderExecution' in extraArgs)
      return concat([EVMExtraArgsV2Tag, BcsEVMExtraArgsV2Codec.serialize(extraArgs).toBytes()])
    else if ('computeUnits' in extraArgs)
      return concat([
        SVMExtraArgsV1Tag,
        BcsSVMExtraArgsV1Codec.serialize({
          ...extraArgs,
          computeUnits: Number(extraArgs.computeUnits),
          tokenReceiver: getAddressBytes(extraArgs.tokenReceiver),
          accounts: extraArgs.accounts.map(getAddressBytes),
        }).toBytes(),
      ])
    throw new CCIPExtraArgsEncodingUnsupportedError(
      ChainFamily.Aptos,
      'EVMExtraArgsV2, SVMExtraArgsV1 & GenericExtraArgsV3',
    )
  }

  /**
   * Decodes commit reports from an Aptos log event.
   * @param log - Log with data field.
   * @param lane - Lane info for filtering.
   * @returns Array of CommitReport or undefined if not valid.
   * @throws {@link CCIPAptosLogInvalidError} if log data format is invalid
   */
  static decodeCommits({ data }: Pick<ChainLog, 'data'>, lane?: Lane): CommitReport[] | undefined {
    if (!data || typeof data != 'object')
      throw new CCIPLogDataInvalidError(data, { chain: ChainFamily.Aptos })
    const data_ = data as {
      blessed_merkle_roots: unknown[] | undefined
      unblessed_merkle_roots: unknown[]
    }
    if (!data_.blessed_merkle_roots) return
    let commits = (
      convertKeysToCamelCase(data_.blessed_merkle_roots.concat(data_.unblessed_merkle_roots), (v) =>
        typeof v === 'string' && v.match(/^\d+$/) ? BigInt(v) : v,
      ) as CommitReport[]
    ).map((c) => ({
      ...c,
      onRampAddress: decodeOnRampAddress(
        c.onRampAddress,
        networkInfo(c.sourceChainSelector).family,
      ),
    }))
    if (lane) {
      commits = commits.filter(
        (c) =>
          c.sourceChainSelector === lane.sourceChainSelector && c.onRampAddress === lane.onRamp,
      )
    }
    return commits
  }

  /**
   * Decodes an execution receipt from an Aptos log event.
   * @param log - Log with data field.
   * @returns ExecutionReceipt or undefined if not valid.
   * @throws {@link CCIPAptosLogInvalidError} if log data format is invalid
   */
  static decodeReceipt({ data }: Pick<ChainLog, 'data'>): ExecutionReceipt | undefined {
    if (!data || typeof data != 'object')
      throw new CCIPLogDataInvalidError(data, { chain: ChainFamily.Aptos })
    const data_ = data as { message_id: string; state: number }
    if (!data_.message_id || !data_.state) return
    const receipt = convertKeysToCamelCase(data_, (v) =>
      typeof v === 'string' && v.match(/^\d+$/) ? BigInt(v) : v,
    ) as Partial<ExecutionReceipt> & { messageNumber?: bigint }
    receipt.sequenceNumber ??= receipt.messageNumber // as 2.0 names it
    return receipt as ExecutionReceipt
  }

  /**
   * Converts bytes to an Aptos address.
   * @param bytes - Bytes to convert.
   * @returns Aptos address in canonical short form (0x-prefixed hex, leading
   * zero nibbles stripped).
   * @throws {@link CCIPDataFormatUnsupportedError} if bytes length exceeds 32
   */
  static getAddress(bytes: BytesLike | readonly number[]): string {
    return getMoveAddress(bytes)
  }

  /**
   * Validates a transaction hash format for Aptos
   */
  static isTxHash(v: unknown): v is `0x${string}` {
    return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
  }

  /**
   * Gets the leaf hasher for Aptos destination chains.
   * @param lane - Lane configuration.
   * @returns Leaf hasher function.
   */
  static getDestLeafHasher(lane: Lane, _ctx?: WithLogger): LeafHasher {
    return getAptosLeafHasher(lane)
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    await this.checkSendMessage(opts)
    const { router, destChainSelector, message } = opts
    const populatedMessage = buildMessageForDest(message, networkInfo(destChainSelector).family)
    return getFee(this.provider, router, destChainSelector, populatedMessage)
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  async generateUnsignedSendMessage(
    opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<UnsignedAptosTx> {
    const { sender, router, destChainSelector } = opts
    const populatedMessage = buildMessageForDest(
      opts.message,
      networkInfo(destChainSelector).family,
    )
    const message = {
      ...populatedMessage,
      fee: opts.message.fee ?? (await this.getFee({ ...opts, message: populatedMessage })),
    }
    const tx = await generateUnsignedCcipSend(
      this.provider,
      sender,
      router,
      destChainSelector,
      message,
      opts,
    )
    return {
      family: ChainFamily.Aptos,
      transactions: [tx],
    }
  }

  /**
   * {@inheritDoc Chain.sendMessage}
   * @throws {@link CCIPAptosWalletInvalidError} if wallet is not a valid Aptos account
   */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    const account = opts.wallet
    if (!isAptosAccount(account)) {
      throw new CCIPWalletInvalidError(opts.wallet, { className: this.constructor.name })
    }

    const unsignedTx = await this.generateUnsignedSendMessage({
      ...opts,
      sender: account.accountAddress.toString(),
    })
    const unsigned = SimpleTransaction.deserialize(new Deserializer(unsignedTx.transactions[0]))

    // Sign and submit the transaction
    const signed = await account.signTransactionWithAuthenticator(unsigned)
    const pendingTxn = await this.provider.transaction.submit.simple({
      transaction: unsigned,
      senderAuthenticator: signed,
    })

    // Wait for the transaction to be confirmed
    const { hash } = await this.provider.waitForTransaction({
      transactionHash: pendingTxn.hash,
    })

    // Return the CCIPRequest by fetching it
    return (await this.getMessagesInTx(await this.getTransaction(hash)))[0]!
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecute}
   * @throws {@link CCIPAptosExtraArgsV2RequiredError} if message missing EVMExtraArgsV2 fields
   */
  async generateUnsignedExecute({
    payer,
    ...opts
  }: Parameters<Chain['generateUnsignedExecute']>[0]): Promise<UnsignedAptosTx> {
    const resolved = await this.resolveExecuteOpts(opts)
    if ('encodedMessage' in resolved.input) {
      const tx = await generateUnsignedExecuteV2(
        this.provider,
        payer,
        await this._getModule(resolved.offRamp, 'offramp'),
        resolved.input,
        resolved,
      )
      return { family: ChainFamily.Aptos, transactions: [tx] }
    }
    if (
      !('message' in resolved.input) ||
      !('allowOutOfOrderExecution' in resolved.input.message) ||
      !('gasLimit' in resolved.input.message)
    ) {
      throw new CCIPAptosExtraArgsV2RequiredError()
    }

    const tx = await generateUnsignedExecuteReport(
      this.provider,
      payer,
      resolved.offRamp,
      resolved.input as ExecutionInput<CCIPMessage_V1_6_EVM>,
      resolved,
    )
    return {
      family: ChainFamily.Aptos,
      transactions: [tx],
    }
  }

  /**
   * {@inheritDoc Chain.execute}
   * @throws {@link CCIPAptosWalletInvalidError} if wallet is not a valid Aptos account
   */
  async execute(opts: Parameters<Chain['execute']>[0]): Promise<CCIPExecution> {
    const account = opts.wallet
    if (!isAptosAccount(account)) {
      throw new CCIPWalletInvalidError(opts.wallet, { className: this.constructor.name })
    }

    const unsignedTx = await this.generateUnsignedExecute({
      ...opts,
      payer: account.accountAddress.toString(),
    })
    const unsigned = SimpleTransaction.deserialize(new Deserializer(unsignedTx.transactions[0]))

    // Sign and submit the transaction
    const signed = await account.signTransactionWithAuthenticator(unsigned)
    const pendingTxn = await this.provider.transaction.submit.simple({
      transaction: unsigned,
      senderAuthenticator: signed,
    })

    // Wait for the transaction to be confirmed
    const { hash } = await this.provider.waitForTransaction({
      transactionHash: pendingTxn.hash,
    })
    const tx = await this.getTransaction(hash)
    return this.getExecutionReceiptInTx(tx)
  }

  /**
   * Parses raw Aptos data into typed structures.
   * @param data - Raw data to parse.
   * @returns Parsed data or undefined.
   */
  static parse(data: unknown): Record<string, unknown> | undefined {
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      !(data instanceof Uint8Array) &&
      ('vmStatus' in data || 'vm_status' in data)
    )
      return data as Record<string, unknown>
    // a view or simulation which the VM aborted: the node's answer names the Move abort
    const error = data instanceof AptosApiError && (data.data as Record<string, unknown> | null)
    if (error && error.vm_error_code) return error
    try {
      if (isBytesLike(data)) {
        const parsedExtraArgs = this.decodeExtraArgs(data)
        if (parsedExtraArgs) return parsedExtraArgs
      }
    } catch {
      // ignore
    }
  }

  /** {@inheritDoc Chain.getSupportedTokens} */
  async getSupportedTokens(address: string, opts?: Pick<LogFilter, 'page'>): Promise<string[]> {
    const res = new Set<string>()
    for (const registry of await this._getRegistries(address)) {
      let page,
        nextKey = '0x0',
        hasMore
      do {
        ;[page, nextKey, hasMore] = await this.provider.view<[string[], string, boolean]>({
          payload: {
            function:
              `${registry}::get_all_configured_tokens` as `${string}::${string}::get_all_configured_tokens`,
            functionArguments: [nextKey, (opts?.page ?? 1000) || Number.MAX_SAFE_INTEGER],
          },
        })
        for (const token of page) res.add(token)
      } while (hasMore)
    }
    return [...res]
  }

  /**
   * {@inheritDoc Chain.getRegistryTokenConfig}
   * @throws {@link CCIPAptosTokenNotRegisteredError} if token is not registered
   */
  async getRegistryTokenConfig(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }> {
    const configs = await Promise.all(
      (await this._getRegistries(registry)).map(async (module) => {
        const [tokenPool, administrator, pendingAdministrator] = await this.provider.view<
          [string, string, string]
        >({
          payload: {
            function: `${module}::get_token_config` as `${string}::${string}::get_token_config`,
            functionArguments: [token],
          },
        })
        return {
          administrator,
          ...(!pendingAdministrator.match(/^0x0*$/) && { pendingAdministrator }),
          ...(!tokenPool.match(/^0x0*$/) && { tokenPool }),
        }
      }),
    )
    // like the ramps: the first registry with a pool for the token, else the first which knows it
    const config =
      configs.find((c) => c.tokenPool) ?? configs.find((c) => !c.administrator.match(/^0x0*$/))
    if (!config) throw new CCIPTokenNotRegisteredError(token, registry)
    return config
  }

  /** Pool modules of a pool package: a 2.0 one (`*_token_pool_v2`) before its 1.6 one. */
  private async _getPoolModules(tokenPool: string): Promise<string[]> {
    return (await this._getAccountModulesNames(tokenPool))
      .filter((name) => name.match(/token_pool(_v\d+)?$/))
      .sort((a, b) => b.length - a.length)
      .map((name) => `${tokenPool}::${name}`)
  }

  /** {@inheritDoc Chain.getTokenPoolConfig} */
  async getTokenPoolConfig(
    tokenPool: string,
    _opts?: TokenPoolConfigOpts,
  ): Promise<TokenPoolConfig> {
    let firstErr
    for (const module of await this._getPoolModules(tokenPool)) {
      const view = async <T>(fn: string) =>
        (
          await this.provider.view<[T]>({
            payload: { function: `${module}::${fn}` as `${string}::${string}::${string}` },
          })
        )[0]
      try {
        const [typeAndVersion, token, router, allowedFinality] = await Promise.all([
          this.typeAndVersion(module),
          view<string>('get_token'),
          // a 2.0 pool does not name its Router
          view<string>('get_router').catch(() => this._getRouterV2(module)),
          // 2.0: the finality which a transfer may request
          view<number>('get_allowed_finality_config').catch(() => undefined),
        ])
        return {
          token,
          router,
          typeAndVersion: typeAndVersion[2],
          ...(allowedFinality != null && decodeFinalityAllowed(Number(allowedFinality))),
        }
      } catch (err) {
        firstErr ??= err as Error
      }
    }
    throw CCIPError.from(firstErr ?? `Could not get tokenPool configs from ${tokenPool}`, 'UNKNOWN')
  }

  /** {@inheritDoc Chain.getTokenPoolRemotes} */
  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
    _opts?: TokenPoolRemotesOpts,
  ): Promise<Record<string, TokenPoolRemote>> {
    type RawRateLimiterState_ = {
      capacity: string
      is_enabled: boolean
      last_updated: string
      rate: string
      tokens: string
    }
    const toState = (state?: RawRateLimiterState_) =>
      state?.is_enabled
        ? {
            capacity: BigInt(state.capacity),
            lastUpdated: Number(state.last_updated),
            rate: BigInt(state.rate),
            tokens: BigInt(state.tokens),
          }
        : null
    let firstErr
    for (const module of await this._getPoolModules(tokenPool)) {
      const view = async <T>(fn: string, ...args: unknown[]) =>
        (
          await this.provider.view<[T]>({
            payload: {
              function: `${module}::${fn}` as `${string}::${string}::${string}`,
              functionArguments: args as [],
            },
          })
        )[0]
      // a 2.0 pool has a second pair of buckets, for fast finality: its views take that flag too
      const buckets = (fn: string, selector: bigint) =>
        view<RawRateLimiterState_>(fn, selector).then(
          (state) => [state],
          (err: unknown) => {
            if (!String(err).includes('Too few arguments')) throw err
            return Promise.all([
              view<RawRateLimiterState_>(fn, selector, false),
              view<RawRateLimiterState_>(fn, selector, true),
            ])
          },
        )
      try {
        const supportedChains = remoteChainSelector
          ? [remoteChainSelector]
          : await view<string[]>('get_supported_chains')
        return Object.fromEntries(
          await Promise.all(
            supportedChains.map(networkInfo).map(async (chain) => {
              try {
                const [remoteToken, remotePools, inbound, outbound] = await Promise.all([
                  view<BytesLike>('get_remote_token', chain.chainSelector),
                  view<BytesLike[]>('get_remote_pools', chain.chainSelector),
                  buckets('get_current_inbound_rate_limiter_state', chain.chainSelector),
                  buckets('get_current_outbound_rate_limiter_state', chain.chainSelector),
                ])
                return [
                  chain.name,
                  {
                    remoteToken: decodeAddress(remoteToken, chain.family),
                    remotePools: remotePools.map((pool) => decodeAddress(pool, chain.family)),
                    inboundRateLimiterState: toState(inbound[0]),
                    outboundRateLimiterState: toState(outbound[0]),
                    ...(outbound.length > 1 && {
                      fastInboundRateLimiterState: toState(inbound[1]),
                      fastOutboundRateLimiterState: toState(outbound[1]),
                    }),
                  },
                ] as const
              } catch (err) {
                if (
                  err instanceof AptosApiError &&
                  err.message.match(/Key not found in the smart table|E_UNKNOWN_REMOTE_CHAIN/)
                )
                  throw new CCIPTokenPoolChainConfigNotFoundError(tokenPool, tokenPool, chain.name)
                throw err
              }
            }),
          ),
        )
      } catch (err) {
        firstErr ??= err as Error
      }
    }
    throw CCIPError.from(firstErr ?? `Could not view 'get_remote_token' in ${tokenPool}`, 'UNKNOWN')
  }

  /** {@inheritDoc Chain.getTokenPrice} */
  override async getTokenPrice(opts: {
    router: string
    token: string
    timestamp?: number
  }): Promise<TokenPrice> {
    if (opts.timestamp != null) {
      this.logger.warn(
        'getTokenPrice: timestamp parameter not yet supported on Aptos, returning latest price',
      )
    }
    const feeQuoterModule = `${await this._getCcipPackage(opts.router)}::fee_quoter`

    const [[prices], { decimals }] = await Promise.all([
      this.provider.view<[{ value: string; timestamp: string }[]]>({
        payload: {
          function:
            `${feeQuoterModule}::get_token_prices` as `${string}::${string}::get_token_prices`,
          functionArguments: [[opts.token]],
        },
      }),
      this.getTokenInfo(opts.token),
    ])

    const rawPrice = BigInt(prices[0]!.value)
    return {
      price: Number(rawPrice) * 10 ** (decimals - 36),
    }
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(router: string): Promise<Record<string, TokenInfo>> {
    const [feeTokens] = await this.provider.view<[string[]]>({
      payload: {
        function:
          `${await this._getCcipPackage(router)}::fee_quoter::get_fee_tokens` as `${string}::${string}::get_fee_tokens`,
      },
    })
    return Object.fromEntries(
      await Promise.all(
        feeTokens.map(async (token) => [token, await this.getTokenInfo(token)] as const),
      ),
    )
  }
}
