import {
  type CantonAddress,
  InstanceAddress,
  RawInstanceAddress,
  parseInstanceAddress,
} from '../addressCodec.ts'
import { get, post } from '../client/client.ts'
import type { DisclosedContract } from './types.ts'

/**
 * Configuration for the EDS-based disclosure provider.
 */
export interface EdsDisclosureConfig {
  /** Base URL of the global CCIP EDS instance, e.g. `http://eds-host:8090`. */
  edsBaseUrl: string
  /**
   * Optional mapping from a RawInstanceAddress owner party to the owner-hosted
   * external EDS base URL. If an owner is absent, `edsBaseUrl` is used.
   */
  externalEdsUrlsByOwner?: Record<string, string>
  /** Optional request timeout in milliseconds (default: 10_000). */
  timeoutMs?: number
}

/** Canton instrument as represented in the EDS API. */
export interface EdsInstrumentId {
  admin: string
  id: string
}

/** Executor selector carried in an EDS CCIP message. */
export interface EdsExecutor {
  type: '' | 'noExecutor' | 'withAddress'
  address?: string
}

/** Optional token transfer carried in an EDS CCIP message. */
export interface EdsTokenTransfer {
  token: EdsInstrumentId
  amount: string
  holdingContractIds: string[]
}

/** CCIP message shape accepted by the global and external EDS endpoints. */
export interface EdsMessage {
  destinationChainSelector: string
  sender: string
  receiver: string
  payload: string
  tokenTransfer: EdsTokenTransfer | null
  feeToken: EdsInstrumentId
  executor: EdsExecutor
}

/** Token input returned by external Token Pool EDS endpoints. */
export interface EdsTokenInput {
  transferFactory: string
  extraArgs: {
    context: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
  tokenPoolHoldings: string[]
}

/** Result of `POST /ccip/v1/global/message/send`. */
export interface EdsSendResult {
  contextData: Record<string, unknown>
  disclosedContracts: DisclosedContract[]
  ccvs: CantonAddress[]
  executor?: CantonAddress
  feeTokenConfigCid: string
}

/** Result of `POST /ccip/v1/global/message/execute`. */
export interface EdsExecuteResult {
  contextData: Record<string, unknown>
  disclosedContracts: DisclosedContract[]
  tokenPool?: RawInstanceAddress
}

/** Result of external CCV and Executor disclosure endpoints. */
export interface EdsExternalDisclosureResult {
  contractId: string
  instanceAddress: InstanceAddress
  rawInstanceAddress: RawInstanceAddress
  contextData: Record<string, unknown>
  disclosedContracts: DisclosedContract[]
}

/** Result of external Token Pool send/execute disclosure endpoints. */
export interface EdsTokenPoolDisclosureResult extends EdsExternalDisclosureResult {
  requiredCCVs: CantonAddress[]
  tokenInput?: EdsTokenInput
}

/**
 * Result of a `fetchPerPartyRouterFactoryDisclosures()` call.
 */
export interface EdsPerPartyRouterFactoryResult {
  /** The Contract ID of the PerPartyRouterFactory. */
  contractId: string
  /** Backward-compatible alias for `contractId`. */
  perPartyRouterFactoryId: string
  /** Hashed InstanceAddress of the factory. */
  instanceAddress: string
  /** Raw InstanceAddress of the factory. */
  rawInstanceAddress: string
  /** Disclosures for all contracts required to instantiate a PerPartyRouter. */
  disclosedContracts: DisclosedContract[]
}

interface EdsApiDisclosedContract {
  templateId: string
  contractId: string
  createdEventBlob: string
  synchronizerId: string
}

interface EdsGlobalSendResponse {
  contextData?: Record<string, unknown>
  disclosedContracts?: EdsApiDisclosedContract[]
  ccvs?: string[]
  executor?: string
  feeTokenConfigCid?: string
}

interface EdsGlobalExecuteResponse {
  contextData?: Record<string, unknown>
  disclosedContracts?: EdsApiDisclosedContract[]
  tokenPool?: string
}

interface EdsExternalDisclosureResponse {
  contractId: string
  instanceAddress: string
  rawInstanceAddress: string
  contextData?: Record<string, unknown>
  disclosedContracts?: EdsApiDisclosedContract[]
}

interface EdsTokenPoolDisclosureResponse extends EdsExternalDisclosureResponse {
  requiredCCVs: string[]
  tokenInput?: EdsTokenInput
}

interface EdsTokenAdminRegistryResponse {
  rawInstanceAddress?: string
}

interface EdsPerPartyRouterFactoryResponse {
  contractId: string
  instanceAddress: string
  rawInstanceAddress: string
  disclosedContracts?: EdsApiDisclosedContract[]
}

const EDS_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

function edsContractToSdk(c: EdsApiDisclosedContract): DisclosedContract {
  return {
    templateId: c.templateId,
    contractId: c.contractId,
    createdEventBlob: c.createdEventBlob,
    synchronizerId: c.synchronizerId,
  }
}

function contextDataOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : { values: {} }
}

function contractsOrEmpty(value: EdsApiDisclosedContract[] | undefined): DisclosedContract[] {
  return (value ?? []).map(edsContractToSdk)
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

/**
 * Disclosure provider that speaks the split CCIP EDS API:
 * global CCIP endpoints plus owner-hosted Token Pool, CCV, and Executor endpoints.
 */
export class EdsDisclosureProvider {
  private readonly edsBaseUrl: string
  private readonly externalEdsUrlsByOwner: Record<string, string>
  private readonly timeoutMs: number

  /**
   * Create an EDS disclosure provider for global and external split APIs.
   */
  constructor(config: EdsDisclosureConfig) {
    this.edsBaseUrl = stripTrailingSlash(config.edsBaseUrl)
    this.externalEdsUrlsByOwner = Object.fromEntries(
      Object.entries(config.externalEdsUrlsByOwner ?? {}).map(([owner, url]) => [
        owner,
        stripTrailingSlash(url),
      ]),
    )
    this.timeoutMs = config.timeoutMs ?? 10_000
  }

  /**
   * Resolve the EDS base URL for an external endpoint owner.
   *
   * RawInstanceAddresses select `externalEdsUrlsByOwner[owner]`
   * when configured; InstanceAddresses and unmapped owners fall back to the
   * global EDS base URL.
   */
  externalBaseUrlFor(address: CantonAddress): string {
    if (address instanceof RawInstanceAddress) {
      return this.externalEdsUrlsByOwner[address.owner] ?? this.edsBaseUrl
    }
    return this.edsBaseUrl
  }

  /** Fetch the token pool registered for a hashed Canton instrument ID. */
  async lookupTokenPool(instrumentIdHash: string): Promise<RawInstanceAddress | undefined> {
    const resp = await get<EdsTokenAdminRegistryResponse>(
      this.edsBaseUrl,
      `/ccip/v1/global/TokenAdminRegistry/token/${encodeURIComponent(instrumentIdHash)}`,
      EDS_HEADERS,
      this.timeoutMs,
    )
    return resp.rawInstanceAddress
      ? RawInstanceAddress.fromString(resp.rawInstanceAddress)
      : undefined
  }

  /** Fetch global send disclosures for a CCIP message. */
  async fetchSendDisclosures(
    message: EdsMessage,
    senderRequiredCCVs: readonly CantonAddress[] = [],
    tokenPoolRequiredCCVs: readonly CantonAddress[] = [],
  ): Promise<EdsSendResult> {
    const resp = await post<EdsGlobalSendResponse>(
      this.edsBaseUrl,
      '/ccip/v1/global/message/send',
      EDS_HEADERS,
      this.timeoutMs,
      {
        message,
        senderRequiredCCVs: senderRequiredCCVs.map((addr) => addr.instanceAddress().hex()),
        tokenPoolRequiredCCVs: tokenPoolRequiredCCVs.map((addr) => addr.instanceAddress().hex()),
      },
    )
    return {
      contextData: contextDataOrEmpty(resp.contextData),
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
      ccvs: resp.ccvs?.map(parseInstanceAddress) ?? [],
      executor: parseInstanceAddress(resp.executor),
      feeTokenConfigCid: resp.feeTokenConfigCid ?? '',
    }
  }

  /** Fetch external Token Pool send disclosures. */
  async fetchTokenPoolSendDisclosure(
    address: CantonAddress,
    message: EdsMessage,
  ): Promise<EdsTokenPoolDisclosureResult> {
    const resp = await post<EdsTokenPoolDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/tokenPool/${encodeURIComponent(address.instanceAddress().hex())}/send`,
      EDS_HEADERS,
      this.timeoutMs,
      { message },
    )
    return this.rawTokenPoolResult(resp)
  }

  /** Fetch external CCV send disclosures. */
  async fetchCcvSendDisclosure(
    address: CantonAddress,
    message: EdsMessage,
  ): Promise<EdsExternalDisclosureResult> {
    const resp = await post<EdsExternalDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/ccv/${encodeURIComponent(address.instanceAddress().hex())}/send`,
      EDS_HEADERS,
      this.timeoutMs,
      { message },
    )
    return this.rawExternalResult(resp)
  }

  /** Fetch external Executor send disclosures. */
  async fetchExecutorSendDisclosure(
    address: CantonAddress,
    message: EdsMessage,
    ccvs: readonly CantonAddress[],
  ): Promise<EdsExternalDisclosureResult> {
    const resp = await post<EdsExternalDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/executor/${encodeURIComponent(address.instanceAddress().hex())}/send`,
      EDS_HEADERS,
      this.timeoutMs,
      { message, ccvs: [...ccvs] },
    )
    return this.rawExternalResult(resp)
  }

  /** Fetch global execute disclosures for an encoded CCIP message. */
  async fetchExecutionDisclosures(
    encodedMessage: string,
    receiver: string,
  ): Promise<EdsExecuteResult> {
    const resp = await post<EdsGlobalExecuteResponse>(
      this.edsBaseUrl,
      '/ccip/v1/global/message/execute',
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage, receiver },
    )
    return {
      contextData: contextDataOrEmpty(resp.contextData),
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
      tokenPool: resp.tokenPool ? RawInstanceAddress.fromString(resp.tokenPool) : undefined,
    }
  }

  /** Fetch external Token Pool execute disclosures. */
  async fetchTokenPoolExecuteDisclosure(
    address: CantonAddress,
    encodedMessage: string,
    receiver: string,
  ): Promise<EdsTokenPoolDisclosureResult> {
    const resp = await post<EdsTokenPoolDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/tokenPool/${encodeURIComponent(address.instanceAddress().hex())}/execute`,
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage, receiver },
    )
    return this.rawTokenPoolResult(resp)
  }

  /** Fetch external CCV execute disclosures. */
  async fetchCcvExecuteDisclosure(
    address: CantonAddress,
    encodedMessage: string,
    receiver: string,
  ): Promise<EdsExternalDisclosureResult> {
    const resp = await post<EdsExternalDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/ccv/${encodeURIComponent(address.instanceAddress().hex())}/execute`,
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage, receiver },
    )
    return this.rawExternalResult(resp)
  }

  /**
   * Fetch the explicit disclosures required to instantiate a PerPartyRouter
   * using the PerPartyRouterFactory.
   */
  async fetchPerPartyRouterFactoryDisclosures(
    partyID: string,
  ): Promise<EdsPerPartyRouterFactoryResult> {
    const resp = await post<EdsPerPartyRouterFactoryResponse>(
      this.edsBaseUrl,
      '/ccip/v1/global/PerPartyRouter/factory',
      EDS_HEADERS,
      this.timeoutMs,
      { partyID },
    )
    return {
      contractId: resp.contractId,
      perPartyRouterFactoryId: resp.contractId,
      instanceAddress: resp.instanceAddress,
      rawInstanceAddress: resp.rawInstanceAddress,
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
    }
  }

  /** Convert a raw external endpoint response to the SDK shape. */
  private rawExternalResult(resp: EdsExternalDisclosureResponse): EdsExternalDisclosureResult {
    return {
      contractId: resp.contractId,
      instanceAddress: InstanceAddress.fromHex(resp.instanceAddress),
      rawInstanceAddress: RawInstanceAddress.fromString(resp.rawInstanceAddress),
      contextData: contextDataOrEmpty(resp.contextData),
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
    }
  }

  /** Convert a raw token pool endpoint response to the SDK shape. */
  private rawTokenPoolResult(resp: EdsTokenPoolDisclosureResponse): EdsTokenPoolDisclosureResult {
    return {
      ...this.rawExternalResult(resp),
      requiredCCVs: resp.requiredCCVs.map(parseInstanceAddress),
      tokenInput: resp.tokenInput,
    }
  }
}
