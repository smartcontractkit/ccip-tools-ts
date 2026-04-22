import type { DisclosedContract } from './types.ts'
import { get, post } from '../client/client.ts'

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

const EDS_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

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
    const resp = await post<EdsCCIPSendResponse>(
      this.edsBaseUrl,
      '/ccip/v1/message/send',
      EDS_HEADERS,
      this.timeoutMs,
      { ccvs },
    )
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
   * @param encodedMessage - The hex-encoded CCIP message to be executed (without `0x` prefix).
   * @param ccvs - InstanceAddresses of all CCVs that should verify the message.
   * @returns `EdsExecuteResult` containing the `choiceContext` and the per-CCV
   *   disclosure map (`ccvs`).
   */
  async fetchExecutionDisclosures(
    encodedMessage: string,
    ccvs: string[],
  ): Promise<EdsExecuteResult> {
    const resp = await post<EdsCCIPExecuteResponse>(
      this.edsBaseUrl,
      '/ccip/v1/message/execute',
      EDS_HEADERS,
      this.timeoutMs,
      { encodedMessage, ccvs },
    )
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
    const resp = await post<EdsPerPartyRouterFactoryResponse>(
      this.edsBaseUrl,
      '/ccip/v1/perPartyRouter/factory',
      EDS_HEADERS,
      this.timeoutMs,
      { partyID },
    )
    return {
      perPartyRouterFactoryId: resp.perPartyRouterFactoryId,
      disclosedContracts: resp.disclosedContracts.map(edsContractToSdk),
    }
  }

  /**
   * Filter `ccvs` to only those that this EDS instance can serve.
   *
   * Probes each CCV via `GET /ccip/v1/disclosure/{instanceAddress}` with a
   * single attempt (no retries) so that invalid CCVs are detected quickly
   * without incurring retry delays. Returns only the addresses that succeed.
   *
   * Use this before {@link fetchSendDisclosures} when CCVs are discovered
   * dynamically and some may not be registered with this EDS instance.
   *
   * @param ccvs - CCV InstanceAddresses to probe.
   * @returns The subset of `ccvs` that the EDS can serve.
   */
  async filterValidCCVsForSend(ccvs: string[]): Promise<string[]> {
    const results = await Promise.allSettled(
      ccvs.map((addr) =>
        get<EdsApiDisclosedContract>(
          this.edsBaseUrl,
          `/ccip/v1/disclosure/${encodeURIComponent(addr)}`,
          EDS_HEADERS,
          this.timeoutMs,
          undefined, // no query params
        ),
      ),
    )
    return ccvs.filter((_, i) => results[i]!.status === 'fulfilled')
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
    const resp = await get<EdsApiDisclosedContract>(
      this.edsBaseUrl,
      `/ccip/v1/disclosure/${encodeURIComponent(instanceAddress)}`,
      EDS_HEADERS,
      this.timeoutMs,
    )
    return edsContractToSdk(resp)
  }
}
