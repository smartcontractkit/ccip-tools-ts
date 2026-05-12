import { type BytesLike, id as keccak256Utf8 } from 'ethers'
import type { PickDeep } from 'type-fest'

import {
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
import {
  CCIPChainNotFoundError,
  CCIPError,
  CCIPErrorCode,
  CCIPNotImplementedError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import { CCV_INDEXER_URL } from '../evm/const.ts'
import type { ExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { getMessagesInBatch } from '../requests.ts'
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
  type OffchainTokenData,
  type VerifierResult,
  type WithLogger,
  CCIPVersion,
} from '../types.ts'
import {
  type CantonClient,
  type JsCommands,
  type JsTransaction,
  createCantonClient,
} from './client/index.ts'
import { parseCantonExecutionReceipt, parseCantonSendResult, resolveTimestamp } from './events.ts'
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
  type UnsignedCantonTx,
  isCantonWallet,
  parseInstrumentId,
} from './types.ts'

export type { CantonClient, CantonClientConfig } from './client/index.ts'
export type {
  CantonCCVSendInput,
  CantonExtraArgsV1,
  CantonInstrumentId,
  CantonTokenExtraArgs,
  CantonTokenInput,
  CantonWallet,
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
  ) {
    super(network, ctx)
    this.provider = client
    this.network = network
    this.acsDisclosureProvider = acsDisclosureProvider
    this.edsDisclosureProvider = edsDisclosureProvider
    this.transferInstructionClient = transferInstructionClient
    this.tokenMetadataClient = tokenMetadataClient
    this.ccipParty = ccipParty
    this.indexerUrl = indexerUrl
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
    ['global', 'canton:LocalNet'],
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
  static async fromClient(
    client: CantonClient,
    acsDisclosureProvider: AcsDisclosureProvider,
    edsDisclosureProvider: EdsDisclosureProvider,
    transferInstructionClient: TransferInstructionClient,
    tokenMetadataClient: TokenMetadataClient,
    ccipParty: string,
    indexerUrl = CCV_INDEXER_URL,
    ctx?: ChainContext,
  ): Promise<CantonChain> {
    const synchronizers = await client.getConnectedSynchronizers()

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
    // Check that ctx has the necessary cantonConfig
    if (!ctx || !ctx.cantonConfig || typeof ctx.cantonConfig.jwt !== 'string') {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.fromUrl: ctx.cantonConfig is required',
      )
    }

    const client = createCantonClient({
      baseUrl: url,
      jwt: ctx.cantonConfig.jwt,
      signal: ctx.abort,
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
      ctx,
    )
  }

  /**
   * {@inheritDoc Chain.getBlockTimestamp}
   * @throws {@link CCIPNotImplementedError} for numeric blocks (Canton ledger uses offsets, not block numbers)
   */
  getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    throw new CCIPNotImplementedError(
      `CantonChain.getBlockTimestamp: block ${block} — Canton uses ledger offsets, not block numbers`,
    )
  }

  /**
   * Fetches a Canton transaction (update) by its update ID.
   *
   * The ledger is queried via `/v2/updates/transaction-by-id` with a wildcard
   * party filter so that all visible events are returned without requiring a
   * known party ID.
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
    const tx: JsTransaction = await this.provider.getTransactionById(hash)

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
  getLogs(_opts: LogFilter): AsyncIterableIterator<ChainLog> {
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
  typeAndVersion(
    _address: string,
  ): Promise<[type: string, version: string, typeAndVersion: string, suffix?: string]> {
    throw new CCIPNotImplementedError('CantonChain.typeAndVersion')
  }

  /**
   * {@inheritDoc Chain.getRouterForOnRamp}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    // TODO: Contract discovery can come from EDS.
    throw new CCIPNotImplementedError('CantonChain.getRouterForOnRamp')
  }

  /**
   * {@inheritDoc Chain.getRouterForOffRamp}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getRouterForOffRamp')
  }

  /**
   * {@inheritDoc Chain.getNativeTokenForRouter}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getNativeTokenForRouter(_router: string): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getNativeTokenForRouter')
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
   * {@inheritDoc Chain.getOnRampsForOffRamp}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getOnRampsForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string[]> {
    throw new CCIPNotImplementedError('CantonChain.getOnRampsForOffRamp')
  }

  /**
   * {@inheritDoc Chain.getCommitStoreForOffRamp}
   */
  async getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp)
  }

  /**
   * {@inheritDoc Chain.getTokenForTokenPool}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getTokenForTokenPool(_tokenPool: string): Promise<string> {
    throw new CCIPNotImplementedError('CantonChain.getTokenForTokenPool')
  }

  /**
   * {@inheritDoc Chain.getTokenInfo}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number }> {
    throw new CCIPNotImplementedError('CantonChain.getTokenInfo')
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
   * {@inheritDoc Chain.getFee}
   * @throws {@link CCIPNotImplementedError} always (not yet implemented for Canton)
   */
  getFee(_opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    throw new CCIPNotImplementedError('CantonChain.getFee')
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
      typeof message.receiver === 'string' ? message.receiver : String(message.receiver),
    )
    const payloadHex = message.data
      ? stripHexPrefix(typeof message.data === 'string' ? message.data : String(message.data))
      : ''
    const gasLimit = cantonArgs.gasLimit ?? 200_000n
    const feeTokenHoldingCids = cantonArgs.feeTokenHoldingCids
    const senderRequiredCCVs = cantonArgs.ccvRawAddresses ?? []

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
            gasLimit: Number(gasLimit),
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

    // Retry the full generate+submit cycle (up to 3 attempts) so that each
    // attempt uses freshly-discovered ACS data (fee holding CID, disclosed
    // contracts, EDS context, etc.).  HTTP-level retries inside
    // submitAndWaitForTransaction are disabled, so a stale holding that gets
    // swept between discovery and submission simply causes a fast fail here and
    // triggers re-discovery on the next attempt.
    const MAX_SEND_ATTEMPTS = 3
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        // Build the unsigned command fresh on every attempt (re-queries ACS / EDS).
        const unsigned = await this.generateUnsignedSendMessage({
          ...opts,
          sender: wallet.party,
        })

        this.logger.debug(
          `CantonChain.sendMessage: submitting command (attempt ${attempt}/${MAX_SEND_ATTEMPTS})`,
        )

        // Submit and wait for the full transaction (so we get events back)
        const response = await this.provider.submitAndWaitForTransaction(unsigned.commands)
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
          feeToken: opts.message.feeToken ?? '',
          feeTokenAmount: 0n,
        } as unknown as CCIPMessage

        return { lane, message: ccipMessage, log, tx }
      } catch (err) {
        lastError = err
        if (attempt < MAX_SEND_ATTEMPTS) {
          this.logger.debug(
            `CantonChain.sendMessage: attempt ${attempt} failed, retrying with fresh data: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
    throw lastError
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
      verifications.map((v) =>
        this.edsDisclosureProvider.fetchCcvExecuteDisclosure(v.destAddress, encodedMessageHex),
      ),
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
    this.logger.debug(
      `CantonChain.execute: message finality=${finality}, looking for compatible CCIPReceiver...`,
    )

    let receiverCid = (await this.acsDisclosureProvider.findReceiverForFinality(finality))
      ?.contractId
    if (!receiverCid) {
      this.logger.debug(
        `CantonChain.execute: no CCIPReceiver with minBlockConfirmations=${finality} found in ACS — creating one`,
      )
      receiverCid = await this.createReceiverForFinality(wallet.party, finality)
    }

    // Build the unsigned command, passing the resolved receiver CID via Canton-specific opts.
    const unsigned = await this.generateUnsignedExecute({
      ...opts,
      payer: wallet.party,
      _cantonReceiverCid: receiverCid,
    } as unknown as Parameters<Chain['generateUnsignedExecute']>[0])

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.provider.submitAndWaitForTransaction(unsigned.commands)
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
      blockNumber: 0,
      transactionHash: updateId,
      data: response.transaction,
    }

    return { receipt, log, timestamp }
  }

  /**
   * Find or create a `CCIPReceiver` contract whose `minBlockConfirmations` equals `finality`.
   *
   * The `OffRamp.PrepareExecute` Daml choice rejects messages whose `finality` field does not
   * match the receiver's `minBlockConfirmations`, so each distinct finality value needs its own
   * receiver instance.  This method first searches the ACS; if no match is found it creates a
   * fresh contract (mirroring the Go `deployReceiver` helper in the staging script).
   */
  private async createReceiverForFinality(payer: string, finality: number): Promise<string> {
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
        const response = await this.provider.submitAndWaitForTransaction(createCmd)
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
        await delay(delayMs)
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

    const indexerMessageId = normalizeIndexerMessageId(request.message.messageId)
    const url = `${this.indexerUrl}/v1/verifierresults/${indexerMessageId}`
    const res = await fetch(url)
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
   * Auto-discover everything needed to call {@link sendMessage} for a simple Canton-to-EVM send.
   *
   * Queries the token metadata registry to determine the default fee token
   * (Amulet) and finds the first usable holding for `party`.
   *
   * @param party - The sender party ID.
   * @returns The resolved `feeToken` string and a ready-to-use {@link CantonExtraArgsV1}.
   * @throws if no fee token holdings are found for `party`.
   */
  async discoverSendArgs(
    party: string,
  ): Promise<{ feeToken: string; extraArgs: CantonExtraArgsV1 }> {
    const registryInfo = await this.tokenMetadataClient.getRegistryInfo()
    const feeToken = `${registryInfo.adminId}::Amulet`
    const instrumentId = parseInstrumentId(feeToken)

    const holdings = await fetchTokenHoldings(this.provider, party, instrumentId)

    if (!holdings.length) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `discoverSendArgs: no Amulet holdings found for party ${party}`,
      )
    }

    return {
      feeToken,
      extraArgs: {
        feeTokenHoldingCids: [holdings[0]!.contractId],
      },
    }
  }

  // ─── Static methods ───────────────────────────────────────────────────────

  /**
   * Try to decode a CCIP message from a Canton log/event.
   * @returns undefined (Canton message format not yet supported)
   */
  static decodeMessage(_log: Pick<ChainLog, 'data'>): CCIPMessage | undefined {
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

function assertRequiredCcvsCovered(required: readonly string[], provided: readonly string[]): void {
  const providedAddresses = new Set(provided.map(instanceAddressFor))
  const missing = required.filter((address) => !providedAddresses.has(instanceAddressFor(address)))
  if (missing.length) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `CantonChain.generateUnsignedExecute: token pool requires CCV result(s) not provided by verifications: ${missing.join(', ')}`,
    )
  }
}

const CANTON_DECIMALS = 10n
const CANTON_DECIMAL_SCALE = BigInt(10) ** CANTON_DECIMALS

function formatCantonDecimal(amount: bigint): string {
  if (amount < 0n) {
    throw new CCIPError(CCIPErrorCode.METHOD_UNSUPPORTED, 'Canton token amounts cannot be negative')
  }
  const whole = amount / CANTON_DECIMAL_SCALE
  const fraction = (amount % CANTON_DECIMAL_SCALE).toString().padStart(Number(CANTON_DECIMALS), '0')
  return `${whole}.${fraction}`
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

function normalizeIndexerMessageId(messageId: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(messageId)) return messageId
  if (/^[0-9a-fA-F]{64}$/.test(messageId)) return `0x${messageId}`
  return messageId
}

function isRetryableCantonSubmitError(err: unknown): boolean {
  return CCIPError.isCCIPError(err) && err.isTransient
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  return { tag: 'BlockDepth', value: finality }
}
