import util from 'node:util'

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
import yaml from 'yaml'

import { ccipSend, getFee } from './send.ts'
import { type ChainTransaction, type LogFilter, Chain, ChainFamily } from '../chain.ts'
import {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsTag,
} from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import type {
  AnyMessage,
  CCIPMessage,
  CCIPRequest,
  CCIPVersion,
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

export class AptosChain extends Chain<typeof ChainFamily.Aptos> {
  static readonly family = ChainFamily.Aptos
  static readonly decimals = 8

  readonly network: NetworkInfo<typeof ChainFamily.Aptos>
  readonly provider: Aptos

  getTokenInfo: (token: string) => Promise<{ symbol: string; decimals: number }>
  _getAccountModulesNames: (address: string) => Promise<string[]>

  constructor(provider: Aptos, network: NetworkInfo) {
    super()

    if (network.family !== ChainFamily.Aptos) {
      throw new Error(`Invalid network family: ${network.family}, expected ${ChainFamily.Aptos}`)
    }
    this.provider = provider
    this.network = network
    this.typeAndVersion = moize(this.typeAndVersion.bind(this), {
      maxSize: 100,
      maxArgs: 1,
      maxAge: 60e3, // 1min
    })
    this.getTransaction = moize(this.getTransaction.bind(this), { maxSize: 100, maxArgs: 1 })
    this.getTokenForTokenPool = moize(this.getTokenForTokenPool.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenInfo = moize((token) => getTokenInfo(this.provider, token), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenPoolForToken = moize(this.getTokenPoolForToken.bind(this), {
      maxSize: 100,
      maxArgs: 2,
    })

    this._getAccountModulesNames = moize(
      (address) =>
        this.provider
          .getAccountModules({ accountAddress: address })
          .then((modules) => modules.map(({ abi }) => abi!.name)),
      { maxSize: 100, maxArgs: 1 },
    )
    this.getWallet = moize(this.getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
    this.provider.getTransactionByVersion = moize(
      this.provider.getTransactionByVersion.bind(this.provider),
      {
        maxSize: 100,
        isPromise: true,
        transformArgs: ([arg]) => [(arg as { ledgerVersion: number }).ledgerVersion],
      },
    )
  }

  static async fromUrl(url: string | Network): Promise<AptosChain> {
    let network
    if (Object.values(Network).includes(url as Network)) network = url as Network
    else if (url.includes('mainnet')) network = Network.MAINNET
    else if (url.includes('testnet')) network = Network.TESTNET
    else if (url.includes('local')) network = Network.LOCAL
    else throw new Error(`Unknown Aptos network: ${url}`)
    const config: AptosConfig = new AptosConfig({
      network,
      fullnode: url.includes('://') ? url : undefined,
      // indexer: url.includes('://') ? `${url}/v1/graphql` : undefined,
    })
    const provider = new Aptos(config)
    return new AptosChain(provider, networkInfo(`aptos:${await provider.getChainId()}`))
  }

  static txFromUrl(url: string, txHash: string): [Promise<AptosChain>, Promise<ChainTransaction>] {
    const chainPromise = AptosChain.fromUrl(url)
    const txPromise = isHexString(txHash, 32)
      ? chainPromise.then(async (chain) => chain.getTransaction(txHash))
      : Promise.reject(new Error(`Invalid transaction hash: ${txHash}`))
    return [chainPromise, txPromise]
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

  async typeAndVersion(
    address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
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
    let lastErr
    for (const name of modulesNames) {
      try {
        const res = await this.provider.view<[string]>({
          payload: {
            function: `${tokenPool}::${name}::get_token`,
          },
        })
        return res[0]
      } catch (err) {
        lastErr = err as Error
      }
    }
    throw lastErr ?? new Error(`Could not view 'get_token' in ${tokenPool}`)
  }

  getTokenAdminRegistryForOnRamp(onRamp: string): Promise<string> {
    return Promise.resolve(onRamp.split('::')[0] + '::token_admin_registry')
  }

  async getTokenPoolForToken(registry: string, token: string): Promise<string> {
    const res = await this.provider.view<[string]>({
      payload: {
        function:
          `${registry.includes('::') ? registry : registry + '::token_admin_registry'}::get_pool` as `${string}::${string}::get_pool`,
        functionArguments: [token],
      },
    })
    return res[0]
  }

  async getRemoteTokenForTokenPool(
    tokenPool: string,
    remoteChainSelector: bigint,
  ): Promise<string> {
    const modulesNames = (await this._getAccountModulesNames(tokenPool))
      .reverse()
      .filter((name) => name.endsWith('token_pool'))
    let lastErr
    for (const name of modulesNames) {
      try {
        const res = await this.provider.view<[BytesLike]>({
          payload: {
            function: `${tokenPool}::${name}::get_remote_token`,
            functionArguments: [remoteChainSelector],
          },
        })
        return decodeAddress(res[0], networkInfo(remoteChainSelector).family)
      } catch (err) {
        lastErr = err as Error
      }
    }
    throw lastErr ?? new Error(`Could not view 'get_token' in ${tokenPool}`)
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
  static decodeMessage(log: Log_): CCIPMessage | undefined {
    let { data } = log
    if (typeof data === 'string' && data.startsWith('{'))
      data = yaml.parse(data, { intAsBigInt: true }) as Record<string, unknown>
    if (!data || typeof data != 'object') throw new Error(`invalid aptos log: ${util.inspect(log)}`)
    const data_ = data as {
      message: Record<string, unknown> & { header: { dest_chain_selector: string } }
    }
    if (!data_.message) return
    const dest = networkInfo(BigInt(data_.message.header.dest_chain_selector))
    const msg = convertKeysToCamelCase(data_.message, (v, k) =>
      typeof v === 'string' && v.match(/^\d+$/)
        ? BigInt(v)
        : k === 'receiver' || k === 'destTokenAddress'
          ? decodeAddress(v as string, dest.family)
          : v,
    ) as CCIPMessage<typeof CCIPVersion.V1_6>
    const extraArgs = this.decodeExtraArgs(msg.extraArgs)
    if (extraArgs) {
      const { _tag, ...rest } = extraArgs
      Object.assign(msg, rest)
    }
    return msg
  }

  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
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
      case SVMExtraArgsTag: {
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

  static encodeExtraArgs(extraArgs: ExtraArgs): string {
    if ('gasLimit' in extraArgs && 'allowOutOfOrderExecution' in extraArgs)
      return concat([EVMExtraArgsV2Tag, EVMExtraArgsV2Codec.serialize(extraArgs).toBytes()])
    else if ('computeUnits' in extraArgs)
      return concat([
        SVMExtraArgsTag,
        SVMExtraArgsV1Codec.serialize({
          ...extraArgs,
          computeUnits: Number(extraArgs.computeUnits),
          tokenReceiver: getAddressBytes(extraArgs.tokenReceiver),
          accounts: extraArgs.accounts.map(getAddressBytes),
        }).toBytes(),
      ])
    throw new Error('Aptos can only encode EVMExtraArgsV2 & SVMExtraArgsV1')
  }

  static decodeCommits({ data }: Log_, lane?: Lane): CommitReport[] | undefined {
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

  static decodeReceipt({ data }: Log_): ExecutionReceipt | undefined {
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
    message: AnyMessage & { fee: bigint },
    opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<ChainTransaction> {
    const account = await this.getWallet(opts)

    const hash = await ccipSend(this.provider, account, router, destChainSelector, message)

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
}

supportedChains[ChainFamily.Aptos] = AptosChain
