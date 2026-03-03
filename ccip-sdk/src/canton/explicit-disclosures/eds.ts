import type { DisclosedContract } from './types.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'

/**
 * Configuration for the EDS-based disclosure provider.
 * Requires only the EDS base URL — no direct ledger access needed.
 */
export interface EdsDisclosureConfig {
  /** Base URL of the running EDS instance, e.g. `http://eds-host:8090` */
  edsBaseUrl: string
  /** Optional request timeout in milliseconds (default: 10_000) */
  timeoutMs?: number
}

/**
 * The context returned by the EDS for a send or execute request.
 *
 * Corresponds to `ChoiceContext` in the EDS OpenAPI spec.
 * - `choiceContextData` must be included as additional data when exercising the Canton choice.
 * - `disclosedContracts` must be attached to the Canton command submission.
 */
export interface EdsChoiceContext {
  /** Additional opaque data required when exercising the Canton choice. */
  choiceContextData: unknown
  /** Contracts that must be explicitly disclosed in the command submission. */
  disclosedContracts: DisclosedContract[]
}

/**
 * The result of an explicit disclosure lookup for a single contract.
 *
 * Corresponds to `OptionalDisclosure` in the EDS OpenAPI spec.
 * - If the EDS can serve a disclosure directly, `disclosedContract` is populated.
 * - If the contract's owner registered it with the global EDS registry but this
 *   EDS cannot serve it, `registeredContract` points to the owning EDS.
 */
export interface OptionalDisclosure {
  /** The disclosed contract, if this EDS can serve it. */
  disclosedContract?: DisclosedContract
  /** Redirect information when the disclosure must be fetched from another EDS. */
  registeredContract?: RegisteredContract
}

/**
 * Information about a contract registered with the global EDS registry whose
 * disclosure must be fetched from a different EDS instance.
 *
 * Corresponds to `RegisteredContract` in the EDS OpenAPI spec.
 */
export interface RegisteredContract {
  /** The party ID of the contract owner. */
  owner: string
  /** The URL of the EDS that can serve an explicit disclosure for this contract. */
  edsURL: string
}

/**
 * Result of a `fetchSendDisclosures()` call.
 *
 * Corresponds to `CCIPSendResponse` in the EDS OpenAPI spec.
 */
export interface EdsSendResult {
  /** Choice context (data + disclosed contracts) for the Canton command submission. */
  choiceContext: EdsChoiceContext
  /**
   * Per-CCV disclosure results, keyed by the CCV InstanceAddress.
   * Each entry is either a locally-resolved disclosure or a redirect to another EDS.
   */
  ccvs: Record<string, OptionalDisclosure>
}

/**
 * Result of a `fetchExecutionDisclosures()` call.
 *
 * Corresponds to `CCIPExecuteResponse` in the EDS OpenAPI spec.
 */
export interface EdsExecuteResult {
  /** Choice context (data + disclosed contracts) for the Canton command submission. */
  choiceContext: EdsChoiceContext
  /**
   * Per-CCV disclosure results, keyed by the CCV InstanceAddress.
   * Each entry is either a locally-resolved disclosure or a redirect to another EDS.
   */
  ccvs: Record<string, OptionalDisclosure>
}

/**
 * Result of a `fetchPerPartyRouterFactoryDisclosures()` call.
 *
 * Corresponds to `CCIPPerPartyRouterFactoryResponse` in the EDS OpenAPI spec.
 */
export interface EdsPerPartyRouterFactoryResult {
  /** The Contract ID of the PerPartyRouterFactory. */
  perPartyRouterFactoryId: string
  /** Disclosures for all contracts required to instantiate a PerPartyRouter. */
  disclosedContracts: DisclosedContract[]
}

/**
 * A single disclosed contract as returned by the EDS API.
 * `templateId` is already a flat colon-delimited string (`"<pkgId>:Module:Entity"`).
 */
interface EdsApiDisclosedContract {
  templateId: string
  contractId: string
  createdEventBlob: string
  synchronizerId: string
}

/** `OptionalDisclosure` as returned by the EDS API. */
interface EdsApiOptionalDisclosure {
  disclosedContract?: EdsApiDisclosedContract
  registeredContract?: { owner: string; edsURL: string }
}

/** `ChoiceContext` object returned from send/execute endpoints. */
interface EdsApiChoiceContext {
  choiceContextData: unknown
  disclosedContracts: EdsApiDisclosedContract[]
}

/** Response body of `POST /ccip/v1/message/send`. */
interface EdsCCIPSendResponse {
  choiceContext: EdsApiChoiceContext
  ccvs: Record<string, EdsApiOptionalDisclosure>
}

/** Response body of `POST /ccip/v1/message/execute`. */
interface EdsCCIPExecuteResponse {
  choiceContext: EdsApiChoiceContext
  ccvs: Record<string, EdsApiOptionalDisclosure>
}

/** Response body of `POST /ccip/v1/perPartyRouter/factory`. */
interface EdsPerPartyRouterFactoryResponse {
  perPartyRouterFactoryId: string
  disclosedContracts: EdsApiDisclosedContract[]
}

/** EDS error response body. */
interface EdsErrorResponse {
  error: string
  details?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edsContractToSdk(c: EdsApiDisclosedContract): DisclosedContract {
  return {
    templateId: c.templateId,
    contractId: c.contractId,
    createdEventBlob: c.createdEventBlob,
    synchronizerId: c.synchronizerId,
  }
}

function rawOptionalDisclosureToSdk(raw: EdsApiOptionalDisclosure): OptionalDisclosure {
  const result: OptionalDisclosure = {}
  if (raw.disclosedContract) {
    result.disclosedContract = edsContractToSdk(raw.disclosedContract)
  }
  if (raw.registeredContract) {
    result.registeredContract = raw.registeredContract
  }
  return result
}

function rawCcvsToSdk(
  raw: Record<string, EdsApiOptionalDisclosure>,
): Record<string, OptionalDisclosure> {
  const result: Record<string, OptionalDisclosure> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[key] = rawOptionalDisclosureToSdk(value)
  }
  return result
}

function rawContextToSdk(raw: EdsApiChoiceContext): EdsChoiceContext {
  return {
    choiceContextData: raw.choiceContextData,
    disclosedContracts: raw.disclosedContracts.map(edsContractToSdk),
  }
}

async function edsFetch<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `EDS request failed for ${url}: ${msg}. Ensure the EDS is running and reachable.`,
      { cause: err instanceof Error ? err : undefined },
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const errBody = (await response.json()) as EdsErrorResponse
      detail = ` ${errBody.error}${errBody.details ? `: ${errBody.details}` : ''}`
    } catch {
      detail = ` HTTP ${response.status}`
    }
    throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, `EDS${detail} — URL: ${url}`)
  }

  return response.json() as Promise<T>
}

async function edsPost<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  return edsFetch<T>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )
}

async function edsGet<T>(url: string, timeoutMs: number): Promise<T> {
  return edsFetch<T>(url, { method: 'GET' }, timeoutMs)
}

/**
 * Disclosure provider that fetches explicit disclosures from a running EDS instance
 * using the CCIP Explicit Disclosure API
 */
export class EdsDisclosureProvider {
  private readonly edsBaseUrl: string
  private readonly timeoutMs: number

  /**
   * Create an `EdsDisclosureProvider` from an EDS connection configuration.
   *
   * @param config - EDS connection configuration.
   */
  constructor(config: EdsDisclosureConfig) {
    this.edsBaseUrl = config.edsBaseUrl.replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? 10_000
  }

  /**
   * Fetch the explicit disclosures required to send a CCIP message to Canton.
   *
   * Calls `POST /ccip/v1/message/send`.
   *
   * @param ccvs - InstanceAddresses of all CCVs that should verify the message.
   * @returns `EdsSendResult` containing the `choiceContext` and the per-CCV
   *   disclosure map (`ccvs`).
   */
  async fetchSendDisclosures(ccvs: string[]): Promise<EdsSendResult> {
    const url = `${this.edsBaseUrl}/ccip/v1/message/send`
    const resp = await edsPost<EdsCCIPSendResponse>(url, { ccvs }, this.timeoutMs)
    return {
      choiceContext: rawContextToSdk(resp.choiceContext),
      ccvs: rawCcvsToSdk(resp.ccvs),
    }
  }

  /**
   * Fetch the explicit disclosures required to execute a CCIP message on Canton.
   *
   * Calls `POST /ccip/v1/message/execute`.
   *
   * @param messageID - The message ID of the CCIP message to be executed.
   * @param ccvs - InstanceAddresses of all CCVs that should verify the message.
   * @returns `EdsExecuteResult` containing the `choiceContext` and the per-CCV
   *   disclosure map (`ccvs`).
   */
  async fetchExecutionDisclosures(messageID: string, ccvs: string[]): Promise<EdsExecuteResult> {
    const url = `${this.edsBaseUrl}/ccip/v1/message/execute`
    const resp = await edsPost<EdsCCIPExecuteResponse>(url, { messageID, ccvs }, this.timeoutMs)
    return {
      choiceContext: rawContextToSdk(resp.choiceContext),
      ccvs: rawCcvsToSdk(resp.ccvs),
    }
  }

  /**
   * Fetch the explicit disclosures required to instantiate a PerPartyRouter
   * using the PerPartyRouterFactory.
   *
   * Calls `POST /ccip/v1/perPartyRouter/factory`.
   *
   * @param partyID - The Daml party ID of the caller.
   * @returns `EdsPerPartyRouterFactoryResult` containing the factory contract ID
   *   and all `disclosedContracts` needed to instantiate a PerPartyRouter.
   */
  async fetchPerPartyRouterFactoryDisclosures(
    partyID: string,
  ): Promise<EdsPerPartyRouterFactoryResult> {
    const url = `${this.edsBaseUrl}/ccip/v1/perPartyRouter/factory`
    const resp = await edsPost<EdsPerPartyRouterFactoryResponse>(url, { partyID }, this.timeoutMs)
    return {
      perPartyRouterFactoryId: resp.perPartyRouterFactoryId,
      disclosedContracts: resp.disclosedContracts.map(edsContractToSdk),
    }
  }

  /**
   * Fetch the explicit disclosure for a single contract by its InstanceAddress.
   *
   * Calls `GET /ccip/v1/disclosure/{instanceAddress}`.
   *
   * @param instanceAddress - The InstanceAddress of the contract.
   * @returns The `DisclosedContract` for the requested contract.
   */
  async fetchDisclosure(instanceAddress: string): Promise<DisclosedContract> {
    const url = `${this.edsBaseUrl}/ccip/v1/disclosure/${encodeURIComponent(instanceAddress)}`
    const resp = await edsGet<EdsApiDisclosedContract>(url, this.timeoutMs)
    return edsContractToSdk(resp)
  }
}
