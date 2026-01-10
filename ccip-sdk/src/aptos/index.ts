import {
  Aptos,
  AptosConfig,
  Deserializer,
  Network,
  SimpleTransaction,
  TransactionResponseType,
} from '@aptos-labs/ts-sdk'
import {
  type BytesLike,
  concat,
  dataLength,
  dataSlice,
  decodeBase64,
  getBytes,
  hexlify,
  isBytesLike,
  isHexString,
  zeroPadValue,
} from 'ethers'
import { memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import {
  type ChainContext,
  type LogFilter,
  type TokenInfo,
  type TokenPoolRemote,
  Chain,
} from '../chain.ts'
import { generateUnsignedCcipSend, getFee } from './send.ts'
import {
  CCIPAptosAddressInvalidError,
  CCIPAptosExtraArgsEncodingError,
  CCIPAptosExtraArgsV2RequiredError,
  CCIPAptosLogInvalidError,
  CCIPAptosNetworkUnknownError,
  CCIPAptosRegistryTypeInvalidError,
  CCIPAptosTokenNotRegisteredError,
  CCIPAptosTransactionInvalidError,
  CCIPAptosTransactionTypeInvalidError,
  CCIPAptosWalletInvalidError,
  CCIPError,
  CCIPOnRampRequiredError,
} from '../errors/index.ts'
import {
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
} from '../extra-args.ts'
import {
  type UnsignedAptosTx,
  EVMExtraArgsV2Codec,
  SVMExtraArgsV1Codec,
  isAptosAccount,
} from './types.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPExecution,
  type CCIPMessage,
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
import {
  convertKeysToCamelCase,
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  networkInfo,
  parseTypeAndVersion,
  util,
} from '../utils.ts'
import { generateUnsignedExecuteReport } from './exec.ts'
import { getAptosLeafHasher } from './hasher.ts'
import { getUserTxByVersion, getVersionTimestamp, streamAptosLogs } from './logs.ts'
import { getTokenInfo } from './token.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import {
  decodeMessage,
  getMessageById,
  getMessagesInBatch,
  getMessagesInTx,
  populateDefaultMessageForDest,
} from '../requests.ts'
export type { UnsignedAptosTx }

/**
 * Aptos chain implementation supporting Aptos networks.
 */
export class AptosChain extends Chain<typeof ChainFamily.Aptos> {
  static {
    supportedChains[ChainFamily.Aptos] = AptosChain
  }
  static readonly family = ChainFamily.Aptos
  static readonly decimals = 8

  readonly destroy$: Promise<void>
  provider: Aptos

  getTokenInfo: (token: string) => Promise<TokenInfo>
  _getAccountModulesNames: (address: string) => Promise<string[]>

  /**
   * Creates a new AptosChain instance.
   * @param provider - Aptos SDK provider instance.
   * @param network - Network information for this chain.
   */
  constructor(provider: Aptos, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)

    this.destroy$ = new Promise<void>((resolve) => (this.destroy = resolve))
    this.provider = provider

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      maxSize: 100,
      maxArgs: 1,
      expires: 60e3, // 1min
    })
    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenInfo = memoize((token) => getTokenInfo(this.provider, token), {
      maxSize: 100,
      maxArgs: 1,
    })

    this._getAccountModulesNames = memoize(
      (address) =>
        this.provider
          .getAccountModules({ accountAddress: address })
          .then((modules) => modules.map(({ abi }) => abi!.name)),
      { maxSize: 100, maxArgs: 1 },
    )
    this.provider.getTransactionByVersion = memoize(
      this.provider.getTransactionByVersion.bind(this.provider),
      {
        maxSize: 100,
        async: true,
        transformKey: ([arg]) => [(arg as { ledgerVersion: number }).ledgerVersion],
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
    return new AptosChain(provider, networkInfo(`aptos:${await provider.getChainId()}`), ctx)
  }

  /**
   * Creates an AptosChain instance from an Aptos configuration.
   * @param config - Aptos configuration object.
   * @param ctx - context containing logger.
   * @returns A new AptosChain instance.
   */
  static async fromAptosConfig(config: AptosConfig, ctx?: WithLogger): Promise<AptosChain> {
    const provider = new Aptos(config)
    return this.fromProvider(provider, ctx)
  }

  /**
   * Creates an AptosChain instance from a URL or network identifier.
   * @param url - RPC URL, Aptos Network enum value or [fullNodeUrl, Network] tuple.
   * @param ctx - context containing logger
   * @returns A new AptosChain instance.
   */
  static async fromUrl(
    url: string | Network | readonly [string, Network],
    ctx?: ChainContext,
  ): Promise<AptosChain> {
    let network: Network
    if (Array.isArray(url)) {
      ;[url, network] = url
    } else if (Object.values(Network).includes(url as Network)) network = url as Network
    else if (url.includes('mainnet')) network = Network.MAINNET
    else if (url.includes('testnet')) network = Network.TESTNET
    else if (url.includes('local')) network = Network.LOCAL
    else throw new CCIPAptosNetworkUnknownError(util.inspect(url))
    const config: AptosConfig = new AptosConfig({
      network,
      fullnode: typeof url === 'string' && url.includes('://') ? url : undefined,
      // indexer: url.includes('://') ? `${url}/v1/graphql` : undefined,
    })
    return this.fromAptosConfig(config, ctx)
  }

  /** {@inheritDoc Chain.getBlockTimestamp} */
  async getBlockTimestamp(version: number | 'finalized'): Promise<number> {
    return getVersionTimestamp(this.provider, version)
  }

  /** {@inheritDoc Chain.getTransaction} */
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

    return {
      hash: tx.hash,
      blockNumber: +tx.version,
      from: tx.sender,
      timestamp: +tx.timestamp / 1e6,
      logs: tx.events.map((event, index) => ({
        address: event.type.slice(0, event.type.lastIndexOf('::')),
        transactionHash: tx.hash,
        index,
        blockNumber: +tx.version, // we use version as Aptos' blockNumber, as blockHeight isn't very useful
        data: event.data as Record<string, unknown>,
        topics: [event.type.slice(event.type.lastIndexOf('::') + 2)],
      })),
    }
  }

  /** {@inheritDoc Chain.getLogs} */
  async *getLogs(opts: LogFilter & { versionAsHash?: boolean }): AsyncIterableIterator<Log_> {
    yield* streamAptosLogs(this, opts)
  }

  /** {@inheritDoc Chain.getMessagesInTx} */
  async getMessagesInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return getMessagesInTx(this, typeof tx === 'string' ? await this.getTransaction(tx) : tx)
  }

  /** {@inheritDoc Chain.getMessageById} */
  override async getMessageById(
    messageId: string,
    onRamp?: string,
    opts?: { page?: number },
  ): Promise<CCIPRequest> {
    if (!onRamp) throw new CCIPOnRampRequiredError()
    return getMessageById(this, messageId, {
      address: await this.getOnRampForRouter(onRamp, 0n),
      ...opts,
    })
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  async getMessagesInBatch<
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
    // requires address with `::<module>` suffix
    const [typeAndVersion] = await this.provider.view<[string]>({
      payload: {
        function: `${address}::type_and_version` as `${string}::${string}::type_and_version`,
      },
    })
    return parseTypeAndVersion(typeAndVersion)
  }

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    // router is same package as onramp, changing only module
    return Promise.resolve(onRamp.split('::')[0] + '::router')
  }

  /** {@inheritDoc Chain.getRouterForOffRamp} */
  getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.resolve(offRamp.split('::')[0] + '::router')
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.resolve('0xa')
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.resolve([router.split('::')[0] + '::offramp'])
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(router.split('::')[0] + '::onramp')
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const [sourceChainConfig] = await this.provider.view<[{ on_ramp: string }]>({
      payload: {
        function:
          `${offRamp.includes('::') ? offRamp : offRamp + '::offramp'}::get_source_chain_config` as `${string}::${string}::get_source_chain_config`,
        functionArguments: [sourceChainSelector],
      },
    })
    return decodeAddress(sourceChainConfig.on_ramp, networkInfo(sourceChainSelector).family)
  }

  /** {@inheritDoc Chain.getCommitStoreForOffRamp} */
  getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp.split('::')[0] + '::offramp')
  }

  /** {@inheritDoc Chain.getTokenForTokenPool} */
  async getTokenForTokenPool(tokenPool: string): Promise<string> {
    const modulesNames = (await this._getAccountModulesNames(tokenPool))
      .reverse()
      .filter((name) => name.endsWith('token_pool'))
    let firstErr
    for (const name of modulesNames) {
      try {
        const res = await this.provider.view<[string]>({
          payload: {
            function: `${tokenPool}::${name}::get_token`,
          },
        })
        return res[0]
      } catch (err) {
        firstErr ??= err as Error
      }
    }
    throw CCIPError.from(firstErr ?? `Could not view 'get_token' in ${tokenPool}`, 'UNKNOWN')
  }

  /** {@inheritDoc Chain.getTokenAdminRegistryFor} */
  async getTokenAdminRegistryFor(address: string): Promise<string> {
    const registry = address.split('::')[0] + '::token_admin_registry'
    const [type] = await this.typeAndVersion(registry)
    if (type !== 'TokenAdminRegistry') {
      throw new CCIPAptosRegistryTypeInvalidError(registry, type)
    }
    return registry
  }

  /**
   * Decodes a CCIP message from an Aptos log event.
   * @param log - Log with data field.
   * @returns Decoded CCIPMessage or undefined if not valid.
   */
  static decodeMessage(log: {
    data: BytesLike | Record<string, unknown>
  }): CCIPMessage | undefined {
    const { data } = log
    if (
      (typeof data !== 'string' || !data.startsWith('{')) &&
      (typeof data !== 'object' || isBytesLike(data))
    )
      throw new CCIPAptosLogInvalidError(util.inspect(log))
    // offload massaging to generic decodeJsonMessage
    try {
      return decodeMessage(data)
    } catch (_) {
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
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | undefined {
    const data = getDataBytes(extraArgs),
      tag = dataSlice(data, 0, 4)
    switch (tag) {
      case EVMExtraArgsV2Tag: {
        const parsed = EVMExtraArgsV2Codec.parse(getBytes(dataSlice(data, 4)))
        // Aptos serialization of EVMExtraArgsV2: 37 bytes total: 4 tag + 32 LE gasLimit + 1 allowOOOE
        return {
          _tag: 'EVMExtraArgsV2',
          ...parsed,
          gasLimit: BigInt(parsed.gasLimit),
        }
      }
      case SVMExtraArgsV1Tag: {
        const parsed = SVMExtraArgsV1Codec.parse(getBytes(dataSlice(data, 4)))
        // Aptos serialization of SVMExtraArgsV1: 13 bytes total: 4 tag + 8 LE computeUnits
        return {
          _tag: 'SVMExtraArgsV1',
          ...parsed,
          computeUnits: BigInt(parsed.computeUnits),
          accountIsWritableBitmap: BigInt(parsed.accountIsWritableBitmap),
          tokenReceiver: decodeAddress(new Uint8Array(parsed.tokenReceiver), ChainFamily.Solana),
          accounts: parsed.accounts.map((account) =>
            decodeAddress(new Uint8Array(account), ChainFamily.Solana),
          ),
        }
      }
    }
  }

  /**
   * Encodes extra arguments for Aptos CCIP messages.
   * @param extraArgs - Extra arguments to encode.
   * @returns Encoded extra arguments as hex string.
   */
  static encodeExtraArgs(extraArgs: ExtraArgs): string {
    if ('gasLimit' in extraArgs && 'allowOutOfOrderExecution' in extraArgs)
      return concat([EVMExtraArgsV2Tag, EVMExtraArgsV2Codec.serialize(extraArgs).toBytes()])
    else if ('computeUnits' in extraArgs)
      return concat([
        SVMExtraArgsV1Tag,
        SVMExtraArgsV1Codec.serialize({
          ...extraArgs,
          computeUnits: Number(extraArgs.computeUnits),
          tokenReceiver: getAddressBytes(extraArgs.tokenReceiver),
          accounts: extraArgs.accounts.map(getAddressBytes),
        }).toBytes(),
      ])
    throw new CCIPAptosExtraArgsEncodingError()
  }

  /**
   * Decodes commit reports from an Aptos log event.
   * @param log - Log with data field.
   * @param lane - Lane info for filtering.
   * @returns Array of CommitReport or undefined if not valid.
   */
  static decodeCommits({ data }: Pick<Log_, 'data'>, lane?: Lane): CommitReport[] | undefined {
    if (!data || typeof data != 'object') throw new CCIPAptosLogInvalidError(data)
    const data_ = data as {
      blessed_merkle_roots: unknown[] | undefined
      unblessed_merkle_roots: unknown[]
    }
    if (!data_.blessed_merkle_roots) return
    let commits = (
      convertKeysToCamelCase(
        data_.blessed_merkle_roots.concat(data_.unblessed_merkle_roots),
        (v) => (typeof v === 'string' && v.match(/^\d+$/) ? BigInt(v) : v),
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
   */
  static decodeReceipt({ data }: Pick<Log_, 'data'>): ExecutionReceipt | undefined {
    if (!data || typeof data != 'object') throw new CCIPAptosLogInvalidError(data)
    const data_ = data as { message_id: string; state: number }
    if (!data_.message_id || !data_.state) return
    return convertKeysToCamelCase(data_, (v) =>
      typeof v === 'string' && v.match(/^\d+$/) ? BigInt(v) : v,
    ) as ExecutionReceipt
  }

  /**
   * Converts bytes to an Aptos address.
   * @param bytes - Bytes to convert.
   * @returns Aptos address (0x-prefixed hex, 32 bytes padded).
   */
  static getAddress(bytes: BytesLike): string {
    let suffix = ''
    if (typeof bytes === 'string' && !bytes.startsWith('0x')) {
      bytes = decodeBase64(bytes)
    } else if (typeof bytes === 'string') {
      const idx = bytes.indexOf('::')
      if (idx > 0) {
        suffix = bytes.slice(idx)
        bytes = bytes.slice(0, idx)
      }
    }
    if (dataLength(bytes) > 32) throw new CCIPAptosAddressInvalidError(hexlify(bytes))
    return zeroPadValue(bytes, 32) + suffix
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
  async getFee({
    router,
    destChainSelector,
    message,
  }: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    const message_ = populateDefaultMessageForDest(message, networkInfo(destChainSelector).family)
    return getFee(this.provider, router, destChainSelector, message_)
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  async generateUnsignedSendMessage(
    opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<UnsignedAptosTx> {
    opts.message = populateDefaultMessageForDest(
      opts.message,
      networkInfo(opts.destChainSelector).family,
    )
    const { sender, router, destChainSelector, message } = opts
    if (!message.fee) message.fee = await this.getFee(opts)
    const tx = await generateUnsignedCcipSend(
      this.provider,
      sender,
      router,
      destChainSelector,
      message as AnyMessage & { fee: bigint },
      opts,
    )
    return {
      family: ChainFamily.Aptos,
      transactions: [tx],
    }
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    const account = opts.wallet
    if (!isAptosAccount(account)) {
      throw new CCIPAptosWalletInvalidError(this.constructor.name, util.inspect(opts.wallet))
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

  /** {@inheritDoc Chain.getOffchainTokenData} */
  getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /** {@inheritDoc Chain.generateUnsignedExecuteReport} */
  async generateUnsignedExecuteReport({
    payer,
    offRamp,
    execReport,
    ...opts
  }: Parameters<Chain['generateUnsignedExecuteReport']>[0]): Promise<UnsignedAptosTx> {
    if (!('allowOutOfOrderExecution' in execReport.message && 'gasLimit' in execReport.message)) {
      throw new CCIPAptosExtraArgsV2RequiredError()
    }

    const tx = await generateUnsignedExecuteReport(
      this.provider,
      payer,
      offRamp,
      execReport as ExecutionReport<CCIPMessage_V1_6_EVM>,
      opts,
    )
    return {
      family: ChainFamily.Aptos,
      transactions: [tx],
    }
  }

  /** {@inheritDoc Chain.executeReport} */
  async executeReport(opts: Parameters<Chain['executeReport']>[0]): Promise<CCIPExecution> {
    const account = opts.wallet
    if (!isAptosAccount(account)) {
      throw new CCIPAptosWalletInvalidError(this.constructor.name, util.inspect(opts.wallet))
    }

    const unsignedTx = await this.generateUnsignedExecuteReport({
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
  static parse(data: unknown) {
    if (isBytesLike(data)) {
      const parsedExtraArgs = this.decodeExtraArgs(data)
      if (parsedExtraArgs) return parsedExtraArgs
    }
  }

  /** {@inheritDoc Chain.getSupportedTokens} */
  async getSupportedTokens(address: string, opts?: { page?: number }): Promise<string[]> {
    const res = []
    let page,
      nextKey = '0x0',
      hasMore
    do {
      ;[page, nextKey, hasMore] = await this.provider.view<[string[], string, boolean]>({
        payload: {
          function:
            `${address.split('::')[0] + '::token_admin_registry'}::get_all_configured_tokens` as `${string}::${string}::get_all_configured_tokens`,
          functionArguments: [nextKey, (opts?.page ?? 1000) || Number.MAX_SAFE_INTEGER],
        },
      })
      res.push(...page)
    } while (hasMore)
    return page
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
    const [tokenPool, administrator, pendingAdministrator] = await this.provider.view<
      [string, string, string]
    >({
      payload: {
        function:
          `${registry.includes('::') ? registry : registry + '::token_admin_registry'}::get_token_config` as `${string}::${string}::get_token_config`,
        functionArguments: [token],
      },
    })
    if (administrator.match(/^0x0*$/)) throw new CCIPAptosTokenNotRegisteredError(token, registry)
    return {
      administrator,
      ...(!pendingAdministrator.match(/^0x0*$/) && { pendingAdministrator }),
      ...(!tokenPool.match(/^0x0*$/) && { tokenPool }),
    }
  }

  /** {@inheritDoc Chain.getTokenPoolConfigs} */
  async getTokenPoolConfigs(tokenPool: string): Promise<{
    token: string
    router: string
    typeAndVersion?: string
  }> {
    const modulesNames = (await this._getAccountModulesNames(tokenPool))
      .reverse()
      .filter((name) => name.endsWith('token_pool'))
    let firstErr
    for (const name of modulesNames) {
      try {
        const [typeAndVersion, token, router] = await Promise.all([
          this.typeAndVersion(`${tokenPool}::${name}`),
          this.provider.view<[string]>({
            payload: {
              function: `${tokenPool}::${name}::get_token`,
              functionArguments: [],
            },
          }),
          this.provider.view<[string]>({
            payload: {
              function: `${tokenPool}::${name}::get_router`,
              functionArguments: [],
            },
          }),
        ])
        return {
          token: token[0],
          router: router[0],
          typeAndVersion: typeAndVersion[2],
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
  ): Promise<Record<string, TokenPoolRemote>> {
    type RawRateLimiterState_ = {
      capacity: string
      is_enabled: boolean
      last_updated: string
      rate: string
      tokens: string
    }
    const modulesNames = (await this._getAccountModulesNames(tokenPool))
      .reverse()
      .filter((name) => name.endsWith('token_pool'))
    let firstErr
    for (const name of modulesNames) {
      try {
        const [supportedChains] = remoteChainSelector
          ? [[remoteChainSelector]]
          : await this.provider.view<[string[]]>({
              payload: {
                function: `${tokenPool}::${name}::get_supported_chains`,
                functionArguments: [],
              },
            })
        return Object.fromEntries(
          await Promise.all(
            supportedChains.map(networkInfo).map(async (chain) => {
              const remoteToken$ = this.provider.view<[BytesLike]>({
                payload: {
                  function: `${tokenPool}::${name}::get_remote_token`,
                  functionArguments: [chain.chainSelector],
                },
              })
              const remotePools$ = this.provider.view<[BytesLike[]]>({
                payload: {
                  function: `${tokenPool}::${name}::get_remote_pools`,
                  functionArguments: [chain.chainSelector],
                },
              })
              const inboundRateLimiterState$ = this.provider.view<[RawRateLimiterState_]>({
                payload: {
                  function: `${tokenPool}::${name}::get_current_inbound_rate_limiter_state`,
                  functionArguments: [chain.chainSelector],
                },
              })
              const outboundRateLimiterState$ = this.provider.view<[RawRateLimiterState_]>({
                payload: {
                  function: `${tokenPool}::${name}::get_current_outbound_rate_limiter_state`,
                  functionArguments: [chain.chainSelector],
                },
              })
              const [
                [remoteToken],
                [remotePools],
                [inboundRateLimiterState],
                [outboundRateLimiterState],
              ] = await Promise.all([
                remoteToken$,
                remotePools$,
                inboundRateLimiterState$,
                outboundRateLimiterState$,
              ])
              return [
                chain.name,
                {
                  remoteToken: decodeAddress(remoteToken, chain.family),
                  remotePools: remotePools.map((pool) => decodeAddress(pool, chain.family)),
                  inboundRateLimiterState: inboundRateLimiterState.is_enabled
                    ? {
                        capacity: BigInt(inboundRateLimiterState.capacity),
                        lastUpdated: Number(inboundRateLimiterState.last_updated),
                        rate: BigInt(inboundRateLimiterState.rate),
                        tokens: BigInt(inboundRateLimiterState.tokens),
                      }
                    : null,
                  outboundRateLimiterState: outboundRateLimiterState.is_enabled
                    ? {
                        capacity: BigInt(outboundRateLimiterState.capacity),
                        lastUpdated: Number(outboundRateLimiterState.last_updated),
                        rate: BigInt(outboundRateLimiterState.rate),
                        tokens: BigInt(outboundRateLimiterState.tokens),
                      }
                    : null,
                },
              ] as const
            }),
          ),
        )
      } catch (err) {
        firstErr ??= err as Error
      }
    }
    throw CCIPError.from(firstErr ?? `Could not view 'get_remote_token' in ${tokenPool}`, 'UNKNOWN')
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(router: string): Promise<Record<string, TokenInfo>> {
    const [feeTokens] = await this.provider.view<[string[]]>({
      payload: {
        function:
          `${router.split('::')[0] + '::fee_quoter'}::get_fee_tokens` as `${string}::${string}::get_fee_tokens`,
      },
    })
    return Object.fromEntries(
      await Promise.all(
        feeTokens.map(async (token) => [token, await this.getTokenInfo(token)] as const),
      ),
    )
  }
}
