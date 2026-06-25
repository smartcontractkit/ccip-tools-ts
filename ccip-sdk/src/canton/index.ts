import { type BytesLike, hexlify, id as keccak256Utf8 } from 'ethers'

import {
  type BlockInfo,
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  type RegistryTokenConfig,
  type TokenInfo,
  type TokenPoolConfig,
  type TokenPoolRemote,
  Chain,
} from '../chain.ts'
import { MAINNET_INDEXER_URLS } from '../commits.ts'
import {
  CCIPChainNotFoundError,
  CCIPError,
  CCIPErrorCode,
  CCIPNotImplementedError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { ExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVerifications,
  type ChainLog,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type Lane,
  type LeanNumbers,
  type OffchainTokenData,
  type VerifierResult,
  type WithLogger,
  CCIPVersion,
} from '../types.ts'
import { getDataBytes, sleep } from '../utils.ts'
import {
  missingTokenPoolRequiredCcvs,
  normalizeCantonCcvList,
  resolveEdsCcvAddress,
  resolveSenderRequiredCcvs,
} from './ccv-addresses.ts'
import {
  type CantonClient,
  type JsCommands,
  type JsPrepareSubmissionRequest,
  type JsSubmitAndWaitForTransactionResponse,
  type JsTransaction,
  createCantonClient,
} from './client/index.ts'
import {
  extractCantonSentEventFieldsFromLogData,
  normalizeCantonMessageId,
  parseCantonExecutionReceipt,
  parseCantonSendResult,
  resolveTimestamp,
  toBigIntSafe,
  tryParseCantonSendResult,
} from './events.ts'
import { AcsDisclosureProvider } from './explicit-disclosures/acs.ts'
import { type EdsMessage, EdsDisclosureProvider } from './explicit-disclosures/eds.ts'
import type { DisclosedContract } from './explicit-disclosures/types.ts'
import { type TokenMetadataClient, createTokenMetadataClient } from './token-metadata/client.ts'
import {
  type TransferInstructionClient,
  createTransferInstructionClient,
} from './transfer-instruction/client.ts'
import {
  type CantonExtraArgsV1,
  type CantonInstrumentId,
  type TransactionSigner,
  type UnsignedCantonTx,
  isCantonWallet,
  parseInstrumentId,
} from './types.ts'

export type {
  CantonClient,
  CantonClientConfig,
  HashingSchemeVersion,
  PartySignatures,
  Signature,
  SinglePartySignatures,
} from './client/index.ts'
export type {
  CantonCCVSendInput,
  CantonExtraArgsV1,
  CantonInstrumentId,
  CantonTokenExtraArgs,
  CantonTokenInput,
  CantonWallet,
  TransactionSigner,
  UnsignedCantonTx,
} from './types.ts'
export { isCantonWallet, parseInstrumentId } from './types.ts'

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
  readonly acsDisclosureProvider: AcsDisclosureProvider
  readonly edsDisclosureProvider: EdsDisclosureProvider
  readonly transferInstructionClient: TransferInstructionClient
  readonly tokenMetadataClient: TokenMetadataClient
  readonly indexerUrl: string
  readonly ccipParty: string
  /** Ledger party used for actAs / ACS queries (may differ from ccipParty). */
  readonly ledgerParty: string
  /** Custom fetch function supplied via ctx, used for indexer requests. Falls back to globalThis.fetch. */
  private readonly fetchFn: typeof fetch

  /** When set, used for CCV execute EDS lookups and receiver matching instead of indexer-only addresses. */
  private readonly ccvs: readonly string[]

  /**
   * Creates a new CantonChain instance.
   * @param client - Canton Ledger API client.
   * @param acsDisclosureProvider - ACS-based disclosure provider.
   * @param edsDisclosureProvider - EDS-based disclosure provider.
   * @param transferInstructionClient - Transfer Instruction API client.
   * @param tokenMetadataClient - Token Metadata API client.
   * @param ccipParty - The party ID to use for CCIP operations
   * @param indexerUrl - Base URL of the CCV indexer service.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   * @param ledgerParty - Party ID for ledger event visibility (defaults to ccipParty)
   */
  constructor(
    client: CantonClient,
    acsDisclosureProvider: AcsDisclosureProvider,
    edsDisclosureProvider: EdsDisclosureProvider,
    transferInstructionClient: TransferInstructionClient,
    tokenMetadataClient: TokenMetadataClient,
    ccipParty: string,
    indexerUrl: string,
    network: NetworkInfo<typeof ChainFamily.Canton>,
    ctx?: ChainContext,
    ledgerParty?: string,
  ) {
    super(network, ctx)
    this.provider = client
    this.network = network
    this.acsDisclosureProvider = acsDisclosureProvider
    this.edsDisclosureProvider = edsDisclosureProvider
    this.transferInstructionClient = transferInstructionClient
    this.tokenMetadataClient = tokenMetadataClient
    this.ccipParty = ccipParty
    this.ledgerParty = ledgerParty ?? ccipParty
    this.indexerUrl = indexerUrl
    this.fetchFn = ctx?.fetch ?? globalThis.fetch.bind(globalThis)
    this.ccvs = normalizeCantonCcvList(ctx?.cantonConfig?.ccvs)
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
   * Default Canton chain ID to use when the synchronizer alias is ambiguous
   * (e.g. the generic "global" alias used across all Canton environments).
   */
  private static readonly DEFAULT_CANTON_CHAIN_ID = 'canton:DevNet'

  /**
   * Detect the Canton network and instantiate a CantonChain.
   *
   * Network detection works by querying the connected synchronizers via
   * `/v2/state/connected-synchronizers` and matching the `synchronizerAlias` of the
   * first recognised synchronizer against the known Canton chain names.
   *
   * @throws {@link CCIPChainNotFoundError} if no connected synchronizer alias maps to a known Canton chain
   */
  static async fromClient(
    client: CantonClient,
    acsDisclosureProvider: AcsDisclosureProvider,
    edsDisclosureProvider: EdsDisclosureProvider,
    transferInstructionClient: TransferInstructionClient,
    tokenMetadataClient: TokenMetadataClient,
    ccipParty: string,
    indexerUrl = MAINNET_INDEXER_URLS[0]!,
    ledgerParty?: string,
    ctx?: ChainContext,
  ): Promise<CantonChain> {
    const synchronizers = await client.getConnectedSynchronizers()

    if (!synchronizers.length) {
      throw new CCIPChainNotFoundError('no connected synchronizers')
    }

    const configChainId = ctx?.cantonConfig?.chainId?.trim()
    if (configChainId) {
      ctx?.logger?.debug(
        'Canton: using chainId from canton config (skipping synchronizer alias detection):',
        configChainId,
      )
      return new CantonChain(
        client,
        acsDisclosureProvider,
        edsDisclosureProvider,
        transferInstructionClient,
        tokenMetadataClient,
        ccipParty,
        indexerUrl,
        networkInfo(configChainId) as NetworkInfo<typeof ChainFamily.Canton>,
        ctx,
        ledgerParty,
      )
    }

    // TODO: Check synchronizer returned aliases against known Canton chain names to determine the network.
    for (const { synchronizerAlias } of synchronizers) {
      const chainId = CantonChain.SYNCHRONIZER_ALIAS_TO_CHAIN_ID.get(
        synchronizerAlias.toLowerCase(),
      )
      if (chainId) {
        return new CantonChain(
          client,
          acsDisclosureProvider,
          edsDisclosureProvider,
          transferInstructionClient,
          tokenMetadataClient,
          ccipParty,
          indexerUrl,
          networkInfo(chainId) as NetworkInfo<typeof ChainFamily.Canton>,
          ctx,
          ledgerParty,
        )
      }
    }

    // fall back to the default Canton chain if there are synchronizers but none of their aliases are recognised
    if (synchronizers.length) {
      ctx?.logger?.debug(
        'Canton: no specific alias matched for synchronizers',
        synchronizers.map((s) => s.synchronizerAlias),
        '— falling back to',
        CantonChain.DEFAULT_CANTON_CHAIN_ID,
      )
      return new CantonChain(
        client,
        acsDisclosureProvider,
        edsDisclosureProvider,
        transferInstructionClient,
        tokenMetadataClient,
        ccipParty,
        indexerUrl,
        networkInfo(CantonChain.DEFAULT_CANTON_CHAIN_ID) as NetworkInfo<typeof ChainFamily.Canton>,
        ctx,
        ledgerParty,
      )
    }

    throw new CCIPChainNotFoundError(
      `canton:${synchronizers.map((s) => s.synchronizerAlias).join(', ')}`,
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
    // Check that ctx has the necessary cantonConfig
    if (!ctx || !ctx.cantonConfig || typeof ctx.cantonConfig.jwt !== 'string') {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.fromUrl: ctx.cantonConfig is required',
      )
    }

    const fetchFn = ctx.fetch
    const client = createCantonClient({
      baseUrl: url,
      jwt: ctx.cantonConfig.jwt,
      signal: ctx.abort,
      fetch: fetchFn,
    })
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
    const acsDisclosureProvider = new AcsDisclosureProvider(client, {
      party: ctx.cantonConfig.party,
      packages: ctx.cantonConfig.packages,
      ccvs: ctx.cantonConfig.ccvs,
    })
    const edsDisclosureProvider = new EdsDisclosureProvider({
      edsBaseUrl: ctx.cantonConfig.edsUrl,
      externalEdsUrlsByOwner: ctx.cantonConfig.externalEdsUrlsByOwner,
    })
    const transferInstructionClient = createTransferInstructionClient({
      baseUrl: ctx.cantonConfig.transferInstructionUrl,
      jwt: ctx.cantonConfig.jwt,
    })
    const tokenMetadataClient = createTokenMetadataClient({
      baseUrl: ctx.cantonConfig.transferInstructionUrl,
      jwt: ctx.cantonConfig.jwt,
    })
    return CantonChain.fromClient(
      client,
      acsDisclosureProvider,
      edsDisclosureProvider,
      transferInstructionClient,
      tokenMetadataClient,
      ctx.cantonConfig.ccipParty,
      ctx.cantonConfig.indexerUrl ?? '',
      ctx.cantonConfig.party,
      ctx,
    )
  }

  /**
   * {@inheritDoc Chain.getBlockInfo}
   * @throws {@link CCIPNotImplementedError} Canton ledger uses offsets, not block numbers
   */
  getBlockInfo(block: number | 'finalized' | 'latest'): Promise<BlockInfo> {
    throw new CCIPNotImplementedError(
      `CantonChain.getBlockInfo: block ${block} — Canton uses ledger offsets, not block numbers`,
    )
  }

  /**
   * Fetches a Canton transaction (update) by its update ID.
   *
   * The ledger is queried via `/v2/updates/transaction-by-id` scoped to
   * {@link ledgerParty} so restricted participant nodes allow the lookup.
   *
   * Canton concepts are mapped to {@link ChainTransaction} fields as follows:
   * - `hash`        — the Canton `updateId`
   * - `blockNumber` — the ledger `offset`
   * - `timestamp`   — `effectiveAt` parsed to Unix seconds
   * - `from`        — first `actingParties` entry of the first exercised event
   * - `logs`        — one {@link ChainLog} per transaction event
   *
   * @param hash - The Canton update ID (transaction hash) to look up.
   * @returns A {@link ChainTransaction} with events mapped to logs.
   */
  async getTransaction(hash: string): Promise<ChainTransaction> {
    const tx: JsTransaction = await this.provider.getTransactionById(hash, this.ledgerParty)

    const timestamp = tx.effectiveAt
      ? Math.floor(new Date(tx.effectiveAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000)

    // Extract the submitter from the first exercised event's actingParties.
    let from = ''
    for (const event of tx.events) {
      const ev = event as Record<string, unknown>
      const exercised = ev['ExercisedEvent'] as Record<string, unknown> | undefined
      if (
        exercised?.actingParties &&
        Array.isArray(exercised.actingParties) &&
        exercised.actingParties.length > 0
      ) {
        from = String(exercised.actingParties[0])
        break
      }
    }

    // Build one ChainLog per event.  Events can be
    // { CreatedEvent: ... }, { ExercisedEvent: ... }, or { ArchivedEvent: ... }.
    const logs: ChainLog[] = tx.events.map((event, index) => {
      const ev = event as Record<string, unknown>
      const inner = (ev['CreatedEvent'] ??
        ev['ExercisedEvent'] ??
        ev['ArchivedEvent'] ??
        ev) as Record<string, unknown>
      const templateId = typeof inner['templateId'] === 'string' ? inner['templateId'] : ''
      return {
        address: templateId,
        transactionHash: hash,
        index,
        blockNumber: tx.offset,
        blockTimestamp: timestamp,
        topics: templateId ? [templateId] : [],
        data: inner,
      }
    })

    return {
      hash,
      blockNumber: tx.offset,
      timestamp,
      from,
      logs,
    }
  }

  /**
   * {@inheritDoc Chain.getLogs}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getLogs(_opts: LeanNumbers<LogFilter>): AsyncIterableIterator<ChainLog> {
    throw new CCIPNotImplementedError('CantonChain.getLogs')
  }

  /**
   * {@inheritDoc Chain.typeAndVersion}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  typeAndVersion(
    _address: string,
  ): Promise<[type: string, version: string, typeAndVersion: string, suffix?: string]> {
    throw new CCIPNotImplementedError('CantonChain.typeAndVersion')
  }

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(
    _onRamp: string,
    _destChainSelector: bigint,
  ): ReturnType<Chain['getOnRampConfig']> {
    throw new CCIPNotImplementedError('CantonChain.getOnRampConfig')
  }

  /** {@inheritDoc Chain.getOffRampConfig} */
  async getOffRampConfig(
    _offRamp: string,
    _sourceChainSelector: bigint,
  ): ReturnType<Chain['getOffRampConfig']> {
    throw new CCIPNotImplementedError('CantonChain.getOffRampConfig')
  }

  /**
   * Returns Canton's default fee token.
   *
   * Canton's default fee token is registry-level (not router-level): the
   * Amulet instrument exposed by the token-metadata registry.
   */
  async getNativeTokenForRouter(_router: string): Promise<string> {
    return this.getDefaultFeeToken()
  }

  /**
   * {@inheritDoc Chain.getOffRampsForRouter}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getOffRampsForRouter(_router: string, _sourceChainSelector: bigint): Promise<string[]> {
    throw new CCIPNotImplementedError('CantonChain.getOffRampsForRouter')
  }

  /**
   * {@inheritDoc Chain.getOnRampForRouter}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getOnRampForRouter')
  }

  /**
   * Returns token symbol and decimals for the given Canton fee token.
   *
   * Looks up the instrument in the Canton token-metadata registry. `token` is
   * the full Canton fee-token string (`"admin::id"`); the registry is keyed by
   * the local `id` portion.
   */
  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    const { id } = parseInstrumentId(token)
    try {
      const instrument = await this.tokenMetadataClient.getInstrument(id)
      return { symbol: instrument.symbol, decimals: instrument.decimals }
    } catch (error) {
      // scan-proxy only lists Amulet-registry instruments; CCIP-owned tokens (e.g. link-token)
      // are absent but still use Canton 10-decimal holding amounts.
      if (CCIPError.isCCIPError(error) && error.context['statusCode'] === 404) {
        return { symbol: id, decimals: CantonChain.decimals }
      }
      throw error
    }
  }

  /**
   * {@inheritDoc Chain.getBalance}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getBalance(_opts: GetBalanceOpts): Promise<bigint> {
    throw new CCIPNotImplementedError('CantonChain.getBalance')
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getTokenAdminRegistryFor')
  }

  /**
   * Returns the CCIP fee for sending a message.
   *
   * Canton has no scalar upfront CCIP fee — the cost is computed inside the
   * on-chain command at send time. Returns `0n` so `--only-get-fee` and the
   * balance check both pass cleanly.
   */
  getFee(_opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    return Promise.resolve(0n)
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  override async generateUnsignedSendMessage(
    opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<UnsignedCantonTx> {
    const { sender, destChainSelector, message } = opts

    // --- validate inputs ---
    if (!sender) {
      throw new CCIPError(
        CCIPErrorCode.WALLET_INVALID,
        'CantonChain.generateUnsignedSendMessage: sender (party ID) is required',
      )
    }

    if (!message.feeToken) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.generateUnsignedSendMessage: message.feeToken is required ' +
          '(use "admin::tokenId" format, e.g. "registryAdmin::Amulet")',
      )
    }

    const cantonArgs = message.extraArgs as CantonExtraArgsV1 | undefined
    if (!cantonArgs?.feeTokenHoldingCids.length) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.generateUnsignedSendMessage: message.extraArgs.feeTokenHoldingCids is required. ' +
          'Pass at least one fee-token holding contract ID in extraArgs.',
      )
    }

    // --- parse fields ---
    const feeInstrument = parseInstrumentId(message.feeToken)
    const receiverHex = stripHexPrefix(
      typeof message.receiver === 'string' ? message.receiver : hexlify(message.receiver),
    )
    const payloadHex = message.data
      ? stripHexPrefix(typeof message.data === 'string' ? message.data : hexlify(message.data))
      : ''
    const gasLimit = cantonArgs.gasLimit ?? 200_000n
    const feeTokenHoldingCids = cantonArgs.feeTokenHoldingCids
    const senderRequiredCCVs = resolveSenderRequiredCcvs(cantonArgs.ccvRawAddresses, this.ccvs)
    if (cantonArgs.ccvRawAddresses === undefined && this.ccvs.length) {
      this.logger.debug(
        'CantonChain.generateUnsignedSendMessage: using ccvs from canton config for senderRequiredCCVs',
        this.ccvs,
      )
    }

    this.logger.debug('CantonChain.generateUnsignedSendMessage: fetching ACS disclosures')

    const tokenAmounts = message.tokenAmounts ?? []
    if (tokenAmounts.length > 1) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.generateUnsignedSendMessage: only one token transfer is supported, got ${tokenAmounts.length}`,
      )
    }

    this.logger.debug(
      'CantonChain.generateUnsignedSendMessage: fetching registry admin from Token Metadata API',
    )
    const [acsDisclosures, registryInfo] = await Promise.all([
      this.acsDisclosureProvider.fetchSendDisclosures(),
      this.tokenMetadataClient.getRegistryInfo(),
    ])
    const registryAdmin = registryInfo.adminId

    this.logger.debug(
      `CantonChain.generateUnsignedSendMessage: registry admin is ${registryAdmin}, fetching transfer factory...`,
    )

    this.logger.debug(
      'CantonChain.generateUnsignedSendMessage: fetching transfer factory from Transfer Instruction API',
    )
    const feeTransferFactory = await this.getTransferFactoryForInstrument({
      registryAdmin,
      sender,
      receiver: this.ccipParty,
      instrumentId: feeInstrument,
    })

    let messageTokenTransfer: Record<string, unknown> | null = null
    let tokenTransferInput: Record<string, unknown> | null = null
    let tokenTransferDisclosures: DisclosedContract[] = []
    let tokenPoolRequiredCCVs: string[] = []

    if (tokenAmounts.length === 1) {
      const tokenAmount = tokenAmounts[0]!
      if (tokenAmount.amount <= 0n) {
        throw new CCIPError(
          CCIPErrorCode.METHOD_UNSUPPORTED,
          'CantonChain.generateUnsignedSendMessage: token transfer amount must be greater than zero',
        )
      }

      const tokenInstrument = parseInstrumentId(tokenAmount.token)
      const tokenAmountDecimal = formatCantonDecimal(tokenAmount.amount)
      messageTokenTransfer = {
        token: { admin: tokenInstrument.admin, id: tokenInstrument.id },
        amount: tokenAmountDecimal,
      }

      const tokenPoolAddress = await this.edsDisclosureProvider.lookupTokenPool(
        hashCantonInstrumentId(tokenInstrument),
      )
      if (!tokenPoolAddress) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `CantonChain.generateUnsignedSendMessage: no token pool registered for ${formatInstrumentId(tokenInstrument)}`,
        )
      }
      if (
        cantonArgs.tokenPoolAddress &&
        !sameRawOrHashedAddress(cantonArgs.tokenPoolAddress, tokenPoolAddress)
      ) {
        throw new CCIPError(
          CCIPErrorCode.METHOD_UNSUPPORTED,
          `CantonChain.generateUnsignedSendMessage: tokenPoolAddress ${cantonArgs.tokenPoolAddress} does not match registry token pool ${tokenPoolAddress}`,
        )
      }

      const tokenPoolEdsMessage = buildEdsMessage({
        destChainSelector,
        receiverHex,
        payloadHex,
        feeInstrument,
        tokenTransfer: messageTokenTransfer,
      })

      const [tokenHoldings, tokenPoolSend] = await Promise.all([
        this.resolveTokenTransferHoldings({
          party: sender,
          instrumentId: tokenInstrument,
          explicitHoldingCids: cantonArgs.tokenTransferHoldingCids,
          feeTokenHoldingCids,
          requiredAmount: tokenAmount.amount,
        }),
        this.edsDisclosureProvider.fetchTokenPoolSendDisclosure(
          tokenPoolAddress,
          tokenPoolEdsMessage,
        ),
      ])

      tokenPoolRequiredCCVs = tokenPoolSend.requiredCCVs
      tokenTransferInput = {
        senderInputCids: tokenHoldings.map((holding) => holding.contractId),
        tokenPoolCid: tokenPoolSend.contractId,
        poolExtraContext: tokenPoolSend.contextData,
      }
      tokenTransferDisclosures = [
        ...tokenHoldings.map((holding) => holding.disclosedContract),
        ...tokenPoolSend.disclosedContracts,
      ]
    }

    const edsMessage = buildEdsMessage({
      destChainSelector,
      receiverHex,
      payloadHex,
      feeInstrument,
      tokenTransfer: messageTokenTransfer,
    })

    this.logger.debug('CantonChain.generateUnsignedSendMessage: fetching global EDS send data')
    const edsResult = await this.edsDisclosureProvider.fetchSendDisclosures(
      edsMessage,
      senderRequiredCCVs,
      tokenPoolRequiredCCVs,
    )

    const ccvSendResults = await Promise.all(
      edsResult.ccvs.map((ccvAddress) =>
        this.edsDisclosureProvider.fetchCcvSendDisclosure(ccvAddress, edsMessage),
      ),
    )

    let executorInput: Record<string, unknown> | null = null
    let executorDisclosures: DisclosedContract[] = []
    if (edsResult.executor) {
      const executorResult = await this.edsDisclosureProvider.fetchExecutorSendDisclosure(
        edsResult.executor,
        edsMessage,
        ccvSendResults.map((ccv) => ccv.instanceAddress),
      )
      executorInput = {
        executorCid: executorResult.contractId,
        executorExtraContext: executorResult.contextData,
      }
      executorDisclosures = executorResult.disclosedContracts
    }

    const ccvSendInputsForDaml = ccvSendResults.map((ccv) => ({
      ccvAddress: { unpack: ccv.rawInstanceAddress },
      ccvCid: ccv.contractId,
      ccvExtraContext: ccv.contextData,
    }))

    const ccvExtraArgs = ccvSendResults.map((ccv) => ({
      ccvAddress: { unpack: ccv.rawInstanceAddress },
      ccvArgs: '',
    }))

    if (!edsResult.feeTokenConfigCid) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'CantonChain.generateUnsignedSendMessage: EDS did not return feeTokenConfigCid; ' +
          'ensure the fee token is registered in TokenAdminRegistry',
      )
    }

    const choiceArgument: Record<string, unknown> = {
      // top-level Send fields (from CCIPSender.Send Daml struct)
      destinationChainSelector: destChainSelector.toString(),
      context: edsResult.contextData,
      routerCid: acsDisclosures.perPartyRouter.contractId,
      // Canton2AnyMessage nested under `message`
      message: {
        receiver: receiverHex,
        payload: payloadHex,
        tokenTransfer: messageTokenTransfer,
        feeToken: { admin: feeInstrument.admin, id: feeInstrument.id },
        extraArgs: {
          tag: 'V3',
          value: {
            gasLimit: encodeDamlInt64(gasLimit),
            ccvs: ccvExtraArgs,
            executor: { tag: 'Executor_UseDefault', value: { executorArgs: '' } },
            tokenReceiver: '',
            tokenArgs: '',
          },
        },
      },
      feeTokenInput: {
        senderInputCids: feeTokenHoldingCids,
        feeTokenTransferFactory: feeTransferFactory.factoryId,
        feeTokenConfigCid: edsResult.feeTokenConfigCid,
        feeTokenExtraArgs: {
          context: { values: feeTransferFactory.contextValues },
          meta: { values: {} },
        },
      },
      ccvSendInputs: ccvSendInputsForDaml,
      tokenTransferInput,
      executorInput,
    }

    const allDisclosedRaw: DisclosedContract[] = [
      acsDisclosures.perPartyRouter,
      acsDisclosures.ccipSender,
      ...edsResult.disclosedContracts,
      ...ccvSendResults.flatMap((ccv) => ccv.disclosedContracts),
      ...executorDisclosures,
      ...feeTransferFactory.disclosedContracts,
      ...tokenTransferDisclosures,
    ]
    const allDisclosed = dedupeDisclosedContracts(allDisclosedRaw)

    const exerciseCommand = {
      ExerciseCommand: {
        templateId: acsDisclosures.ccipSender.templateId,
        contractId: acsDisclosures.ccipSender.contractId,
        choice: 'Send',
        choiceArgument,
      },
    }

    const jsCommands: JsCommands = {
      commands: [exerciseCommand],
      commandId: `ccip-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [sender],
      disclosedContracts: allDisclosed.map((dc) => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: dc.synchronizerId,
      })),
    }

    this.logger.debug(
      `CantonChain.generateUnsignedSendMessage: built command with ${allDisclosed.length} disclosed contracts`,
    )

    return {
      family: ChainFamily.Canton,
      commands: jsCommands,
    }
  }

  /**
   * {@inheritDoc Chain.sendMessage}
   */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    const { wallet } = opts
    if (!isCantonWallet(wallet)) {
      throw new CCIPWalletInvalidError(wallet)
    }

    const message = await this.fillCantonSendDefaults(opts.message, wallet.party)

    const unsigned = await this.generateUnsignedSendMessage({
      ...opts,
      message,
      sender: wallet.party,
    })

    this.logger.debug(`CantonChain.sendMessage: submitting command`)

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.submitCommands(unsigned.commands, wallet.signer)
    const txRecord = response.transaction as Record<string, unknown>
    const updateId: string =
      (typeof txRecord.update_id === 'string' ? txRecord.update_id : null) ??
      (typeof txRecord.updateId === 'string' ? txRecord.updateId : '')

    this.logger.debug(`CantonChain.sendMessage: submitted, updateId=${updateId}`)

    // Parse CCIPMessageSent from the transaction events
    const sendResult = parseCantonSendResult(response.transaction, updateId)
    const timestamp = resolveTimestamp(txRecord)

    // Build the Lane
    const lane: Lane = {
      sourceChainSelector: this.network.chainSelector,
      destChainSelector: opts.destChainSelector,
      onRamp: sendResult.onRampAddress ?? '',
      version: CCIPVersion.V2_0,
    }

    const log: ChainLog = {
      topics: [],
      index: 0,
      address: '',
      blockNumber: 0,
      blockTimestamp: timestamp,
      transactionHash: updateId,
      data: response.transaction,
    }

    const tx: Omit<ChainTransaction, 'logs'> = {
      hash: updateId,
      blockNumber: 0,
      timestamp,
      from: wallet.party,
    }

    const ccipMessage = {
      messageId: sendResult.messageId,
      encodedMessage: sendResult.encodedMessage,
      sourceChainSelector: this.network.chainSelector,
      destChainSelector: opts.destChainSelector,
      sequenceNumber: sendResult.sequenceNumber,
      nonce: sendResult.nonce ?? 0n,
      sender: wallet.party,
      receiver:
        typeof opts.message.receiver === 'string'
          ? opts.message.receiver
          : String(opts.message.receiver),
      data: sendResult.encodedMessage,
      tokenAmounts: (opts.message.tokenAmounts ?? []) as readonly {
        token: string
        amount: bigint
      }[],
      feeToken: message.feeToken ?? '',
      feeTokenAmount: 0n,
    } as unknown as CCIPMessage

    return { lane, message: ccipMessage, log, tx }
  }

  /**
   * {@inheritDoc Chain.getOffchainTokenData}
   */
  override getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return Promise.resolve(request.message.tokenAmounts.map(() => undefined))
  }

  /**
   * Builds a Canton `JsCommands` payload that exercises the `Execute` choice on
   * the caller's `CCIPReceiver` contract.  The command includes:
   *
   * 1. **ACS disclosures** – same-party contracts (`PerPartyRouter`,
   *    `CCIPReceiver`) fetched via {@link AcsDisclosureProvider}.
   * 2. **EDS disclosures** – cross-party contracts (OffRamp, GlobalConfig,
   *    TokenAdminRegistry, RMNRemote, CCVs) fetched via
   *    {@link EdsDisclosureProvider}.
   * 3. **Choice argument** – assembled from the encoded CCIP message,
   *    verification data, and the opaque `contextData` returned by the EDS.
   *
   * @param opts - Must use the `offRamp` + `input` variant of {@link ExecuteOpts}.
   *   `input` must contain `encodedMessage` and `verifications` (CCIP v2.0).
   *   `payer` is the Daml party ID used for `actAs`.
   * @returns An {@link UnsignedCantonTx} wrapping the ready-to-submit
   *   `JsCommands`.
   */
  override async generateUnsignedExecute(
    opts: Parameters<Chain['generateUnsignedExecute']>[0],
  ): Promise<UnsignedCantonTx> {
    // --- validate opts shape ---
    if (!('offRamp' in opts) || !('input' in opts)) {
      throw new CCIPNotImplementedError(
        'CantonChain.generateUnsignedExecute: messageId-based execution is not supported; ' +
          'provide offRamp + input instead',
      )
    }

    const { input, payer } = opts
    if (!payer) {
      throw new CCIPError(
        CCIPErrorCode.WALLET_INVALID,
        'CantonChain.generateUnsignedExecute: payer (party ID) is required',
      )
    }

    // v2.0 input shape: { encodedMessage, verifications }
    if (!('encodedMessage' in input) || !('verifications' in input)) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.generateUnsignedExecute: only CCIP v2.0 ExecutionInput ' +
          '(encodedMessage + verifications) is supported',
      )
    }

    const { encodedMessage, verifications } = input

    const encodedMessageHex = stripHexPrefix(String(encodedMessage))

    this.logger.debug('CantonChain.generateUnsignedExecute: fetching global EDS execute data...')
    const edsResult = await this.edsDisclosureProvider.fetchExecutionDisclosures(encodedMessageHex)
    // Step 2 — Fetch same-party disclosures (PerPartyRouter + CCIPReceiver)
    // TODO: This should include receiverCid when provided. We need to figure out how to get that from the input or opts.
    this.logger.debug(
      'CantonChain.generateUnsignedExecute: fetching ACS disclosures for CCIPReceiver and PerPartyRouter...',
    )
    // Check opts for a pre-resolved receiver CID (threaded from execute() after find/create).
    const cantonOpts = opts as typeof opts & { _cantonReceiverCid?: string }
    const acsDisclosures = await this.acsDisclosureProvider.fetchExecutionDisclosures(
      cantonOpts._cantonReceiverCid,
    )

    const ccvExecuteResults = await Promise.all(
      verifications.map((v) => {
        const ccvAddress = resolveEdsCcvAddress(v.destAddress, this.ccvs)
        if (this.ccvs.length && ccvAddress !== v.destAddress) {
          this.logger.debug(
            'CantonChain.generateUnsignedExecute: using ccvs config override for EDS',
            { override: ccvAddress, verifierDestAddress: v.destAddress },
          )
        }
        return this.edsDisclosureProvider.fetchCcvExecuteDisclosure(ccvAddress, encodedMessageHex)
      }),
    )

    const ccvInputs = verifications.map((v, index) => {
      const ccv = ccvExecuteResults[index]!
      return {
        ccvCid: ccv.contractId,
        verifierResults: stripHexPrefix(String(v.ccvData)),
        ccvExtraContext: ccv.contextData,
      }
    })

    let tokenTransferInput: Record<string, unknown> | null = null
    let tokenTransferDisclosures: DisclosedContract[] = []
    if (edsResult.tokenPool) {
      this.logger.debug(
        'CantonChain.generateUnsignedExecute: token pool present; fetching token release EDS data...',
      )
      const tokenPoolExecute = await this.edsDisclosureProvider.fetchTokenPoolExecuteDisclosure(
        edsResult.tokenPool,
        encodedMessageHex,
      )
      assertRequiredCcvsCovered(
        tokenPoolExecute.requiredCCVs,
        verifications.map((v) => v.destAddress),
        this.ccvs,
      )

      tokenTransferInput = {
        tokenPoolCid: tokenPoolExecute.contractId,
        tokenReceiverParty: payer,
        poolExtraContext: tokenPoolExecute.contextData,
      }
      tokenTransferDisclosures = tokenPoolExecute.disclosedContracts
    }

    // The global EDS contextData is passed as the Execute choice context.
    const choiceArgument: Record<string, unknown> = {
      context: edsResult.contextData,
      routerCid: acsDisclosures.perPartyRouter.contractId,
      encodedMessage: encodedMessageHex,
      tokenTransfer: tokenTransferInput,
      ccvInputs,
    }

    // Step 6 — Merge all disclosed contracts (dedup by contractId)
    const allDisclosedRaw: DisclosedContract[] = [
      acsDisclosures.perPartyRouter,
      acsDisclosures.ccipReceiver,
      ...edsResult.disclosedContracts,
      ...ccvExecuteResults.flatMap((ccv) => ccv.disclosedContracts),
      ...tokenTransferDisclosures,
    ]
    const allDisclosed = dedupeDisclosedContracts(allDisclosedRaw)

    // Step 7 — Build the ExerciseCommand
    const exerciseCommand = {
      ExerciseCommand: {
        templateId: acsDisclosures.ccipReceiver.templateId,
        contractId: acsDisclosures.ccipReceiver.contractId,
        choice: 'Execute',
        choiceArgument,
      },
    }

    // Step 8 — Assemble JsCommands
    const jsCommands: JsCommands = {
      commands: [exerciseCommand],
      commandId: `ccip-execute-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [payer],
      disclosedContracts: allDisclosed.map((dc) => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: dc.synchronizerId,
      })),
    }

    return {
      family: ChainFamily.Canton,
      commands: jsCommands,
    }
  }

  /**
   * Executes a CCIP message on Canton by:
   * 1. Validating the wallet as a {@link CantonWallet}.
   * 2. Building the unsigned command via {@link generateUnsignedExecute}.
   * 3. Submitting the command to the Canton Ledger API.
   * 4. Parsing the resulting transaction into a {@link CCIPExecution}.
   *
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid {@link CantonWallet}
   * @throws {@link CCIPError} if the Ledger API submission or result parsing fails
   */
  async execute(opts: Parameters<Chain['execute']>[0]): Promise<CCIPExecution> {
    const { wallet } = opts
    if (!isCantonWallet(wallet)) {
      throw new CCIPWalletInvalidError(wallet)
    }

    // Decode the message finality and find/create a compatible CCIPReceiver.
    const inputOpts = opts as { input?: { encodedMessage?: string } }
    const encodedMessageHex = inputOpts.input?.encodedMessage ?? ''
    const finality = decodeFinalityFromEncodedMessage(encodedMessageHex)
    const receiverHint = typeof opts.receiver === 'string' ? opts.receiver.trim() : ''
    this.logger.debug(
      `CantonChain.execute: message finality=${finality}, resolving CCIPReceiver` +
        (receiverHint ? ` (hint=${receiverHint})` : '') +
        '...',
    )

    const resolvedReceiver = await this.acsDisclosureProvider.resolveReceiverForExecute(
      finality,
      receiverHint || undefined,
    )
    let receiverCid = resolvedReceiver?.contractId
    if (!receiverCid) {
      this.logger.debug(
        `CantonChain.execute: no CCIPReceiver with minBlockConfirmations=${finality} found in ACS — creating one`,
      )
      receiverCid = await this.createReceiverForFinality(wallet.party, finality, wallet.signer)
    } else {
      this.logger.debug(`CantonChain.execute: using CCIPReceiver contractId=${receiverCid}`)
    }

    // Build the unsigned command, passing the resolved receiver CID via Canton-specific opts.
    const unsigned = await this.generateUnsignedExecute({
      ...opts,
      payer: wallet.party,
      _cantonReceiverCid: receiverCid,
    } as unknown as Parameters<Chain['generateUnsignedExecute']>[0])

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.submitCommands(unsigned.commands, wallet.signer)
    const txRecord = response.transaction as Record<string, unknown>
    const updateId: string =
      (typeof txRecord.update_id === 'string' ? txRecord.update_id : null) ??
      (typeof txRecord.updateId === 'string' ? txRecord.updateId : '')

    // Parse execution receipt from the transaction events
    const receipt = parseCantonExecutionReceipt(response.transaction, updateId)
    const timestamp = resolveTimestamp(txRecord)

    // Build a synthetic ChainLog — Canton doesn't have EVM-style logs, but the
    // SDK contract expects a ChainLog in the CCIPExecution.
    const log: ChainLog = {
      topics: [],
      index: 0,
      address: '',
      blockNumber: response.transaction.offset,
      blockTimestamp: timestamp,
      transactionHash: updateId,
      data: response.transaction,
    }

    return { receipt, log }
  }

  // ─── Internal submission helper ─────────────────────────────────────────

  /**
   * Build a prepare-submission request with synchronizer and package preferences
   * required by prod Canton participants for interactive signing.
   */
  private async buildPrepareRequest(commands: JsCommands): Promise<JsPrepareSubmissionRequest> {
    const synchronizerId = await this.resolveSubmissionSynchronizerId(commands)
    const packageNames = this.resolvePackageNamesForCommands(commands)
    const packageIdSelectionPreference = await this.provider.getPreferredPackageIds(
      commands.actAs,
      packageNames,
      synchronizerId,
    )
    if (packageIdSelectionPreference.length === 0) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'CantonChain: unable to resolve packageIdSelectionPreference for prepare submission',
      )
    }

    return {
      commandId: commands.commandId,
      commands: commands.commands,
      actAs: commands.actAs,
      readAs: commands.readAs,
      disclosedContracts: commands.disclosedContracts,
      synchronizerId,
      packageIdSelectionPreference,
      hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3',
    }
  }

  /** Resolve synchronizerId for interactive prepare when commands omit it explicitly. */
  private async resolveSubmissionSynchronizerId(commands: JsCommands): Promise<string> {
    if (commands.synchronizerId) return commands.synchronizerId

    const fromDisclosed = commands.disclosedContracts
      ?.map((dc) => dc.synchronizerId)
      .find((id) => typeof id === 'string' && id.length > 0)
    if (fromDisclosed) return fromDisclosed

    const synchronizers = await this.provider.getConnectedSynchronizers()
    const synchronizerId = synchronizers[0]?.synchronizerId
    if (!synchronizerId) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'CantonChain: unable to resolve synchronizerId for prepare submission',
      )
    }
    return synchronizerId
  }

  /** Collect DAR package names referenced by command template IDs for prepare submission. */
  private resolvePackageNamesForCommands(commands: JsCommands): string[] {
    const names = new Set<string>([
      ...packageNamesFromTemplateRefs(commands),
      ...CANTON_SEND_PACKAGE_NAMES,
    ])
    return [...names]
  }

  /**
   * Submit a command to the ledger, using external signing when a
   * {@link TransactionSigner} is provided.
   *
   * - **No signer**: delegates to `submitAndWaitForTransaction` (direct submit).
   * - **With signer**: uses the interactive submission API:
   *   1. Prepare the transaction (`/v2/interactive-submission/prepare`).
   *   2. Decode the hash and call `signer.sign(hashBytes)`.
   *   3. Execute the signed transaction (`/v2/interactive-submission/executeAndWaitForTransaction`).
   */
  private async submitCommands(
    commands: JsCommands,
    signer?: TransactionSigner,
  ): Promise<JsSubmitAndWaitForTransactionResponse> {
    if (!signer) {
      return this.provider.submitAndWaitForTransaction(commands)
    }

    // Step 1 — Prepare the transaction
    const prepareRequest = await this.buildPrepareRequest(commands)

    const prepareResponse = await this.provider.prepareSubmission(prepareRequest)

    if (!prepareResponse.preparedTransaction || !prepareResponse.preparedTransactionHash) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'prepareSubmission returned an incomplete response (missing preparedTransaction or hash)',
      )
    }

    // Step 2 — Sign the hash
    const hashBytes = getDataBytes(prepareResponse.preparedTransactionHash)
    const partySignatures = await signer.sign(hashBytes)

    // Step 3 — Execute the signed transaction
    const hashingSchemeVersion =
      prepareResponse.hashingSchemeVersion &&
      prepareResponse.hashingSchemeVersion !== 'HASHING_SCHEME_VERSION_UNSPECIFIED'
        ? prepareResponse.hashingSchemeVersion
        : 'HASHING_SCHEME_VERSION_V3'

    const executeResponse = await this.provider.executeSubmissionAndWaitForTransaction({
      preparedTransaction: prepareResponse.preparedTransaction,
      partySignatures,
      deduplicationPeriod: { Empty: {} },
      hashingSchemeVersion,
      submissionId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    })

    return executeResponse
  }

  /**
   * Find or create a `CCIPReceiver` contract whose `minBlockConfirmations` equals `finality`.
   *
   * The `OffRamp.PrepareExecute` Daml choice rejects messages whose `finality` field does not
   * match the receiver's `minBlockConfirmations`, so each distinct finality value needs its own
   * receiver instance.  This method first searches the ACS; if no match is found it creates a
   * fresh contract (mirroring the Go `deployReceiver` helper in the staging script).
   */
  private async createReceiverForFinality(
    payer: string,
    finality: number,
    signer?: TransactionSigner,
  ): Promise<string> {
    const attempts = 4
    let lastError: unknown

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const instanceId = `receiver-finality${finality}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const createCmd: JsCommands = {
        commands: [
          {
            CreateCommand: {
              templateId: '#ccip-receiver:CCIP.CCIPReceiver:CCIPReceiver',
              createArguments: {
                instanceId,
                owner: payer,
                receiverFinalityConfig: encodeFinalityConfig(finality),
                requiredCCVs: [],
                optionalCCVs: [],
                optionalThreshold: 0,
              },
            },
          },
        ],
        commandId: `ccip-create-receiver-${Date.now()}-${attempt}`,
        actAs: [payer],
      }

      try {
        this.logger.debug(
          `CantonChain.createReceiverForFinality: creating CCIPReceiver finality=${finality} instanceId=${instanceId} attempt=${attempt}/${attempts}`,
        )
        const response = await this.submitCommands(createCmd, signer)
        const tx = response.transaction as { events?: unknown[] }
        for (const event of tx.events ?? []) {
          const ev = event as Record<string, unknown>
          const created = ev['CreatedEvent'] as Record<string, unknown> | undefined
          if (typeof created?.contractId === 'string') return created.contractId
        }
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `CantonChain.createReceiverForFinality: CCIPReceiver creation produced no contract ID`,
        )
      } catch (err) {
        lastError = err
        if (attempt >= attempts || !isRetryableCantonSubmitError(err)) throw err

        const delayMs = 2_000 * attempt
        const detail =
          CCIPError.isCCIPError(err) && Object.keys(err.context).length
            ? ` context=${JSON.stringify(err.context)}`
            : ''
        this.logger.warn(
          `CantonChain.createReceiverForFinality: receiver creation failed with a retryable Canton error; retrying in ${delayMs}ms (${attempt}/${attempts})${detail}`,
        )
        await sleep(delayMs)
      }
    }

    throw CCIPError.from(lastError, CCIPErrorCode.CANTON_API_ERROR)
  }

  /**
   * Fetches CCV verification results for a CCIP message from the Canton indexer.
   * @param opts - Options that should only include the CCIP request with the message ID to query.
   * @returns CCIPVerifications with verification policy and individual verifier results.
   */
  override async getVerifications(
    opts: Parameters<Chain['getVerifications']>[0],
  ): Promise<CCIPVerifications> {
    const { request } = opts
    if (request.lane.version < CCIPVersion.V2_0) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.getVerifications: CCIP versions below v2.0 are not supported in Canton (request lane version: ${request.lane.version})`,
      )
    }

    const indexerMessageId = normalizeCantonMessageId(request.message.messageId)
    const cliIndexer = Array.isArray(opts.indexer) ? opts.indexer : undefined
    const indexerBase = resolveIndexerBaseUrl(cliIndexer, this.indexerUrl)
    if (!indexerBase) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'CantonChain.getVerifications: indexer URL is required; set canton-config indexerUrl or pass indexer option',
      )
    }
    const url = `${indexerBase.replace(/\/$/, '')}/v1/verifierresults/${indexerMessageId}`
    const res = await this.fetchFn(url)
    if (!res.ok) {
      const body = await res.text()
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton indexer responded with ${res.status} for message ${indexerMessageId} (${url})${body ? `: ${body}` : ''}`,
      )
    }

    const json = (await res.json()) as {
      success: boolean
      results: Array<{
        verifierResult: {
          message_ccv_addresses: string[]
          ccv_data: string
          timestamp: string
          verifier_source_address: string
          verifier_dest_address: string
        }
      }>
      messageID: string
    }

    if (!json.success) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton indexer returned success=false for message ${indexerMessageId}`,
      )
    }

    // message_ccv_addresses is a message-level property — identical across all results.
    // Use the first result's list as requiredCCVs; fall back to empty if no results yet.
    const requiredCCVs: string[] = json.results[0]?.verifierResult.message_ccv_addresses ?? []

    const verifications: VerifierResult[] = json.results.map(({ verifierResult: vr }) => ({
      ccvData: vr.ccv_data,
      sourceAddress: vr.verifier_source_address,
      destAddress: vr.verifier_dest_address,
      timestamp: vr.timestamp ? Math.floor(new Date(vr.timestamp).getTime() / 1000) : undefined,
    }))

    return {
      verificationPolicy: {
        requiredCCVs,
        optionalCCVs: [],
        optionalThreshold: 0,
      },
      verifications,
    }
  }

  /**
   * {@inheritDoc Chain.getSupportedTokens}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getSupportedTokens(_address: string, _opts?: { page?: number }): Promise<string[]> {
    throw new CCIPNotImplementedError('CantonChain.getSupportedTokens')
  }

  /**
   * {@inheritDoc Chain.getRegistryTokenConfig}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getRegistryTokenConfig(_registry: string, _token: string): Promise<RegistryTokenConfig> {
    throw new CCIPNotImplementedError('CantonChain.getRegistryTokenConfig')
  }

  /**
   * {@inheritDoc Chain.getTokenPoolConfig}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getTokenPoolConfig(_tokenPool: string): Promise<TokenPoolConfig> {
    throw new CCIPNotImplementedError('CantonChain.getTokenPoolConfig')
  }

  /**
   * {@inheritDoc Chain.getTokenPoolRemotes}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getTokenPoolRemotes(
    _tokenPool: string,
    _remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    throw new CCIPNotImplementedError('CantonChain.getTokenPoolRemotes')
  }

  /**
   * {@inheritDoc Chain.getFeeTokens}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getFeeTokens(_router: string): Promise<Record<string, TokenInfo>> {
    throw new CCIPNotImplementedError('CantonChain.getFeeTokens')
  }

  /**
   * Fetch a fresh Transfer Factory and choice context for a specific Canton instrument.
   */
  private async getTransferFactoryForInstrument({
    registryAdmin,
    sender,
    receiver,
    instrumentId,
    amount = '100.00',
  }: {
    registryAdmin: string
    sender: string
    receiver: string
    instrumentId: CantonInstrumentId
    amount?: string
  }): Promise<CantonTransferFactoryData> {
    const transferFactoryResponse = await this.transferInstructionClient.getTransferFactory({
      choiceArguments: {
        expectedAdmin: registryAdmin,
        transfer: {
          sender,
          receiver,
          amount,
          instrumentId: { admin: instrumentId.admin, id: instrumentId.id },
          lock: null,
          requestedAt: new Date(Date.now() - 3_600_000).toISOString(),
          executeBefore: new Date(Date.now() + 86_400_000).toISOString(),
          inputHoldingCids: [],
          meta: { values: {} },
        },
        extraArgs: {
          context: { values: {} },
          meta: { values: {} },
        },
      },
    })

    return {
      factoryId: transferFactoryResponse.factoryId,
      contextValues: extractChoiceContextValues(
        transferFactoryResponse.choiceContext.choiceContextData,
      ),
      disclosedContracts: transferFactoryResponse.choiceContext.disclosedContracts,
    }
  }

  /**
   * Resolve token-transfer sender holdings, optionally constrained to caller-supplied CIDs.
   */
  private async resolveTokenTransferHoldings({
    party,
    instrumentId,
    explicitHoldingCids,
    feeTokenHoldingCids,
    requiredAmount,
  }: {
    party: string
    instrumentId: CantonInstrumentId
    explicitHoldingCids: readonly string[] | undefined
    feeTokenHoldingCids: readonly string[]
    requiredAmount: bigint
  }): Promise<TokenHoldingDetails[]> {
    const holdings = await fetchTokenHoldings(this.provider, party, instrumentId)
    const byCid = new Map(holdings.map((holding) => [holding.contractId, holding]))

    if (explicitHoldingCids?.length) {
      const resolved = explicitHoldingCids.map((cid) => {
        const holding = byCid.get(cid)
        if (!holding) {
          throw new CCIPError(
            CCIPErrorCode.CANTON_API_ERROR,
            `CantonChain.generateUnsignedSendMessage: token transfer holding ${cid} was not found, is locked, has zero balance, or does not match ${formatInstrumentId(instrumentId)}`,
          )
        }
        return holding
      })
      for (const holding of resolved) {
        if (feeTokenHoldingCids.includes(holding.contractId)) {
          throw new CCIPError(
            CCIPErrorCode.METHOD_UNSUPPORTED,
            `CantonChain.generateUnsignedSendMessage: fee holding and token transfer holding must be different contracts (${holding.contractId})`,
          )
        }
      }
      return resolved
    }

    const feeCidSet = new Set(feeTokenHoldingCids)
    const requiredAmountDecimal = formatCantonDecimal(requiredAmount)
    const holding = holdings.find(
      (candidate) =>
        !feeCidSet.has(candidate.contractId) &&
        decimalStringToCantonUnits(candidate.amount) >= requiredAmount,
    )
    if (!holding) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.generateUnsignedSendMessage: no unlocked holding for ${formatInstrumentId(instrumentId)} with at least ${requiredAmountDecimal}; pass message.extraArgs.tokenTransferHoldingCids`,
      )
    }
    return [holding]
  }

  // ─── Discovery helpers ──────────────────────────────────────────────────

  /**
   * Resolve the registry-default fee token (Amulet) for this Canton chain.
   *
   * The fee token is registry-level, not router- or party-dependent: a single
   * metadata lookup yields `"<adminId>::Amulet"`, where `adminId` is itself a
   * Daml party ID (`name::fingerprint`).
   */
  private async getDefaultFeeToken(): Promise<string> {
    const registryInfo = await this.tokenMetadataClient.getRegistryInfo()
    return `${registryInfo.adminId}::Amulet`
  }

  /**
   * Fill in Canton-specific fields that {@link generateUnsignedSendMessage}
   * requires but the generic `sendMessage` caller (e.g. the CLI) does not
   * know how to populate: a default `feeToken` if missing, and at least one
   * `feeTokenHoldingCids` entry discovered from `party`'s holdings.
   */
  private async fillCantonSendDefaults(
    message: Parameters<Chain['sendMessage']>[0]['message'],
    party: string,
  ): Promise<Parameters<Chain['sendMessage']>[0]['message']> {
    const feeToken = message.feeToken || (await this.getDefaultFeeToken())
    const extraArgs = (message.extraArgs ?? {}) as Partial<CantonExtraArgsV1>
    if (extraArgs.feeTokenHoldingCids?.length) {
      return { ...message, feeToken }
    }

    const holdings = await fetchTokenHoldings(this.provider, party, parseInstrumentId(feeToken))
    if (!holdings.length) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.sendMessage: no fee-token holdings found for party ${party} on instrument ${feeToken}`,
      )
    }
    return {
      ...message,
      feeToken,
      extraArgs: { ...extraArgs, feeTokenHoldingCids: [holdings[0]!.contractId] },
    }
  }

  // ─── Static methods ───────────────────────────────────────────────────────

  /**
   * Try to decode a CCIP message from a Canton log/event.
   * @returns undefined (Canton message format not yet supported)
   */
  static decodeMessage(log: Pick<ChainLog, 'data' | 'transactionHash'>): CCIPMessage | undefined {
    const updateId = log.transactionHash
    const sendResult = tryParseCantonSendResult(log.data, updateId)
    if (!sendResult) return undefined

    const sentEvent = extractCantonSentEventFieldsFromLogData(log.data)

    const destRaw =
      sentEvent?.destChainSelector ??
      sentEvent?.destinationChainSelector ??
      sentEvent?.dest_chain_selector
    const srcRaw = sentEvent?.sourceChainSelector ?? sentEvent?.source_chain_selector

    if (destRaw == null || srcRaw == null) return undefined

    return {
      messageId: sendResult.messageId,
      encodedMessage: sendResult.encodedMessage,
      sourceChainSelector: toBigIntSafe(srcRaw),
      destChainSelector: toBigIntSafe(destRaw),
      sequenceNumber: sendResult.sequenceNumber,
      nonce: sendResult.nonce ?? 0n,
      sender: typeof sentEvent?.sender === 'string' ? sentEvent.sender : '',
      receiver: typeof sentEvent?.receiver === 'string' ? sentEvent.receiver : '',
      data: sendResult.encodedMessage,
      tokenAmounts: [],
      feeToken: '',
      feeTokenAmount: 0n,
    } as unknown as CCIPMessage
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
  static decodeCommits(_log: Pick<ChainLog, 'data'>, _lane?: Lane): CommitReport[] | undefined {
    // TODO: implement Canton commit report decoding
    return undefined
  }

  /**
   * Try to decode an execution receipt from a Canton log.
   * @returns undefined (Canton receipt format not yet supported)
   */
  static decodeReceipt(_log: Pick<ChainLog, 'data'>): ExecutionReceipt | undefined {
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
  static override buildMessageForDest(message: Parameters<ChainStatic['buildMessageForDest']>[0]) {
    return super.buildMessageForDest(message)
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

type CantonTransferFactoryData = {
  factoryId: string
  contextValues: Record<string, unknown>
  disclosedContracts: DisclosedContract[]
}

type ActiveContractDetails = {
  contractId: string
  templateId: string
  createdEventBlob: string
  synchronizerId: string
  createArgument: unknown
  interfaceViews?: unknown[]
  disclosedContract: DisclosedContract
}

type TokenHoldingDetails = ActiveContractDetails & {
  amount: string
  instrumentId: CantonInstrumentId
}

function extractChoiceContextValues(choiceContextData: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!choiceContextData || typeof choiceContextData !== 'object') return out
  const values = (choiceContextData as Record<string, unknown>)['values']
  if (!values || typeof values !== 'object') return out
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    out[key] = value
  }
  return out
}

async function fetchTokenHoldings(
  client: CantonClient,
  party: string,
  instrumentId: CantonInstrumentId,
): Promise<TokenHoldingDetails[]> {
  const { offset } = await client.getLedgerEnd()

  const responses = await client.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: [
            {
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
                    includeInterfaceView: true,
                    includeCreatedEventBlob: true,
                  },
                },
              },
            },
          ],
        },
      },
      verbose: true,
    },
  })

  const holdings: TokenHoldingDetails[] = []
  for (const response of responses) {
    const active = activeContractFromResponse(response)
    if (!active) continue

    const holdingView = extractHoldingView(active)
    if (!holdingView) continue
    if (extractStringField(holdingView, 'owner') !== party) continue

    const holdingInstrument = extractInstrumentId(holdingView)
    if (!holdingInstrument || !sameInstrumentId(holdingInstrument, instrumentId)) continue

    const amount = extractStringField(holdingView, 'amount')
    if (!amount || decimalStringToCantonUnits(amount) <= 0n) continue
    if (extractField(holdingView, 'lock') != null) continue

    holdings.push({
      ...active,
      amount,
      instrumentId: holdingInstrument,
    })
  }
  return holdings
}

function activeContractFromResponse(response: unknown): ActiveContractDetails | null {
  if (!response || typeof response !== 'object') return null
  const entry = (response as Record<string, unknown>)['contractEntry']
  if (!entry || typeof entry !== 'object' || !('JsActiveContract' in entry)) return null
  const active = (entry as Record<string, unknown>)['JsActiveContract']
  if (!active || typeof active !== 'object') return null
  const activeRecord = active as Record<string, unknown>
  const created = activeRecord['createdEvent']
  if (!created || typeof created !== 'object') return null
  const createdRecord = created as Record<string, unknown>

  const contractId =
    typeof createdRecord['contractId'] === 'string' ? createdRecord['contractId'] : ''
  const templateId =
    typeof createdRecord['templateId'] === 'string' ? createdRecord['templateId'] : ''
  if (!contractId || !templateId) return null

  const createdEventBlob =
    typeof createdRecord['createdEventBlob'] === 'string' ? createdRecord['createdEventBlob'] : ''
  const synchronizerId =
    typeof activeRecord['synchronizerId'] === 'string' ? activeRecord['synchronizerId'] : ''

  return {
    contractId,
    templateId,
    createdEventBlob,
    synchronizerId,
    createArgument: createdRecord['createArgument'],
    interfaceViews: Array.isArray(createdRecord['interfaceViews'])
      ? (createdRecord['interfaceViews'] as unknown[])
      : undefined,
    disclosedContract: {
      contractId,
      templateId,
      createdEventBlob,
      synchronizerId,
    },
  }
}

function extractHoldingView(active: ActiveContractDetails): unknown {
  const holdingView = active.interfaceViews?.find((view) => {
    if (!view || typeof view !== 'object') return false
    const viewRecord = view as Record<string, unknown>
    return (
      typeof viewRecord['interfaceId'] === 'string' &&
      viewRecord['interfaceId'].includes('HoldingV1') &&
      viewRecord['viewValue'] != null
    )
  })
  if (holdingView && typeof holdingView === 'object') {
    return (holdingView as Record<string, unknown>)['viewValue']
  }
  return active.createArgument
}

function extractField(record: unknown, fieldName: string): unknown {
  if (!record || typeof record !== 'object') return undefined
  const obj = unwrapDamlValue(record) as Record<string, unknown>

  if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
    return unwrapDamlValue(obj[fieldName])
  }

  if (Array.isArray(obj['fields'])) {
    for (const field of obj['fields'] as Array<Record<string, unknown>>) {
      if (field['label'] === fieldName) return unwrapDamlValue(field['value'])
    }
  }
  return undefined
}

function unwrapDamlValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>

  if ('Sum' in obj && obj['Sum'] && typeof obj['Sum'] === 'object') {
    const sum = obj['Sum'] as Record<string, unknown>
    const first = Object.values(sum)[0]
    return unwrapDamlValue(first)
  }
  if ('value' in obj && Object.keys(obj).length <= 2) {
    return unwrapDamlValue(obj['value'])
  }
  if ('Text' in obj) return obj['Text']
  if ('text' in obj) return obj['text']
  if ('Party' in obj) return obj['Party']
  if ('party' in obj) return obj['party']
  if ('Numeric' in obj) return obj['Numeric']
  if ('numeric' in obj) return obj['numeric']
  if ('Int64' in obj) return obj['Int64']
  if ('int64' in obj) return obj['int64']
  if ('ContractId' in obj) return obj['ContractId']
  if ('contractId' in obj && Object.keys(obj).length === 1) return obj['contractId']
  return value
}

function extractStringField(record: unknown, fieldName: string): string | null {
  const value = extractField(record, fieldName)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString()
  return null
}

function extractInstrumentId(record: unknown): CantonInstrumentId | null {
  const rawInstrument = extractField(record, 'instrumentId')
  if (!rawInstrument || typeof rawInstrument !== 'object') return null
  const admin = extractStringField(rawInstrument, 'admin')
  const id = extractStringField(rawInstrument, 'id')
  if (!admin || !id) return null
  return { admin, id }
}

function sameInstrumentId(a: CantonInstrumentId, b: CantonInstrumentId): boolean {
  return a.admin === b.admin && a.id === b.id
}

function formatInstrumentId(instrumentId: CantonInstrumentId): string {
  return `${instrumentId.admin}::${instrumentId.id}`
}

function buildEdsMessage({
  destChainSelector,
  receiverHex,
  payloadHex,
  feeInstrument,
  tokenTransfer,
}: {
  destChainSelector: bigint
  receiverHex: string
  payloadHex: string
  feeInstrument: CantonInstrumentId
  tokenTransfer: Record<string, unknown> | null
}): EdsMessage {
  return {
    destinationChainSelector: destChainSelector.toString(),
    receiver: receiverHex,
    payload: payloadHex,
    tokenTransfer: tokenTransfer as EdsMessage['tokenTransfer'],
    feeToken: { admin: feeInstrument.admin, id: feeInstrument.id },
    executor: { type: '' },
  }
}

function hashCantonInstrumentId(instrumentId: CantonInstrumentId): string {
  return keccak256Utf8(`${instrumentId.id}@${instrumentId.admin}`)
}

function instanceAddressFor(address: string): string {
  const trimmed = address.trim()
  if (trimmed.includes('@')) return keccak256Utf8(trimmed).toLowerCase()
  return trimmed.toLowerCase()
}

function sameRawOrHashedAddress(a: string, b: string): boolean {
  return instanceAddressFor(a) === instanceAddressFor(b)
}

function dedupeDisclosedContracts(contracts: readonly DisclosedContract[]): DisclosedContract[] {
  const seen = new Set<string>()
  return contracts.filter((dc) => {
    if (seen.has(dc.contractId)) return false
    seen.add(dc.contractId)
    return true
  })
}

function assertRequiredCcvsCovered(
  required: readonly string[],
  verificationDestAddresses: readonly string[],
  configuredCcvs: readonly string[],
): void {
  const missing = missingTokenPoolRequiredCcvs(required, verificationDestAddresses, configuredCcvs)
  if (missing.length) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `CantonChain.generateUnsignedExecute: token pool requires CCV result(s) not provided by verifications: ${missing.join(', ')}`,
    )
  }
}

const CANTON_DECIMALS = 10n
const CANTON_DECIMAL_SCALE = BigInt(10) ** CANTON_DECIMALS

/** Package names commonly involved in CCIP Canton send (fee + token pool paths). */
const CANTON_SEND_PACKAGE_NAMES = [
  'ccip-core',
  'ccip-executor',
  'ccip-burn-mint-token-pool',
  'splice-amulet',
  'splice-api-token-holding-v1',
  'splice-api-token-transfer-instruction-v1',
  'link',
] as const

function formatCantonDecimal(amount: bigint): string {
  if (amount < 0n) {
    throw new CCIPError(CCIPErrorCode.METHOD_UNSUPPORTED, 'Canton token amounts cannot be negative')
  }
  const whole = amount / CANTON_DECIMAL_SCALE
  const fraction = (amount % CANTON_DECIMAL_SCALE).toString().padStart(Number(CANTON_DECIMALS), '0')
  return `${whole}.${fraction}`
}

function packageNamesFromTemplateRefs(commands: JsCommands): string[] {
  const names = new Set<string>()
  for (const templateId of templateIdsFromCommands(commands)) {
    if (!templateId.startsWith('#')) continue
    const trimmed = templateId.slice(1)
    const sep = trimmed.indexOf(':')
    if (sep > 0) names.add(trimmed.slice(0, sep))
  }
  return [...names]
}

function templateIdsFromCommands(commands: JsCommands): string[] {
  const ids: string[] = []
  for (const disclosed of commands.disclosedContracts ?? []) {
    if (disclosed.templateId) ids.push(disclosed.templateId)
  }
  for (const command of commands.commands) {
    const record = command as Record<string, unknown>
    for (const key of ['ExerciseCommand', 'CreateCommand'] as const) {
      const nested = record[key]
      if (!nested || typeof nested !== 'object') continue
      const templateId = (nested as Record<string, unknown>)['templateId']
      if (typeof templateId === 'string') ids.push(templateId)
    }
  }
  return ids
}

function resolveIndexerBaseUrl(
  cliIndexer: readonly string[] | undefined,
  configuredIndexerUrl: string,
): string {
  for (const entry of cliIndexer ?? []) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed) return trimmed
  }
  return configuredIndexerUrl.trim()
}

function decimalStringToCantonUnits(raw: string): bigint {
  const value = raw.trim().replace(/\.$/, '')
  if (!/^\d+(\.\d+)?$/.test(value)) return 0n
  const [wholeRaw, fractionRaw = ''] = value.split('.')
  if (fractionRaw.length > Number(CANTON_DECIMALS)) return 0n
  const whole = BigInt(wholeRaw || '0')
  const fraction = BigInt(fractionRaw.padEnd(Number(CANTON_DECIMALS), '0') || '0')
  return whole * CANTON_DECIMAL_SCALE + fraction
}

/**
 * Strip the `0x` prefix from a hex string.
 * Canton / Daml expects hex values without the prefix.
 */
function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

function isRetryableCantonSubmitError(err: unknown): boolean {
  return CCIPError.isCCIPError(err) && err.isTransient
}

/**
 * Decode the `finality` field from a Canton-encoded CCIP message.
 *
 * Wire format (big-endian, offsets in bytes):
 *   0      version          (1)
 *   1–8    source_chain     (8)
 *   9–16   dest_chain       (8)
 *   17–24  sequence_number  (8)
 *   25–28  execution_gas    (4)
 *   29–32  ccip_gas         (4)
 *   33–36  finality         (4)  ← uint32 big-endian
 */
function decodeFinalityFromEncodedMessage(encodedHex: string): number {
  const hex = encodedHex.startsWith('0x') ? encodedHex.slice(2) : encodedHex
  // finality starts at byte 33 → hex offset 66, length 8 chars
  if (hex.length < 74) return 0
  return parseInt(hex.slice(66, 74), 16)
}

/**
 * Encode a numeric message finality as a Canton JSON Ledger API variant value for
 * the `receiverFinalityConfig : FinalityConfig` field of `CCIPReceiver`.
 *
 * Mirrors Go's `encodeReceiverFinalityConfig` in ccip/devenv/manual_execution.go:
 *   0         → WaitForFinality  (no block-depth threshold)
 *   0x00010000→ WaitForSafe      (wait for the safe/finalized block)
 *   N (other) → BlockDepth(N)    (wait for N block confirmations)
 */
function encodeFinalityConfig(finality: number): Record<string, unknown> {
  if (finality === 0) return { tag: 'WaitForFinality', value: {} }
  if (finality === 0x00010000) return { tag: 'WaitForSafe', value: {} }
  return { tag: 'BlockDepth', value: encodeDamlInt64(finality) }
}

/** Encode a Daml INT64 for the JSON Ledger API (string, not JSON number). */
function encodeDamlInt64(value: bigint | number): string {
  return value.toString()
}
