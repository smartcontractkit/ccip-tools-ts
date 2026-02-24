import type { BytesLike } from 'ethers'
import type { PickDeep } from 'type-fest'

import { type ChainContext, type GetBalanceOpts, type LogFilter, Chain } from '../chain.ts'
import {
  CCIPChainNotFoundError,
  CCIPError,
  CCIPErrorCode,
  CCIPNotImplementedError,
} from '../errors/index.ts'
import type { ExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { getMessagesInBatch } from '../requests.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type Lane,
  type Log_,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  ChainFamily,
} from '../types.ts'
import { networkInfo } from '../utils.ts'
import { type CantonClient, createCantonClient } from './client/index.ts'

export type { CantonClient, CantonClientConfig } from './client/index.ts'

const EDS_API_URL = ''

/**
 * Canton chain implementation supporting Canton Ledger networks.
 *
 */
export class CantonChain extends Chain<typeof ChainFamily.Canton> {
  static {
    supportedChains[ChainFamily.Canton] = CantonChain
  }
  static readonly family = ChainFamily.Canton
  /** Canton uses 10 decimals (lf-coin micro-units) */
  static readonly decimals = 10

  override readonly network: NetworkInfo<typeof ChainFamily.Canton>
  readonly provider: CantonClient

  /**
   * Creates a new CantonChain instance.
   * @param client - Canton Ledger API client.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   */
  constructor(
    client: CantonClient,
    network: NetworkInfo<typeof ChainFamily.Canton>,
    ctx?: ChainContext,
  ) {
    super(network, ctx)
    this.provider = client
    this.network = network
  }

  /**
   * Mapping from lower-cased synchronizer alias variants to their canonical Canton chain ID
   * as it appears in selectors.ts (e.g. `canton:MainNet`).
   */
  private static readonly SYNCHRONIZER_ALIAS_TO_CHAIN_ID: ReadonlyMap<string, string> = new Map([
    ['localnet', 'canton:LocalNet'],
    ['local', 'canton:LocalNet'],
    ['canton-localnet', 'canton:LocalNet'],
    ['devnet', 'canton:DevNet'],
    ['dev', 'canton:DevNet'],
    ['canton-devnet', 'canton:DevNet'],
    ['testnet', 'canton:TestNet'],
    ['test', 'canton:TestNet'],
    ['canton-testnet', 'canton:TestNet'],
    ['mainnet', 'canton:MainNet'],
    ['main', 'canton:MainNet'],
    ['canton-mainnet', 'canton:MainNet'],
  ])

  /**
   * Detect the Canton network and instantiate a CantonChain.
   *
   * Network detection works by querying the connected synchronizers via
   * `/v2/state/connected-synchronizers` and matching the `synchronizerAlias` of the
   * first recognised synchronizer against the known Canton chain names.
   *
   * @throws {@link CCIPChainNotFoundError} if no connected synchronizer alias maps to a known Canton chain
   */
  static async fromClient(client: CantonClient, ctx?: ChainContext): Promise<CantonChain> {
    const synchronizers = await client.getConnectedSynchronizers()

    // TODO: Check synchronizer returned aliases against known Canton chain names to determine the network.
    for (const { synchronizerAlias } of synchronizers) {
      const chainId = CantonChain.SYNCHRONIZER_ALIAS_TO_CHAIN_ID.get(
        synchronizerAlias.toLowerCase(),
      )
      if (chainId) {
        return new CantonChain(
          client,
          networkInfo(chainId) as NetworkInfo<typeof ChainFamily.Canton>,
          ctx,
        )
      }
    }

    throw new CCIPChainNotFoundError(
      synchronizers.length
        ? `canton:${synchronizers.map((s) => s.synchronizerAlias).join(', ')}`
        : 'no connected synchronizers',
    )
  }

  /**
   * Creates a CantonChain instance from a Canton Ledger JSON API URL.
   * Verifies the connection and detects the network.
   *
   * @param url - Base URL for the Canton Ledger JSON API (e.g., http://localhost:7575).
   * @param ctx - Context containing logger.
   * @returns A new CantonChain instance.
   * @throws {@link CCIPHttpError} if connection to the Canton Ledger JSON API fails
   * @throws {@link CCIPNotImplementedError} if Canton network detection is not yet implemented
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<CantonChain> {
    const client = createCantonClient({ baseUrl: url })
    try {
      const alive = await client.isAlive()
      if (!alive) throw new CCIPNotImplementedError('Canton Ledger JSON API is not alive')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `Failed to connect to Canton Ledger API ${url}: ${message}`,
      )
    }
    return CantonChain.fromClient(client, ctx)
  }

  /**
   * {@inheritDoc Chain.getBlockTimestamp}
   * @throws {@link CCIPNotImplementedError} for numeric blocks (Canton ledger uses offsets, not block numbers)
   */
  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    if (typeof block !== 'number') {
      // For 'finalized', return current time as best approximation
      return Math.floor(Date.now() / 1000)
    }
    // Canton ledger uses offset-based ordering, not block timestamps
    throw new CCIPNotImplementedError(
      `CantonChain.getBlockTimestamp: block ${block} — Canton uses ledger offsets, not block numbers`,
    )
  }

  /**
   * {@inheritDoc Chain.getTransaction}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getTransaction(_hash: string): Promise<ChainTransaction> {
    throw new CCIPNotImplementedError('CantonChain.getTransaction')
  }

  /**
   * {@inheritDoc Chain.getLogs}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  // eslint-disable-next-line require-yield
  async *getLogs(_opts: LogFilter): AsyncIterableIterator<Log_> {
    throw new CCIPNotImplementedError('CantonChain.getLogs')
  }

  /**
   * {@inheritDoc Chain.getMessagesInBatch}
   */
  override async getMessagesInBatch<
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

  /**
   * {@inheritDoc Chain.typeAndVersion}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async typeAndVersion(
    _address: string,
  ): Promise<[type: string, version: string, typeAndVersion: string, suffix?: string]> {
    throw new CCIPNotImplementedError('CantonChain.typeAndVersion')
  }

  /**
   * {@inheritDoc Chain.getRouterForOnRamp}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getRouterForOnRamp')
  }

  /**
   * {@inheritDoc Chain.getRouterForOffRamp}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getRouterForOffRamp')
  }

  /**
   * {@inheritDoc Chain.getNativeTokenForRouter}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getNativeTokenForRouter(_router: string): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getNativeTokenForRouter')
  }

  /**
   * {@inheritDoc Chain.getOffRampsForRouter}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getOffRampsForRouter(_router: string, _sourceChainSelector: bigint): Promise<string[]> {
    throw new CCIPNotImplementedError('CantonChain.getOffRampsForRouter')
  }

  /**
   * {@inheritDoc Chain.getOnRampForRouter}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getOnRampForRouter')
  }

  /**
   * {@inheritDoc Chain.getOnRampForOffRamp}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getOnRampForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getOnRampForOffRamp')
  }

  /**
   * {@inheritDoc Chain.getCommitStoreForOffRamp}
   *
   * For Canton (CCIP v1.6+), the OffRamp itself serves as the commit store.
   */
  async getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp)
  }

  /**
   * {@inheritDoc Chain.getTokenForTokenPool}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getTokenForTokenPool')
  }

  /**
   * {@inheritDoc Chain.getTokenInfo}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number }> {
    throw new CCIPNotImplementedError('CantonChain.getTokenInfo')
  }

  /**
   * {@inheritDoc Chain.getBalance}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getBalance(_opts: GetBalanceOpts): Promise<bigint> {
    throw new CCIPNotImplementedError('CantonChain.getBalance')
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getTokenAdminRegistryFor(_address: string): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getTokenAdminRegistryFor')
  }

  /**
   * {@inheritDoc Chain.getFee}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getFee(_opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    throw new CCIPNotImplementedError('CantonChain.getFee')
  }

  /**
   * {@inheritDoc Chain.generateUnsignedSendMessage}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  override generateUnsignedSendMessage(
    _opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('CantonChain.generateUnsignedSendMessage'))
  }

  /**
   * {@inheritDoc Chain.sendMessage}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async sendMessage(_opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    throw new CCIPNotImplementedError('CantonChain.sendMessage')
  }

  /**
   * {@inheritDoc Chain.getOffchainTokenData}
   */
  getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecuteReport}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  override generateUnsignedExecuteReport(
    _opts: Parameters<Chain['generateUnsignedExecuteReport']>[0],
  ): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('CantonChain.generateUnsignedExecuteReport'))
  }

  /**
   * {@inheritDoc Chain.executeReport}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async executeReport(_opts: Parameters<Chain['executeReport']>[0]): Promise<CCIPExecution> {
    throw new CCIPNotImplementedError('CantonChain.executeReport')
  }

  /**
   * {@inheritDoc Chain.getSupportedTokens}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getSupportedTokens(_address: string): Promise<string[]> {
    throw new CCIPNotImplementedError('CantonChain.getSupportedTokens')
  }

  /**
   * {@inheritDoc Chain.getRegistryTokenConfig}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getRegistryTokenConfig(_registry: string, _token: string): Promise<never> {
    throw new CCIPNotImplementedError('CantonChain.getRegistryTokenConfig')
  }

  /**
   * {@inheritDoc Chain.getTokenPoolConfig}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getTokenPoolConfig(_tokenPool: string): Promise<never> {
    throw new CCIPNotImplementedError('CantonChain.getTokenPoolConfig')
  }

  /**
   * {@inheritDoc Chain.getTokenPoolRemotes}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    throw new CCIPNotImplementedError('CantonChain.getTokenPoolRemotes')
  }

  /**
   * {@inheritDoc Chain.getFeeTokens}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  async getFeeTokens(_router: string): Promise<never> {
    throw new CCIPNotImplementedError('CantonChain.getFeeTokens')
  }

  // ─── Static methods ───────────────────────────────────────────────────────

  /**
   * Try to decode a CCIP message from a Canton log/event.
   * @returns undefined (Canton message format not yet supported)
   */
  static decodeMessage(_log: Pick<Log_, 'data'>): CCIPMessage | undefined {
    // TODO: implement Canton message decoding
    return undefined
  }

  /**
   * Try to decode extra args serialized for Canton.
   * @returns undefined (Canton extra args format not yet supported)
   */
  static decodeExtraArgs(_extraArgs: BytesLike): undefined {
    // TODO: implement Canton extra args decoding
    return undefined
  }

  /**
   * Encode extraArgs for Canton.
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  static encodeExtraArgs(_extraArgs: ExtraArgs): string {
    throw new CCIPNotImplementedError('CantonChain.encodeExtraArgs')
  }

  /**
   * Try to decode a commit report from a Canton log.
   * @returns undefined (Canton commit format not yet supported)
   */
  static decodeCommits(_log: Pick<Log_, 'data'>, _lane?: Lane): CommitReport[] | undefined {
    // TODO: implement Canton commit report decoding
    return undefined
  }

  /**
   * Try to decode an execution receipt from a Canton log.
   * @returns undefined (Canton receipt format not yet supported)
   */
  static decodeReceipt(_log: Pick<Log_, 'data'>): ExecutionReceipt | undefined {
    // TODO: implement Canton execution receipt decoding
    return undefined
  }

  /**
   * Receive bytes and try to decode as a Canton address (Daml party ID or contract ID).
   *
   * @param bytes - Bytes or string to convert.
   * @returns Canton address string.
   * @throws {@link CCIPNotImplementedError} if bytes cannot be decoded as a Canton address
   */
  static getAddress(bytes: BytesLike): string {
    if (typeof bytes === 'string') return bytes
    // TODO: implement proper Canton address decoding from bytes
    throw new CCIPNotImplementedError('CantonChain.getAddress: bytes-to-address decoding')
  }

  /**
   * Validates a transaction (update) ID format for Canton.
   * Canton update IDs are base64-encoded strings.
   */
  static isTxHash(v: unknown): v is string {
    if (typeof v !== 'string' || v.length === 0) return false
    // Canton update IDs are base64url-encoded strings, typically ~44 chars
    return /^[A-Za-z0-9+/=_-]+$/.test(v)
  }

  /**
   * Gets the leaf hasher for Canton destination chains.
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  static getDestLeafHasher(_lane: Lane, _ctx?: WithLogger): LeafHasher {
    throw new CCIPNotImplementedError('CantonChain.getDestLeafHasher')
  }

  /**
   * Build a message targeted at this Canton destination chain, populating missing fields.
   */
  static override buildMessageForDest(
    message: Parameters<(typeof Chain)['buildMessageForDest']>[0],
  ) {
    return Chain.buildMessageForDest(message)
  }
}
