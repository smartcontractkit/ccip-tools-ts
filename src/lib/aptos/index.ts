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
  getBytes,
  hexlify,
  isBytesLike,
  isHexString,
  zeroPadValue,
} from 'ethers'
import moize from 'moize'
import yaml from 'yaml'

import { ccipSend, getFee } from './send.ts'
import { type Chain, type ChainTransaction, type LogFilter, ChainFamily } from '../chain.ts'
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
import {
  type AnyMessage,
  type CCIPMessage,
  type CCIPRequest,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  CCIPVersion,
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
import { getAptosLeafHasher } from './hasher.ts'
import { getTokenInfo } from './token.ts'
import {
  type AptosAsyncAccount,
  EVMExtraArgsV2Codec,
  ExecutionReportCodec,
  SVMExtraArgsV1Codec,
} from './types.ts'

const eventToHandler = {
  CCIPMessageSent: 'OnRampState/ccip_message_sent_events',
  CommitReportAccepted: 'OffRampState/commit_report_accepted_events',
  ExecutionStateChanged: 'OffRampState/execution_state_changed_events',
} as const

export class AptosChain implements Chain<typeof ChainFamily.Aptos> {
  static readonly family = ChainFamily.Aptos
  static readonly decimals = 8

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
      {
        maxSize: 100,
        maxArgs: 1,
      },
    )
    this.getWallet = moize(this.getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
  }

  [util.inspect.custom]() {
    return `${this.constructor.name} { ${this.network.name} }`
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
        data: event.data as Record<string, unknown>,
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
    const [stateAddr] = await this.provider.view<[string]>({
      payload: {
        function:
          `${opts.address}::get_state_address` as `0x${string}::${string}::get_state_address`,
      },
    })

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
        data: ev.data as Record<string, unknown>,
      }
    }
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
    opts?: { wallet?: string; gasLimit?: number; tokensGasLimit?: number },
  ): Promise<ChainTransaction> {
    const [type, version, typeAndVersion] = await this.typeAndVersion(offRamp)
    if (!type.includes('OffRamp') || !Object.values<string>(CCIPVersion).includes(version))
      throw new Error(`Invalid OffRamp=${offRamp} type or version: "${typeAndVersion}"`)

    const account = await this.getWallet(opts)

    // Prepare offchain token data - for now, just empty bytes for each token
    const offchainTokenData = execReport.offchainTokenData.map((data) => {
      if (data?._tag === 'usdc') {
        // For USDC, we need to encode message and attestation
        // This is a simplified version - actual implementation may vary
        return Array.from(
          getBytes(concat([getDataBytes(data.message), getDataBytes(data.attestation)])),
        )
      } else if (data?._tag === 'lbtc') {
        return Array.from(getBytes(data.attestation))
      }
      return []
    })

    // Prepare proofs as byte arrays
    const proofs = execReport.proofs.map((proof) => Array.from(getBytes(proof)))

    // Prepare the message for Aptos
    const message = execReport.message
    const senderBytes = Array.from(getBytes(zeroPadValue(getDataBytes(message.sender), 32)))
    const receiverBytes = Array.from(getBytes(zeroPadValue(getDataBytes(message.receiver), 32)))
    const dataBytes = Array.from(getBytes(message.data))

    // Prepare token amounts - extract token address properly
    const tokenAddresses: string[] = []
    const tokenAmountValues: string[] = []

    for (const ta of message.tokenAmounts) {
      // Handle different token amount structures
      if ('token' in ta) {
        tokenAddresses.push(ta.token)
        tokenAmountValues.push(ta.amount.toString())
      } else if ('destTokenAddress' in ta) {
        tokenAddresses.push(ta.destTokenAddress)
        tokenAmountValues.push(ta.amount.toString())
      }
    }
    if (!('allowOutOfOrderExecution' in message && 'gasLimit' in message)) {
      throw new Error('allowOutOfOrderExecution is required')
    }

    const serialized = ExecutionReportCodec.serialize({
      sourceChainSelector: message.header.sourceChainSelector,
      messageId: getBytes(message.header.messageId),
      headerSourceChainSelector: message.header.sourceChainSelector,
      destChainSelector: message.header.destChainSelector,
      sequenceNumber: message.header.sequenceNumber,
      nonce: message.header.nonce,
      sender: getAddressBytes(message.sender),
      data: getBytes(message.data),
      receiver: getAddressBytes(message.receiver),
      gasLimit: message.gasLimit,
      tokenAmounts: message.tokenAmounts.map((ta) => ({
        sourcePoolAddress: getAddressBytes(ta.sourcePoolAddress),
        destTokenAddress: getAddressBytes(ta.destTokenAddress),
        destGasAmount: Number(ta.destGasAmount),
        extraData: getBytes(ta.extraData),
        amount: ta.amount,
      })),
      offchainTokenData: execReport.offchainTokenData.map(() => []),
      proofs: execReport.proofs.map((p) => getBytes(p)),
    }).toBytes()

    // Build the transaction to call manually_execute
    // The function signature should be something like:
    // public entry fun manually_execute(
    //     caller: &signer,
    //     merkle_root: vector<u8>,
    //     proofs: vector<vector<u8>>,
    //     proof_flag_bits: u256,
    //     message_id: vector<u8>,
    //     source_chain_selector: u64,
    //     dest_chain_selector: u64,
    //     sequence_number: u64,
    //     nonce: u64,
    //     sender: vector<u8>,
    //     receiver: vector<u8>,
    //     data: vector<u8>,
    //     token_addresses: vector<address>,
    //     token_amounts: vector<u256>,
    //     offchain_token_data: vector<vector<u8>>,
    //     gas_limit: u256
    // )
    const transaction = await this.provider.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function:
          `${offRamp.includes('::') ? offRamp : offRamp + '::offramp'}::manually_execute` as `${string}::${string}::${string}`,
        functionArguments: [serialized],
      },
    })

    // Sign and submit the transaction
    const signed = await account.signTransactionWithAuthenticator(transaction)
    const pendingTxn = await this.provider.transaction.submit.simple({
      transaction,
      senderAuthenticator: signed,
    })

    // Wait for the transaction to be confirmed
    const { hash } = await this.provider.waitForTransaction({
      transactionHash: pendingTxn.hash,
    })

    // Return the ChainTransaction by fetching it
    return this.getTransaction(hash)
  }
}

supportedChains[ChainFamily.Aptos] = AptosChain
