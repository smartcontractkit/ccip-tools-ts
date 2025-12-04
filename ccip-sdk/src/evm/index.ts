import util from 'util'

import { parseAbi } from 'abitype'
import {
  type BytesLike,
  type Interface,
  type JsonRpcApiProvider,
  type Log,
  type Provider,
  type Signer,
  type TransactionReceipt,
  AbstractSigner,
  BaseWallet,
  Contract,
  JsonRpcProvider,
  Result,
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
  toBeHex,
  toBigInt,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import { memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import { type LogFilter, type TokenPoolRemote, Chain } from '../chain.ts'
import {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  EVMExtraArgsV1Tag,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPCommit,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type ExecutionState,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  CCIPVersion,
  ChainFamily,
} from '../types.ts'
import {
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  networkInfo,
  parseTypeAndVersion,
} from '../utils.ts'
import type Token_ABI from './abi/BurnMintERC677Token.ts'
import type FeeQuoter_ABI from './abi/FeeQuoter_1_6.ts'
import type TokenPool_1_5_ABI from './abi/LockReleaseTokenPool_1_5.ts'
import type TokenPool_ABI from './abi/LockReleaseTokenPool_1_6_1.ts'
import EVM2EVMOffRamp_1_2_ABI from './abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from './abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from './abi/OffRamp_1_6.ts'
import EVM2EVMOnRamp_1_2_ABI from './abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import type Router_ABI from './abi/Router.ts'
import type TokenAdminRegistry_1_5_ABI from './abi/TokenAdminRegistry_1_5.ts'
import {
  DEFAULT_APPROVE_GAS_LIMIT,
  DEFAULT_GAS_LIMIT,
  commitsFragments,
  defaultAbiCoder,
  interfaces,
  receiptsFragments,
  requestsFragments,
} from './const.ts'
import { parseData } from './errors.ts'
import { getV12LeafHasher, getV16LeafHasher } from './hasher.ts'
import { getEvmLogs } from './logs.ts'
import {
  type CCIPMessage_V1_6_EVM,
  type CleanAddressable,
  parseSourceTokenData,
} from './messages.ts'
import { encodeEVMOffchainTokenData, fetchEVMOffchainTokenData } from './offchain.ts'
import {
  fetchAllMessagesInBatch,
  fetchCCIPRequestById,
  fetchCCIPRequestsInTx,
} from '../requests.ts'

const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])

const EVMExtraArgsV1 = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2 = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
const SVMExtraArgsV1 =
  'tuple(uint32 computeUnits, uint64 accountIsWritableBitmap, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] accounts)'
const SuiExtraArgsV1 =
  'tuple(uint256 gasLimit, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] receiverObjectIds)'

function resultToObject<T>(o: T): T {
  return o instanceof Promise
    ? (o.then(resultToObject) as T)
    : o instanceof Result
      ? (o.toObject() as T)
      : o
}

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

export class EVMChain extends Chain<typeof ChainFamily.EVM> {
  static {
    supportedChains[ChainFamily.EVM] = EVMChain
  }
  static readonly family = ChainFamily.EVM
  static readonly decimals = 18

  readonly network: NetworkInfo<typeof ChainFamily.EVM>
  readonly provider: JsonRpcApiProvider
  readonly destroy$: Promise<void>

  constructor(provider: JsonRpcApiProvider, network: NetworkInfo) {
    if (network.family !== ChainFamily.EVM)
      throw new Error(`Invalid network family for EVMChain: ${network.family}`)
    super()

    this.network = network
    this.provider = provider
    this.destroy$ = new Promise<void>((resolve) => (this.destroy = resolve))
    void this.destroy$.finally(() => provider.destroy())

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this))

    this.provider.getBlock = memoize(provider.getBlock.bind(provider), {
      maxSize: 100,
      maxArgs: 1,
      async: true,
      forceUpdate: ([block]) => typeof block !== 'number',
    })
    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
      transformKey: (args) =>
        typeof args[0] !== 'string'
          ? [(args[0] as unknown as TransactionReceipt).hash]
          : (args as unknown as string[]),
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this))
    this.getNativeTokenForRouter = memoize(this.getNativeTokenForRouter.bind(this), {
      maxArgs: 1,
      async: true,
    })
    this.getTokenInfo = memoize(this.getTokenInfo.bind(this))
    this.getWallet = memoize(this.getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
    this.getTokenAdminRegistryFor = memoize(this.getTokenAdminRegistryFor.bind(this), {
      async: true,
      maxArgs: 1,
    })
    this.getFeeTokens = memoize(this.getFeeTokens.bind(this), { async: true, maxArgs: 1 })
  }

  // overwrite EVMChain.getWallet to implement custom wallet loading
  // some signers don't like to be `.connect`ed, so pass provider as first param
  static getWallet(_provider: Provider, _opts: { wallet?: unknown }): Promise<Signer> {
    throw new Error('static EVM wallet loading not available')
  }

  // cached wallet/signer getter
  async getWallet(opts: { wallet?: unknown } = {}): Promise<Signer> {
    if (
      typeof opts.wallet === 'number' ||
      (typeof opts.wallet === 'string' && opts.wallet.match(/^(\d+|0x[a-fA-F0-9]{40})$/))
    ) {
      // if given a number, numeric string or address, use ethers `provider.getSigner` (e.g. geth or MM)
      return this.provider.getSigner(
        typeof opts.wallet === 'string' && opts.wallet.match(/^0x[a-fA-F0-9]{40}$/)
          ? opts.wallet
          : Number(opts.wallet),
      )
    } else if (typeof opts.wallet === 'string') {
      // support receiving private key directly (not recommended)
      try {
        return Promise.resolve(
          new BaseWallet(
            new SigningKey((opts.wallet.startsWith('0x') ? '' : '0x') + opts.wallet),
            this.provider,
          ),
        )
      } catch (_) {
        // pass
      }
    } else if (opts.wallet instanceof AbstractSigner) {
      // if given a signer, return/cache it
      return opts.wallet
    }
    return (this.constructor as typeof EVMChain).getWallet(this.provider, opts)
  }

  /**
   * Expose ethers provider's `listAccounts`, if provider supports it
   */
  async listAccounts(): Promise<string[]> {
    return (await this.provider.listAccounts()).map(({ address }) => address)
  }

  async getWalletAddress(opts?: { wallet?: unknown }): Promise<string> {
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

  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    const res = await this.provider.getBlock(block) // cached
    if (!res) throw new Error(`Block not found: ${block}`)
    return res.timestamp
  }

  async getTransaction(hash: string | TransactionReceipt): Promise<ChainTransaction> {
    const tx = typeof hash === 'string' ? await this.provider.getTransactionReceipt(hash) : hash
    if (!tx) throw new Error(`Transaction not found: ${hash as string}`)
    const timestamp = await this.getBlockTimestamp(tx.blockNumber)
    const chainTx = {
      ...tx,
      timestamp,
      logs: [] as Log_[],
    }
    const logs: Log_[] = tx.logs.map((l) => Object.assign(l, { tx: chainTx }))
    chainTx.logs = logs
    return chainTx
  }

  async *getLogs(filter: LogFilter & { onlyFallback?: boolean }): AsyncIterableIterator<Log> {
    yield* getEvmLogs(this.provider, filter, this.destroy$)
  }

  async fetchRequestsInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return fetchCCIPRequestsInTx(this, typeof tx === 'string' ? await this.getTransaction(tx) : tx)
  }

  override fetchRequestById(
    messageId: string,
    onRamp?: string,
    opts?: { page?: number },
  ): Promise<CCIPRequest> {
    return fetchCCIPRequestById(this, messageId, { address: onRamp, ...opts })
  }

  async fetchAllMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.header.sequenceNumber'
    >,
  >(
    request: R,
    commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: { page?: number },
  ): Promise<R['message'][]> {
    let opts_: Parameters<EVMChain['getLogs']>[0] | undefined
    if (request.lane.version >= CCIPVersion.V1_6) {
      // specialized getLogs filter for v1.6 CCIPMessageSent events, to filter by dest
      opts_ = {
        ...opts,
        topics: [[request.log.topics[0]], [toBeHex(request.lane.destChainSelector, 32)]],
      }
    }
    return fetchAllMessagesInBatch(this, request, commit, opts_)
  }

  async typeAndVersion(address: string) {
    const contract = new Contract(
      address,
      VersionedContractABI,
      this.provider,
    ) as unknown as TypedContract<typeof VersionedContractABI>
    return parseTypeAndVersion(await contract.typeAndVersion())
  }

  static decodeMessage(log: {
    topics?: readonly string[]
    data: unknown
  }): CCIPMessage | undefined {
    if (!isBytesLike(log.data)) throw new Error(`invalid data=${util.inspect(log.data)}`)
    let fragments
    if (log.topics?.[0]) {
      fragments = [requestsFragments[log.topics[0] as `0x${string}`]]
      if (!fragments[0]) return
    } else {
      fragments = Object.values(requestsFragments)
    }
    let message
    for (const fragment of fragments) {
      try {
        // we don't actually use Interface instance here, `decodeEventLog` is mostly static when given a fragment
        const result = interfaces.OnRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
        message = resultsToMessage(result)
      } catch (_) {
        // try next fragment
      }
    }
    if (!message) return
    if (!isHexString(message.sender, 20)) throw new Error('could not decode CCIPMessage')

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
        if ('sourceTokenData' in message) {
          // CCIPMessage_V1_2_EVM
          try {
            tokenAmount = {
              ...parseSourceTokenData(
                (message as { sourceTokenData: string[] }).sourceTokenData[i],
              ),
              ...tokenAmount,
            }
          } catch (_) {
            console.debug(
              'legacy sourceTokenData:',
              i,
              (message as { sourceTokenData: string[] }).sourceTokenData[i],
            )
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
    log: { topics?: readonly string[]; data: unknown },
    lane?: Omit<Lane, 'destChainSelector'>,
  ): CommitReport[] | undefined {
    if (!isBytesLike(log.data)) throw new Error(`invalid data=${util.inspect(log.data)}`)
    let fragments
    if (log.topics?.[0]) {
      const fragment = commitsFragments[log.topics[0] as `0x${string}`]
      if (!fragment) return
      const isCcipV15 = fragment.name === 'ReportAccepted'
      // CCIP<=1.5 doesn't have lane info in event, so we need lane to be provided (e.g. from CommitStore's configs)
      if (isCcipV15 && !lane) throw new Error('decoding commits from CCIP<=v1.5 requires lane')
      fragments = [fragment]
    } else fragments = Object.values(commitsFragments)
    for (const fragment of fragments) {
      let result
      try {
        result = interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
      } catch (_) {
        continue
      }
      if (result.length === 1) result = result[0] as Result
      const isCcipV15 = fragment.name === 'ReportAccepted'
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
  }

  static decodeReceipt(log: {
    topics?: readonly string[]
    data: unknown
  }): ExecutionReceipt | undefined {
    if (!isBytesLike(log.data)) throw new Error(`invalid data=${util.inspect(log.data)}`)
    let fragments
    if (log.topics?.[0]) {
      fragments = [receiptsFragments[log.topics[0] as `0x${string}`]]
      if (!fragments[0]) return
    } else fragments = Object.values(receiptsFragments)
    for (const fragment of fragments) {
      try {
        const result = interfaces.OffRamp_v1_6.decodeEventLog(fragment, log.data, log.topics)
        return {
          ...result.toObject(),
          // ...(fragment.inputs.filter((p) => p.indexed).map((p, i) => [p.name, log.topics[i+1]] as const)).
          state: Number(result.state as bigint) as ExecutionState,
        } as ExecutionReceipt
      } catch (_) {
        // continue
      }
    }
  }

  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
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
      case SVMExtraArgsV1Tag: {
        const args = defaultAbiCoder.decode([SVMExtraArgsV1], dataSlice(data, 4))
        const parsed = (args[0] as Result).toObject() as SVMExtraArgsV1
        parsed.tokenReceiver = encodeBase58(parsed.tokenReceiver)
        parsed.accounts = parsed.accounts.map((a: string) => encodeBase58(a))
        return { ...parsed, _tag: 'SVMExtraArgsV1' }
      }
      case SuiExtraArgsV1Tag: {
        const args = defaultAbiCoder.decode([SuiExtraArgsV1], dataSlice(data, 4))
        const parsed = (args[0] as Result).toObject() as SuiExtraArgsV1
        return {
          ...parsed,
          receiverObjectIds: Array.from<string>(parsed.receiverObjectIds),
          _tag: 'SuiExtraArgsV1',
        }
      }
      default:
        return undefined
    }
  }

  static encodeExtraArgs(args: ExtraArgs): string {
    if (!args) return '0x'
    if ('computeUnits' in args) {
      return concat([
        SVMExtraArgsV1Tag,
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
    } else if ('receiverObjectIds' in args) {
      return concat([
        SuiExtraArgsV1Tag,
        defaultAbiCoder.encode(
          [SuiExtraArgsV1],
          [
            {
              ...args,
              tokenReceiver: zeroPadValue(getAddressBytes(args.tokenReceiver), 32),
              receiverObjectIds: args.receiverObjectIds.map((a) => getDataBytes(a)),
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

  async getTokenInfo(token: string): Promise<{ decimals: number; symbol: string; name: string }> {
    const contract = new Contract(
      token,
      interfaces.Token,
      this.provider,
    ) as unknown as TypedContract<typeof Token_ABI>
    const [symbol, decimals, name] = await Promise.all([
      contract.symbol(),
      contract.decimals(),
      contract.name(),
    ])
    return { symbol, decimals: Number(decimals), name }
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

  async _getSomeOnRampFor(router: string): Promise<string> {
    // when given a router, we take any onRamp we can find, as usually they all use same registry
    const someOtherNetwork = this.network.isTestnet
      ? this.network.name === 'ethereum-testnet-sepolia'
        ? 'avalanche-testnet-fuji'
        : 'ethereum-testnet-sepolia'
      : this.network.name === 'ethereum-mainnet'
        ? 'avalanche-mainnet'
        : 'ethereum-mainnet'
    return this.getOnRampForRouter(router, networkInfo(someOtherNetwork).chainSelector)
  }

  async getTokenAdminRegistryFor(address: string): Promise<string> {
    let [type, version, typeAndVersion] = await this.typeAndVersion(address)
    if (type === 'TokenAdminRegistry') {
      return address
    } else if (type === 'Router') {
      address = await this._getSomeOnRampFor(address)
      ;[type, version, typeAndVersion] = await this.typeAndVersion(address)
    } else if (!type.includes('Ramp')) {
      throw new Error(`Not a Router, Ramp or TokenAdminRegistry: ${address} is "${typeAndVersion}"`)
    }
    const contract = new Contract(
      address,
      version < CCIPVersion.V1_6
        ? type.includes('OnRamp')
          ? interfaces.EVM2EVMOnRamp_v1_5
          : interfaces.EVM2EVMOffRamp_v1_5
        : type.includes('OnRamp')
          ? interfaces.OnRamp_v1_6
          : interfaces.OffRamp_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof OnRamp_1_6_ABI | typeof OffRamp_1_6_ABI>
    const { tokenAdminRegistry } = await contract.getStaticConfig()
    return tokenAdminRegistry as string
  }

  async getFeeQuoterFor(address: string): Promise<string> {
    let [type, version, typeAndVersion] = await this.typeAndVersion(address)
    if (type === 'FeeQuoter') {
      return address
    } else if (type === 'Router') {
      address = await this._getSomeOnRampFor(address)
      ;[type, version, typeAndVersion] = await this.typeAndVersion(address)
    } else if (!type.includes('Ramp')) {
      throw new Error(`Not a Router, Ramp or FeeQuoter: ${address} is "${typeAndVersion}"`)
    }
    if (version < CCIPVersion.V1_6)
      throw new Error(`Version < v1.6 doesn't have feeQuoter: got=${version}`)

    const contract = new Contract(
      address,
      type.includes('OnRamp') ? interfaces.OnRamp_v1_6 : interfaces.OffRamp_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof OnRamp_1_6_ABI | typeof OffRamp_1_6_ABI>
    const { feeQuoter } = await contract.getDynamicConfig()
    return feeQuoter as string
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
    message: AnyMessage & { fee?: bigint },
    opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    if (!message.fee) message.fee = await this.getFee(router_, destChainSelector, message)
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
    const receipt = await tx.wait(1)
    return (await this.fetchRequestsInTx(await this.getTransaction(receipt!)))[0]
  }

  fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return fetchEVMOffchainTokenData(request)
  }

  async executeReport(
    offRamp: string,
    execReport: ExecutionReport,
    opts?: { wallet?: string; gasLimit?: number; tokensGasLimit?: number },
  ) {
    const [_, version] = await this.typeAndVersion(offRamp)
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
          (ta) => ({
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
    const receipt = await this.provider.waitForTransaction(manualExecTx.hash, 1, 60e3)
    if (!receipt?.hash) throw new Error(`Could not confirm exec tx: ${manualExecTx.hash}`)
    if (!receipt.status) throw new Error(`Exec transaction reverted: ${manualExecTx.hash}`)
    return this.getTransaction(receipt)
  }

  static parse(data: unknown) {
    return parseData(data)
  }

  /**
   * Get the supported tokens for a given contract address
   *
   * @param address Router, OnRamp, OffRamp or TokenAdminRegistry contract
   * @returns An array of supported token addresses.
   */
  async getSupportedTokens(registry: string, opts?: { page?: number }): Promise<string[]> {
    const contract = new Contract(
      registry,
      interfaces.TokenAdminRegistry,
      this.provider,
    ) as unknown as TypedContract<typeof TokenAdminRegistry_1_5_ABI>

    const limit = (opts?.page ?? 1000) || Number.MAX_SAFE_INTEGER
    const res = []
    let page
    do {
      page = await contract.getAllConfiguredTokens(BigInt(res.length), BigInt(limit))
      res.push(...page)
    } while (page.length === limit)
    return res as string[]
  }

  async getRegistryTokenConfig(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }> {
    const contract = new Contract(
      registry,
      interfaces.TokenAdminRegistry,
      this.provider,
    ) as unknown as TypedContract<typeof TokenAdminRegistry_1_5_ABI>

    const config = (await resultToObject(contract.getTokenConfig(token))) as CleanAddressable<
      Partial<Awaited<ReturnType<(typeof contract)['getTokenConfig']>>>
    >
    if (!config.administrator || config.administrator === ZeroAddress)
      throw new Error(`Token ${token} is not configured in registry ${registry}`)
    if (!config.pendingAdministrator || config.pendingAdministrator === ZeroAddress)
      delete config.pendingAdministrator
    if (!config.tokenPool || config.tokenPool === ZeroAddress) delete config.tokenPool
    return {
      ...config,
      administrator: config.administrator,
    }
  }

  async getTokenPoolConfigs(tokenPool: string): Promise<{
    token: string
    router: string
    typeAndVersion: string
  }> {
    const [_, , typeAndVersion] = await this.typeAndVersion(tokenPool)

    const contract = new Contract(
      tokenPool,
      interfaces.TokenPool_v1_6,
      this.provider,
    ) as unknown as TypedContract<typeof TokenPool_ABI>

    const token = contract.getToken()
    const router = contract.getRouter()
    return Promise.all([token, router]).then(([token, router]) => {
      return {
        token: token as string,
        router: router as string,
        typeAndVersion,
      }
    })
  }

  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    const [_, version] = await this.typeAndVersion(tokenPool)

    let supportedChains: Promise<NetworkInfo[]>
    if (remoteChainSelector) supportedChains = Promise.resolve([networkInfo(remoteChainSelector)])

    let remotePools: Promise<string[][]>
    let contract
    if (version < '1.5.1') {
      const contract_ = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_5,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_1_5_ABI>
      contract = contract_
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract_
              .getRemotePool(chain.chainSelector)
              .then((remotePool) => [decodeAddress(remotePool, chain.family)]),
          ),
        ),
      )
    } else {
      const contract_ = new Contract(
        tokenPool,
        interfaces.TokenPool_v1_6,
        this.provider,
      ) as unknown as TypedContract<typeof TokenPool_ABI>
      contract = contract_
      supportedChains ??= contract.getSupportedChains().then((chains) => chains.map(networkInfo))
      remotePools = supportedChains.then((chains) =>
        Promise.all(
          chains.map((chain) =>
            contract_
              .getRemotePools(chain.chainSelector)
              .then((pools) => pools.map((remotePool) => decodeAddress(remotePool, chain.family))),
          ),
        ),
      )
    }
    const remoteInfo = supportedChains.then((chains) =>
      Promise.all(
        chains.map((chain) =>
          Promise.all([
            contract.getRemoteToken(chain.chainSelector),
            resultToObject(contract.getCurrentInboundRateLimiterState(chain.chainSelector)),
            resultToObject(contract.getCurrentOutboundRateLimiterState(chain.chainSelector)),
          ] as const),
        ),
      ),
    )
    return Promise.all([supportedChains, remotePools, remoteInfo]).then(
      ([supportedChains, remotePools, remoteInfo]) =>
        Object.fromEntries(
          supportedChains.map(
            (chain, i) =>
              [
                chain.name,
                {
                  remoteToken: decodeAddress(remoteInfo[i][0], chain.family),
                  remotePools: remotePools[i].map((pool) => decodeAddress(pool, chain.family)),
                  inboundRateLimiterState: remoteInfo[i][1].isEnabled ? remoteInfo[i][1] : null,
                  outboundRateLimiterState: remoteInfo[i][2].isEnabled ? remoteInfo[i][2] : null,
                },
              ] as const,
          ),
        ),
    )
  }

  async getFeeTokens(router: string) {
    const onRamp = await this._getSomeOnRampFor(router)
    const [_, version] = await this.typeAndVersion(onRamp)
    let tokens
    let onRampIface: Interface
    switch (version) {
      case CCIPVersion.V1_2:
        onRampIface = interfaces.EVM2EVMOnRamp_v1_2
      // falls through
      case CCIPVersion.V1_5: {
        onRampIface ??= interfaces.EVM2EVMOnRamp_v1_5
        const fragment = onRampIface.getEvent('FeeConfigSet')!
        const tokens_ = new Set()
        for await (const log of this.getLogs({
          address: onRamp,
          topics: [fragment.topicHash],
          startBlock: 1,
          onlyFallback: true,
        })) {
          ;(
            onRampIface.decodeEventLog(fragment, log.data, log.topics) as unknown as {
              feeConfig: { token: string; enabled: boolean }[]
            }
          ).feeConfig.forEach(({ token, enabled }) =>
            enabled ? tokens_.add(token) : tokens_.delete(token),
          )
        }
        tokens = Array.from(tokens_)
        break
      }
      case CCIPVersion.V1_6: {
        const feeQuoter = await this.getFeeQuoterFor(onRamp)
        const contract = new Contract(
          feeQuoter,
          interfaces.FeeQuoter,
          this.provider,
        ) as unknown as TypedContract<typeof FeeQuoter_ABI>
        tokens = await contract.getFeeTokens()
        break
      }
      default:
        throw new Error(`Unsupported version: ${version}`)
    }
    return Object.fromEntries(
      await Promise.all(
        tokens.map(
          async (token) => [token as string, await this.getTokenInfo(token as string)] as const,
        ),
      ),
    )
  }

  override async *fetchExecutionReceipts(
    offRamp: string,
    request: PickDeep<CCIPRequest, 'lane' | 'message.header.messageId' | 'tx.timestamp'>,
    commit?: CCIPCommit,
    opts?: { page?: number },
  ): AsyncIterableIterator<CCIPExecution> {
    let opts_: Parameters<EVMChain['getLogs']>[0] | undefined = opts
    if (request.lane.version < CCIPVersion.V1_6) {
      opts_ = {
        ...opts,
        topics: [
          interfaces.EVM2EVMOffRamp_v1_5.getEvent('ExecutionStateChanged')!.topicHash,
          null,
          request.message.header.messageId,
        ],
        // onlyFallback: false,
      }
    } else /* >= V1.6 */ {
      opts_ = {
        ...opts,
        topics: [
          interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!.topicHash,
          toBeHex(request.lane.sourceChainSelector, 32),
          null,
          request.message.header.messageId,
        ],
        // onlyFallback: false,
      }
    }
    yield* super.fetchExecutionReceipts(offRamp, request, commit, opts_)
  }
}
