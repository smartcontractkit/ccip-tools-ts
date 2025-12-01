import util from 'util'

import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
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
import moize from 'moize'

import { ccipSend, getFee } from './send.ts'
import {
  type ChainTransaction,
  type LogFilter,
  type TokenInfo,
  type TokenPoolRemote,
  Chain,
  ChainFamily,
} from '../chain.ts'
import {
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
} from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import type {
  AnyMessage,
  CCIPMessage,
  CCIPRequest,
  CommitReport,
  ExecutionReceipt,
  ExecutionReport,
  Lane,
  Log_,
  NetworkInfo,
  OffchainTokenData,
} from '../types.ts'
import {
  convertKeysToCamelCase,
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  networkInfo,
  parseTypeAndVersion,
} from '../utils.ts'
import { executeReport } from './exec.ts'
import { getAptosLeafHasher } from './hasher.ts'
import { getUserTxByVersion, getVersionTimestamp, streamAptosLogs } from './logs.ts'
import { getTokenInfo } from './token.ts'
import { type AptosAsyncAccount, EVMExtraArgsV2Codec, SVMExtraArgsV1Codec } from './types.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import { decodeMessage } from '../requests.ts'

export class AptosChain extends Chain<typeof ChainFamily.Aptos> {
  static readonly family = ChainFamily.Aptos
  static readonly decimals = 8

  readonly network: NetworkInfo<typeof ChainFamily.Aptos>
  readonly provider: Aptos

  getTokenInfo: (token: string) => Promise<TokenInfo>
  _getAccountModulesNames: (address: string) => Promise<string[]>

  constructor(provider: Aptos, network: NetworkInfo) {
    if (network.family !== ChainFamily.Aptos) {
      throw new Error(`Invalid network family: ${network.family}, expected ${ChainFamily.Aptos}`)
    }
    super()

    this.provider = provider
    this.network = network
    this.typeAndVersion = moize.default(this.typeAndVersion.bind(this), {
      maxSize: 100,
      maxArgs: 1,
      maxAge: 60e3, // 1min
    })
    this.getTransaction = moize.default(this.getTransaction.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenForTokenPool = moize.default(this.getTokenForTokenPool.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenInfo = moize.default((token) => getTokenInfo(this.provider, token), {
      maxSize: 100,
      maxArgs: 1,
    })

    this._getAccountModulesNames = moize.default(
      (address) =>
        this.provider
          .getAccountModules({ accountAddress: address })
          .then((modules) => modules.map(({ abi }) => abi!.name)),
      { maxSize: 100, maxArgs: 1 },
    )
    this.getWallet = moize.default(this.getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
    this.provider.getTransactionByVersion = moize.default(
      this.provider.getTransactionByVersion.bind(this.provider),
      {
        maxSize: 100,
        isPromise: true,
        transformArgs: ([arg]) => [(arg as { ledgerVersion: number }).ledgerVersion],
      },
    )
  }

  static async fromProvider(provider: Aptos): Promise<AptosChain> {
    return new AptosChain(provider, networkInfo(`aptos:${await provider.getChainId()}`))
  }

  static async fromAptosConfig(config: AptosConfig): Promise<AptosChain> {
    const provider = new Aptos(config)
    return this.fromProvider(provider)
  }

  static async fromUrl(url: string | Network, network?: Network): Promise<AptosChain> {
    if (network) {
      // pass
    } else if (Object.values(Network).includes(url as Network)) network = url as Network
    else if (url.includes('mainnet')) network = Network.MAINNET
    else if (url.includes('testnet')) network = Network.TESTNET
    else if (url.includes('local')) network = Network.LOCAL
    else throw new Error(`Unknown Aptos network: ${url}`)
    const config: AptosConfig = new AptosConfig({
      network,
      fullnode: url.includes('://') ? url : undefined,
      // indexer: url.includes('://') ? `${url}/v1/graphql` : undefined,
    })
    return this.fromAptosConfig(config)
  }

  async destroy(): Promise<void> {
    // Nothing to cleanup for Aptos implementation
  }

  async getBlockTimestamp(version: number | 'finalized'): Promise<number> {
    return getVersionTimestamp(this.provider, version)
  }

  async getTransaction(hashOrVersion: string | number): Promise<ChainTransaction> {
    let tx
    if (isHexString(hashOrVersion, 32)) {
      tx = await this.provider.getTransactionByHash({
        transactionHash: hashOrVersion,
      })
    } else if (!isNaN(+hashOrVersion)) {
      tx = await getUserTxByVersion(this.provider, +hashOrVersion)
    } else {
      throw new Error(`Invalid transaction hash or version: ${hashOrVersion}`)
    }
    if (tx.type !== TransactionResponseType.User) throw new Error('Invalid transaction type')

    return {
      chain: this,
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

  async *getLogs(opts: LogFilter & { versionAsHash?: boolean }): AsyncIterableIterator<Log_> {
    yield* streamAptosLogs(this.provider, opts)
  }

  async typeAndVersion(address: string) {
    // requires address with `::<module>` suffix
    const [typeAndVersion] = await this.provider.view<[string]>({
      payload: {
        function: `${address}::type_and_version` as `${string}::${string}::type_and_version`,
      },
    })
    return parseTypeAndVersion(typeAndVersion)
  }

  getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    // router is same package as onramp, changing only module
    return Promise.resolve(onRamp.split('::')[0] + '::router')
  }

  getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.resolve(offRamp.split('::')[0] + '::router')
  }

  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.resolve('0xa')
  }

  getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.resolve([router.split('::')[0] + '::offramp'])
  }

  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(router.split('::')[0] + '::onramp')
  }

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

  getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp.split('::')[0] + '::offramp')
  }

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
    throw firstErr ?? new Error(`Could not view 'get_token' in ${tokenPool}`)
  }

  async getTokenAdminRegistryFor(address: string): Promise<string> {
    const registry = address.split('::')[0] + '::token_admin_registry'
    const [type] = await this.typeAndVersion(registry)
    if (type !== 'TokenAdminRegistry') {
      throw new Error(`Expected ${registry} to have TokenAdminRegistry type, got=${type}`)
    }
    return registry
  }

  static getWallet(_opts: { wallet?: unknown } = {}): Promise<AptosAsyncAccount> {
    return Promise.reject(new Error('TODO according to your environment'))
  }

  // cached
  async getWallet(opts: { wallet?: unknown } = {}): Promise<AptosAsyncAccount> {
    if (isBytesLike(opts.wallet)) {
      return Account.fromPrivateKey({
        privateKey: new Ed25519PrivateKey(opts.wallet, false),
      })
    }
    return (this.constructor as typeof AptosChain).getWallet(opts)
  }

  async getWalletAddress(opts?: { wallet?: unknown }): Promise<string> {
    return (await this.getWallet(opts)).accountAddress.toString()
  }

  // Static methods for decoding
  static decodeMessage(log: {
    data: BytesLike | Record<string, unknown>
  }): CCIPMessage | undefined {
    const { data } = log
    if (
      (typeof data !== 'string' || !data.startsWith('{')) &&
      (typeof data !== 'object' || data == null || isBytesLike(data))
    )
      throw new Error(`invalid log data: ${util.inspect(log)}`)
    // offload massaging to generic decodeJsonMessage
    try {
      return decodeMessage(data)
    } catch (_) {
      // return undefined
    }
  }

  // decodes an Aptos-generated extraArgs, destinated *to* other chains (EVM, Solana, etc)
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

  // encodes extraArgs destinated *to other* chains (EVM, Solana, etc), using Aptos-specific encoding (i.e. *from* Aptos)
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
    throw new Error('Aptos can only encode EVMExtraArgsV2 & SVMExtraArgsV1')
  }

  static decodeCommits({ data }: Pick<Log_, 'data'>, lane?: Lane): CommitReport[] | undefined {
    if (!data || typeof data != 'object') throw new Error('invalid aptos log')
    const data_ = data as { blessed_merkle_roots: unknown[]; unblessed_merkle_roots: unknown[] }
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

  static decodeReceipt({ data }: Pick<Log_, 'data'>): ExecutionReceipt | undefined {
    if (!data || typeof data != 'object') throw new Error('invalid aptos log')
    const data_ = data as { message_id: string; state: number }
    if (!data_.message_id || !data_.state) return
    return convertKeysToCamelCase(data_, (v) =>
      typeof v === 'string' && v.match(/^\d+$/) ? BigInt(v) : v,
    ) as ExecutionReceipt
  }

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
    if (dataLength(bytes) > 32) throw new Error(`Invalid aptos address: "${hexlify(bytes)}"`)
    return zeroPadValue(bytes, 32) + suffix
  }

  static getDestLeafHasher(lane: Lane): LeafHasher {
    return getAptosLeafHasher(lane)
  }

  async getFee(router: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint> {
    return getFee(this.provider, router, destChainSelector, message)
  }

  async sendMessage(
    router: string,
    destChainSelector: bigint,
    message: AnyMessage & { fee?: bigint },
    opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<ChainTransaction> {
    if (!message.fee) message.fee = await this.getFee(router, destChainSelector, message)
    const account = await this.getWallet(opts)

    const hash = await ccipSend(
      this.provider,
      account,
      router,
      destChainSelector,
      message as AnyMessage & { fee: bigint },
    )

    // Return the ChainTransaction by fetching it
    return this.getTransaction(hash)
  }

  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  async executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts?: { wallet?: unknown; gasLimit?: number },
  ): Promise<ChainTransaction> {
    const account = await this.getWallet(opts)

    if (!('allowOutOfOrderExecution' in execReport.message && 'gasLimit' in execReport.message)) {
      throw new Error('Aptos expects EVMExtraArgsV2 reports')
    }

    const hash = await executeReport(
      this.provider,
      account,
      offRamp,
      execReport as ExecutionReport<CCIPMessage_V1_6_EVM>,
      opts,
    )

    return this.getTransaction(hash)
  }

  static parse(data: unknown) {
    if (isBytesLike(data)) {
      const parsedExtraArgs = this.decodeExtraArgs(data)
      if (parsedExtraArgs) return parsedExtraArgs
    }
  }

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
    if (administrator.match(/^0x0*$/))
      throw new Error(`Token=${token} not registered in registry=${registry}`)
    return {
      administrator,
      ...(!pendingAdministrator.match(/^0x0*$/) && { pendingAdministrator }),
      ...(!tokenPool.match(/^0x0*$/) && { tokenPool }),
    }
  }

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
    throw firstErr ?? new Error(`Could not get tokenPool configs from ${tokenPool}`)
  }

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
    throw firstErr ?? new Error(`Could not view 'get_remote_token' in ${tokenPool}`)
  }

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

supportedChains[ChainFamily.Aptos] = AptosChain
