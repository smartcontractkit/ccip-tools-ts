import type { DisclosedContract } from './types.ts'
import { get, post } from '../client/client.ts'

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
}

/** CCIP message shape accepted by the global and external EDS endpoints. */
export interface EdsMessage {
  destinationChainSelector: string
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
  ccvs: string[]
  executor?: string
  feeTokenConfigCid: string
}

/** Result of `POST /ccip/v1/global/message/execute`. */
export interface EdsExecuteResult {
  contextData: Record<string, unknown>
  disclosedContracts: DisclosedContract[]
  tokenPool?: string
}

/** Result of external CCV and Executor disclosure endpoints. */
export interface EdsExternalDisclosureResult {
  contractId: string
  instanceAddress: string
  rawInstanceAddress: string
  contextData: Record<string, unknown>
  disclosedContracts: DisclosedContract[]
}

/** Result of external Token Pool send/execute disclosure endpoints. */
export interface EdsTokenPoolDisclosureResult extends EdsExternalDisclosureResult {
  requiredCCVs: string[]
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
  requiredCCVs?: string[]
  tokenInput?: EdsTokenInput
}

interface EdsTokenAdminRegistryResponse {
  tokenPool?: string
  pool?: string
  instanceAddress?: string
  rawInstanceAddress?: string
  address?: string
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

function ownerFromRawAddress(address: string): string | undefined {
  const rawSeparator = address.indexOf('@')
  if (rawSeparator < 0) return undefined
  const owner = address.slice(rawSeparator + 1)
  return owner.length > 0 ? owner : undefined
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
   * Raw addresses (`instanceId@owner`) select `externalEdsUrlsByOwner[owner]`
   * when configured; hashed addresses and unmapped owners fall back to the
   * global EDS base URL.
   */
  externalBaseUrlFor(address: string): string {
    const owner = ownerFromRawAddress(address)
    return (owner ? this.externalEdsUrlsByOwner[owner] : undefined) ?? this.edsBaseUrl
  }

  /** Fetch the token pool registered for a hashed Canton instrument ID. */
  async lookupTokenPool(instrumentIdHash: string): Promise<string> {
    const resp = await get<EdsTokenAdminRegistryResponse>(
      this.edsBaseUrl,
      `/ccip/v1/global/TokenAdminRegistry/token/${encodeURIComponent(instrumentIdHash)}`,
      EDS_HEADERS,
      this.timeoutMs,
    )
    return (
      resp.tokenPool ??
      resp.pool ??
      resp.rawInstanceAddress ??
      resp.instanceAddress ??
      resp.address ??
      ''
    )
  }

  /** Fetch global send disclosures for a CCIP message. */
  async fetchSendDisclosures(
    message: EdsMessage,
    senderRequiredCCVs: readonly string[] = [],
    tokenPoolRequiredCCVs: readonly string[] = [],
  ): Promise<EdsSendResult> {
    const resp = await post<EdsGlobalSendResponse>(
      this.edsBaseUrl,
      '/ccip/v1/global/message/send',
      EDS_HEADERS,
      this.timeoutMs,
      {
        message,
        senderRequiredCCVs: [...senderRequiredCCVs],
        tokenPoolRequiredCCVs: [...tokenPoolRequiredCCVs],
      },
    )
    return {
      contextData: contextDataOrEmpty(resp.contextData),
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
      ccvs: resp.ccvs ?? [],
      executor: resp.executor,
      feeTokenConfigCid: resp.feeTokenConfigCid ?? '',
    }
  }

  /** Fetch external Token Pool send disclosures. */
  async fetchTokenPoolSendDisclosure(
    address: string,
    message: EdsMessage,
  ): Promise<EdsTokenPoolDisclosureResult> {
    const resp = await post<EdsTokenPoolDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/tokenPool/${encodeURIComponent(address)}/send`,
      EDS_HEADERS,
      this.timeoutMs,
      { message },
    )
    return this.rawTokenPoolResult(resp)
  }

  /** Fetch external CCV send disclosures. */
  async fetchCcvSendDisclosure(
    address: string,
    message: EdsMessage,
  ): Promise<EdsExternalDisclosureResult> {
    const resp = await post<EdsExternalDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/ccv/${encodeURIComponent(address)}/send`,
      EDS_HEADERS,
      this.timeoutMs,
      { message },
    )
    return this.rawExternalResult(resp)
  }

  /** Fetch external Executor send disclosures. */
  async fetchExecutorSendDisclosure(
    address: string,
    message: EdsMessage,
    ccvs: readonly string[],
  ): Promise<EdsExternalDisclosureResult> {
    const resp = await post<EdsExternalDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/executor/${encodeURIComponent(address)}/send`,
      EDS_HEADERS,
      this.timeoutMs,
      { message, ccvs: [...ccvs] },
    )
    return this.rawExternalResult(resp)
  }

  /** Fetch global execute disclosures for an encoded CCIP message. */
  async fetchExecutionDisclosures(encodedMessage: string): Promise<EdsExecuteResult> {
    const resp = await post<EdsGlobalExecuteResponse>(
      this.edsBaseUrl,
      '/ccip/v1/global/message/execute',
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage },
    )
    return {
      contextData: contextDataOrEmpty(resp.contextData),
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
      tokenPool: resp.tokenPool,
    }
  }

  /** Fetch external Token Pool execute disclosures. */
  async fetchTokenPoolExecuteDisclosure(
    address: string,
    encodedMessage: string,
  ): Promise<EdsTokenPoolDisclosureResult> {
    const resp = await post<EdsTokenPoolDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/tokenPool/${encodeURIComponent(address)}/execute`,
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage },
    )
    return this.rawTokenPoolResult(resp)
  }

  /** Fetch external CCV execute disclosures. */
  async fetchCcvExecuteDisclosure(
    address: string,
    encodedMessage: string,
  ): Promise<EdsExternalDisclosureResult> {
    const resp = await post<EdsExternalDisclosureResponse>(
      this.externalBaseUrlFor(address),
      `/ccip/v1/external/ccv/${encodeURIComponent(address)}/execute`,
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage },
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
      instanceAddress: resp.instanceAddress,
      rawInstanceAddress: resp.rawInstanceAddress,
      contextData: contextDataOrEmpty(resp.contextData),
      disclosedContracts: contractsOrEmpty(resp.disclosedContracts),
    }
  }

  /** Convert a raw token pool endpoint response to the SDK shape. */
  private rawTokenPoolResult(resp: EdsTokenPoolDisclosureResponse): EdsTokenPoolDisclosureResult {
    return {
      ...this.rawExternalResult(resp),
      requiredCCVs: resp.requiredCCVs ?? [],
      tokenInput: resp.tokenInput,
    }
  }
}
