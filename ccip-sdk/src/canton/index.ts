import { type BytesLike, id as keccak256Utf8 } from 'ethers'
import type { PickDeep } from 'type-fest'

import {
  type ChainContext,
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
import type { ExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
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
  type NetworkInfo,
  type OffchainTokenData,
  type VerifierResult,
  type WithLogger,
  CCIPVersion,
  ChainFamily,
} from '../types.ts'
import { networkInfo } from '../utils.ts'
import {
  type CantonClient,
  type JsCommands,
  type JsTransaction,
  createCantonClient,
} from './client/index.ts'
import { parseCantonExecutionReceipt, parseCantonSendResult, resolveTimestamp } from './events.ts'
import { AcsDisclosureProvider } from './explicit-disclosures/acs.ts'
import { EdsDisclosureProvider } from './explicit-disclosures/eds.ts'
import type { DisclosedContract } from './explicit-disclosures/types.ts'
import { CCV_INDEXER_URL } from '../evm/const.ts'
import { type TokenMetadataClient, createTokenMetadataClient } from './token-metadata/client.ts'
import {
  type TransferInstructionClient,
  createTransferInstructionClient,
} from './transfer-instruction/client.ts'
import {
  type CantonExtraArgsV1,
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
    console.log(
      `[CantonChain.fromUrl] Connecting to Canton Ledger API at ${url}... with JWT: ${ctx.cantonConfig.jwt.substring(0, 10)}...`,
    )
    const client = createCantonClient({ baseUrl: url, jwt: ctx.cantonConfig.jwt })
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
    const edsDisclosureProvider = new EdsDisclosureProvider({ edsBaseUrl: ctx.cantonConfig.edsUrl })
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
    if (!cantonArgs?.feeTokenHoldingCids?.length) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.generateUnsignedSendMessage: message.extraArgs.feeTokenHoldingCids is required. ' +
          'Pass at least one fee-token holding contract ID in extraArgs.',
      )
    }

    // --- parse fields ---
    const instrumentId = parseInstrumentId(message.feeToken)
    const receiverHex = stripHexPrefix(
      typeof message.receiver === 'string' ? message.receiver : String(message.receiver),
    )
    const payloadHex = message.data
      ? stripHexPrefix(typeof message.data === 'string' ? message.data : String(message.data))
      : ''
    const gasLimit = cantonArgs.gasLimit ?? 200_000n
    const feeTokenHoldingCids = cantonArgs.feeTokenHoldingCids
    const ccvRawAddresses = cantonArgs.ccvRawAddresses ?? []
    // Derive hex InstanceAddresses at runtime: keccak256 of each raw "instanceId@party" string
    const ccvAddresses = ccvRawAddresses.map((raw) => keccak256Utf8(raw))

    this.logger.debug('CantonChain.generateUnsignedSendMessage: fetching ACS disclosures')

    // Step 1 — Fetch same-party disclosures (PerPartyRouter + CCIPSender)
    const acsDisclosures = await this.acsDisclosureProvider.fetchSendDisclosures()

    // Step 2 — Fetch cross-party disclosures from EDS
    this.logger.debug(
      `CantonChain.generateUnsignedSendMessage: fetching EDS disclosures for ${ccvAddresses.length} CCVs`,
    )
    const edsResult = await this.edsDisclosureProvider.fetchSendDisclosures(ccvAddresses)

    // Step 3 — Build CCV send inputs
    const ccvSendInputs = ccvRawAddresses.map((rawAddr, i) => {
      const addr = ccvAddresses[i]!
      const ccvDisclosure = edsResult.ccvs[addr]
      if (!ccvDisclosure?.disclosedContract) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `EDS did not return a disclosure for CCV at ${addr}`,
        )
      }
      return {
        ccvCid: ccvDisclosure.disclosedContract.contractId,
        ccvRawAddress: { unpack: rawAddr },
        verifierArgs: '',
      }
    })

    // Step 4 — Extract CCV disclosed contracts
    const ccvDisclosedContracts: DisclosedContract[] = ccvAddresses
      .map((addr) => edsResult.ccvs[addr]?.disclosedContract)
      .filter((dc): dc is DisclosedContract => dc !== undefined)

    // Step 5 — Fetch transfer factory from Transfer Instruction API
    //   Mirrors the Go test flow: get registry admin, then call getTransferFactory
    //   with choiceArguments describing the intended transfer.
    this.logger.debug(
      'CantonChain.generateUnsignedSendMessage: fetching registry admin from Token Metadata API',
    )
    const registryInfo = await this.tokenMetadataClient.getRegistryInfo()
    const registryAdmin = registryInfo.adminId

    this.logger.debug(
      `CantonChain.generateUnsignedSendMessage: registry admin is ${registryAdmin}, fetching transfer factory...`,
    )

    this.logger.debug(
      'CantonChain.generateUnsignedSendMessage: fetching transfer factory from Transfer Instruction API',
    )
    const transferFactoryResponse = await this.transferInstructionClient.getTransferFactory({
      choiceArguments: {
        expectedAdmin: registryAdmin,
        transfer: {
          sender,
          receiver: this.ccipParty,
          amount: '100.00',
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

    // Step 6 — Build fee token input from the transfer factory response
    const transferFactoryContextValues: Record<string, unknown> = {}
    const ctxData = transferFactoryResponse.choiceContext.choiceContextData
    if (typeof ctxData === 'object' && 'values' in ctxData) {
      const values = ctxData.values
      if (values && typeof values === 'object') {
        for (const [key, val] of Object.entries(values as Record<string, unknown>)) {
          // Preserve the full variant structure (e.g. { tag: "AV_ContractId", value: "00..." })
          // so the Canton JSON API receives the correct tagged union, not a bare string.
          transferFactoryContextValues[key] = val
        }
      }
    }

    const feeTokenInput = {
      transferFactory: transferFactoryResponse.factoryId,
      extraArgs: {
        context: { values: transferFactoryContextValues },
        meta: { values: {} },
      },
      tokenPoolHoldings: [] as string[],
    }

    // Step 7 — Assemble the Send choice argument.
    //   The EDS `choiceContextData` contains the contract CIDs for OnRamp,
    //   GlobalConfig, TAR, FeeQuoter, RMNRemote etc.
    const edsContextData =
      edsResult.choiceContext.choiceContextData != null &&
      typeof edsResult.choiceContext.choiceContextData === 'object'
        ? (edsResult.choiceContext.choiceContextData as Record<string, unknown>)
        : {}

    const choiceArgument: Record<string, unknown> = {
      context: edsContextData,
      routerCid: acsDisclosures.perPartyRouter.contractId,
      destChainSelector: destChainSelector.toString(),
      receiver: receiverHex,
      payload: payloadHex,
      ccipReceiveGasLimit: Number(gasLimit),
      senderRequiredCCVs: [],
      feeToken: instrumentId,
      feeTokenInput,
      feeTokenHoldingCids,
      tokenTransfer: null,
      ccvSendInputs,
    }

    // Step 8 — Merge all disclosed contracts
    const transferFactoryDisclosures: DisclosedContract[] =
      transferFactoryResponse.choiceContext.disclosedContracts ?? []

    const allDisclosed: DisclosedContract[] = [
      acsDisclosures.perPartyRouter,
      acsDisclosures.ccipSender,
      ...edsResult.choiceContext.disclosedContracts,
      ...ccvDisclosedContracts,
      ...transferFactoryDisclosures,
    ]

    // Step 9 — Build the ExerciseCommand
    const exerciseCommand = {
      ExerciseCommand: {
        templateId: acsDisclosures.ccipSender.templateId,
        contractId: acsDisclosures.ccipSender.contractId,
        choice: 'Send',
        choiceArgument,
      },
    }

    // Step 10 — Assemble JsCommands
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

    // Build the unsigned command
    const unsigned = await this.generateUnsignedSendMessage({
      ...opts,
      sender: wallet.party,
    })

    this.logger.debug('CantonChain.sendMessage: submitting command to Ledger API')

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.provider.submitAndWaitForTransaction(unsigned.commands)
    const txRecord = (response.transaction ?? response) as Record<string, unknown>
    const updateId: string =
      (typeof txRecord.update_id === 'string' ? txRecord.update_id : null) ??
      (typeof txRecord.updateId === 'string' ? txRecord.updateId : '')

    this.logger.debug(`CantonChain.sendMessage: submitted, updateId=${updateId}`)

    // Parse CCIPMessageSent from the transaction events
    const sendResult = parseCantonSendResult(response.transaction ?? response, updateId)

    const timestamp = resolveTimestamp(txRecord)

    // Build the Lane
    const lane: Lane = {
      sourceChainSelector: this.network.chainSelector,
      destChainSelector: opts.destChainSelector,
      onRamp: sendResult.onRampAddress ?? '',
      version: CCIPVersion.V2_0,
    }

    // Build a synthetic ChainLog from the Canton transaction
    const log: ChainLog = {
      topics: [],
      index: 0,
      address: '',
      blockNumber: 0,
      transactionHash: updateId,
      data: response.transaction as Record<string, unknown>,
    }

    // Build the transaction descriptor
    const tx: Omit<ChainTransaction, 'logs'> = {
      hash: updateId,
      blockNumber: 0,
      timestamp,
      from: wallet.party,
    }

    // Build the CCIPMessage from the CCIPMessageSent event data
    const ccipMessage = {
      messageId: sendResult.messageId,
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
      tokenAmounts: [] as readonly { token: string; amount: bigint }[],
      feeToken: opts.message.feeToken ?? '',
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
   *    verification data, and the opaque `choiceContextData` returned by the
   *    EDS.
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

    const { encodedMessage, verifications } = input as {
      encodedMessage: string
      verifications: Pick<VerifierResult, 'ccvData' | 'destAddress'>[]
    }

    // Step 1 — Fetch same-party disclosures (PerPartyRouter + CCIPReceiver)
    // TODO: This should include receiverCid when provided. We need to figure out how to get that from the input or opts.
    const acsDisclosures = await this.acsDisclosureProvider.fetchExecutionDisclosures()

    // Step 2 — Fetch cross-party disclosures from EDS
    //   The EDS needs the CCV instance addresses so it can return the right
    //   CCV disclosures alongside the infrastructure contracts.
    const ccvAddresses = verifications.map((v) => v.destAddress)

    // Derive a message ID for the EDS request.
    // For now, we use the first 66 chars of encodedMessage as a stand-in;
    // in practice this should be the keccak256 of the encoded message or
    // extracted from decodable headers.
    const messageIdForEds = stripHexPrefix(encodedMessage).slice(0, 64)

    const edsResult = await this.edsDisclosureProvider.fetchExecutionDisclosures(
      messageIdForEds,
      ccvAddresses,
    )

    // Step 3 — Build CCV inputs: pair each verification with its CCV contract ID
    const ccvInputs = verifications.map((v) => {
      const ccvDisclosure = edsResult.ccvs[v.destAddress]
      if (!ccvDisclosure?.disclosedContract) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `EDS did not return a disclosure for CCV at ${v.destAddress}`,
        )
      }
      const entry = {
        ccvCid: ccvDisclosure.disclosedContract.contractId,
        verifierResults: stripHexPrefix(String(v.ccvData)),
        ccvExtraContext: { values: {} },
      }
      return entry
    })

    // Step 4 — Extract CCV disclosed contracts
    const ccvDisclosedContracts: DisclosedContract[] = verifications
      .map((v) => edsResult.ccvs[v.destAddress]?.disclosedContract)
      .filter((dc): dc is DisclosedContract => dc !== undefined)

    // Step 5 — Assemble the Execute choice argument.
    //   The `choiceContextData` from EDS is an opaque blob that the Canton
    //   runtime expects under the `context` field of the Execute choice — it
    //   contains contract IDs for OffRamp, GlobalConfig, etc.
    const choiceArgument: Record<string, unknown> = {
      context: edsResult.choiceContext.choiceContextData ?? {},
      routerCid: acsDisclosures.perPartyRouter.contractId,
      encodedMessage: stripHexPrefix(String(encodedMessage)),
      tokenTransfer: null,
      ccvInputs,
      additionalRequiredCCVs: [],
    }

    // Step 6 — Merge all disclosed contracts
    const allDisclosed: DisclosedContract[] = [
      acsDisclosures.perPartyRouter,
      acsDisclosures.ccipReceiver,
      ...edsResult.choiceContext.disclosedContracts,
      ...ccvDisclosedContracts,
    ]

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

    // Build the unsigned command
    const unsigned = await this.generateUnsignedExecute({
      ...opts,
      payer: wallet.party,
    })

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.provider.submitAndWaitForTransaction(unsigned.commands)
    const txRecord = (response.transaction ?? response) as Record<string, unknown>
    const updateId: string =
      (typeof txRecord.update_id === 'string' ? txRecord.update_id : null) ??
      (typeof txRecord.updateId === 'string' ? txRecord.updateId : '')

    // Parse execution receipt from the transaction events
    const receipt = parseCantonExecutionReceipt(response.transaction ?? response, updateId)
    const timestamp = resolveTimestamp(txRecord)

    // Build a synthetic ChainLog — Canton doesn't have EVM-style logs, but the
    // SDK contract expects a ChainLog in the CCIPExecution.
    const log: ChainLog = {
      topics: [],
      index: 0,
      address: '',
      blockNumber: 0,
      transactionHash: updateId,
      data: response.transaction as Record<string, unknown>,
    }

    return { receipt, log, timestamp }
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

    const url = `${this.indexerUrl}/v1/verifierresults/${request.message.messageId}`
    const res = await fetch(url)
    if (!res.ok) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton indexer responded with ${res.status} for message ${request.message.messageId}`,
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
        `Canton indexer returned success=false for message ${request.message.messageId}`,
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
  static override buildMessageForDest(
    message: Parameters<(typeof Chain)['buildMessageForDest']>[0],
  ) {
    return Chain.buildMessageForDest(message)
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Strip the `0x` prefix from a hex string.
 * Canton / Daml expects hex values without the prefix.
 */
function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}
