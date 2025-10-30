import util from 'node:util'

import { parseAbi } from 'abitype'
import {
  type BytesLike,
  type JsonRpcApiProvider,
  type Log,
  type Provider,
  type Result,
  type Signer,
  type TransactionReceipt,
  BaseWallet,
  Contract,
  JsonRpcProvider,
  SigningKey,
  WebSocketProvider,
  ZeroAddress,
  concat,
  dataSlice,
  encodeBase58,
  getAddress,
  getBytes,
  hexlify,
  isBytesLike,
  isHexString,
  toBigInt,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import moize from 'moize'

import {
  DEFAULT_APPROVE_GAS_LIMIT,
  DEFAULT_GAS_LIMIT,
  commitsFragments,
  defaultAbiCoder,
  getAllFragmentsMatchingEvents,
  interfaces,
  receiptsFragments,
  requestsFragments,
} from './const.ts'
import { getV12LeafHasher, getV16LeafHasher } from './hasher.ts'
import { type CCIPMessage_V1_6_EVM, parseSourceTokenData } from './messages.ts'
import { encodeEVMOffchainTokenData, fetchEVMOffchainTokenData } from './offchain.ts'
import type Token_ABI from '../../abi/BurnMintERC677Token.ts'
import type TokenPool_ABI from '../../abi/LockReleaseTokenPool_1_6_1.ts'
import EVM2EVMOffRamp_1_2_ABI from '../../abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from '../../abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from '../../abi/OffRamp_1_6.ts'
import EVM2EVMOnRamp_1_2_ABI from '../../abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from '../../abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from '../../abi/OnRamp_1_6.ts'
import type Router_ABI from '../../abi/Router.ts'
import type TokenAdminRegistry_1_5_ABI from '../../abi/TokenAdminRegistry_1_5.ts'
import { type Chain, type ChainTransaction, type LogFilter, ChainFamily } from '../chain.ts'
import {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type SVMExtraArgsV1,
  EVMExtraArgsV1Tag,
  EVMExtraArgsV2Tag,
  SVMExtraArgsTag,
} from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import {
  type AnyMessage,
  type CCIPMessage,
  type CCIPRequest,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type ExecutionState,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  CCIPVersion,
} from '../types.ts'
import {
  blockRangeGenerator,
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  getSomeBlockNumberBefore,
  networkInfo,
  parseTypeAndVersion,
} from '../utils.ts'
import { parseError } from './errors.ts'
import { supportedChains } from '../supported-chains.ts'

const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])
const EVMExtraArgsV1 = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2 = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
const SVMExtraArgsV1 =
  'tuple(uint32 computeUnits, uint64 accountIsWritableBitmap, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] accounts)'

function resultsToMessage(result: Result): Record<string, unknown> {
  if (result.message) result = result.message as Result
  return {
    ...result.toObject(),
    tokenAmounts: (result.tokenAmounts as Result[]).map((ta) => ta.toObject()),
    ...(result.sourceTokenData
      ? { sourceTokenData: (result.sourceTokenData as Result).toArray() }
      : {}),
    ...(result.header ? { header: (result.header as Result).toObject() } : {}),
  } as unknown as CCIPMessage
}

export class EVMChain implements Chain<typeof ChainFamily.EVM> {
  static readonly family = ChainFamily.EVM
  static readonly decimals = 18

  readonly network: NetworkInfo<typeof ChainFamily.EVM>
  readonly provider: JsonRpcApiProvider

  constructor(provider: JsonRpcApiProvider, network: NetworkInfo) {
    if (network.family !== ChainFamily.EVM)
      throw new Error(`Invalid network family for EVMChain: ${network.family}`)
    this.network = network
    this.provider = provider

    this.typeAndVersion = moize(this.typeAndVersion.bind(this))
    this.getBlockTimestamp = moize(this.getBlockTimestamp.bind(this), {
      maxSize: 100,
      updateCacheForKey: (key) => typeof key[key.length - 1] !== 'number',
    })
    this.getTransaction = moize(this.getTransaction.bind(this), {
      maxSize: 100,
      transformArgs: (args) =>
        typeof args[0] !== 'string' ? [(args[0] as TransactionReceipt).hash] : (args as string[]),
    })
    this.getTokenForTokenPool = moize(this.getTokenForTokenPool.bind(this))
    this.getNativeTokenForRouter = moize(this.getNativeTokenForRouter.bind(this), {
      maxArgs: 1,
      isPromise: true,
    })
    this.getTokenInfo = moize(this.getTokenInfo.bind(this))
    this.getWallet = moize(this.getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
  }

  [util.inspect.custom]() {
    return `${this.constructor.name} { ${this.network.name} }`
  }

  // overwrite EVMChain.getWallet to implement custom wallet loading
  // some signers don't like to be `.connect`ed, so pass provider as first param
  static getWallet(_provider: Provider, _opts: { wallet?: unknown }): Promise<Signer> {
    throw new Error('static EVM wallet loading not available')
  }

  // cached wallet/signer getter
  async getWallet(opts: { wallet?: unknown } = {}): Promise<Signer> {
    try {
      if (typeof opts.wallet === 'string') {
        return Promise.resolve(
          new BaseWallet(
            new SigningKey((opts.wallet.startsWith('0x') ? '' : '0x') + opts.wallet),
            this.provider,
          ),
        )
      }
    } catch (_) {
      // pass
    }
    return (this.constructor as typeof EVMChain).getWallet(this.provider, opts)
  }

  async getWalletAddress(opts?: { wallet?: string }): Promise<string> {
    return (await this.getWallet(opts)).getAddress()
  }

  static async _getProvider(url: string): Promise<JsonRpcApiProvider> {
    let provider: JsonRpcApiProvider
    let providerReady: Promise<JsonRpcApiProvider>
    if (url.startsWith('ws')) {
      const provider_ = new WebSocketProvider(url)
      providerReady = new Promise((resolve, reject) => {
        provider_.websocket.onerror = reject
        provider_
          ._waitUntilReady()
          .then(() => resolve(provider_))
          .catch(reject)
      })
      provider = provider_
    } else if (url.startsWith('http')) {
      provider = new JsonRpcProvider(url)
      providerReady = Promise.resolve(provider)
    } else {
      throw new Error(
        `Unknown JSON RPC protocol in endpoint (should be wss?:// or https?://): ${url}`,
      )
    }
    return providerReady
  }

  static async fromProvider(provider: JsonRpcApiProvider): Promise<EVMChain> {
    try {
      return new EVMChain(provider, networkInfo(Number((await provider.getNetwork()).chainId)))
    } catch (err) {
      provider.destroy()
      throw err
    }
  }

  static async fromUrl(url: string): Promise<EVMChain> {
    return this.fromProvider(await this._getProvider(url))
  }

  static txFromUrl(url: string, txHash: string): [Promise<EVMChain>, Promise<ChainTransaction>] {
    const provider$ = this._getProvider(url)
    const chain$ = provider$.then((provider) => this.fromProvider(provider))
    return [
      chain$,
      (isHexString(txHash, 32)
        ? Promise.resolve(txHash)
        : Promise.reject(new Error(`Invalid transaction hash: ${txHash}`))
      ).then(async (txHash) => {
        const tx = await (await provider$).getTransactionReceipt(txHash)
        if (!tx) throw new Error(`Transaction not found: ${txHash} in ${url}`)
        const chain = await chain$
        const timestamp = await chain.getBlockTimestamp(tx.blockNumber)
        return Object.assign(tx, { chain, timestamp })
      }),
    ]
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async destroy(): Promise<void> {
    this.provider.destroy()
  }

  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    const res = await this.provider.getBlock(block)
    if (!res) throw new Error(`Block not found: ${block}`)
    return res.timestamp
  }

  async getTransaction(hash: string | TransactionReceipt): Promise<ChainTransaction> {
    const tx = typeof hash === 'string' ? await this.provider.getTransactionReceipt(hash) : hash
    if (!tx) throw new Error(`Transaction not found: ${hash as string}`)
    const timestamp = await this.getBlockTimestamp(tx.blockNumber)
    const chainTx = {
      ...tx,
      chain: this,
      timestamp,
      logs: [] as Log_[],
    }
    const logs: Log_[] = tx.logs.map((l) => Object.assign(l, { tx: chainTx }))
    chainTx.logs = logs
    return chainTx
  }

  async *getLogs(filter: LogFilter): AsyncIterableIterator<Log> {
    const endBlock = filter.endBlock ?? (await this.provider.getBlockNumber())
    if (
      filter.topics?.length &&
      filter.topics.every((t: string | string[]): t is string => typeof t === 'string')
    ) {
      const topics = new Set(
        filter.topics
          .filter(isHexString)
          .concat(Object.keys(getAllFragmentsMatchingEvents(filter.topics)) as `0x${string}`[])
          .flat(),
      )
      if (!topics.size) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Could not find matching topics: ${filter.topics}`)
      }
      filter.topics = [Array.from(topics)]
    }
    if (!filter.startBlock && filter.startTime) {
      filter.startBlock = await getSomeBlockNumberBefore(this.provider, filter.startTime)
    }
    for (const blockRange of blockRangeGenerator({ ...filter, endBlock })) {
      const logs = await this.provider.getLogs({
        ...blockRange,
        ...(filter.address ? { address: filter.address } : {}),
        ...(filter.topics?.length ? { topics: filter.topics } : {}),
      })
      if (!filter.startBlock) logs.reverse()
      yield* logs
    }
  }

  static decodeMessage(log: { topics: readonly string[]; data: unknown }): CCIPMessage | undefined {
    if (!isBytesLike(log.data)) throw new Error(`invalid data=${util.inspect(log.data)}`)
    const fragment = requestsFragments[log.topics[0] as `0x${string}`]
    if (!fragment) return
    // we don't actually use Interface instance here, `decodeEventLog` is mostly static when given a fragment
    const result = interfaces.OnRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
    const message = resultsToMessage(result)
    if (!isHexString(message?.sender, 20)) throw new Error('could not decode CCIPMessage')

    if (!message.header) {
      // CCIPMessage_V1_2_EVM
      message.header = {
        messageId: message.messageId as string,
        sequenceNumber: message.sequenceNumber as bigint,
        nonce: message.nonce as bigint,
        sourceChainSelector: message.sourceChainSelector as bigint,
      }
    }

    const sourceFamily = networkInfo(
      (message.header as { sourceChainSelector: bigint }).sourceChainSelector,
    ).family
    let destFamily: ChainFamily = ChainFamily.EVM
    if ((message.header as { destChainSelector: bigint } | undefined)?.destChainSelector) {
      destFamily = networkInfo(
        (message.header as { destChainSelector: bigint }).destChainSelector,
      ).family
    }
    // conversions to make any message version be compatible with latest v1.6
    message.tokenAmounts = (message.tokenAmounts as Record<string, string | bigint | number>[]).map(
      (tokenAmount, i) => {
        if (message.sourceTokenData) {
          // CCIPMessage_V1_2_EVM
          try {
            tokenAmount = {
              ...parseSourceTokenData((message.sourceTokenData as string[])[i]),
              ...tokenAmount,
            }
          } catch (_) {
            console.debug('legacy sourceTokenData:', i, (message.sourceTokenData as string[])[i])
          }
        }
        if (typeof tokenAmount.destExecData === 'string' && tokenAmount.destGasAmount == null) {
          // CCIPMessage_V1_6_EVM
          tokenAmount.destGasAmount = toBigInt(getDataBytes(tokenAmount.destExecData))
        }
        // Can be undefined if the message is from before v1.5 and failed to parse sourceTokenData
        if (tokenAmount.sourcePoolAddress) {
          tokenAmount.sourcePoolAddress = decodeAddress(
            tokenAmount.sourcePoolAddress as string,
            sourceFamily,
          )
        }
        if (tokenAmount.destTokenAddress) {
          tokenAmount.destTokenAddress = decodeAddress(
            tokenAmount.destTokenAddress as string,
            destFamily,
          )
        }
        return tokenAmount
      },
    )
    message.sender = decodeAddress(message.sender, sourceFamily)
    message.feeToken = decodeAddress(message.feeToken as string, sourceFamily)
    message.receiver = decodeAddress(message.receiver as string, destFamily)
    if (message.extraArgs) {
      // v1.6+
      const parsed = this.decodeExtraArgs(message.extraArgs as string)
      if (!parsed) throw new Error(`Unknown extraArgs: ${message.extraArgs as string}`)
      const { _tag, ...rest } = parsed
      // merge parsed extraArgs to any family in message root object
      Object.assign(message, rest)
    } else if (message.nonce === 0n) {
      // v1.2..v1.5 targets EVM only; extraArgs is not explicit, gasLimit is already in
      // message body, allowOutOfOrderExecution (in v1.5) was present only as nonce=0
      message.allowOutOfOrderExecution = true
    }
    return message as CCIPMessage
  }

  static decodeCommits(
    log: { topics: readonly string[]; data: unknown },
    lane?: Omit<Lane, 'destChainSelector'>,
  ): CommitReport[] | undefined {
    if (!isBytesLike(log.data)) throw new Error(`invalid data=${util.inspect(log.data)}`)
    const fragment = commitsFragments[log.topics[0] as `0x${string}`]
    if (!fragment) return
    const isCcipV15 = fragment.name === 'ReportAccepted'
    // CCIP<=1.5 doesn't have lane info in event, so we need lane to be provided (e.g. from CommitStore's configs)
    if (isCcipV15 && !lane) throw new Error('decoding commits from CCIP<=v1.5 requires lane')
    let result = interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
    if (result.length === 1) result = result[0] as Result
    if (isCcipV15) {
      return [
        {
          merkleRoot: result.merkleRoot as string,
          minSeqNr: (result.interval as Result).min as bigint,
          maxSeqNr: (result.interval as Result).max as bigint,
          sourceChainSelector: lane!.sourceChainSelector,
          onRampAddress: lane!.onRamp,
        },
      ]
    } else {
      const reports: CommitReport[] = []
      for (const c of [...(result[0] as Result[]), ...(result[1] as Result[])]) {
        // if ccip>=v1.6 and lane is provided, use it to filter reports; otherwise, include all
        if (lane && c.sourceChainSelector !== lane.sourceChainSelector) continue
        const onRampAddress = decodeOnRampAddress(
          c.onRampAddress as string,
          networkInfo(c.sourceChainSelector as bigint).family,
        )
        if (lane && onRampAddress !== lane.onRamp) continue
        reports.push({ ...c.toObject(), onRampAddress } as CommitReport)
      }
      if (reports.length) return reports
    }
  }

  static decodeReceipt(log: {
    topics: readonly string[]
    data: unknown
  }): ExecutionReceipt | undefined {
    if (!isBytesLike(log.data)) throw new Error(`invalid data=${util.inspect(log.data)}`)
    const fragment = receiptsFragments[log.topics[0] as `0x${string}`]
    if (!fragment) return
    const result = interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
    return {
      ...result.toObject(),
      // ...(fragment.inputs.filter((p) => p.indexed).map((p, i) => [p.name, log.topics[i+1]] as const)).
      state: Number(result.state as bigint) as ExecutionState,
    } as ExecutionReceipt
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
      case EVMExtraArgsV1Tag: {
        const args = defaultAbiCoder.decode([EVMExtraArgsV1], dataSlice(data, 4))
        return { ...((args[0] as Result).toObject() as EVMExtraArgsV1), _tag: 'EVMExtraArgsV1' }
      }
      case EVMExtraArgsV2Tag: {
        const args = defaultAbiCoder.decode([EVMExtraArgsV2], dataSlice(data, 4))
        return { ...((args[0] as Result).toObject() as EVMExtraArgsV2), _tag: 'EVMExtraArgsV2' }
      }
      case SVMExtraArgsTag: {
        const args = defaultAbiCoder.decode([SVMExtraArgsV1], dataSlice(data, 4))
        const parsed = (args[0] as Result).toObject() as SVMExtraArgsV1
        parsed.tokenReceiver = encodeBase58(parsed.tokenReceiver)
        parsed.accounts = parsed.accounts.map((a: string) => encodeBase58(a))
        return { ...parsed, _tag: 'SVMExtraArgsV1' }
      }
      default:
        return undefined
    }
  }

  static encodeExtraArgs(args: EVMExtraArgsV1 | EVMExtraArgsV2 | SVMExtraArgsV1): string {
    if (!args) return '0x'
    if ('computeUnits' in args) {
      return concat([
        SVMExtraArgsTag,
        defaultAbiCoder.encode(
          [SVMExtraArgsV1],
          [
            {
              ...args,
              tokenReceiver: getAddressBytes(args.tokenReceiver),
              accounts: args.accounts.map((a) => getAddressBytes(a)),
            },
          ],
        ),
      ])
    } else if ('allowOutOfOrderExecution' in args) {
      if (args.gasLimit == null) args.gasLimit = DEFAULT_GAS_LIMIT
      return concat([EVMExtraArgsV2Tag, defaultAbiCoder.encode([EVMExtraArgsV2], [args])])
    } else if (args.gasLimit != null) {
      return concat([EVMExtraArgsV1Tag, defaultAbiCoder.encode([EVMExtraArgsV1], [args])])
    }
    return '0x'
  }

  static getAddress(bytes: BytesLike): string {
    bytes = getBytes(bytes)
    if (bytes.length < 20) throw new Error(`Invalid address: ${hexlify(bytes)}`)
    else if (bytes.length > 20) {
      if (bytes.slice(0, bytes.length - 20).every((b) => b === 0)) {
        bytes = bytes.slice(-20)
      } else {
        throw new Error(`Invalid address: ${hexlify(bytes)}`)
      }
    }
    return getAddress(hexlify(bytes))
  }

  async typeAndVersion(address: string) {
    const contract = new Contract(
      address,
      VersionedContractABI,
      this.provider,
    ) as unknown as TypedContract<typeof VersionedContractABI>
    return parseTypeAndVersion(await contract.typeAndVersion())
  }

  async getLaneForOnRamp(onRamp: string): Promise<Lane> {
    const [, version] = await this.typeAndVersion(onRamp)
    const onRampABI = version === CCIPVersion.V1_2 ? EVM2EVMOnRamp_1_2_ABI : EVM2EVMOnRamp_1_5_ABI
    const contract = new Contract(onRamp, onRampABI, this.provider) as unknown as TypedContract<
      typeof onRampABI
    >
    // TODO: memo this call
    const staticConfig = await contract.getStaticConfig()
    if (!staticConfig.destChainSelector)
      throw new Error(
        `No destChainSelector in OnRamp.staticConfig: ${JSON.stringify(staticConfig)}`,
      )
    return {
      sourceChainSelector: this.network.chainSelector,
      destChainSelector: staticConfig.destChainSelector,
      version: version as CCIPVersion,
      onRamp,
    }
  }

  async getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string> {
    const [, version] = await this.typeAndVersion(onRamp)
    let onRampABI
    switch (version) {
      case CCIPVersion.V1_2:
        onRampABI = EVM2EVMOnRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        onRampABI ??= EVM2EVMOnRamp_1_5_ABI
        const contract = new Contract(onRamp, onRampABI, this.provider) as unknown as TypedContract<
          typeof onRampABI
        >
        const { router } = await contract.getDynamicConfig()
        return router as string
      }
      case CCIPVersion.V1_6: {
        onRampABI = OnRamp_1_6_ABI
        const contract = new Contract(onRamp, onRampABI, this.provider) as unknown as TypedContract<
          typeof onRampABI
        >
        const [, , router] = await contract.getDestChainConfig(destChainSelector)
        return router as string
      }
      default:
        throw new Error(`Unsupported version: ${version}`)
    }
  }

  async getRouterForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const [, version] = await this.typeAndVersion(offRamp)
    let offRampABI, router
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        ;({ router } = await contract.getDynamicConfig())
        break
      }
      case CCIPVersion.V1_6: {
        offRampABI = OffRamp_1_6_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        ;({ router } = await contract.getSourceChainConfig(sourceChainSelector))
        break
      }
      default:
        throw new Error(`Unsupported version: ${version}`)
    }
    return router as string
  }

  async getNativeTokenForRouter(router: string): Promise<string> {
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return contract.getWrappedNative() as Promise<string>
  }

  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    const offRamps = await contract.getOffRamps()
    return offRamps
      .filter((offRamp) => offRamp.sourceChainSelector === sourceChainSelector)
      .map(({ offRamp }) => offRamp) as string[]
  }

  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    const contract = new Contract(
      router,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return contract.getOnRamp(destChainSelector) as Promise<string>
  }

  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const [, version] = await this.typeAndVersion(offRamp)
    let offRampABI
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { onRamp } = await contract.getStaticConfig()
        return onRamp as string
      }
      case CCIPVersion.V1_6: {
        offRampABI = OffRamp_1_6_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { onRamp } = await contract.getSourceChainConfig(sourceChainSelector)
        return decodeOnRampAddress(onRamp, networkInfo(sourceChainSelector).family)
      }
      default:
        throw new Error(`Unsupported version: ${version}`)
    }
  }

  async getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    const [, version] = await this.typeAndVersion(offRamp)
    let offRampABI
    switch (version) {
      case CCIPVersion.V1_2:
        offRampABI = EVM2EVMOffRamp_1_2_ABI
      // falls through
      case CCIPVersion.V1_5: {
        offRampABI ??= EVM2EVMOffRamp_1_5_ABI
        const contract = new Contract(
          offRamp,
          offRampABI,
          this.provider,
        ) as unknown as TypedContract<typeof offRampABI>
        const { commitStore } = await contract.getStaticConfig()
        return commitStore as string
      }
      case CCIPVersion.V1_6: {
        return offRamp
      }
      default:
        throw new Error(`Unsupported version: ${version}`)
    }
  }

  async getTokenForTokenPool(tokenPool: string): Promise<string> {
    const contract = new Contract(
      tokenPool,
      interfaces.TokenPool_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof TokenPool_ABI>
    return contract.getToken() as Promise<string>
  }

  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    const contract = new Contract(
      token,
      interfaces.Token,
      this.provider,
    ) as unknown as TypedContract<typeof Token_ABI>
    const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()])
    return { symbol, decimals: Number(decimals) }
  }

  static getDestLeafHasher({
    sourceChainSelector,
    destChainSelector,
    onRamp,
    version,
  }: Lane): LeafHasher {
    switch (version) {
      case CCIPVersion.V1_2:
      case CCIPVersion.V1_5:
        if (networkInfo(sourceChainSelector).family !== ChainFamily.EVM)
          throw new Error(`Unsupported source chain: ${sourceChainSelector}`)
        return getV12LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher
      case CCIPVersion.V1_6:
        return getV16LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher
      default:
        throw new Error(`Unsupported hasher version for EVM: ${version as string}`)
    }
  }

  async getTokenAdminRegistryForOnRamp(onRamp: string): Promise<string> {
    const [, version] = await this.typeAndVersion(onRamp)
    let contract
    switch (version) {
      case CCIPVersion.V1_5:
        contract = new Contract(
          onRamp,
          EVM2EVMOnRamp_1_5_ABI,
          this.provider,
        ) as unknown as TypedContract<typeof EVM2EVMOnRamp_1_5_ABI>
        break
      case CCIPVersion.V1_6:
        contract = new Contract(onRamp, OnRamp_1_6_ABI, this.provider) as unknown as TypedContract<
          typeof OnRamp_1_6_ABI
        >
        break
      default:
        throw new Error(`Unsupported version: ${version}`)
    }
    const { tokenAdminRegistry } = await contract.getStaticConfig() // TODO: memoize
    return tokenAdminRegistry as string
  }

  async getTokenPoolForToken(registry: string, token: string): Promise<string> {
    const contract = new Contract(
      registry,
      interfaces.TokenAdminRegistry,
      this.provider,
    ) as unknown as TypedContract<typeof TokenAdminRegistry_1_5_ABI>
    const tokenPool = await contract.getPool(token)
    if (!tokenPool || tokenPool === ZeroAddress)
      throw new Error(`TokenPool not registered for token ${token} in registry ${registry}`)
    return tokenPool as string
  }

  async getRemoteTokenForTokenPool(
    tokenPool: string,
    remoteChainSelector: bigint,
  ): Promise<string> {
    const contract = new Contract(
      tokenPool,
      interfaces.TokenPool_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof TokenPool_ABI>
    const remoteToken = await contract.getRemoteToken(remoteChainSelector)
    if (!remoteToken || remoteToken === ZeroAddress)
      throw new Error(
        `RemoteToken not registered for token pool ${tokenPool} on chain ${remoteChainSelector}`,
      )
    return decodeAddress(remoteToken, networkInfo(remoteChainSelector).family)
  }

  async getFee(router_: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint> {
    const router = new Contract(
      router_,
      interfaces.Router,
      this.provider,
    ) as unknown as TypedContract<typeof Router_ABI>
    return router.getFee(destChainSelector, {
      receiver: zeroPadValue(getAddressBytes(message.receiver), 32),
      data: hexlify(message.data),
      tokenAmounts: message.tokenAmounts ?? [],
      feeToken: message.feeToken ?? ZeroAddress,
      extraArgs: hexlify((this.constructor as typeof EVMChain).encodeExtraArgs(message.extraArgs)),
    })
  }

  async sendMessage(
    router_: string,
    destChainSelector: bigint,
    message: AnyMessage & { fee: bigint },
    opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<ChainTransaction> {
    const feeToken = message.feeToken ?? ZeroAddress
    const receiver = zeroPadValue(getAddressBytes(message.receiver), 32)
    const data = hexlify(message.data)
    const extraArgs = hexlify(
      (this.constructor as typeof EVMChain).encodeExtraArgs(message.extraArgs),
    )

    // make sure to approve once per token, for the total amount (including fee, if needed)
    const amountsToApprove = (message.tokenAmounts ?? []).reduce(
      (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
      {} as { [token: string]: bigint },
    )
    if (feeToken !== ZeroAddress)
      amountsToApprove[feeToken] = (amountsToApprove[feeToken] ?? 0n) + message.fee

    const wallet = await this.getWallet(opts) // moized wallet arg (if called previously)

    // approve all tokens (including fee token) in parallel
    let nonce = await this.provider.getTransactionCount(await this.getWalletAddress())
    await Promise.all(
      Object.entries(amountsToApprove).map(async ([token, amount]) => {
        const contract = new Contract(token, interfaces.Token, wallet) as unknown as TypedContract<
          typeof Token_ABI
        >
        const allowance = await contract.allowance(await wallet.getAddress(), router_)
        if (allowance < amount) {
          const amnt = opts?.approveMax ? 2n ** 256n - 1n : amount
          // optimization: hardcode nonce and gasLimit to send all approvals in parallel without estimating
          console.info('Approving', amnt, 'of', token, 'tokens for router', router_)
          const tx = await contract.approve(router_, amnt, {
            nonce: nonce++,
            gasLimit: DEFAULT_APPROVE_GAS_LIMIT,
          })
          console.info('=>', tx.hash)
          await tx.wait(1, 60_000)
        }
      }),
    )

    const router = new Contract(router_, interfaces.Router, wallet) as unknown as TypedContract<
      typeof Router_ABI
    >
    const tx = await router.ccipSend(
      destChainSelector,
      {
        receiver,
        data,
        tokenAmounts: message.tokenAmounts ?? [],
        extraArgs,
        feeToken,
      },
      {
        nonce: nonce++,
        // if native fee, include it in value; otherwise, it's transferedFrom feeToken
        ...(feeToken === ZeroAddress ? { value: message.fee } : {}),
      },
    )
    const receipt = (await tx.wait(1))!
    return this.getTransaction(receipt)
  }

  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return fetchEVMOffchainTokenData(request)
  }

  async executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts?: { wallet?: string; gasLimit?: number; tokensGasLimit?: number },
  ) {
    const [type, version, typeAndVersion] = await this.typeAndVersion(offRamp)
    if (!type.includes('OffRamp') || Object.values<string>(CCIPVersion).includes(version))
      throw new Error(`Invalid OffRamp=${offRamp} type or version: "${typeAndVersion}"`)

    const wallet = await this.getWallet(opts)

    let manualExecTx
    const offchainTokenData = execReport.offchainTokenData.map(encodeEVMOffchainTokenData)

    switch (version) {
      case CCIPVersion.V1_2: {
        const contract = new Contract(
          offRamp,
          EVM2EVMOffRamp_1_2_ABI,
          wallet,
        ) as unknown as TypedContract<typeof EVM2EVMOffRamp_1_2_ABI>
        const gasOverride = BigInt(opts?.gasLimit ?? 0)
        manualExecTx = await contract.manuallyExecute(
          {
            ...execReport,
            proofs: execReport.proofs.map((d) => hexlify(d)),
            messages: [execReport.message as CCIPMessage<typeof CCIPVersion.V1_2>],
            offchainTokenData: [offchainTokenData],
          },
          [gasOverride],
        )
        break
      }
      case CCIPVersion.V1_5: {
        const contract = new Contract(
          offRamp,
          EVM2EVMOffRamp_1_5_ABI,
          wallet,
        ) as unknown as TypedContract<typeof EVM2EVMOffRamp_1_5_ABI>
        manualExecTx = await contract.manuallyExecute(
          {
            ...execReport,
            proofs: execReport.proofs.map((d) => hexlify(d)),
            messages: [execReport.message as CCIPMessage<typeof CCIPVersion.V1_5>],
            offchainTokenData: [offchainTokenData],
          },
          [
            {
              receiverExecutionGasLimit: BigInt(opts?.gasLimit ?? 0),
              tokenGasOverrides: execReport.message.tokenAmounts.map(() =>
                BigInt(opts?.tokensGasLimit ?? opts?.gasLimit ?? 0),
              ),
            },
          ],
        )
        break
      }
      case CCIPVersion.V1_6: {
        // normalize message
        const sender = zeroPadValue(getAddressBytes(execReport.message.sender), 32)
        const tokenAmounts = (execReport.message as CCIPMessage_V1_6_EVM).tokenAmounts.map(
          (ta: CCIPMessage_V1_6_EVM['tokenAmounts'][number]) => ({
            ...ta,
            sourcePoolAddress: zeroPadValue(getAddressBytes(ta.sourcePoolAddress), 32),
            extraData: hexlify(getDataBytes(ta.extraData)),
          }),
        )
        const message = {
          ...(execReport.message as CCIPMessage_V1_6_EVM),
          sender,
          tokenAmounts,
        }
        const contract = new Contract(offRamp, OffRamp_1_6_ABI, wallet) as unknown as TypedContract<
          typeof OffRamp_1_6_ABI
        >
        manualExecTx = await contract.manuallyExecute(
          [
            {
              ...execReport,
              proofs: execReport.proofs.map((p) => hexlify(p)),
              sourceChainSelector: execReport.message.header.sourceChainSelector,
              messages: [message],
              offchainTokenData: [offchainTokenData],
            },
          ],
          [
            [
              {
                receiverExecutionGasLimit: BigInt(opts?.gasLimit ?? 0),
                tokenGasOverrides: execReport.message.tokenAmounts.map(() =>
                  BigInt(opts?.tokensGasLimit ?? opts?.gasLimit ?? 0),
                ),
              },
            ],
          ],
        )
        break
      }
      default:
        throw new Error(`Unsupported version: ${version}`)
    }

    return manualExecTx
  }

  static parseError(error: unknown) {
    return parseError(error)
  }
}

supportedChains[ChainFamily.EVM] = EVMChain
