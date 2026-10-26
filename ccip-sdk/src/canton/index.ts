import type { AccountsChangedEvent } from '@canton-network/core-wallet-dapp-rpc-client'
import type * as damlTypes from '@daml/types'
import { type BytesLike, dataLength, hexlify, id as keccak256Utf8 } from 'ethers'

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
import { MAINNET_INDEXER_URLS, TESTNET_INDEXER_URLS } from '../commits.ts'
import {
  CCIPChainNotFoundError,
  CCIPError,
  CCIPErrorCode,
  CCIPNotImplementedError,
} from '../errors/index.ts'
import type { ExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import {
  decodeMessageV1,
  readMessageV1ChainSelectors,
  readMessageV1OffRampAddress,
  readMessageV1OnRampAddress,
} from '../messages.ts'
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
import { sleep } from '../utils.ts'
import {
  type CantonAddress,
  type PartyId,
  InstanceAddress,
  RawInstanceAddress,
  addressesMatch,
  addressesMissing,
  parseInstanceAddress,
  parsePartyId,
} from './addressCodec.ts'
import {
  CANTON_DECIMALS,
  formatCantonDecimalAmountUnits,
  parseCantonDecimalAmountUnits,
} from './amount.ts'
import { type Message, EdsProvider } from './clients/eds/client.ts'
import {
  type JsCommands,
  type JsSubmitAndWaitForTransactionResponse,
  type JsTransaction,
  type LedgerApiClient,
  type Update,
  type UpdateFormat,
  createLedgerApiClientFromProvider,
} from './clients/ledger-api/client.ts'
import {
  CANTON_FEE_TOKEN_CLI_SYMBOLS,
  excludeHoldingCidForTokenTransfer,
  formatCantonLinkFeeToken,
  resolveCantonSendGasLimit,
  resolveFeeTransferFactoryAmount,
  selectFeeTokenHoldingCids,
  sumCantonHoldingAmounts,
} from './defaults.ts'
import {
  extractCantonSentEventFieldsFromLogData,
  extractCreatedContractId,
  flattenCantonRecord,
  normalizeCantonEncodedMessage,
  normalizeCantonMessageId,
  parseCantonExecutionReceipt,
  parseCantonSendResult,
  resolveTimestamp,
  toBigIntSafe,
  tryParseCantonSendResult,
} from './events.ts'
import { AcsDisclosureProvider } from './explicit-disclosures/acs.ts'
import type { DisclosedContract } from './explicit-disclosures/types.ts'
import {
  type CantonExtraArgsV1,
  type CantonInstrumentId,
  type CantonRpcProvider,
  type CantonTokenInfo,
  type UnsignedCantonTx,
  parseCantonInstrumentId,
} from './types.ts'
import { isCantonUpdateId } from './update-id.ts'

export type {
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
  UnsignedCantonTx,
} from './types.ts'
export { parseCantonInstrumentId } from './types.ts'
export {
  INSTANCE_ADDRESS_LENGTH,
  InstanceAddress,
  RawInstanceAddress,
  addressesContains,
  addressesMatch,
  addressesMissing,
  parseInstanceAddress,
  parsePartyId,
} from './addressCodec.ts'
export type { PartyId } from './addressCodec.ts'
export {
  CANTON_DECIMALS,
  formatCantonDecimalAmountUnits,
  parseCantonDecimalAmountUnits,
} from './amount.ts'
export {
  CANTON_FEE_TOKEN_CLI_SYMBOLS,
  DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT,
  DEFAULT_CANTON_LINK_INSTRUMENT_ID,
  DEFAULT_CANTON_SEND_GAS_LIMIT,
  excludeHoldingCidForTokenTransfer,
  formatCantonLinkFeeToken,
  resolveFeeTransferFactoryAmount,
  selectFeeTokenHoldingCids,
  sumCantonHoldingAmounts,
} from './defaults.ts'

import type { ITokenConfig } from './bindings/ccip-api-v2-2.0.0/CCIP/APIV2/TokenAdminRegistry/module.d.ts'
import type {
  ExecutorExtraArg,
  GenericExtraArgsV3,
  PerPartyRouter,
} from './bindings/ccip-client-api-v2-2.0.0/CCIP/ClientV2/module.d.ts'
import type { ICrossChainVerifier } from './bindings/ccip-extension-api-v2-2.0.0/CCIP/InterfacesV2/CrossChainVerifier/module.d.ts'
import type { IExecutor } from './bindings/ccip-extension-api-v2-2.0.0/CCIP/InterfacesV2/Executor/module.d.ts'
import type { ITokenPool } from './bindings/ccip-extension-api-v2-2.0.0/CCIP/InterfacesV2/TokenPool/module.d.ts'
import type { Execute } from './bindings/ccip-receiver-v2-2.1.0/CCIP/CCIPReceiver/module.d.ts'
import type { Send } from './bindings/ccip-sender-v2-2.1.0/CCIP/CCIPSender/module.d.ts'
import type { Holding } from './bindings/splice-api-token-holding-v1-1.0.0/Splice/Api/Token/HoldingV1/module.d.ts'
import type { TransferFactory } from './bindings/splice-api-token-transfer-instruction-v1-1.0.0/Splice/Api/Token/TransferInstructionV1/module.d.ts'
import { TokenStandardClientProvider } from './clients/tokenStandard/client.ts'

// Authentication providers (OAuth 2.0: static, clientCredentials, authorizationCode protocol helpers)
export {
  type AccessToken,
  type AnyAuthProvider,
  type AuthConfig,
  type AuthProvider,
  type AuthProviderOptions,
  type AuthorizationCodeAuthConfig,
  type AuthorizationCodeProtocolOptions,
  type AuthorizationRequest,
  type AuthorizationServerMetadata,
  type ClientCredentialsAuthConfig,
  type StaticAuthConfig,
  type ValidatedCallback,
  AuthType as CantonAuthType,
  AuthorizationCodeProvider,
  ClientCredentialsProvider,
  StaticProvider,
  buildAuthorizationRequest,
  codeChallengeFromVerifier,
  createAuthProvider,
  createAuthorizationCodeProvider,
  createClientCredentialsProvider,
  createMemoizedTokenFetcher,
  createStaticProvider,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  generateState,
  getAuthorizationServerMetadata,
  isAccessToken,
  isTokenExpired,
  refreshAuthorizationCodeToken,
  resolveAuthorizationCodeConfig,
  validateAuthorizationCallback,
} from './authentication/index.ts'

/**
 * Canton chain implementation supporting Canton Ledger networks.
 *
 */
export class CantonChain extends Chain<typeof ChainFamily.Canton> {
  static {
    supportedChains[ChainFamily.Canton] ??= CantonChain
  }
  static readonly family = ChainFamily.Canton
  /** Canton uses 10 decimals (lf-coin micro-units) */
  static readonly decimals = CANTON_DECIMALS

  override readonly network: NetworkInfo<typeof ChainFamily.Canton>

  // The Canton provider instance to use.
  // Used for all connectivity to the Canton validator.
  readonly provider: CantonRpcProvider
  readonly ledgerApiClient: LedgerApiClient
  activeParty: PartyId

  // EDS provider, used to create clients for all EDS APIs
  readonly edsProvider: EdsProvider
  // Token standard client provider
  readonly tokenStandardClientProvider: TokenStandardClientProvider

  readonly acsDisclosureProvider: AcsDisclosureProvider
  // readonly tokenMetadataClient: TokenMetadataClient
  readonly indexerUrl: string
  readonly ccipParty: PartyId
  readonly nativeToken: CantonTokenInfo
  /** Custom fetch function supplied via ctx, used for indexer requests. Falls back to globalThis.fetch. */
  private readonly fetchFn: typeof fetch

  /** When set, used as a fallback for sender-required CCVs. Can be overwritten using {@link CantonExtraArgsV1} ccvRawAddresses */
  private readonly ccvs: readonly RawInstanceAddress[]

  /** DAR package names for CCIP template IDs (from canton-config `packages`). */
  private readonly ccipPackages: {
    perPartyRouter: string
    ccipSender: string
    ccipReceiver: string
  }

  /** Transfer-factory preview amount for fee payments (`canton-config.feeTransferFactoryAmount`). */
  private readonly feeTransferFactoryAmount: string

  /** Default gas limit for Canton → destination sends (`canton-config.defaultSendGasLimit`). */
  private readonly defaultSendGasLimit?: number | bigint

  /**
   * Creates a new CantonChain instance.
   * @param provider - Canton provider instance, provides all connectivity
   * @param client - Canton Ledger API client.
   * @param acsDisclosureProvider - ACS-based disclosure provider.
   * @param edsDisclosureProvider - EDS-based disclosure provider.
   * @param tokenMetadataClient - Token Metadata API client.
   * @param ccipParty - The party ID to use for CCIP operations
   * @param indexerUrl - Base URL of the CCV indexer service.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   */
  private constructor(
    provider: CantonRpcProvider,
    ledgerApiClient: LedgerApiClient,
    partyId: string,
    acsDisclosureProvider: AcsDisclosureProvider,
    edsProvider: EdsProvider,
    tokenStandardClientProvider: TokenStandardClientProvider,
    ccipParty: string,
    nativeToken: CantonTokenInfo,
    indexerUrl: string,
    network: NetworkInfo<typeof ChainFamily.Canton>,
    ctx?: ChainContext,
  ) {
    super(network, ctx)
    this.provider = provider
    this.ledgerApiClient = ledgerApiClient
    this.activeParty = parsePartyId(partyId)
    this.edsProvider = edsProvider
    this.tokenStandardClientProvider = tokenStandardClientProvider
    this.network = network
    this.acsDisclosureProvider = acsDisclosureProvider
    this.nativeToken = nativeToken
    // this.tokenMetadataClient = tokenMetadataClient
    this.ccipParty = parsePartyId(ccipParty)
    this.indexerUrl = indexerUrl
    this.fetchFn = ctx?.fetch ?? globalThis.fetch.bind(globalThis)
    this.ccvs = ctx?.cantonConfig?.ccvs?.map((ccv) => RawInstanceAddress.fromString(ccv)) ?? []
    this.ccipPackages = {
      perPartyRouter: ctx?.cantonConfig?.packages?.perPartyRouter ?? 'ccip-runtime-v2',
      ccipSender: ctx?.cantonConfig?.packages?.ccipSender ?? 'ccip-sender-v2',
      ccipReceiver: ctx?.cantonConfig?.packages?.ccipReceiver ?? 'ccip-receiver-v2',
    }
    this.feeTransferFactoryAmount = resolveFeeTransferFactoryAmount(ctx?.cantonConfig)
    this.defaultSendGasLimit = ctx?.cantonConfig?.defaultSendGasLimit
  }

  /**
   * Mapping from lower-cased CAIP-2 chain ID variants to the chain's default values
   */
  private static readonly CAIP2_TO_CHAIN_DEFAULTS: ReadonlyMap<
    string,
    {
      chainId: string
      ccipPartyId: string
      edsUrls: ReadonlyMap<string, string>
      tokenStandardUrls: ReadonlyMap<string, string>
      indexerUrls: ReadonlyArray<string>
      nativeToken: CantonTokenInfo
    }
  > = new Map([
    [
      'canton:localnet',
      {
        chainId: 'canton:LocalNet',
        ccipPartyId: '',
        edsUrls: new Map(),
        tokenStandardUrls: new Map(),
        indexerUrls: [],
        nativeToken: {
          instrumentId: '',
          symbol: '',
          decimals: 0,
        },
      },
    ],
    [
      'canton:devnet',
      {
        chainId: 'canton:DevNet',
        ccipPartyId: '',
        edsUrls: new Map(),
        tokenStandardUrls: new Map(),
        indexerUrls: [],
        nativeToken: {
          instrumentId:
            'Amulet@DSO::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a',
          symbol: 'CC',
          decimals: 10,
        },
      },
    ],
    [
      'canton:testnet',
      {
        chainId: 'canton:TestNet',
        ccipPartyId:
          'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
        edsUrls: new Map([
          [
            'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
            'https://eds.testnet.ccip.chain.link',
          ],
          [
            'ccvOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
            'https://eds.testnet.ccip.chain.link',
          ],
          ['*', 'https://eds.testnet.ccip.chain.link'],
        ]),
        tokenStandardUrls: new Map([
          [
            'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
            'https://eds.testnet.ccip.chain.link',
          ],
          ['*', 'https://eds.testnet.ccip.chain.link'],
        ]),
        indexerUrls: TESTNET_INDEXER_URLS,
        nativeToken: {
          instrumentId:
            'Amulet@DSO::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337',
          symbol: 'CC',
          decimals: 10,
        },
      },
    ],
    [
      'canton:mainnet',
      {
        chainId: 'canton:MainNet',
        ccipPartyId:
          'ccipOwner::122012714685760dc1927c4cfe119ce2126c48756154e95c06f5c181da05a5519093',
        edsUrls: new Map([
          [
            'ccipOwner::122012714685760dc1927c4cfe119ce2126c48756154e95c06f5c181da05a5519093',
            'https://eds.ccip.chain.link',
          ],
          [
            'ccvOwner::122096accf0a84fc7d80d5fce5ea3135317a03eb22e62e0d8cdd7548865f984f11ff',
            'https://eds.ccip.chain.link',
          ],
          ['*', 'https://eds.ccip.chain.link'],
        ]),
        tokenStandardUrls: new Map([
          [
            'ccipOwner::122012714685760dc1927c4cfe119ce2126c48756154e95c06f5c181da05a5519093',
            'https://eds.ccip.chain.link',
          ],
          ['*', 'https://eds.ccip.chain.link'],
        ]),
        indexerUrls: MAINNET_INDEXER_URLS,
        nativeToken: {
          instrumentId:
            'Amulet@DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc',
          symbol: 'CC',
          decimals: 10,
        },
      },
    ],
  ])

  // Instantiate a new CantonChain using the given provider.
  // TODO: ctx must be optional, use reasonable defaults
  static async fromProvider(provider: CantonRpcProvider, ctx?: ChainContext): Promise<CantonChain> {
    // Check that ctx has the necessary cantonConfig
    if (!ctx || !ctx.cantonConfig) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.fromUrl: ctx.cantonConfig is required',
      )
    }

    // Detect active network using provider
    const activeNetwork = await provider.request({ method: 'getActiveNetwork' })

    // Resolve chain defaults using the CAIP-2 network ID
    const chainDefaults = this.CAIP2_TO_CHAIN_DEFAULTS.get(activeNetwork.networkId.toLowerCase())
    if (!chainDefaults?.chainId) {
      throw new CCIPChainNotFoundError(activeNetwork.networkId)
    }

    // Determine Party ID and set up listener to update if provider changes primary party
    const primaryAccount = await provider.request({
      method: 'getPrimaryAccount',
    })
    const partyId = primaryAccount.partyId
    ctx.logger?.info(`Using primary party ${partyId} from provider`)
    // Listen for account changes and update activeParty if required
    provider.on<AccountsChangedEvent>('accountsChanged', (wallets) => {
      const primaryParty = wallets.find((w) => w.primary)
      ctx.logger?.info(`Primary party changed to ${primaryParty?.partyId}`)
    })

    // Create EDS provider, using defaults + optional config overrides
    const edsProvider = new EdsProvider({
      edsUrlsByOwner: {
        ...Object.fromEntries(chainDefaults.edsUrls),
        ...ctx.cantonConfig.externalEdsUrlsByOwner,
      },
    })

    // Create Token Standard API provider, using defaults + optional config overrides
    const tokenStandardClientProvider = new TokenStandardClientProvider({
      urlsByAdmin: {
        ...Object.fromEntries(chainDefaults.tokenStandardUrls),
        // TODO: add token standard config overrides - currently only EDS overrides exist
      },
    })

    // Create Ledger API client from provider
    const ledgerApiClient = createLedgerApiClientFromProvider(provider)

    // Resolve indexer URL
    // TODO: can we just reuse the existing fetch logic here?
    const indexerUrl = ctx.cantonConfig.indexerUrl ?? chainDefaults.indexerUrls[0]
    if (!indexerUrl) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.fromUrl: Unable to resolve indexer URL',
      )
    }

    const acsDisclosureProvider = new AcsDisclosureProvider(ledgerApiClient, {
      party: partyId, // TODO use this.activeParty instead, as primary party can change
      packages: ctx.cantonConfig.packages,
      logger: ctx.logger,
    })

    return new this(
      provider,
      ledgerApiClient,
      partyId,
      acsDisclosureProvider,
      edsProvider,
      tokenStandardClientProvider,
      chainDefaults.ccipPartyId,
      chainDefaults.nativeToken,
      indexerUrl,
      networkInfo(chainDefaults.chainId) as NetworkInfo<typeof ChainFamily.Canton>,
      ctx,
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
    if (!ctx || !ctx.cantonConfig) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.fromUrl: ctx.cantonConfig is required',
      )
    }

    return this.fromProvider(ctx.cantonConfig.provider, ctx)
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
   * UpdateFormat for `/v2/updates/update-by-id` that returns the full
   * transaction (all events visible to the party, with create arguments but
   * without raw created-event blobs).
   */
  private transactionUpdateFormat(): UpdateFormat {
    return {
      includeTransactions: {
        eventFormat: {
          filtersByParty: {
            [this.activeParty]: {
              cumulative: [
                {
                  identifierFilter: {
                    WildcardFilter: {
                      value: {
                        includeCreatedEventBlob: false,
                      },
                    },
                  },
                },
              ],
            },
          },
          verbose: true,
        },
        transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
      },
    } as UpdateFormat
  }

  /**
   * Fetches a Canton transaction (update) by its update ID.
   *
   * The ledger is queried via `/v2/updates/transaction-by-id` scoped to
   * the provider's party so restricted participant nodes allow the lookup.
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
    const response = await this.ledgerApiClient.getUpdateById(hash, this.transactionUpdateFormat())
    if (!response.update) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton update response did not include an update for hash ${hash}`,
      )
    }
    const update: Update = response.update
    if (!('Transaction' in update)) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton update for hash ${hash} is not a Transaction update`,
      )
    }
    const tx: JsTransaction = update.Transaction.value

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
   * the full Canton fee-token string (`"id@admin"`); the registry is keyed by
   * the local `id` portion.
   */
  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    // Special case: for native we can't fetch from scan proxy, we therefore have the native token info hardcoded
    if (token === this.nativeToken.instrumentId) {
      return {
        symbol: this.nativeToken.symbol,
        decimals: this.nativeToken.decimals,
      }
    }

    const instrumentId = parseCantonInstrumentId(token)
    const registryInfoResult = await this.tokenStandardClientProvider
      .tokenMetadataV1ClientFor(instrumentId)
      .GET('/registry/metadata/v1/instruments/{instrumentId}', {
        params: {
          path: {
            instrumentId: instrumentId.id,
          },
        },
      })
    if (registryInfoResult.error) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Failed to get token info for instrumentId ${instrumentId.id}: ${registryInfoResult.error.error}`,
      )
    }

    return {
      symbol: registryInfoResult.data.symbol,
      decimals: registryInfoResult.data.decimals,
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
    const senderPartyId = parsePartyId(sender)

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
    const feeTokenInstrumentId = parseCantonInstrumentId(message.feeToken)
    const feeTokenHoldingCids = cantonArgs.feeTokenHoldingCids // TODO - fetch here
    const receiverHex = stripHexPrefix(
      typeof message.receiver === 'string' ? message.receiver : hexlify(message.receiver),
    )
    const payloadHex = message.data
      ? stripHexPrefix(typeof message.data === 'string' ? message.data : hexlify(message.data))
      : ''
    const hasPayload = Boolean(message.data && dataLength(message.data))
    const tokenAmounts = message.tokenAmounts ?? []
    const tokenOnly = tokenAmounts.length === 1 && !hasPayload
    const gasLimit = resolveCantonSendGasLimit(cantonArgs.gasLimit, tokenOnly, {
      defaultSendGasLimit: this.defaultSendGasLimit,
    })
    const executorType = (() => {
      switch (
        cantonArgs.executorMode // TODO: Add 'withAddress' support
      ) {
        case 'none':
          return 'noExecutor'
        case 'default':
        default:
          return ''
      }
    })()
    const senderRequiredCCVs = cantonArgs.ccvRawAddresses
      ? cantonArgs.ccvRawAddresses.map((ccv) => RawInstanceAddress.fromString(ccv))
      : this.ccvs
    if (cantonArgs.ccvRawAddresses === undefined && this.ccvs.length) {
      this.logger.debug(
        'CantonChain.generateUnsignedSendMessage: using ccvs from canton config for senderRequiredCCVs',
        this.ccvs,
      )
    }

    this.logger.debug('CantonChain.generateUnsignedSendMessage: fetching ACS disclosures')

    if (tokenAmounts.length > 1) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.generateUnsignedSendMessage: only one token transfer is supported, got ${tokenAmounts.length}`,
      )
    }

    const acsDisclosures = await this.ensureSendDisclosures(senderPartyId) // TODO - remove disclosed contract return

    // Build the OApi message for EDS lookups
    let oapiMessage: Message = {
      destinationChainSelector: destChainSelector.toString(),
      sender: sender,
      receiver: receiverHex,
      payload: payloadHex,
      tokenTransfer: undefined,
      feeToken: feeTokenInstrumentId,
      executor: {
        type: executorType,
      },
      gasLimit: Number(gasLimit),
    }

    // Build choice arguments for CCIPSender.Send
    const sendArgs: Send = {
      destinationChainSelector: destChainSelector.toString(),
      message: {
        receiver: receiverHex,
        payload: payloadHex,
        tokenTransfer: null,
        feeToken: {
          admin: feeTokenInstrumentId.admin,
          id: feeTokenInstrumentId.id,
        },
        extraArgs: {
          tag: 'V3',
          value: {
            gasLimit: encodeDamlInt64(gasLimit),
            ccvs: [],
            executor: {
              tag: 'Executor_UseDefault',
              value: { executorArgs: '' } as ExecutorExtraArg.Executor_UseDefault,
            },
            tokenArgs: '',
            tokenReceiver: '',
          } as GenericExtraArgsV3,
        },
      },
      routerCid: acsDisclosures.perPartyRouter.contractId as damlTypes.ContractId<PerPartyRouter>,
      feeTokenInput: {
        senderInputCids: feeTokenHoldingCids.map((cid) => cid as damlTypes.ContractId<Holding>),
        feeTokenConfigCid: '' as damlTypes.ContractId<ITokenConfig>,
        feeTokenTransferFactory: '' as damlTypes.ContractId<TransferFactory>,
        feeTokenExtraArgs: undefined,
      },
      ccvSendInputs: [],
      tokenTransferInput: null,
      executorInput: null,
      context: null,
    }

    // Collect all disclosed contracts
    let disclosedContracts: DisclosedContract[] = []

    // If the message contains a token transfer, get the token transfer inputs
    let tokenPoolRequiredCCVs: RawInstanceAddress[] = []
    if (tokenAmounts.length === 1) {
      const tokenAmount = tokenAmounts[0]!
      if (tokenAmount.amount <= 0n) {
        throw new CCIPError(
          CCIPErrorCode.METHOD_UNSUPPORTED,
          'CantonChain.generateUnsignedSendMessage: token transfer amount must be greater than zero',
        )
      }

      const tokenInstrument = parseCantonInstrumentId(tokenAmount.token)
      const tokenAmountDecimal = formatCantonDecimalAmountUnits(tokenAmount.amount)

      // Get token holdings
      const tokenHoldings = await this.resolveTokenTransferHoldings({
        party: sender,
        instrumentId: tokenInstrument,
        explicitHoldingCids: cantonArgs.tokenTransferHoldingCids,
        feeTokenHoldingCids,
        requiredAmount: tokenAmount.amount,
      })
      oapiMessage.tokenTransfer = {
        token: { admin: tokenInstrument.admin, id: tokenInstrument.id },
        amount: tokenAmountDecimal,
        holdingContractIds: tokenHoldings.map((holding) => holding.contractId),
      }

      // Query CCIP EDS to use the TAR to resolve instrumentId -> token pool address
      const tokenAdminRegistryGetTokenResponse = await this.edsProvider
        .ccipClientFor(this.ccipParty)
        .GET('/ccip/v1/global/TokenAdminRegistry/token/{instrumentId}', {
          params: {
            path: {
              instrumentId: hashCantonInstrumentId(tokenInstrument),
            },
          },
        })
      if (tokenAdminRegistryGetTokenResponse.error) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `CantonChain.generateUnsignedSendMessage: failed to fetch token admin registry token for ${formatInstrumentId(tokenInstrument)}: ${tokenAdminRegistryGetTokenResponse.error.error}`,
        )
      }
      const tokenPoolAddress = RawInstanceAddress.fromString(
        tokenAdminRegistryGetTokenResponse.data.rawInstanceAddress,
      )
      if (cantonArgs.tokenPoolAddress) {
        // TODO: is this needed?
        const parsedTokenPoolAddress = parseInstanceAddress(cantonArgs.tokenPoolAddress)
        if (!parsedTokenPoolAddress.instanceAddress().equals(tokenPoolAddress.instanceAddress())) {
          throw new CCIPError(
            CCIPErrorCode.METHOD_UNSUPPORTED,
            `CantonChain.generateUnsignedSendMessage: tokenPoolAddress ${cantonArgs.tokenPoolAddress} does not match registry token pool ${tokenPoolAddress.toString()}`,
          )
        }
      }

      // Token pool disclosures
      const tokenPoolSendDisclosuresResponse = await this.edsProvider
        .tokenPoolClientFor(tokenPoolAddress.owner)
        .POST('/ccip/v1/external/tokenPool/{address}/send', {
          params: {
            path: {
              address: tokenPoolAddress.toInstanceAddress().toString(),
            },
          },
          body: {
            message: oapiMessage,
          },
        })
      if (tokenPoolSendDisclosuresResponse.error) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `CantonChain.generateUnsignedSendMessage: failed to fetch token pool send disclosures for ${tokenPoolAddress.toString()}: ${tokenPoolSendDisclosuresResponse.error.error}`,
        )
      }

      // Add to output
      tokenPoolRequiredCCVs.push(
        ...tokenPoolSendDisclosuresResponse.data.requiredCCVs.map(
          (ccv: string): RawInstanceAddress => RawInstanceAddress.fromString(ccv),
        ),
      )
      disclosedContracts.push(...tokenPoolSendDisclosuresResponse.data.disclosedContracts)
      sendArgs.message.tokenTransfer = {
        token: { admin: tokenInstrument.admin, id: tokenInstrument.id },
        amount: tokenAmountDecimal,
      }
      sendArgs.tokenTransferInput = {
        tokenPoolCid: tokenPoolSendDisclosuresResponse.data
          .contractId as damlTypes.ContractId<ITokenPool>,
        senderInputCids: tokenHoldings.map(
          (holding) => holding.contractId as damlTypes.ContractId<Holding>,
        ),
        context: tokenPoolSendDisclosuresResponse.data.contextData,
      }
    }

    // CCIP Disclosures
    const ccipSendDisclosuresResponse = await this.edsProvider
      .ccipClientFor(this.ccipParty)
      .POST('/ccip/v1/global/message/send', {
        params: {},
        body: {
          message: oapiMessage,
          senderRequiredCCVs: senderRequiredCCVs.map((ccv) => ccv.toString()),
          tokenPoolRequiredCCVs: tokenPoolRequiredCCVs.map((ccv) => ccv.toString()),
        },
      })
    if (ccipSendDisclosuresResponse.error) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `CantonChain.generateUnsignedSendMessage: failed to fetch CCIP send disclosures: ${ccipSendDisclosuresResponse.error.error}`,
      )
    }

    // EDS v1.1.0 added support for returning a fee token's transfer factory + choice context.
    // We only have access to a Canton provider here, which when using CIP-103 doesn't allow for
    // fetching the Scan Proxy API. When using native/CC as a fee token, we'd have to use that API
    // to fetch the transfer factory.
    // To mitigate this, we're entirely relying on EDS to return these fields. EDS should be
    // configured to return both context + transfer factory CID for all allowed fee tokens.
    if (!ccipSendDisclosuresResponse.data.feeTokenTransferFactoryCid) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'CantonChain.generateUnsignedSendMessage: EDS did not return a feeTokenTransferFactoryCid; ' +
          'ensure you are using a valid and supported fee token',
      )
    }

    // Add to output
    disclosedContracts.push(...ccipSendDisclosuresResponse.data.disclosedContracts)
    sendArgs.context = ccipSendDisclosuresResponse.data.contextData
    sendArgs.feeTokenInput.feeTokenConfigCid = ccipSendDisclosuresResponse.data
      .feeTokenConfigCid as damlTypes.ContractId<ITokenConfig>
    sendArgs.feeTokenInput.feeTokenTransferFactory = ccipSendDisclosuresResponse.data
      .feeTokenTransferFactoryCid as damlTypes.ContractId<TransferFactory>
    sendArgs.feeTokenInput.feeTokenExtraArgs = {
      context: ccipSendDisclosuresResponse.data.feeTokenTransferFactoryContext,
      meta: { values: {} },
    }

    // CCV Disclosures
    const ccvSendResults = await Promise.all(
      ccipSendDisclosuresResponse.data.ccvs.map(async (ccvAddress) => {
        const ccvInstanceAddress = parseInstanceAddress(ccvAddress)
        const ccvSendDisclosuresResponse = await this.edsProvider
          .ccvClientFor(ccvInstanceAddress)
          .POST('/ccip/v1/external/ccv/{address}/send', {
            params: {
              path: {
                address: ccvInstanceAddress.toString(),
              },
            },
            body: {
              message: oapiMessage,
            },
          })
        if (ccvSendDisclosuresResponse.error) {
          throw new CCIPError(
            CCIPErrorCode.CANTON_API_ERROR,
            `CantonChain.generateUnsignedSendMessage: failed to fetch CCV disclosure for ${ccvInstanceAddress.toString()}: ${ccvSendDisclosuresResponse.error.error}`,
          )
        }
        return ccvSendDisclosuresResponse
      }),
    )
    ccvSendResults.forEach((result) => {
      const ccvAddress = RawInstanceAddress.fromString(result.data.rawInstanceAddress)
      disclosedContracts.push(...result.data.disclosedContracts)
      sendArgs.ccvSendInputs.push({
        ccvAddress: ccvAddress.binding(),
        ccvCid: result.data.contractId as damlTypes.ContractId<ICrossChainVerifier>,
        context: result.data.contextData,
      })
    })

    // Executor Disclosures
    if (ccipSendDisclosuresResponse.data.executor) {
      const executorAddress = RawInstanceAddress.fromString(
        ccipSendDisclosuresResponse.data.executor,
      )
      const executorDisclosuresResponse = await this.edsProvider
        .executorClientFor(executorAddress.owner)
        .POST('/ccip/v1/external/executor/{address}/send', {
          params: {
            path: {
              address: executorAddress.toString(),
            },
          },
          body: {
            message: oapiMessage,
            ccvs: ccipSendDisclosuresResponse.data.ccvs,
          },
        })
      if (executorDisclosuresResponse.error) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `CantonChain.generateUnsignedSendMessage: failed to fetch executor disclosure for ${executorAddress.toString()}: ${executorDisclosuresResponse.error.error}`,
        )
      }
      disclosedContracts.push(...executorDisclosuresResponse.data.disclosedContracts)
      sendArgs.executorInput = {
        executorCid: executorDisclosuresResponse.data.contractId as damlTypes.ContractId<IExecutor>,
        context: executorDisclosuresResponse.data.contextData,
      }
    }

    const exerciseCommand = {
      ExerciseCommand: {
        templateId: acsDisclosures.ccipSender.templateId,
        contractId: acsDisclosures.ccipSender.contractId,
        choice: 'Send',
        choiceArgument: sendArgs,
      },
    }

    this.logger.debug('SendArgs:', sendArgs)
    this.logger.debug('DisclosedContracts:', disclosedContracts)

    const jsCommands: JsCommands = {
      commands: [exerciseCommand],
      commandId: `ccip-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [sender],
      disclosedContracts: disclosedContracts,
    }

    this.logger.debug(
      `CantonChain.generateUnsignedSendMessage: built command with ${ccipSendDisclosuresResponse.data.disclosedContracts.length} disclosed contracts`,
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
    // The provider takes care of signing/submission — the wallet opt is unused
    // on Canton; the acting party is the chain's active party.
    const senderPartyId = this.activeParty

    const message = await this.fillCantonSendDefaults(opts.message, senderPartyId)

    await this.ensureSendDisclosures(senderPartyId)

    const unsigned = await this.generateUnsignedSendMessage({
      ...opts,
      message,
      sender: senderPartyId,
    })

    this.logger.debug(`CantonChain.sendMessage: submitting command`)

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.submitCommands(unsigned.commands, 'Send Message')
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
      from: senderPartyId,
    }

    const ccipMessage = {
      messageId: sendResult.messageId,
      encodedMessage: normalizeCantonEncodedMessage(sendResult.encodedMessage),
      sourceChainSelector: this.network.chainSelector,
      destChainSelector: opts.destChainSelector,
      sequenceNumber: sendResult.sequenceNumber,
      nonce: sendResult.nonce ?? 0n,
      sender: senderPartyId,
      receiver:
        typeof opts.message.receiver === 'string'
          ? opts.message.receiver
          : String(opts.message.receiver),
      data: normalizeCantonEncodedMessage(sendResult.encodedMessage),
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
   * @param opts - {@link ExecuteOpts} with `offRamp` + `input`, or `{ messageId }` when
   *   `apiClient` is configured (fetches execution inputs from the CCIP API).
   *   `input` must contain `encodedMessage` and `verifications` (CCIP v2.0).
   *   `payer` is the Daml party ID used for `actAs`.
   * @returns An {@link UnsignedCantonTx} wrapping the ready-to-submit
   *   `JsCommands`.
   */
  override async generateUnsignedExecute(
    opts: Parameters<Chain['generateUnsignedExecute']>[0],
  ): Promise<UnsignedCantonTx> {
    const { payer, ...executeOpts } = opts
    const cantonOpts = opts as typeof opts & { _cantonReceiverCid?: string }
    const resolved = await this.resolveExecuteOpts(executeOpts)

    if (!payer) {
      throw new CCIPError(
        CCIPErrorCode.WALLET_INVALID,
        'CantonChain.generateUnsignedExecute: payer (party ID) is required',
      )
    }
    const receiverPartyId = parsePartyId(payer)

    const { input } = resolved

    // v2.0 input shape: { encodedMessage, verifications }
    if (!('encodedMessage' in input) || !('verifications' in input)) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.generateUnsignedExecute: only CCIP v2.0 ExecutionInput ' +
          '(encodedMessage + verifications) is supported',
      )
    }

    const { encodedMessage, verifications } = input
    const verifierAddresses = verifications.map((v) => parseInstanceAddress(v.destAddress))

    // TODO: This should include receiverCid when provided. We need to figure out how to get that from the input or opts.
    this.logger.debug(
      'CantonChain.generateUnsignedExecute: fetching ACS disclosures for CCIPReceiver and PerPartyRouter...',
    )
    // Check opts for a pre-resolved receiver CID (threaded from execute() after find/create).
    const acsDisclosures = await this.acsDisclosureProvider.fetchExecutionDisclosures(
      // TODO remove disclosed contracts return from this
      cantonOpts._cantonReceiverCid,
    )

    const encodedMessageHex = stripHexPrefix(String(encodedMessage))

    // Build choice arguments for CCIPReceiver.Execute
    const executeArgs: Execute = {
      routerCid: acsDisclosures.perPartyRouter.contractId as damlTypes.ContractId<PerPartyRouter>,
      encodedMessage: encodedMessageHex,
      context: {},
      ccvInputs: [],
      tokenTransfer: null,
    }

    // Collect all disclosed contracts
    let disclosedContracts: DisclosedContract[] = []

    // Fetch CCIP disclosures
    this.logger.debug('CantonChain.generateUnsignedExecute: fetching global EDS execute data...')
    const ccipExecuteDisclosuresResult = await this.edsProvider
      .ccipClientFor(this.ccipParty)
      .POST('/ccip/v1/global/message/execute', {
        body: {
          encodedMessage: encodedMessageHex,
          receiver: receiverPartyId.toString(),
        },
      })
    if (ccipExecuteDisclosuresResult.error) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `CantonChain.generateUnsignedExecute: failed to fetch global EDS execute disclosures: ${ccipExecuteDisclosuresResult.error.error}`,
      )
    }
    disclosedContracts.push(...ccipExecuteDisclosuresResult.data.disclosedContracts)
    executeArgs.context = ccipExecuteDisclosuresResult.data.contextData

    // Fetch CCV Disclosures
    const ccvExecuteResults = await Promise.all(
      verifierAddresses.map(async (verifierAddress) => {
        this.logger.debug('CantonChain.generateUnsignedExecute: CCV execute EDS address', {
          verifierAddress,
        })
        const ccvDisclosureResult = await this.edsProvider
          .ccvClientFor(verifierAddress)
          .POST('/ccip/v1/external/ccv/{address}/execute', {
            params: {
              path: {
                address: verifierAddress.toString(),
              },
            },
            body: {
              encodedMessage: encodedMessageHex,
              receiver: receiverPartyId.toString(),
            },
          })
        if (ccvDisclosureResult.error) {
          throw new CCIPError(
            CCIPErrorCode.CANTON_API_ERROR,
            `CantonChain.generateUnsignedExecute: failed to fetch CCV execute disclosures for verifier ${verifierAddress.toString()}: ${ccvDisclosureResult.error.error}`,
          )
        }
        return ccvDisclosureResult
      }),
    )
    ccvExecuteResults.forEach((result, index) => {
      const verification = verifications[index]!
      disclosedContracts.push(...result.data.disclosedContracts)
      executeArgs.ccvInputs.push({
        ccvCid: result.data.contractId as damlTypes.ContractId<ICrossChainVerifier>,
        verifierResults: stripHexPrefix(String(verification.ccvData)),
        context: result.data.contextData,
      })
    })

    // Fetch Token Transfer Disclosures (if token transfer)
    if (ccipExecuteDisclosuresResult.data.tokenPool) {
      const tokenPoolAddress = RawInstanceAddress.fromString(
        ccipExecuteDisclosuresResult.data.tokenPool,
      )
      this.logger.debug(
        `CantonChain.generateUnsignedExecute: token pool present; fetching token pool disclosures for ${tokenPoolAddress.toString()}...`,
      )
      const tokenPoolExecuteDisclosureResult = await this.edsProvider
        .tokenPoolClientFor(tokenPoolAddress)
        .POST('/ccip/v1/external/tokenPool/{address}/execute', {
          params: {
            path: {
              address: tokenPoolAddress.toString(),
            },
          },
          body: {
            encodedMessage: encodedMessageHex,
            receiver: receiverPartyId.toString(),
          },
        })
      if (tokenPoolExecuteDisclosureResult.error) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `CantonChain.generateUnsignedExecute: failed to fetch token pool execute disclosures for ${tokenPoolAddress.toString()}: ${tokenPoolExecuteDisclosureResult.error.error}`,
        )
      }
      assertRequiredCcvsCovered(
        tokenPoolExecuteDisclosureResult.data.requiredCCVs.map((ccvAddress) =>
          parseInstanceAddress(ccvAddress),
        ),
        verifierAddresses,
      ) // TODO is this needed?
      disclosedContracts.push(...tokenPoolExecuteDisclosureResult.data.disclosedContracts)
      executeArgs.tokenTransfer = {
        tokenPoolCid: tokenPoolExecuteDisclosureResult.data
          .contractId as damlTypes.ContractId<ITokenPool>,
        tokenReceiverParty: receiverPartyId.toString(),
        context: tokenPoolExecuteDisclosureResult.data.contextData,
      }
    }

    // Step 7 — Build the ExerciseCommand
    const exerciseCommand = {
      ExerciseCommand: {
        templateId: acsDisclosures.ccipReceiver.templateId,
        contractId: acsDisclosures.ccipReceiver.contractId,
        choice: 'Execute',
        choiceArgument: executeArgs,
      },
    }

    // Step 8 — Assemble JsCommands
    const jsCommands: JsCommands = {
      commands: [exerciseCommand],
      commandId: `ccip-execute-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [receiverPartyId],
      disclosedContracts: dedupeDisclosedContracts(disclosedContracts),
    }

    return {
      family: ChainFamily.Canton,
      commands: jsCommands,
    }
  }

  /**
   * Executes a CCIP message on Canton by:
   * 1. Building the unsigned command via {@link generateUnsignedExecute}.
   * 2. Submitting the command to the Canton Ledger API.
   * 3. Parsing the resulting transaction into a {@link CCIPExecution}.
   *
   * The wallet opt is unused on Canton (the provider takes care of
   * signing/submission); @throws {@link CCIPError} if the Ledger API
   * submission or result parsing fails.
   */
  async execute(opts: Parameters<Chain['execute']>[0]): Promise<CCIPExecution> {
    this.logger.debug(`CantonChain.execute: executing message with opts=${JSON.stringify(opts)}`)
    const { wallet: _wallet, ...executeOpts } = opts
    void _wallet
    const partyId = this.activeParty

    const resolved = await this.resolveExecuteOpts(executeOpts)
    if (!('encodedMessage' in resolved.input) || !('verifications' in resolved.input)) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.execute: only CCIP v2.0 ExecutionInput ' +
          '(encodedMessage + verifications) is supported',
      )
    }

    const { encodedMessage, verifications } = resolved.input
    const encodedMessageHex = stripHexPrefix(String(encodedMessage))
    if (verifications.length === 0) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'CantonChain.execute: verifications array is empty; at least one verification is required',
      )
    }
    this.logger.debug(
      `CantonChain.execute: executing message with ${verifications.length} verifications...`,
    )
    // TODO: This must be updated to work with third-party CCVs.
    //  CCIP API should return the RawInstanceAddress as destAddress, instead of the hashed address
    //  just like the Indexer already does.
    // The indexer/canton-config may carry the CCV as a keccak256 InstanceAddress hash
    // (32 bytes), but the Daml CCIPReceiver.requiredCCVs field expects the raw
    // RawInstanceAddress.unpack string (e.g. "committeeverifier-…@ccvOwner::1220…").
    // Resolve the raw form via EDS before creating/updating the receiver so that
    // requiredCCVs matches the CCV contract's instance address at Execute time.
    const verifierAddresses: RawInstanceAddress[] = await Promise.all(
      verifications.map(async (v) => {
        const verifierAddress = parseInstanceAddress(v.destAddress)
        if (verifierAddress instanceof RawInstanceAddress) {
          this.logger.debug(
            `CantonChain.execute: verifier address ${verifierAddress.toString()} is already a RawInstanceAddress`,
          )
          return verifierAddress
        } else if (verifierAddress instanceof InstanceAddress) {
          this.logger.debug(
            `CantonChain.execute: resolving verifier address ${verifierAddress.toString()} to a RawInstanceAddress via EDS...`,
          )
          const ccvDisclosureResult = await this.edsProvider
            .ccvClientFor(verifierAddress)
            .POST('/ccip/v1/external/ccv/{address}/execute', {
              params: {
                path: {
                  address: verifierAddress.toString(),
                },
              },
              body: {
                encodedMessage: encodedMessageHex,
                receiver: partyId.toString(),
              },
            })
          if (ccvDisclosureResult.error) {
            throw new CCIPError(
              CCIPErrorCode.CANTON_API_ERROR,
              `CantonChain.execute: error executing CCV ${verifierAddress.toString()}: ${ccvDisclosureResult.error.error}`,
            )
          }
          return RawInstanceAddress.fromString(ccvDisclosureResult.data.rawInstanceAddress)
        } else {
          throw new CCIPError(
            CCIPErrorCode.METHOD_UNSUPPORTED,
            `CantonChain.execute: unable to resolve verifier address ${v.destAddress} to a RawInstanceAddress`,
          )
        }
      }),
    )
    const finality = decodeFinalityFromEncodedMessage(encodedMessageHex)
    const receiverHint = typeof opts.receiver === 'string' ? opts.receiver.trim() : ''

    this.logger.debug(
      `CantonChain.execute: message finality=${finality}, resolving CCIPReceiver` +
        (receiverHint ? ` (hint=${receiverHint})` : '') +
        (verifierAddresses.length > 0
          ? ` (attestation CCVs=${verifierAddresses.map((v) => v.toString()).join(',')})`
          : '') +
        '...',
    )

    const receiverCid = await this.ensureReceiverForExecute(
      partyId,
      finality,
      verifierAddresses,
      receiverHint || undefined,
    )
    this.logger.debug(`CantonChain.execute: using CCIPReceiver contractId=${receiverCid}`)

    // Build the unsigned command, passing the resolved receiver CID via Canton-specific opts.
    const unsigned = await this.generateUnsignedExecute({
      offRamp: resolved.offRamp,
      input: resolved.input,
      receiver: opts.receiver,
      payer: partyId,
      _cantonReceiverCid: receiverCid,
    } as unknown as Parameters<Chain['generateUnsignedExecute']>[0])

    // Submit and wait for the full transaction (so we get events back)
    const response = await this.submitCommands(unsigned.commands, 'Execute Message')
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
   * Submit a command to the ledger via the provider.
   *
   * The provider takes care of signing and submitting: the browser dApp
   * wallet signs with the user's key, while the CLI provider submits
   * JWT-authenticated via the participant.
   */
  private async submitCommands(
    commands: JsCommands,
    reason: string = 'submit command',
  ): Promise<JsSubmitAndWaitForTransactionResponse> {
    const { tx } = await this.provider.request({
      method: 'prepareExecuteAndWait',
      params: {
        commandId: commands.commandId,
        commands: commands.commands,
        actAs: commands.actAs,
        readAs: commands.readAs,
        disclosedContracts: commands.disclosedContracts,
        synchronizerId: commands.synchronizerId,
      },
    })
    this.logger.debug(`Canton: submitted command (${reason}), update ${tx.payload.updateId}`)

    // The executed event only reports the update ID — fetch the full
    // committed transaction so callers can parse receipts and events.
    const { update } = await this.ledgerApiClient.getUpdateById(
      tx.payload.updateId,
      this.transactionUpdateFormat(),
    )
    if (!update || !('Transaction' in update)) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton update ${tx.payload.updateId} is not a Transaction update`,
      )
    }
    return { transaction: update.Transaction.value }
  }

  /**
   * Find or create a `CCIPReceiver` for execute, setting `requiredCCVs` from the
   * indexer attestation's verifierAddresses.
   */
  private async ensureReceiverForExecute(
    partyId: PartyId,
    finality: number,
    verifierAddresses: RawInstanceAddress[],
    hint?: string,
  ): Promise<string> {
    const existingReceiver = await this.acsDisclosureProvider.findReceiverMatchForExecute(
      finality,
      hint,
    )

    if (existingReceiver?.contractId) {
      if (addressesMatch(existingReceiver.requiredCCVs, verifierAddresses)) {
        this.logger.debug(
          `CantonChain.ensureReceiverForExecute: using CCIPReceiver ${existingReceiver.contractId} (finality=${finality})`,
          `requiredCCVs=${existingReceiver.requiredCCVs.map((addr) => addr.toString()).join(', ')}`,
        )
        return existingReceiver.contractId
      }

      this.logger.debug(
        `CantonChain.ensureReceiverForExecute: updating CCIPReceiver ${existingReceiver.contractId} requiredCCVs`,
        `requiredCCVs=${verifierAddresses.map((addr) => addr.toString()).join(', ')}`,
      )
      return this.updateReceiverRequiredCCVs(
        existingReceiver.contractId,
        verifierAddresses,
        partyId,
      )
    }

    this.logger.debug(
      `CantonChain.ensureReceiverForExecute: no CCIPReceiver with finality=${finality} — creating one`,
      `verifierAddresses=${verifierAddresses.map((addr) => addr.toString()).join(', ')}`,
    )
    return this.createReceiverForFinality(partyId, finality, verifierAddresses)
  }

  /**
   * Exercise `UpdateRequiredCCVs` on an existing `CCIPReceiver` contract.
   */
  private async updateReceiverRequiredCCVs(
    receiverCid: string,
    requiredCCVs: RawInstanceAddress[],
    partyId: PartyId,
  ): Promise<string> {
    const updateCmd: JsCommands = {
      commands: [
        {
          ExerciseCommand: {
            templateId: `#${this.ccipPackages.ccipReceiver}:CCIP.CCIPReceiver:CCIPReceiver`,
            contractId: receiverCid,
            choice: 'UpdateRequiredCCVs',
            choiceArgument: {
              newRequiredCCVs: requiredCCVs.map((ccv) => ccv.binding()),
            },
          },
        },
      ],
      commandId: `ccip-update-receiver-ccvs-${Date.now()}`,
      actAs: [partyId],
    }

    this.logger.debug(
      `CantonChain.updateReceiverRequiredCCVs: receiver=${receiverCid} ccvs=${requiredCCVs.map((addr) => addr.toString()).join(', ')}`,
    )
    const response = await this.submitCommands(updateCmd, 'Update CCIPReceiver requiredCCVs')
    const newCid = extractCreatedContractId(response.transaction, 'CCIPReceiver')
    if (!newCid) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'CantonChain.updateReceiverRequiredCCVs: CCIPReceiver created event not found in transaction',
      )
    }
    return newCid
  }

  /**
   * Find or create a `CCIPReceiver` contract whose `minBlockConfirmations` equals `finality`.
   *
   * The `OffRamp.PrepareExecute` Daml choice rejects messages whose `finality` field does not
   * match the receiver's `minBlockConfirmations`, so each distinct finality value needs its own
   * receiver instance.  This method first searches the ACS; if no match is found it creates a
   * fresh contract.
   */
  private async createReceiverForFinality(
    partyId: PartyId,
    finality: number,
    requiredCCVs: RawInstanceAddress[],
  ): Promise<string> {
    const attempts = 4
    let lastError: unknown

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const instanceId = `receiver-finality${finality}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const createCmd: JsCommands = {
        commands: [
          {
            CreateCommand: {
              templateId: `#${this.ccipPackages.ccipReceiver}:CCIP.CCIPReceiver:CCIPReceiver`,
              createArguments: {
                instanceId,
                owner: partyId,
                receiverFinalityConfig: encodeFinalityConfig(finality),
                requiredCCVs: requiredCCVs.map((ccv) => ccv.binding()),
                optionalCCVs: [],
                optionalThreshold: encodeDamlInt64(0),
              },
            },
          },
        ],
        commandId: `ccip-create-receiver-${Date.now()}-${attempt}`,
        actAs: [partyId],
      }

      try {
        this.logger.debug(
          `CantonChain.createReceiverForFinality: creating CCIPReceiver finality=${finality} instanceId=${instanceId} attempt=${attempt}/${attempts}`,
        )
        const response = await this.submitCommands(createCmd, 'Create CCIPReceiver')
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
    this.logger.debug('CantonChain.getVerifications...')
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

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(_router: string): Promise<Record<string, TokenInfo>> {
    const amuletToken = await this.getDefaultFeeToken()
    const linkToken = formatCantonLinkFeeToken(this.ccipParty)
    const [amuletInfo, linkInfo] = await Promise.all([
      this.getTokenInfo(amuletToken),
      this.getTokenInfo(linkToken),
    ])
    return {
      [amuletToken]: { ...amuletInfo, symbol: CANTON_FEE_TOKEN_CLI_SYMBOLS.native },
      [linkToken]: { ...linkInfo, symbol: CANTON_FEE_TOKEN_CLI_SYMBOLS.link },
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
    const holdings = await fetchTokenHoldings(this.ledgerApiClient, party, instrumentId)
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
    const requiredAmountDecimal = formatCantonDecimalAmountUnits(requiredAmount)
    const holding = holdings.find(
      (candidate) =>
        !feeCidSet.has(candidate.contractId) &&
        parseCantonDecimalAmountUnits(candidate.amount) >= requiredAmount,
    )
    if (!holding) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.generateUnsignedSendMessage: no unlocked holding for ${formatInstrumentId(instrumentId)} with at least ${requiredAmountDecimal}; pass message.extraArgs.tokenTransferHoldingCids`,
      )
    }
    return [holding]
  }

  /**
   * Ensure PerPartyRouter + CCIPSender disclosures exist for send.
   *
   * Creates missing contracts on demand. Canton authenticates via the ledger
   * JWT (OIDC / static / client-credentials), so no external signer is
   * required.
   */
  private async ensureSendDisclosures(
    partyId: PartyId,
  ): Promise<{ perPartyRouter: DisclosedContract; ccipSender: DisclosedContract }> {
    let found = await this.acsDisclosureProvider.findSendDisclosures()

    if (!found.perPartyRouter) {
      this.logger.debug(
        `CantonChain.ensureSendDisclosures: creating PerPartyRouter for party ${partyId}`,
      )
      await this.createPerPartyRouter(partyId)
      found = {
        ...found,
        perPartyRouter: await this.pollSendDisclosure('perPartyRouter', partyId),
      }
    }

    if (!found.ccipSender) {
      this.logger.debug(
        `CantonChain.ensureSendDisclosures: creating CCIPSender for party ${partyId}`,
      )
      await this.createCcipSender(partyId)
      found = {
        ...found,
        ccipSender: await this.pollSendDisclosure('ccipSender', partyId),
      }
    }

    return {
      perPartyRouter: found.perPartyRouter!,
      ccipSender: found.ccipSender!,
    }
  }

  /**
   * Create a `PerPartyRouter` for `party` via the EDS factory disclosure.
   */
  private async createPerPartyRouter(partyId: PartyId): Promise<void> {
    const perPartyRouterFactoryDisclosuresResponse = await this.edsProvider
      .ccipClientFor(this.ccipParty)
      .POST('/ccip/v1/global/PerPartyRouter/factory', {
        body: {
          partyID: partyId,
        },
      })
    if (perPartyRouterFactoryDisclosuresResponse.error) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `CantonChain.createPerPartyRouter: failed to fetch PerPartyRouterFactory disclosures for party ${partyId}: ${perPartyRouterFactoryDisclosuresResponse.error.error}`,
      )
    }

    const factoryTemplateId = `#${this.ccipPackages.perPartyRouter}:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouterFactory`
    const createCmd: JsCommands = {
      commands: [
        {
          ExerciseCommand: {
            templateId: factoryTemplateId,
            contractId: perPartyRouterFactoryDisclosuresResponse.data.contractId,
            choice: 'CreateRouter',
            choiceArgument: {
              partyOwner: partyId,
              instanceId: `router-${partyId}`,
            },
          },
        },
      ],
      commandId: `ccip-create-router-${Date.now()}`,
      actAs: [partyId],
      disclosedContracts: perPartyRouterFactoryDisclosuresResponse.data.disclosedContracts.map(
        (dc) => ({
          templateId: dc.templateId,
          contractId: dc.contractId,
          createdEventBlob: dc.createdEventBlob,
          synchronizerId: dc.synchronizerId,
        }),
      ),
    }
    await this.submitCommands(createCmd, 'Create PerPartyRouter')
  }

  /**
   * Create a `CCIPSender` contract for `party` when none exists in ACS.
   */
  private async createCcipSender(partyId: PartyId): Promise<void> {
    const instanceId = `sender-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const createCmd: JsCommands = {
      commands: [
        {
          CreateCommand: {
            templateId: `#${this.ccipPackages.ccipSender}:CCIP.CCIPSender:CCIPSender`,
            createArguments: {
              instanceId,
              owner: partyId,
            },
          },
        },
      ],
      commandId: `ccip-create-sender-${Date.now()}`,
      actAs: [partyId],
    }
    await this.submitCommands(createCmd, 'Create CCIPSender')
  }

  /**
   * Poll ACS until a send disclosure for `kind` is visible for `party`.
   */
  private async pollSendDisclosure(
    kind: 'perPartyRouter' | 'ccipSender',
    partyId: PartyId,
  ): Promise<DisclosedContract> {
    const deadline = Date.now() + CANTON_ACS_PROPAGATION_TIMEOUT_MS
    while (Date.now() < deadline) {
      const found = await this.acsDisclosureProvider.findSendDisclosures()
      const disclosure = found[kind]
      if (disclosure) return disclosure
      await sleep(CANTON_ACS_PROPAGATION_POLL_MS)
    }
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `CantonChain: timed out waiting for ${kind} to appear in ACS for party "${partyId}"`,
    )
  }

  // ─── Discovery helpers ──────────────────────────────────────────────────

  /**
   * Returns the registry-default fee token (Amulet) for this Canton chain.
   */
  private async getDefaultFeeToken(): Promise<string> {
    return this.nativeToken.instrumentId
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

    const holdings = await fetchTokenHoldings(
      this.ledgerApiClient,
      party,
      parseCantonInstrumentId(feeToken),
    )
    if (!holdings.length) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.sendMessage: no fee-token holdings found for party ${party} on instrument ${feeToken}`,
      )
    }

    const feeInstrument = parseCantonInstrumentId(feeToken)
    const excludeFromFee: string[] = []
    const tokenAmount = message.tokenAmounts?.[0]
    if (tokenAmount && tokenAmount.amount > 0n) {
      const tokenInstrument = parseCantonInstrumentId(tokenAmount.token)
      if (sameInstrumentId(feeInstrument, tokenInstrument)) {
        const tokenHoldingCid = excludeHoldingCidForTokenTransfer(
          holdings,
          formatCantonDecimalAmountUnits(tokenAmount.amount),
        )
        if (!tokenHoldingCid) {
          throw new CCIPError(
            CCIPErrorCode.METHOD_UNSUPPORTED,
            `CantonChain.sendMessage: no unlocked ${feeToken} holding with at least ${formatCantonDecimalAmountUnits(tokenAmount.amount)} for token transfer (fee and transfer share the same instrument)`,
          )
        }
        excludeFromFee.push(tokenHoldingCid)
      }
    }

    const feeTokenHoldingCids = selectFeeTokenHoldingCids(
      holdings,
      this.feeTransferFactoryAmount,
      excludeFromFee,
    )
    const minFeeUnits = parseCantonDecimalAmountUnits(this.feeTransferFactoryAmount)
    const feeSumUnits = sumCantonHoldingAmounts(holdings, feeTokenHoldingCids)
    if (feeSumUnits < minFeeUnits) {
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `CantonChain.sendMessage: combined fee-token holdings on ${feeToken} total ${formatCantonDecimalAmountUnits(feeSumUnits)}; transfer factory preview requires at least ${this.feeTransferFactoryAmount}`,
      )
    }

    if (feeTokenHoldingCids.length > 1) {
      this.logger.debug(
        `CantonChain.sendMessage: selected ${feeTokenHoldingCids.length} fee-token holdings (combined ${formatCantonDecimalAmountUnits(feeSumUnits)} ${feeToken}) for transfer-factory preview`,
      )
    }

    return {
      ...message,
      feeToken,
      extraArgs: { ...extraArgs, feeTokenHoldingCids },
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

    let destChainSelector = destRaw != null ? toBigIntSafe(destRaw) : undefined
    let sourceChainSelector = srcRaw != null ? toBigIntSafe(srcRaw) : undefined

    // CCIPMessageSentEvent on Canton omits sourceChainSelector; read both from the wire payload.
    if (sourceChainSelector == null || destChainSelector == null) {
      try {
        const selectors = readMessageV1ChainSelectors(sendResult.encodedMessage)
        sourceChainSelector ??= selectors.sourceChainSelector
        destChainSelector ??= selectors.destChainSelector
      } catch {
        if (sourceChainSelector == null || destChainSelector == null) return undefined
      }
    }

    let sender = typeof sentEvent?.sender === 'string' ? sentEvent.sender : ''
    let receiver = typeof sentEvent?.receiver === 'string' ? sentEvent.receiver : ''

    if (!sender && log.data && typeof log.data === 'object') {
      const rec = log.data as Record<string, unknown>
      const createArgs = (rec.create_arguments ?? rec.createArgument) as
        | Record<string, unknown>
        | undefined
      if (createArgs) {
        const flat = flattenCantonRecord(createArgs)
        if (typeof flat.sender === 'string') sender = flat.sender
      }
    }

    let onRampAddress = sendResult.onRampAddress ?? ''
    let offRampAddress = ''

    try {
      const decoded = decodeMessageV1(sendResult.encodedMessage)
      onRampAddress = decoded.onRampAddress || onRampAddress
      offRampAddress = decoded.offRampAddress
      if (!sender) sender = decoded.sender
      if (!receiver) receiver = decoded.receiver
    } catch {
      try {
        offRampAddress = readMessageV1OffRampAddress(sendResult.encodedMessage)
      } catch {
        // optional when wire layout is incomplete
      }
      try {
        if (!onRampAddress) onRampAddress = readMessageV1OnRampAddress(sendResult.encodedMessage)
      } catch {
        // optional when wire layout is incomplete
      }
    }

    return {
      messageId: sendResult.messageId,
      encodedMessage: normalizeCantonEncodedMessage(sendResult.encodedMessage),
      sourceChainSelector,
      destChainSelector,
      sequenceNumber: sendResult.sequenceNumber,
      nonce: sendResult.nonce ?? 0n,
      sender,
      receiver,
      onRampAddress,
      offRampAddress,
      data: normalizeCantonEncodedMessage(sendResult.encodedMessage),
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
   * Validates that `v` is a Canton ledger update ID: `1220` multihash prefix +
   * 64 hex chars, optionally `0x`-prefixed (see `isCantonUpdateId`).
   * Anything else — including CCIP message IDs (`0x` + 64 hex without the
   * `1220` prefix) — is rejected outright.
   */
  static isTxHash(v: unknown): v is string {
    return typeof v === 'string' && isCantonUpdateId(v)
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
   *
   * Canton lanes require GenericExtraArgsV3. Default `finality` to `finalized` when unset.
   * Empty `executor` is left for the source OnRamp lane `defaultExecutor` (no-execution on EVM → Canton).
   */
  static override buildMessageForDest(message: Parameters<ChainStatic['buildMessageForDest']>[0]) {
    const extraArgs = message.extraArgs
    const hasFinality = extraArgs != null && 'finality' in extraArgs && extraArgs.finality != null
    return super.buildMessageForDest(
      hasFinality
        ? message
        : {
            ...message,
            extraArgs: { ...extraArgs, finality: 'finalized' },
          },
    )
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

const CANTON_ACS_PROPAGATION_TIMEOUT_MS = 60_000
const CANTON_ACS_PROPAGATION_POLL_MS = 500

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

async function fetchTokenHoldings(
  ledgerApiClient: LedgerApiClient,
  party: string,
  instrumentId: CantonInstrumentId,
): Promise<TokenHoldingDetails[]> {
  const { offset = 0 } = await ledgerApiClient.getLedgerEnd()

  const responses = await ledgerApiClient.getActiveContracts({
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
    if (!amount || parseCantonDecimalAmountUnits(amount) <= 0n) continue
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
  const adminPartyId = parsePartyId(admin)
  return {
    admin: adminPartyId,
    id: id,
  }
}

function sameInstrumentId(a: CantonInstrumentId, b: CantonInstrumentId): boolean {
  return a.admin === b.admin && a.id === b.id
}

function formatInstrumentId(instrumentId: CantonInstrumentId): string {
  return `${instrumentId.id}@${instrumentId.admin}`
}

function hashCantonInstrumentId(instrumentId: CantonInstrumentId): string {
  return keccak256Utf8(`${instrumentId.id}@${instrumentId.admin}`)
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
  required: readonly CantonAddress[],
  verificationDestAddresses: readonly CantonAddress[],
): void {
  const missing = addressesMissing(verificationDestAddresses, required)
  if (missing.length) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `CantonChain.generateUnsignedExecute: token pool requires CCV result(s) not provided by verifications: ${missing.map((addr) => addr.instanceAddress().hex()).join(', ')}`,
    )
  }
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
