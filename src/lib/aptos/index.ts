import util from 'node:util'

import {
  type Event as AptosEvent,
  type UserTransactionResponse,
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  TransactionResponseType,
  getAptosFullNode,
} from '@aptos-labs/ts-sdk'
import {
  type BytesLike,
  concat,
  dataLength,
  dataSlice,
  decodeBase64,
  hexlify,
  isHexString,
  zeroPadValue,
} from 'ethers'
import moize from 'moize'
import yaml from 'yaml'

import { type Chain, type ChainTransaction, type LogFilter, ChainFamily } from '../chain.ts'
import {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
} from '../extra-args.ts'
// import { getV16AptosLeafHasher } from '../hasher/aptos.ts'
import type { LeafHasher } from '../hasher/common.ts'
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
  getDataBytes,
  leToBigInt,
  networkInfo,
  parseTypeAndVersion,
  toLeArray,
} from '../utils.ts'
import { getAptosLeafHasher } from './hasher.ts'
import { getTokenInfo } from './token.ts'

const eventToHandler = {
  CCIPMessageSent: 'OnRampState/ccip_message_sent_events',
  CommitReportAccepted: 'OffRampState/commit_report_accepted_events',
  ExecutionStateChanged: 'OffRampState/execution_state_changed_events',
} as const

class AptosChain implements Chain {
  readonly network: NetworkInfo<typeof ChainFamily.Aptos>
  readonly provider: Aptos

  getTokenInfo: (token: string) => Promise<{ symbol: string; decimals: number }>
  _getAccountModulesNames: (address: string) => Promise<string[]>

  constructor(provider: Aptos, network: NetworkInfo) {
    if (network.family !== ChainFamily.Aptos) {
      throw new Error(`Invalid network family: ${network.family}, expected ${ChainFamily.Aptos}`)
    }
    this.provider = provider
    this.network = network
    this._getTxByVersion = moize(this._getTxByVersion.bind(this), {
      maxSize: 100,
      maxArgs: 1,
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
      {
        maxSize: 100,
        maxArgs: 1,
      },
    )
    this._getWallet = moize(this._getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
  }

  [util.inspect.custom]() {
    return `${this.constructor.name}{${this.network.name}}`
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

  private async _getTxByVersion(version: number): Promise<UserTransactionResponse> {
    const tx = await this.provider.getTransactionByVersion({
      ledgerVersion: version,
    })
    if (tx.type !== TransactionResponseType.User)
      throw new Error(`Unexpected transaction type="${tx.type}"`)
    return tx
  }

  async getBlockTimestamp(version: number | 'finalized'): Promise<number> {
    if (version === 'finalized') {
      const info = await this.provider.getLedgerInfo()
      version = +info.ledger_version
    }
    const tx = await this._getTxByVersion(version)
    return +tx.timestamp / 1e6
  }

  async getTransaction(hash: string): Promise<ChainTransaction> {
    const tx = await this.provider.getTransactionByHash({
      transactionHash: hash,
    })
    if (tx.type !== TransactionResponseType.User) throw new Error('Invalid transaction type')

    return {
      chain: this,
      hash,
      blockNumber: +tx.version,
      from: tx.sender,
      timestamp: +tx.timestamp / 1e6,
      logs: tx.events.map((event, index) => ({
        address: event.type.slice(0, event.type.lastIndexOf('::')),
        transactionHash: hash,
        index,
        blockNumber: +tx.version,
        data: event.data as unknown,
        topics: [event.type.slice(event.type.lastIndexOf('::') + 2)],
      })),
    }
  }

  async *getLogs(opts: LogFilter): AsyncIterableIterator<Log_> {
    const limit = 100
    if (!opts.address || !opts.address.includes('::'))
      throw new Error('address with module is required')
    if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string')
      throw new Error('single string topic required')
    let eventHandlerField = opts.topics[0]
    if (!eventHandlerField.includes('/')) {
      eventHandlerField = (eventToHandler as Record<string, string>)[eventHandlerField]
      if (!eventHandlerField) throw new Error(`Unknown topic event handler="${opts.topics[0]}"`)
    }
    const stateAddr = (
      await this.provider.view({
        payload: {
          function:
            `${opts.address}::get_state_address` as `0x${string}::${string}::get_state_address`,
        },
      })
    )[0] as string

    type ResEvent = AptosEvent & { version: string }
    let eventsIter
    let cont = true
    if (opts.startBlock || opts.startTime) {
      // forward, collect all events in an array; or maybe in the future, binary-search
      // sequence number matching start conditions to then paginate forward
      let start
      const eventsArr: ResEvent[] = []
      eventsIter = eventsArr
      while (cont) {
        const { data }: { data: ResEvent[] } = await getAptosFullNode({
          aptosConfig: this.provider.config,
          originMethod: 'getEventsByEventHandle',
          path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
          params: { start, limit },
        })

        if (!data.length) break
        else if (start === 1) cont = false
        else start = Math.max(+data[0].sequence_number - limit, 1)

        let checkTime
        if (opts.startTime) {
          const oldest = await this.getBlockTimestamp(+data[0].version)
          if (oldest < opts.startTime) checkTime = opts.startTime
        }

        for (const ev of data.reverse()) {
          if (opts.endBlock && +ev.version > opts.endBlock) continue
          if (opts.startBlock && +ev.version < opts.startBlock) {
            cont = false
            break
          }
          if (checkTime) {
            const timestamp = await this.getBlockTimestamp(+ev.version)
            if (timestamp < checkTime) {
              cont = false
              break
            }
          }
          eventsArr.unshift(ev)
        }
      }
    } else {
      // backwards, just paginate down to lowest sequence number
      eventsIter = async function* (this: AptosChain) {
        let start
        const eventsArr: ResEvent[] = []
        eventsIter = eventsArr
        while (cont) {
          const { data } = await getAptosFullNode<object, ResEvent[]>({
            aptosConfig: this.provider.config,
            originMethod: 'getEventsByEventHandle',
            path: `accounts/${stateAddr}/events/${opts.address}::${eventHandlerField}`,
            params: { start, limit },
          })

          if (!data.length) break
          else if (start === 1) cont = false
          else start = Math.max(+data[0].sequence_number - limit, 1)

          for (const ev of data.reverse()) {
            if (opts.endBlock && +ev.version > opts.endBlock) continue
            if (+ev.sequence_number <= 1) cont = false
            yield ev
          }
        }
      }.call(this)
    }

    let topics
    for await (const ev of eventsIter) {
      topics ??= [ev.type.slice(ev.type.lastIndexOf('::') + 2)]
      yield {
        address: opts.address,
        topics,
        index: +ev.sequence_number,
        blockNumber: +ev.version,
        transactionHash: (await this._getTxByVersion(+ev.version)).hash,
        data: ev.data as unknown,
      }
    }
  }

  async typeAndVersion(
    address: string,
  ): Promise<
    | [type_: string, version: string, typeAndVersion: string]
    | [type_: string, version: string, typeAndVersion: string, suffix: string]
  > {
    const typeAndVersion = (
      await this.provider.view({
        payload: {
          function: `${address}::type_and_version` as `${string}::${string}::type_and_version`,
        },
      })
    )[0] as string
    return parseTypeAndVersion(typeAndVersion)
  }

  getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    // router is same package as onramp, changing only module
    return Promise.resolve(onRamp.split('::')[0] + '::router')
  }

  getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return Promise.resolve(offRamp.split('::')[0] + '::router')
  }

  getOffRampsForRouter(router: string, _sourceChainSelector: bigint): Promise<string[]> {
    return Promise.resolve([router.split('::')[0] + '::offramp'])
  }

  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(router.split('::')[0] + '::onramp')
  }

  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const sourceChainConfig = (
      await this.provider.view({
        payload: {
          function:
            `${offRamp.includes('::') ? offRamp : offRamp + '::offramp'}::get_source_chain_config` as `${string}::${string}::get_source_chain_config`,
          functionArguments: [sourceChainSelector],
        },
      })
    )[0] as { on_ramp: string }
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
        const res = await this.provider.view({
          payload: {
            function: `${tokenPool}::${name}::get_token`,
          },
        })
        return res[0] as string
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
    const res = await this.provider.view({
      payload: {
        function:
          `${registry.includes('::') ? registry : registry + '::token_admin_registry'}::get_pool` as `${string}::${string}::get_pool`,
        functionArguments: [token],
      },
    })
    return res[0] as string
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
        const res = await this.provider.view({
          payload: {
            function: `${tokenPool}::${name}::get_remote_token`,
            functionArguments: [remoteChainSelector],
          },
        })
        return decodeAddress(res[0] as string, networkInfo(remoteChainSelector).family)
      } catch (err) {
        lastErr = err as Error
      }
    }
    throw lastErr ?? new Error(`Could not view 'get_token' in ${tokenPool}`)
  }

  _getWallet({ wallet }: { wallet?: string } = {}): Account {
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(
        wallet ||
          process.env['OWNER_KEY'] ||
          process.env['USER_KEY'] ||
          (() => {
            throw new Error(
              'Unable to send Aptos Transaction, no private key has been provided: You must provide the private key with on USER_KEY env var.',
            )
          })(),
        false,
      ),
    })
  }

  getWalletAddress(opts?: { wallet?: string }): Promise<string> {
    return Promise.resolve(this._getWallet(opts).publicKey.toString())
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
        switch (dataLength(data)) {
          case 4 + 32 + 1:
            // Aptos serialization of EVMExtraArgsV2: 37 bytes total: 4 tag + 32 LE gasLimit + 1 allowOOOE
            return {
              _tag: 'EVMExtraArgsV2',
              gasLimit: leToBigInt(dataSlice(data, 4, 4 + 32)),
              allowOutOfOrderExecution: data[4 + 32] == 1,
            }
          default:
            throw new Error(`Unsupported EVMExtraArgsV2 length: ${dataLength(data)}`)
        }
      }
    }
  }

  static encodeExtraArgs(extraArgs: ExtraArgs): string {
    if (!('gasLimit' in extraArgs && 'allowOutOfOrderExecution' in extraArgs))
      throw new Error('Aptos can only encode EVMExtraArgsV2')
    return concat([
      EVMExtraArgsV2Tag,
      toLeArray(extraArgs.gasLimit ?? 200_000n, 32),
      extraArgs.allowOutOfOrderExecution ? '0x01' : '0x00',
    ])
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

  getFee(_router: string, _destChainSelector: bigint, _message: AnyMessage): Promise<bigint> {
    // TODO: Implement actual Aptos fee calculation
    throw new Error('getFee not implemented for Aptos')
  }

  sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee: bigint },
  ): Promise<ChainTransaction> {
    // TODO: Implement actual Aptos message sending
    throw new Error('sendMessage not implemented for Aptos')
  }

  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    // default offchain token data
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  executeReport(
    _offRamp: string,
    _execReport: ExecutionReport,
    _opts?: { wallet?: string; gasLimit?: number; tokensGasLimit?: number },
  ) {
    return Promise.reject(new Error('not yet implemented'))
  }
}

// Export singleton pattern similar to other chains
const _aptosChain = new WeakMap<NetworkInfo, AptosChain>()

export { AptosChain }
